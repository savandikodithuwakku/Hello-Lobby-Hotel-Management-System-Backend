import mongoose from "mongoose";
import env from "../../config/env.js";
import { toDateString } from "../../shared/utils/date.util.js";
import { money } from "../../shared/utils/money.util.js";
import {
  CHARGE_CATEGORY_VALUES,
  INVOICE_STATUSES,
  POLICY,
  balanceOf,
  deriveInvoiceStatus,
  netPaid,
} from "./payment.constants.js";

/**
 * One thing the guest consumed during their stay.
 *
 * The folio. A booking's `additionalServices` is what was agreed when the room
 * was booked; these are what was used once the guest was in it - a minibar, a
 * laundry bag, a late checkout. Keeping them apart means a guest querying the
 * bill can see which is which, and it means adding a charge to somebody who is
 * already checked in does not require unfreezing the booking's dates.
 *
 * Lines are never edited or removed once posted. A mistake is corrected by
 * posting a negative-signed reversal, so the folio always adds up.
 */
const chargeSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      required: [true, "A charge needs a description"],
      trim: true,
      maxlength: [POLICY.CHARGE_DESCRIPTION_MAX, "Description is too long"],
    },
    category: {
      type: String,
      enum: CHARGE_CATEGORY_VALUES,
      required: true,
    },
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, default: 1, min: [1, "Quantity must be at least 1"] },
    amount: { type: Number, required: true },
    /** Set on a line that cancels an earlier one out. */
    reverses: { type: mongoose.Schema.Types.ObjectId, default: null },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    postedAt: { type: Date, default: Date.now },
    note: {
      type: String,
      trim: true,
      maxlength: [POLICY.NOTE_MAX, "Note is too long"],
      default: "",
    },
  },
  { _id: true }
);

/**
 * The bill for one reservation.
 *
 * There is exactly one invoice per booking, created the first time anybody
 * looks at the money side of that booking. It holds the figures - what is owed,
 * what came in, what went back out - and nothing else. The status is worked out
 * from those figures rather than stored, so it can never be out of date.
 *
 * The reservation is still the place a price is *decided*; the invoice copies
 * those figures over whenever it is touched, so editing a booking's services
 * updates its bill without anyone having to remember to do it.
 */
