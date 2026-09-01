import mongoose from "mongoose";
import env from "../../config/env.js";
import { toDateString } from "../../shared/utils/date.util.js";
import { money } from "../../shared/utils/money.util.js";
import {
  METHOD_LABELS,
  OPEN_TRANSACTION_STATUSES,
  PAYMENT_METHOD_VALUES,
  POLICY,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_DIRECTION_VALUES,
  TRANSACTION_STATUSES,
  TRANSACTION_STATUS_VALUES,
} from "./payment.constants.js";
import { noteField, referenceField } from "../../shared/database/schemaFields.js";

/**
 * One movement of money against a bill.
 *
 * This is the ledger, and a ledger is only ever added to. A settled transaction
 * is never edited or deleted: a wrong amount is corrected by recording a refund
 * that cancels it out, so the history of a bill always adds up to its balance
 * and an auditor can follow what happened.
 *
 * Nothing sensitive is stored. Card numbers, expiry dates and security codes
 * never reach this system - only the reference a provider or a card terminal
 * gave back, which is meaningless to anyone who steals the database.
 */
const transactionSchema = new mongoose.Schema(
  {
    /** Human-readable receipt number, e.g. TXN-20260826-4F7A. */
    reference: referenceField(),
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
      index: true,
    },
    /** Kept alongside the invoice so revenue reports never need a second join. */
    reservation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reservation",
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /** Money coming in, or money going back out. */
    direction: {
      type: String,
      enum: TRANSACTION_DIRECTION_VALUES,
      default: TRANSACTION_DIRECTIONS.PAYMENT,
      required: true,
    },
    amount: {
      type: Number,
      required: [true, "An amount is required"],
      min: [0.01, "An amount must be greater than zero"],
      max: [POLICY.MAX_AMOUNT, "That amount is too large"],
    },
    currency: {
      type: String,
      default: () => env.payment.currency,
      uppercase: true,
      trim: true,
    },
    method: {
      type: String,
      enum: PAYMENT_METHOD_VALUES,
      required: [true, "A payment method is required"],
    },
    status: {
      type: String,
      enum: TRANSACTION_STATUS_VALUES,
      default: TRANSACTION_STATUSES.PENDING,
      index: true,
    },

    /**
     * Which system handled it: `manual` when a member of staff wrote down money
     * they took in person, or the name of the gateway that processed it.
     */
    provider: { type: String, required: true, trim: true, lowercase: true },
    /** The gateway's own id for this payment. Never a card number. */
    providerReference: { type: String, trim: true, default: null },
    /** The gateway's own wording for its outcome, kept for support enquiries. */
    providerStatus: { type: String, trim: true, default: null },
    /** A bank slip number or card terminal receipt number typed in by staff. */
    externalReference: {
      type: String,
      trim: true,
      maxlength: [POLICY.EXTERNAL_REFERENCE_MAX, "Reference is too long"],
      default: "",
    },

    /** The refund this transaction reverses. Only set on refunds. */
    reverses: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
    /** How much of this payment has already been given back. */
    refundedAmount: { type: Number, default: 0, min: 0 },

    /** Who wrote it down. Null when a gateway callback settled it by itself. */
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    /** When the money actually moved, as opposed to when the row was created. */
    settledAt: { type: Date, default: null },
    /** A started online checkout is abandoned if it is not finished by then. */
    expiresAt: { type: Date, default: null },
    failureReason: { type: String, trim: true, default: "" },
    note: noteField(POLICY.NOTE_MAX),
  },
  { timestamps: true }
);

/**
 * A gateway can send the same callback twice. Looking the payment up by the
 * provider's own id is what makes handling it a second time harmless, and this
 * index makes that lookup cheap. Sparse, because manual payments have no id.
 */
transactionSchema.index({ provider: 1, providerReference: 1 }, { sparse: true });
transactionSchema.index({ invoice: 1, createdAt: -1 });
transactionSchema.index({ status: 1, expiresAt: 1 });

/** True while this transaction can still change - i.e. it is still pending. */
transactionSchema.virtual("isOpen").get(function transactionIsOpen() {
  return OPEN_TRANSACTION_STATUSES.includes(this.status);
});

transactionSchema.virtual("isSettled").get(function transactionIsSettled() {
  return this.status === TRANSACTION_STATUSES.SUCCESS;
});

/** How much of this payment could still be given back. */
transactionSchema.virtual("refundableAmount").get(function transactionRefundable() {
  if (!this.isSettled || this.direction !== TRANSACTION_DIRECTIONS.PAYMENT) return 0;
  return money(Math.max(this.amount - this.refundedAmount, 0));
});

/** Marks the money as having actually moved. */
transactionSchema.methods.settle = function settle({ providerReference, providerStatus } = {}) {
  this.status = TRANSACTION_STATUSES.SUCCESS;
  this.settledAt = new Date();
  this.expiresAt = null;
  if (providerReference) this.providerReference = providerReference;
  if (providerStatus) this.providerStatus = providerStatus;
  return this;
};

/** Closes off a transaction that did not go through. */
transactionSchema.methods.close = function close(status, { reason = "", providerStatus } = {}) {
  this.status = status;
  this.failureReason = reason;
  this.expiresAt = null;
  if (providerStatus) this.providerStatus = providerStatus;
  return this;
};

transactionSchema.methods.toSafeObject = function toSafeObject(extra = {}) {
  const recordedBy =
    this.recordedBy && this.recordedBy.name !== undefined ? this.recordedBy : null;
  const customer = this.customer && this.customer.name !== undefined ? this.customer : null;

  return {
    id: this._id.toString(),
    reference: this.reference,
    direction: this.direction,
    status: this.status,
    amount: this.amount,
    currency: this.currency,
    method: this.method,
    methodLabel: METHOD_LABELS[this.method] ?? this.method,

    invoice: this.invoice?._id ? this.invoice._id.toString() : this.invoice?.toString() ?? null,
    reservation: this.reservation?._id
      ? this.reservation._id.toString()
      : this.reservation?.toString() ?? null,
    customer: customer
      ? { id: customer._id.toString(), name: customer.name, email: customer.email }
      : { id: this.customer?.toString() ?? null },

    provider: this.provider,
    // The provider's id is useful to support staff and harmless to show; there
    // is never any card data behind it.
    providerReference: this.providerReference,
    providerStatus: this.providerStatus,
    externalReference: this.externalReference,

    reverses: this.reverses?.toString() ?? null,
    refundedAmount: this.refundedAmount,
    refundableAmount: this.refundableAmount,

    recordedBy: recordedBy
      ? { id: recordedBy._id.toString(), name: recordedBy.name }
      : { id: this.recordedBy?.toString() ?? null },

    settledAt: this.settledAt,
    expiresAt: this.expiresAt,
    failureReason: this.failureReason,
    note: this.note,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    ...extra,
  };
};

/** Receipt number, in the same shape as booking and invoice references. */
export const generateTransactionReference = (date = new Date()) => {
  const stamp = toDateString(date).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TXN-${stamp}-${random}`;
};

export const Transaction = mongoose.model("Transaction", transactionSchema);
export default Transaction;
