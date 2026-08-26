/**
 * Billing rules for the whole system.
 *
 * The reservation module decides what a stay costs. This module decides what is
 * owed, what has actually been received, and what may still be given back. Two
 * separate ideas live here and are deliberately kept apart:
 *
 *  - an **invoice** is the running bill for one reservation, and
 *  - a **transaction** is one attempt to move money for that bill.
 *
 * They need different statuses. "Partially paid" is meaningless for a single
 * cash receipt, and "failed" is meaningless for a bill. Mixing them into one
 * list is what makes payment code confusing later, so there are two lists.
 */
import { POLICY as RESERVATION_POLICY } from "../reservation/reservation.constants.js";
import { money } from "../../shared/utils/money.util.js";

/* -------------------------------------------------------------------------- */
/* Invoice - the bill                                                         */
/* -------------------------------------------------------------------------- */

export const INVOICE_STATUSES = Object.freeze({
  /** Nothing has been received yet. */
  PENDING: "pending",
  /** Some money is in, but not the full total. */
  PARTIALLY_PAID: "partially_paid",
  /** Nothing is owed any more. */
  PAID: "paid",
  /** Money is still owed and the due date has passed. */
  OVERDUE: "overdue",
  /** Everything that was received has been given back. */
  REFUNDED: "refunded",
  /** The booking was called off, so the bill is closed. */
  CANCELLED: "cancelled",
});

export const INVOICE_STATUS_VALUES = Object.freeze(Object.values(INVOICE_STATUSES));

/** Bills that still need someone to chase them. */
export const OPEN_INVOICE_STATUSES = Object.freeze([
  INVOICE_STATUSES.PENDING,
  INVOICE_STATUSES.PARTIALLY_PAID,
  INVOICE_STATUSES.OVERDUE,
]);

/* -------------------------------------------------------------------------- */
/* Transaction - one movement of money                                        */
/* -------------------------------------------------------------------------- */

export const TRANSACTION_STATUSES = Object.freeze({
  /** Started but not finished - an online checkout the guest has not completed. */
  PENDING: "pending",
  /** The money actually moved. This is the only status that changes a balance. */
  SUCCESS: "success",
  /** The provider or the bank refused it. */
  FAILED: "failed",
  /** Abandoned before it completed, or timed out. */
  CANCELLED: "cancelled",
});

export const TRANSACTION_STATUS_VALUES = Object.freeze(Object.values(TRANSACTION_STATUSES));

/** Only a successful transaction counts towards what has been paid. */
export const SETTLED_TRANSACTION_STATUSES = Object.freeze([TRANSACTION_STATUSES.SUCCESS]);

/** Statuses a transaction can still move on from. Anything else is final. */
export const OPEN_TRANSACTION_STATUSES = Object.freeze([TRANSACTION_STATUSES.PENDING]);

/**
 * Which way the money went. A refund is stored as its own transaction pointing
 * back at the payment it reverses, so the ledger is only ever added to and a
 * mistake is corrected by a new entry rather than by editing an old one.
 */
export const TRANSACTION_DIRECTIONS = Object.freeze({
  PAYMENT: "payment",
  REFUND: "refund",
});

export const TRANSACTION_DIRECTION_VALUES = Object.freeze(Object.values(TRANSACTION_DIRECTIONS));

/* -------------------------------------------------------------------------- */
/* How the money arrives                                                      */
/* -------------------------------------------------------------------------- */

/**
 * "Payment gateway" is not a method - it is *how* an online payment is carried
 * out. The method says what the guest did; the `provider` field on the
 * transaction says which system handled it. So a card typed into a website and
 * a card swiped at the front desk are both `card`, and only the first one has a
 * gateway provider attached.
 */
export const PAYMENT_METHODS = Object.freeze({
  CASH: "cash",
  CARD: "card",
  BANK_TRANSFER: "bank_transfer",
  ONLINE: "online",
});

export const PAYMENT_METHOD_VALUES = Object.freeze(Object.values(PAYMENT_METHODS));

/**
 * Methods where a human already took the money in the real world and the system
 * is only writing it down. These settle the moment they are recorded.
 */
export const MANUAL_METHODS = Object.freeze([
  PAYMENT_METHODS.CASH,
  PAYMENT_METHODS.CARD,
  PAYMENT_METHODS.BANK_TRANSFER,
]);