const invoiceSchema = new mongoose.Schema(
  {
    /** Human-readable bill number, e.g. INV-20260826-4F7A. */
    reference: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    /** One invoice per booking - the unique index is what enforces that. */
    reservation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reservation",
      required: [true, "An invoice must belong to a reservation"],
      unique: true,
    },
    /** Denormalised so the guest's own bills can be listed without a join. */
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** Recorded per invoice so an old bill still reads correctly if the hotel
     * ever changes currency. The system never converts between currencies. */
    currency: {
      type: String,
      default: () => env.payment.currency,
      uppercase: true,
      trim: true,
    },
    /** What the guest used during the stay. See `chargeSchema` above. */
    charges: { type: [chargeSchema], default: [] },
    amounts: {
      /** The stay plus everything charged to the room. */
      total: { type: Number, required: true, min: 0 },
      /** What must be in before the room is held, copied from the reservation. */
      advance: { type: Number, required: true, min: 0 },
      /** The sum of every successful payment. Only this module writes it. */
      paid: { type: Number, default: 0, min: 0 },
      /** The sum of every successful refund. */
      refunded: { type: Number, default: 0, min: 0 },
    },
    /** When the advance must be in, or the hold on the room lapses. */
    advanceDueAt: { type: Date, required: true },
    /** When the rest must be in - departure day, when the guest settles up. */
    dueAt: { type: Date, required: true },

    issuedAt: { type: Date, default: Date.now },
    /** Set the moment nothing is owed any more. */
    settledAt: { type: Date, default: null },
    /** Set when the booking is called off; closes the bill for good. */
    voidedAt: { type: Date, default: null },
    voidReason: {
      type: String,
      trim: true,
      maxlength: [POLICY.NOTE_MAX, "Reason is too long"],
      default: "",
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/** "Show me the bills that are late" - the query the front desk runs most. */
invoiceSchema.index({ dueAt: 1, voidedAt: 1 });
invoiceSchema.index({ customer: 1, createdAt: -1 });

/** Everything charged to the room during the stay. */
invoiceSchema.virtual("chargesTotal").get(function invoiceChargesTotal() {
  return money(this.charges.reduce((sum, charge) => sum + charge.amount, 0));
});

/** What the guest has paid and kept, after refunds. */
invoiceSchema.virtual("netPaid").get(function invoiceNetPaid() {
  return netPaid({ paid: this.amounts.paid, refunded: this.amounts.refunded });
});

/** What is still owed. Never negative: an overpayment is not a debt. */
invoiceSchema.virtual("balanceDue").get(function invoiceBalanceDue() {
  return balanceOf({
    total: this.amounts.total,
    paid: this.amounts.paid,
    refunded: this.amounts.refunded,
  });
});

/** Worked out from the amounts every time it is read - see payment.constants. */
invoiceSchema.virtual("status").get(function invoiceStatus() {
  return deriveInvoiceStatus({
    total: this.amounts.total,
    paid: this.amounts.paid,
    refunded: this.amounts.refunded,
    voidedAt: this.voidedAt,
    dueAt: this.dueAt,
  });
});

invoiceSchema.virtual("advanceSettled").get(function invoiceAdvanceSettled() {
  return this.netPaid >= this.amounts.advance;
});

invoiceSchema.virtual("fullySettled").get(function invoiceFullySettled() {
  return this.balanceDue <= 0;
});

/** How much could still be given back if the booking were cancelled now. */
invoiceSchema.virtual("refundableAmount").get(function invoiceRefundable() {
  return this.netPaid;
});

/**
 * Copies the current figures across from the booking.
 *
 * Called before every read and every write, so a reservation that gained a
 * service or moved to a cheaper room is reflected on its bill immediately.
 * Returns true when something actually changed, so callers can avoid a
 * pointless save.
 */
invoiceSchema.methods.syncFromReservation = function syncFromReservation(reservation) {
  if (!reservation) return false;

  const next = {
    total: money(reservation.pricing.totalAmount),
    advance: money(reservation.payment.advanceAmount),
    advanceDueAt: reservation.payment.advanceDeadline,
    dueAt: reservation.payment.balanceDeadline,
  };

  const changed =
    this.amounts.total !== next.total ||
    this.amounts.advance !== next.advance ||
    this.advanceDueAt?.getTime() !== new Date(next.advanceDueAt).getTime() ||
    this.dueAt?.getTime() !== new Date(next.dueAt).getTime();

  this.amounts.total = next.total;
  this.amounts.advance = next.advance;
  this.advanceDueAt = next.advanceDueAt;
  this.dueAt = next.dueAt;

  // A bill stops being settled if the stay grew after it was paid off.
  const settled = this.fullySettled && this.amounts.total > 0;
  if (settled && !this.settledAt) this.settledAt = new Date();
  if (!settled && this.settledAt) this.settledAt = null;

  return changed;
};

invoiceSchema.methods.toSafeObject = function toSafeObject(extra = {}) {
  const reservation =
    this.reservation && this.reservation.reference !== undefined ? this.reservation : null;
  const customer = this.customer && this.customer.name !== undefined ? this.customer : null;

  return {
    id: this._id.toString(),
    reference: this.reference,
    status: this.status,
    currency: this.currency,

    reservation: reservation
      ? {
          id: reservation._id.toString(),
          reference: reservation.reference,
          status: reservation.status,
          checkIn: reservation.checkIn,
          checkOut: reservation.checkOut,
        }
      : { id: this.reservation?.toString() ?? null },

    customer: customer
      ? {
          id: customer._id.toString(),
          name: customer.name,
          email: customer.email,
          phone: customer.phone ?? null,
        }
      : { id: this.customer?.toString() ?? null },

    amounts: {
      total: this.amounts.total,
      advance: this.amounts.advance,
      paid: this.amounts.paid,
      refunded: this.amounts.refunded,
      charges: this.chargesTotal,
      netPaid: this.netPaid,
      balanceDue: this.balanceDue,
    },

    charges: this.charges.map((charge) => ({
      id: charge._id.toString(),
      description: charge.description,
      category: charge.category,
      unitPrice: charge.unitPrice,
      quantity: charge.quantity,
      amount: charge.amount,
      reverses: charge.reverses?.toString() ?? null,
      postedBy: charge.postedBy?.toString() ?? null,
      postedAt: charge.postedAt,
      note: charge.note,
    })),

    advanceDueAt: this.advanceDueAt,
    dueAt: this.dueAt,
    advanceSettled: this.advanceSettled,
    fullySettled: this.fullySettled,
    isOverdue: this.status === INVOICE_STATUSES.OVERDUE,

    issuedAt: this.issuedAt,
    settledAt: this.settledAt,
    voidedAt: this.voidedAt,
    voidReason: this.voidReason,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    ...extra,
  };
};

/**
 * Bill number: the date plus four random characters, the same shape as a
 * booking reference so the two read alike on a printed receipt.
 */
export const generateInvoiceReference = (date = new Date()) => {
  const stamp = toDateString(date).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `INV-${stamp}-${random}`;
};

export const Invoice = mongoose.model("Invoice", invoiceSchema);
export default Invoice;
