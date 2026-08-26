import mongoose from "mongoose";
import env from "../../config/env.js";
import { toDateString } from "../../shared/utils/date.util.js";
import { money } from "../../shared/utils/money.util.js";
import {
  INVOICE_STATUSES,
  POLICY,
  balanceOf,
  deriveInvoiceStatus,
  netPaid,
} from "./payment.constants.js";

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
    amounts: {
      /** The full cost of the stay, copied from the reservation. */
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
    /** When the rest must be in - arrival day at the latest. */
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
      netPaid: this.netPaid,
      balanceDue: this.balanceDue,
    },

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