/** Methods that have to go out to a provider and come back. */
export const ONLINE_METHODS = Object.freeze([PAYMENT_METHODS.ONLINE]);

export const isManualMethod = (method) => MANUAL_METHODS.includes(method);

export const METHOD_LABELS = Object.freeze({
  [PAYMENT_METHODS.CASH]: "Cash",
  [PAYMENT_METHODS.CARD]: "Card",
  [PAYMENT_METHODS.BANK_TRANSFER]: "Bank transfer",
  [PAYMENT_METHODS.ONLINE]: "Online payment",
});

/* -------------------------------------------------------------------------- */
/* The folio - what the guest used while they were here                       */
/* -------------------------------------------------------------------------- */

/**
 * What kind of thing was charged to the room.
 *
 * Coarse on purpose. These are the groupings a hotel actually reports revenue
 * by; anything finer belongs in the description, where it can be read.
 */
export const CHARGE_CATEGORIES = Object.freeze({
  FOOD_AND_DRINK: "food_and_drink",
  MINIBAR: "minibar",
  LAUNDRY: "laundry",
  SPA: "spa",
  TRANSPORT: "transport",
  TELEPHONE: "telephone",
  DAMAGE: "damage",
  /** Late checkout, an extra bed, an early arrival. */
  ROOM_CHARGE: "room_charge",
  OTHER: "other",
  /** Cancels an earlier line out. Never posted directly - see `reverses`. */
  ADJUSTMENT: "adjustment",
});

export const CHARGE_CATEGORY_VALUES = Object.freeze(Object.values(CHARGE_CATEGORIES));

/** The categories a person may choose. Adjustments are made, not chosen. */
export const POSTABLE_CHARGE_CATEGORIES = Object.freeze(
  CHARGE_CATEGORY_VALUES.filter((category) => category !== CHARGE_CATEGORIES.ADJUSTMENT)
);

/* -------------------------------------------------------------------------- */
/* Policy                                                                     */
/* -------------------------------------------------------------------------- */

/** How much of what a guest paid comes back when they cancel. */
export const REFUND_POLICIES = Object.freeze({
  /** The advance is the hotel's compensation for holding the room. Default. */
  ADVANCE_NON_REFUNDABLE: "advance_non_refundable",
  /** Everything back if they cancel early enough, advance kept after that. */
  FULL_BEFORE_CUTOFF: "full_before_cutoff",
  /** Everything back, whenever they cancel. */
  ALWAYS_FULL: "always_full",
  /** Nothing comes back once it has been paid. */
  NEVER: "never",
});

export const REFUND_POLICY_VALUES = Object.freeze(Object.values(REFUND_POLICIES));

export const POLICY = Object.freeze({
  /**
   * The rule the hotel applies to cancellations. Changing this one value
   * changes every refund quote in the system; nothing else needs editing.
   */
  CANCELLATION_REFUND: REFUND_POLICIES.ADVANCE_NON_REFUNDABLE,

  /** Used only by `FULL_BEFORE_CUTOFF`: how long before arrival counts as early. */
  FULL_REFUND_CUTOFF_HOURS: 72,

  /** How long a started online checkout stays open before it is abandoned. */
  CHECKOUT_EXPIRY_MINUTES: 30,

  /** The largest single amount the system will accept, shared with reservations. */
  MAX_AMOUNT: RESERVATION_POLICY.MAX_AMOUNT,

  /** Free-text length limit, shared with reservations so notes behave the same. */
  NOTE_MAX: RESERVATION_POLICY.NOTE_MAX,

  /** A bank slip number, a card terminal receipt number and so on. */
  EXTERNAL_REFERENCE_MAX: 120,

  /** "Minibar - 2 x still water". Long enough to be useful on a printed bill. */
  CHARGE_DESCRIPTION_MAX: 160,
  /** How many lines one folio may carry, so a stay cannot grow without bound. */
  MAX_CHARGES: 200,
});

/* -------------------------------------------------------------------------- */
/* Working out an invoice's status                                            */
/*                                                                            */
/* The status is never stored. A stored status goes stale the moment a due     */
/* date passes with nobody running a job, and then the bill lies about itself. */
/* It is calculated from the amounts every time instead, so it cannot drift.   */
/* -------------------------------------------------------------------------- */

/** What has been received and kept, after any refunds are taken off. */
export const netPaid = ({ paid = 0, refunded = 0 }) => money(paid - refunded);

