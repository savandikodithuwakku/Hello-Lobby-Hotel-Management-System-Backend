import mongoose from "mongoose";
import { toDateString } from "../../shared/utils/date.util.js";
import { money } from "../../shared/utils/money.util.js";
import {
  BLOCKING_STATUSES,
  POLICY,
  RESERVATION_STATUSES,
  RESERVATION_STATUS_VALUES,
  nightsBetween,
} from "./reservation.constants.js";

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Service name is required"],
      trim: true,
      maxlength: [POLICY.SERVICE_NAME_MAX, "Service name is too long"],
    },
    unitPrice: {
      type: Number,
      required: [true, "Service price is required"],
      min: [0, "Service price cannot be negative"],
    },
    quantity: {
      type: Number,
      default: 1,
      min: [1, "Quantity must be at least 1"],
    },
  },
  { _id: false }
);

const historySchema = new mongoose.Schema(
  {
    status: { type: String, enum: RESERVATION_STATUS_VALUES, required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, trim: true, maxlength: [POLICY.NOTE_MAX, "Note is too long"], default: "" },
  },
  { _id: false }
);

/**
 * A booking of one room for one date range.
 *
 * Dates are stored as UTC midnights and the stay is half-open - `checkOut` is
 * the morning the guest leaves, so the room is free for someone else to arrive
 * that same day. Every overlap check in the system relies on that.
 *
 * Prices are snapshots. A reservation keeps the nightly rate it was made at, so
 * repricing a room tomorrow never rewrites what a guest already agreed to pay.
 */