export const balanceOf = ({ total = 0, paid = 0, refunded = 0 }) =>
  money(Math.max(total - netPaid({ paid, refunded }), 0));

export const deriveInvoiceStatus = ({
  total = 0,
  paid = 0,
  refunded = 0,
  voidedAt = null,
  dueAt = null,
  reference = new Date(),
} = {}) => {
  if (voidedAt) return INVOICE_STATUSES.CANCELLED;

  const net = netPaid({ paid, refunded });
  const isLate = Boolean(dueAt) && new Date(dueAt).getTime() < reference.getTime();

  // Everything that came in has gone back out again.
  if (refunded > 0 && net <= 0) return INVOICE_STATUSES.REFUNDED;

  if (total > 0 && net >= total) return INVOICE_STATUSES.PAID;

  // Being late is the fact the front desk has to act on, so it wins over
  // "pending" and "partially paid" while money is still owed.
  if (isLate) return INVOICE_STATUSES.OVERDUE;

  return net <= 0 ? INVOICE_STATUSES.PENDING : INVOICE_STATUSES.PARTIALLY_PAID;
};

/* -------------------------------------------------------------------------- */
/* Working out a refund                                                       */
/* -------------------------------------------------------------------------- */

const hoursUntil = (date, reference = new Date()) =>
  (new Date(date).getTime() - reference.getTime()) / 3_600_000;

/**
 * How much of a cancelled booking the guest gets back, and why.
 *
 * The reason is returned next to the number so the front desk can read it out
 * to the guest instead of having to know the policy by heart.
 */
export const quoteCancellationRefund = ({
  paid = 0,
  refunded = 0,
  advanceAmount = 0,
  checkIn = null,
  policy = POLICY.CANCELLATION_REFUND,
  reference = new Date(),
} = {}) => {
  const available = netPaid({ paid, refunded });

  if (available <= 0) {
    return { amount: 0, retained: 0, policy, reason: "Nothing has been paid on this booking" };
  }

  const keepAdvance = () => {
    const retained = money(Math.min(advanceAmount, available));
    return {
      amount: money(available - retained),
      retained,
      policy,
      reason: `The advance of ${retained} is not refundable; the rest is returned`,
    };
  };

  const keepNothing = (reason) => ({ amount: money(available), retained: 0, policy, reason });

  switch (policy) {
    case REFUND_POLICIES.ALWAYS_FULL:
      return keepNothing("Everything paid is returned");

    case REFUND_POLICIES.NEVER:
      return {
        amount: 0,
        retained: money(available),
        policy,
        reason: "Payments on this booking are not refundable",
      };

    case REFUND_POLICIES.FULL_BEFORE_CUTOFF: {
      const early = checkIn && hoursUntil(checkIn, reference) >= POLICY.FULL_REFUND_CUTOFF_HOURS;
      return early
        ? keepNothing(
            `Cancelled more than ${POLICY.FULL_REFUND_CUTOFF_HOURS} hours before arrival, so everything is returned`
          )
        : keepAdvance();
    }

    case REFUND_POLICIES.ADVANCE_NON_REFUNDABLE:
    default:
      return keepAdvance();
  }
};

/* -------------------------------------------------------------------------- */
/* Listing options                                                            */
/* -------------------------------------------------------------------------- */

export const INVOICE_SORT_OPTIONS = Object.freeze([
  "createdAt",
  "-createdAt",
  "dueAt",
  "-dueAt",
  "amounts.total",
  "-amounts.total",
  "amounts.paid",
  "-amounts.paid",
]);

export const DEFAULT_INVOICE_SORT = "-createdAt";

export const TRANSACTION_SORT_OPTIONS = Object.freeze([
  "createdAt",
  "-createdAt",
  "amount",
  "-amount",
]);

export const DEFAULT_TRANSACTION_SORT = "-createdAt";

/** Paging limits are the same everywhere; re-exported so this module's
 * imports stay in one place. */
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../shared/constants/pagination.constants.js";

export const PAYMENT_MESSAGES = Object.freeze({
  INVOICE_FETCHED: "Invoice fetched successfully",
  PAYMENT_RECORDED: "Payment recorded",
  CHECKOUT_STARTED: "Online payment started",
  CHECKOUT_CANCELLED: "Online payment cancelled",
  TRANSACTION_VERIFIED: "Payment status refreshed",
  REFUND_ISSUED: "Refund issued",
  INVOICE_VOIDED: "Invoice cancelled",
});