const reservationSchema = new mongoose.Schema(
  {
    /** Human-readable booking reference, e.g. RSV-20260826-4F7A. */
    reference: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Customer is required"],
      index: true,
    },
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: [true, "Room is required"],
      index: true,
    },
    /** Kept alongside the room so reports can group by type without a join. */
    roomType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RoomType",
      required: true,
    },
    checkIn: {
      type: Date,
      required: [true, "Check-in date is required"],
      index: true,
    },
    checkOut: {
      type: Date,
      required: [true, "Check-out date is required"],
      index: true,
    },
    nights: {
      type: Number,
      required: true,
      min: [1, "A stay must be at least one night"],
    },
    guests: {
      type: Number,
      required: [true, "Number of guests is required"],
      min: [1, "At least one guest is required"],
      max: [POLICY.MAX_GUESTS, "Too many guests"],
    },
    status: {
      type: String,
      enum: RESERVATION_STATUS_VALUES,
      default: RESERVATION_STATUSES.PENDING,
      index: true,
    },
    pricing: {
      /** Nightly rate agreed at booking time. Never recalculated. */
      roomRate: { type: Number, required: true, min: 0 },
      roomSubtotal: { type: Number, required: true, min: 0 },
      servicesSubtotal: { type: Number, default: 0, min: 0 },
      /**
       * What the guest consumed during the stay - a minibar, laundry, a late
       * checkout. Kept apart from `servicesSubtotal`, which is what was agreed
       * when the booking was made: the two answer different questions and a
       * guest querying their bill needs to see which is which.
       *
       * The itemised lines live on the invoice, in the payments module. Only
       * the total is mirrored here, so the booking still knows what it is
       * worth without the reservation module having to know about billing.
       */
      extraCharges: { type: Number, default: 0, min: 0 },
      totalAmount: { type: Number, required: true, min: 0 },
    },
    additionalServices: {
      type: [serviceSchema],
      default: [],
    },
    payment: {
      /** What must be paid up front for the booking to be confirmed. */
      advanceAmount: { type: Number, required: true, min: 0 },
      amountPaid: { type: Number, default: 0, min: 0 },
      /** When the advance must be in, or the hold lapses. */
      advanceDeadline: { type: Date, required: true },
      /** When the rest must be in - departure day, when the guest settles up. */
      balanceDeadline: { type: Date, required: true },
      lastPaymentAt: { type: Date, default: null },
    },
    specialRequests: {
      type: String,
      trim: true,
      maxlength: [POLICY.NOTE_MAX, "Special requests are too long"],
      default: "",
    },
    checkedInAt: { type: Date, default: null },
    checkedOutAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: {
      type: String,
      trim: true,
      maxlength: [POLICY.NOTE_MAX, "Reason is too long"],
      default: "",
    },
    /** Every status change, in order, with who did it and why. */
    history: {
      type: [historySchema],
      default: [],
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/**
 * The index the overlap query runs on. Room first, then status, then the dates:
 * "which live bookings does this room already have around these days".
 */
reservationSchema.index({ room: 1, status: 1, checkIn: 1, checkOut: 1 });
reservationSchema.index({ customer: 1, createdAt: -1 });

/** What is still owed. */
reservationSchema.virtual("balanceDue").get(function balanceDue() {
  return money(this.pricing.totalAmount - this.payment.amountPaid);
});

reservationSchema.virtual("advanceSettled").get(function advanceSettled() {
  return this.payment.amountPaid >= this.payment.advanceAmount;
});

reservationSchema.virtual("fullySettled").get(function fullySettled() {
  return this.payment.amountPaid >= this.pricing.totalAmount;
});

/** Past its advance deadline with the advance still unpaid. */
reservationSchema.virtual("advanceOverdue").get(function advanceOverdue() {
  return (
    !this.advanceSettled &&
    this.status === RESERVATION_STATUSES.PENDING &&
    this.payment.advanceDeadline.getTime() < Date.now()
  );
});

/** Recomputes every derived amount from the rate, the nights and the services. */
reservationSchema.methods.recalculateTotals = function recalculateTotals() {
  const roomSubtotal = money(this.pricing.roomRate * this.nights);
  const servicesSubtotal = money(
    this.additionalServices.reduce(
      (sum, service) => sum + service.unitPrice * (service.quantity || 1),
      0
    )
  );

  this.pricing.roomSubtotal = roomSubtotal;
  this.pricing.servicesSubtotal = servicesSubtotal;
  this.pricing.totalAmount = money(roomSubtotal + servicesSubtotal + this.pricing.extraCharges);

  // The advance is what the guest had to pay to hold the room, and it is fixed
  // the moment the booking is confirmed. Recalculating it afterwards would mean
  // a guest who ordered a sandwich on their second night was suddenly told they
  // had not paid enough to confirm a booking they checked into yesterday.
  if (this.status === RESERVATION_STATUSES.PENDING) {
    this.payment.advanceAmount = money(
      (this.pricing.totalAmount * POLICY.ADVANCE_PERCENTAGE) / 100
    );
  }

  return this;
};

reservationSchema.methods.recordHistory = function recordHistory(status, { by = null, note = "" } = {}) {
  this.history.push({ status, at: new Date(), by, note });
  return this;
};

/** True while this booking holds its room today. */
reservationSchema.methods.isCurrent = function isCurrent(reference = new Date()) {
  return (
    BLOCKING_STATUSES.includes(this.status) &&
    this.checkIn.getTime() <= reference.getTime() &&
    this.checkOut.getTime() > reference.getTime()
  );
};

const populatedName = (value) => (value && value.name !== undefined ? value : null);

reservationSchema.methods.toSafeObject = function toSafeObject(extra = {}) {
  const customer = populatedName(this.customer);
  const room = this.room && this.room.roomNumber !== undefined ? this.room : null;
  const roomType = populatedName(this.roomType);

  return {
    id: this._id.toString(),
    reference: this.reference,
    status: this.status,

    customer: customer
      ? {
          id: customer._id.toString(),
          name: customer.name,
          email: customer.email,
          phone: customer.phone ?? null,
        }
      : { id: this.customer?.toString() ?? null },

    room: room
      ? {
          id: room._id.toString(),
          roomNumber: room.roomNumber,
          floor: room.floor,
          occupancy: room.occupancy,
          housekeeping: room.housekeeping,
        }
      : { id: this.room?.toString() ?? null },

    roomType: roomType
      ? { id: roomType._id.toString(), name: roomType.name, maxOccupancy: roomType.maxOccupancy }
      : { id: this.roomType?.toString() ?? null },

    checkIn: this.checkIn,
    checkOut: this.checkOut,
    nights: this.nights,
    guests: this.guests,

    pricing: {
      roomRate: this.pricing.roomRate,
      roomSubtotal: this.pricing.roomSubtotal,
      servicesSubtotal: this.pricing.servicesSubtotal,
      extraCharges: this.pricing.extraCharges,
      totalAmount: this.pricing.totalAmount,
    },
    additionalServices: this.additionalServices.map((service) => ({
      name: service.name,
      unitPrice: service.unitPrice,
      quantity: service.quantity,
      lineTotal: money(service.unitPrice * service.quantity),
    })),

    payment: {
      advanceAmount: this.payment.advanceAmount,
      amountPaid: this.payment.amountPaid,
      balanceDue: this.balanceDue,
      advanceDeadline: this.payment.advanceDeadline,
      balanceDeadline: this.payment.balanceDeadline,
      lastPaymentAt: this.payment.lastPaymentAt,
      advanceSettled: this.advanceSettled,
      fullySettled: this.fullySettled,
      advanceOverdue: this.advanceOverdue,
    },

    specialRequests: this.specialRequests,
    checkedInAt: this.checkedInAt,
    checkedOutAt: this.checkedOutAt,
    cancelledAt: this.cancelledAt,
    cancellationReason: this.cancellationReason,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    ...extra,
  };
};

reservationSchema.methods.toHistoryObject = function toHistoryObject() {
  return this.history.map((entry) => ({
    status: entry.status,
    at: entry.at,
    note: entry.note,
    by: entry.by && entry.by.name !== undefined
      ? { id: entry.by._id.toString(), name: entry.by.name }
      : { id: entry.by?.toString() ?? null },
  }));
};

/**
 * Booking reference: date plus four random characters. Short enough to read out
 * over the phone, and unique enough that a same-day clash is vanishingly rare -
 * the unique index catches one if it ever happens.
 */
export const generateReference = (date = new Date()) => {
  const stamp = toDateString(date).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RSV-${stamp}-${random}`;
};

export const calculateNights = nightsBetween;

export const Reservation = mongoose.model("Reservation", reservationSchema);
export default Reservation;
