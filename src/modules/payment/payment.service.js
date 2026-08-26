import ApiError from "../../shared/utils/ApiError.js";
import { toId } from "../../shared/utils/id.util.js";
import { money } from "../../shared/utils/money.util.js";
import { paginateQuery } from "../../shared/utils/pagination.util.js";
import { containsInsensitive } from "../../shared/utils/text.util.js";
import { sendEmailSafely } from "../../shared/mail/mailer.js";
import { PERMISSIONS } from "../auth/rbac/permissions.js";
import { AUDIT_ACTIONS, AUDIT_ENTITIES, AUDIT_OUTCOMES } from "../audit/audit.constants.js";
import { recordAudit } from "../audit/audit.service.js";
import User from "../user/user.model.js";
import Reservation from "../reservation/reservation.model.js";
import { recordPayment as applyPaymentToReservation } from "../reservation/reservation.service.js";
import Invoice, { generateInvoiceReference } from "./invoice.model.js";
import Transaction, { generateTransactionReference } from "./transaction.model.js";
import { paymentReceiptTemplate } from "./emails/paymentReceipt.template.js";
import { getProviderByName, getProviderForMethod } from "./providers/index.js";
import {
  DEFAULT_INVOICE_SORT,
  DEFAULT_TRANSACTION_SORT,
  INVOICE_STATUSES,
  INVOICE_STATUS_VALUES,
  METHOD_LABELS,
  OPEN_INVOICE_STATUSES,
  PAYMENT_METHODS,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_STATUSES,
  deriveInvoiceStatus,
  isManualMethod,
} from "./payment.constants.js";

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

const withInvoiceRelations = (query) =>
  query
    .populate("reservation", "reference status checkIn checkOut pricing payment customer")
    .populate("customer", "name email phone");

const withTransactionRelations = (query) =>
  query.populate("customer", "name email").populate("recordedBy", "name");

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/*                                                                            */
/* Money is the part of the system most worth being able to account for later, */
/* so every movement is recorded against the transaction it belongs to - the   */
/* receipt number is what a person would quote when asking about it.           */
/* -------------------------------------------------------------------------- */

export const auditTransaction = (transaction) => ({
  type: AUDIT_ENTITIES.TRANSACTION,
  id: transaction._id,
  label: transaction.reference,
});

/* -------------------------------------------------------------------------- */
/* Access                                                                     */
/*                                                                            */
/* A guest may see their own bills and nothing else. As in the reservation     */
/* module, this is done by narrowing the query rather than by having separate  */
/* endpoints, so there is only one code path to get right.                    */
/* -------------------------------------------------------------------------- */

const canReadAll = (viewer) => Boolean(viewer?.hasPermission(PERMISSIONS.PAYMENT_READ));

const isOwner = (viewer, invoice) => {
  const ownerId = toId(invoice.customer);
  return Boolean(ownerId && viewer?._id.equals(ownerId));
};

const assertCanView = (viewer, invoice) => {
  if (canReadAll(viewer) || isOwner(viewer, invoice)) return;

  // 404 rather than 403, so a guest cannot probe which invoices exist.
  throw new ApiError(404, "Invoice not found");
};

/* -------------------------------------------------------------------------- */
/* Issuing a bill                                                             */
/*                                                                            */
/* An invoice is created the first time anyone looks at the money side of a    */
/* booking. Doing it lazily rather than at booking time keeps the reservation  */
/* module free of any knowledge of this one - the dependency only ever points  */
/* this way, which is what stops the two modules from tangling.                */
/* -------------------------------------------------------------------------- */

const buildInvoice = (reservation, actorId) =>
  new Invoice({
    reference: generateInvoiceReference(),
    reservation: reservation._id,
    customer: toId(reservation.customer),
    amounts: {
      total: money(reservation.pricing.totalAmount),
      advance: money(reservation.payment.advanceAmount),
      // A booking may already have money against it from before this module
      // existed, so the opening figure is taken from the reservation.
      paid: money(reservation.payment.amountPaid),
      refunded: 0,
    },
    advanceDueAt: reservation.payment.advanceDeadline,
    dueAt: reservation.payment.balanceDeadline,
    createdBy: actorId ?? null,
    updatedBy: actorId ?? null,
  });

/**
 * Returns the bill for a booking, creating it if this is the first time.
 *
 * Two requests can arrive at once for a booking that has no invoice yet. Both
 * would build one, and the unique index on `reservation` lets exactly one of
 * them save - the loser simply reads the winner's invoice instead of failing.
 */
export const issueInvoiceForReservation = async (reservation, actorId = null) => {
  const existing = await withInvoiceRelations(Invoice.findOne({ reservation: reservation._id }));

  if (existing) return existing;

  const invoice = buildInvoice(reservation, actorId);

  try {
    await invoice.save();
  } catch (error) {
    if (error?.code === 11000) {
      return withInvoiceRelations(Invoice.findOne({ reservation: reservation._id }));
    }
    throw error;
  }

  return withInvoiceRelations(Invoice.findById(invoice._id));
};

/**
 * Keeps a bill in step with its booking, and closes it when the booking is
 * called off.
 *
 * This runs on every read, which is what removes the need for a scheduled job:
 * a cancelled booking's bill reads as cancelled the next time anyone opens it,
 * and a stay that gained a service shows the higher total straight away.
 */
const syncInvoice = async (invoice) => {
  const reservation =
    invoice.reservation && invoice.reservation.pricing
      ? invoice.reservation
      : await Reservation.findById(toId(invoice.reservation));

  if (!reservation) return invoice;

  let changed = invoice.syncFromReservation(reservation);

  const bookingCalledOff = ["cancelled", "no_show"].includes(reservation.status);

  if (bookingCalledOff && !invoice.voidedAt) {
    invoice.voidedAt = reservation.cancelledAt || new Date();
    invoice.voidReason = reservation.cancellationReason || "The booking was called off";
    changed = true;
  }

  if (changed) await invoice.save();

  return invoice;
};

/**
 * Cancels online checkouts nobody ever completed.
 *
 * A guest who closes the payment window leaves a pending transaction behind.
 * Left alone it would make the bill look as though money were on its way, so
 * anything past its expiry is closed off whenever the module is used.
 */
const expireStaleCheckouts = async (filter = {}) => {
  await Transaction.updateMany(
    {
      ...filter,
      status: TRANSACTION_STATUSES.PENDING,
      expiresAt: { $ne: null, $lt: new Date() },
    },
    {
      $set: {
        status: TRANSACTION_STATUSES.CANCELLED,
        failureReason: "The guest did not complete the payment in time",
        expiresAt: null,
      },
    }
  );
};

/* -------------------------------------------------------------------------- */
/* Resolving which bill a request is about                                    */
/*                                                                            */
/* The front desk thinks in bookings and the accounts screen thinks in bills,  */
/* so both are accepted as an address. Everything below works on the invoice   */
/* the resolver returns, which is why there is only one copy of each rule.     */
/* -------------------------------------------------------------------------- */

export const resolveInvoice = async ({ invoiceId, reservationId }, viewer, { actorId } = {}) => {
  let invoice;

  if (invoiceId) {
    invoice = await withInvoiceRelations(Invoice.findById(invoiceId));
    if (!invoice) throw new ApiError(404, "Invoice not found");
  } else {
    const reservation = await Reservation.findById(reservationId);
    if (!reservation) throw new ApiError(404, "Reservation not found");

    // Checked before the bill is created, so a guest cannot cause invoices to
    // be issued for other people's bookings by guessing ids.
    assertCanView(viewer, { customer: reservation.customer });
    invoice = await issueInvoiceForReservation(reservation, actorId ?? viewer?._id ?? null);
  }

  assertCanView(viewer, invoice);
  await expireStaleCheckouts({ invoice: invoice._id });

  return syncInvoice(invoice);
};

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Turns a status the caller asked for into a condition on the stored amounts.
 *
 * Because the status is worked out rather than stored, filtering by it means
 * describing it as a query. The definitions here and in `deriveInvoiceStatus`
 * must say the same thing, so they sit next to each other in the review.
 */
const statusFilter = (status) => {
  const now = new Date();
  const net = { $subtract: ["$amounts.paid", "$amounts.refunded"] };
  const notVoid = { voidedAt: null };
  const late = { $lt: ["$dueAt", now] };
  const notLate = { $gte: ["$dueAt", now] };

  switch (status) {
    case INVOICE_STATUSES.CANCELLED:
      return { voidedAt: { $ne: null } };

    case INVOICE_STATUSES.REFUNDED:
      return {
        ...notVoid,
        "amounts.refunded": { $gt: 0 },
        $expr: { $lte: [net, 0] },
      };

    case INVOICE_STATUSES.PAID:
      return { ...notVoid, $expr: { $and: [{ $gt: ["$amounts.total", 0] }, { $gte: [net, "$amounts.total"] }] } };

    case INVOICE_STATUSES.OVERDUE:
      return { ...notVoid, $expr: { $and: [{ $lt: [net, "$amounts.total"] }, late] } };

    case INVOICE_STATUSES.PARTIALLY_PAID:
      return {
        ...notVoid,
        $expr: {
          $and: [{ $gt: [net, 0] }, { $lt: [net, "$amounts.total"] }, notLate],
        },
      };

    case INVOICE_STATUSES.PENDING:
    default:
      return { ...notVoid, $expr: { $and: [{ $lte: [net, 0] }, notLate] } };
  }
};

export const listInvoices = async (query, viewer) => {
  const { page, limit, search, status, customer, from, to, sort = DEFAULT_INVOICE_SORT } = query;

  const filter = {};

  if (canReadAll(viewer)) {
    if (customer) filter.customer = customer;
  } else {
    filter.customer = viewer._id;
  }

  if (status) Object.assign(filter, statusFilter(status));

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  if (search) {
    const pattern = containsInsensitive(search);
    // A bill number is the common case; a booking reference or a guest's name
    // is resolved to ids first, the same way the reservation list does it.
    const reservationIds = await Reservation.find({ reference: pattern }).distinct("_id");
    const or = [{ reference: pattern }, { reservation: { $in: reservationIds } }];

    if (canReadAll(viewer)) {
      const customerIds = await User.find({
        $or: [{ name: pattern }, { email: pattern }],
      }).distinct("_id");
      or.push({ customer: { $in: customerIds } });
    }

    filter.$and = [...(filter.$and || []), { $or: or }];
  }

  await expireStaleCheckouts({});

  const { documents, pagination } = await paginateQuery(Invoice, filter, {
    page,
    limit,
    sort,
    decorate: withInvoiceRelations,
  });

  // Each bill is brought up to date before it is shown, so a list never
  // disagrees with the detail screen behind it.
  const invoices = await Promise.all(documents.map((invoice) => syncInvoice(invoice)));

  return { invoices: invoices.map((invoice) => invoice.toSafeObject()), pagination };
};

/** One bill, with every movement of money that has ever touched it. */
export const getInvoice = async (address, viewer) => {
  const invoice = await resolveInvoice(address, viewer);

  const transactions = await withTransactionRelations(
    Transaction.find({ invoice: invoice._id }).sort(DEFAULT_TRANSACTION_SORT)
  );

  return invoice.toSafeObject({
    transactions: transactions.map((transaction) => transaction.toSafeObject()),
  });
};

export const listTransactions = async (query, viewer) => {
  const {
    page,
    limit,
    invoice,
    reservation,
    customer,
    method,
    status,
    direction,
    from,
    to,
    sort = DEFAULT_TRANSACTION_SORT,
  } = query;

  const filter = {};

  if (canReadAll(viewer)) {
    if (customer) filter.customer = customer;
  } else {
    filter.customer = viewer._id;
  }

  if (invoice) filter.invoice = invoice;
  if (reservation) filter.reservation = reservation;
  if (method) filter.method = method;
  if (status) filter.status = status;
  if (direction) filter.direction = direction;

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  await expireStaleCheckouts({});

  const { documents, pagination } = await paginateQuery(Transaction, filter, {
    page,
    limit,
    sort,
    decorate: withTransactionRelations,
  });

  return {
    transactions: documents.map((transaction) => transaction.toSafeObject()),
    pagination,
  };
};

export const findTransactionOrFail = async (id, viewer) => {
  const transaction = await withTransactionRelations(Transaction.findById(id));

  if (!transaction) throw new ApiError(404, "Payment not found");

  if (!canReadAll(viewer) && !viewer._id.equals(toId(transaction.customer))) {
    throw new ApiError(404, "Payment not found");
  }

  return transaction;
};

export const getTransaction = async (id, viewer) => {
  const transaction = await findTransactionOrFail(id, viewer);
  return transaction.toSafeObject();
};

/* -------------------------------------------------------------------------- */
/* Recording money                                                            */
/* -------------------------------------------------------------------------- */

/** Nothing can be charged to a bill that has been closed. */
const assertInvoiceIsOpen = (invoice) => {
  if (invoice.voidedAt) {
    throw new ApiError(409, "This booking was cancelled, so nothing more can be charged to it");
  }
};

const assertAmountFitsBalance = (invoice, amount) => {
  if (amount <= 0) {
    throw new ApiError(400, "A payment must be greater than zero");
  }

  if (amount > invoice.balanceDue) {
    throw new ApiError(
      400,
      `That is more than the outstanding balance of ${invoice.balanceDue} ${invoice.currency}`
    );
  }
};

/**
 * The guest, loaded in full.
 *
 * Always a fresh read rather than the populated copy on the invoice: the
 * populated copy carries only a name and an email, and a payment made by the
 * guest themselves is recorded with the guest as the actor, which means their
 * role and permissions have to be loaded too.
 */
const loadCustomer = async (invoice) => {
  const customer = await User.findById(toId(invoice.customer));

  if (!customer) throw new ApiError(404, "The guest on this invoice no longer exists");

  return customer;
};

const buildTransaction = ({ invoice, amount, method, provider, direction, actor, payload = {} }) =>
  new Transaction({
    reference: generateTransactionReference(),
    invoice: invoice._id,
    reservation: toId(invoice.reservation),
    customer: toId(invoice.customer),
    direction,
    amount: money(amount),
    currency: invoice.currency,
    method,
    provider: provider.name,
    status: TRANSACTION_STATUSES.PENDING,
    recordedBy: actor?._id ?? null,
    externalReference: payload.externalReference || "",
    note: payload.note || "",
  });

/**
 * Adds settled money to a bill and to its booking.
 *
 * The booking is updated first because it holds the stricter rules - it refuses
 * an overpayment and it is what turns a paid advance into a confirmed booking.
 * Only once it has accepted the money is the bill and then the receipt updated,
 * so a failure part-way through leaves a payment still marked pending, which
 * `verifyTransaction` can then finish rather than money going missing.
 */
const applySettledPayment = async (invoice, transaction, actor) => {
  const outcome = await applyPaymentToReservation(actor, toId(invoice.reservation), {
    amount: transaction.amount,
    note: transaction.note,
  });

  invoice.amounts.paid = money(invoice.amounts.paid + transaction.amount);
  invoice.updatedBy = actor?._id ?? invoice.updatedBy;
  if (invoice.fullySettled) invoice.settledAt = new Date();
  await invoice.save();

  transaction.settle();
  await transaction.save();

  return outcome;
};

const sendReceipt = async (invoice, transaction, customer) => {
  if (!customer?.email) return;

  await sendEmailSafely({
    to: customer.email,
    subject: `Payment received - ${invoice.reference}`,
    html: paymentReceiptTemplate({
      name: customer.name,
      invoice,
      transaction,
      reservationReference: invoice.reservation?.reference ?? null,
    }),
  });
};

/**
 * Writes down money the hotel has already taken: cash at reception, a card put
 * through the hotel's own terminal, a bank transfer that has landed.
 *
 * This is the path that needs no gateway account at all, and in a real hotel it
 * is how most of the money arrives.
 */
export const recordManualPayment = async (actor, address, payload) => {
  const invoice = await resolveInvoice(address, actor, { actorId: actor._id });
  assertInvoiceIsOpen(invoice);

  const method = payload.method || PAYMENT_METHODS.CASH;

  if (!isManualMethod(method)) {
    throw new ApiError(
      400,
      `${METHOD_LABELS[method] ?? method} has to be started as an online payment, not recorded by hand`
    );
  }

  const amount = money(payload.amount);
  assertAmountFitsBalance(invoice, amount);

  const provider = getProviderForMethod(method);
  const transaction = buildTransaction({
    invoice,
    amount,
    method,
    provider,
    direction: TRANSACTION_DIRECTIONS.PAYMENT,
    actor,
    payload,
  });

  const started = provider.initiate({ transaction, invoice });
  transaction.providerStatus = started.providerStatus ?? null;
  transaction.providerReference = started.providerReference ?? null;
  await transaction.save();

  const outcome = await applySettledPayment(invoice, transaction, actor);

  const customer = await loadCustomer(invoice);
  await sendReceipt(invoice, transaction, customer);

  await recordAudit({
    action: AUDIT_ACTIONS.PAYMENT_RECORDED,
    entity: auditTransaction(transaction),
    actor,
    description:
      `Took ${amount} ${invoice.currency} by ${METHOD_LABELS[method]} against ${invoice.reference}`,
    changes: [
      {
        field: "invoice.paid",
        from: String(money(invoice.amounts.paid - amount)),
        to: String(invoice.amounts.paid),
      },
    ],
    reason: payload.externalReference || "",
  });

  return {
    invoice: (await syncInvoice(invoice)).toSafeObject(),
    transaction: transaction.toSafeObject(),
    reservation: outcome.reservation,
    autoConfirmed: outcome.autoConfirmed,
  };
};

/**
 * Starts an online payment.
 *
 * No money moves here. A pending transaction is opened and the guest is sent to
 * the provider; the bill only changes when the provider calls back, or when
 * somebody asks `verifyTransaction` what happened.
 */
export const startCheckout = async (actor, address, payload) => {
  const invoice = await resolveInvoice(address, actor, { actorId: actor._id });
  assertInvoiceIsOpen(invoice);

  const method = payload.method || PAYMENT_METHODS.ONLINE;

  if (isManualMethod(method)) {
    throw new ApiError(400, `${METHOD_LABELS[method] ?? method} is recorded directly, not online`);
  }

  const amount = money(payload.amount);
  assertAmountFitsBalance(invoice, amount);

  // Two open checkouts on one bill would let a guest pay the same balance
  // twice, so the previous one is stood down first.
  await Transaction.updateMany(
    { invoice: invoice._id, status: TRANSACTION_STATUSES.PENDING },
    {
      $set: {
        status: TRANSACTION_STATUSES.CANCELLED,
        failureReason: "Replaced by a newer payment attempt",
        expiresAt: null,
      },
    }
  );

  const provider = getProviderForMethod(method);
  const transaction = buildTransaction({
    invoice,
    amount,
    method,
    provider,
    direction: TRANSACTION_DIRECTIONS.PAYMENT,
    actor,
    payload,
  });

  const reservation = invoice.reservation;
  const customer = await loadCustomer(invoice);
  const started = provider.initiate({ transaction, invoice, reservation, customer });

  transaction.providerReference = started.providerReference ?? null;
  transaction.providerStatus = started.providerStatus ?? null;
  transaction.expiresAt = started.expiresAt ?? null;
  await transaction.save();

  // A provider that settles immediately is handled here rather than being left
  // for a callback that will never come.
  if (started.settled) {
    const outcome = await applySettledPayment(invoice, transaction, customer);
    await sendReceipt(invoice, transaction, customer);

    return {
      transaction: transaction.toSafeObject(),
      invoice: (await syncInvoice(invoice)).toSafeObject(),
      reservation: outcome.reservation,
      redirectUrl: null,
    };
  }

  await recordAudit({
    action: AUDIT_ACTIONS.PAYMENT_CHECKOUT_STARTED,
    entity: auditTransaction(transaction),
    actor,
    description:
      `Started an online payment of ${amount} ${invoice.currency} against ${invoice.reference} ` +
      `via ${provider.name}`,
  });

  return {
    transaction: transaction.toSafeObject(),
    invoice: invoice.toSafeObject(),
    redirectUrl: started.redirectUrl,
    expiresAt: transaction.expiresAt,
  };
};

/**
 * Finishes a pending payment.
 *
 * Called from two places - the provider's callback and a manual verification -
 * and is safe to call twice with the same outcome. A gateway that sends the
 * same callback three times must not be able to credit a bill three times, and
 * the check on `isOpen` is what prevents it.
 */
const completeTransaction = async (transaction, { status, providerReference, providerStatus, reason }) => {
  if (!transaction.isOpen) {
    return { transaction, changed: false };
  }

  if (status !== TRANSACTION_STATUSES.SUCCESS) {
    transaction.close(status, { reason, providerStatus });
    await transaction.save();

    // No actor: a provider callback has no signed-in account behind it, and the
    // audit log says "System" rather than pretending somebody did this.
    await recordAudit({
      action: AUDIT_ACTIONS.PAYMENT_FAILED,
      entity: auditTransaction(transaction),
      description: `Payment ${transaction.reference} of ${transaction.amount} did not go through`,
      changes: [{ field: "status", from: TRANSACTION_STATUSES.PENDING, to: status }],
      outcome: AUDIT_OUTCOMES.FAILURE,
      reason: reason || providerStatus || "",
    });

    return { transaction, changed: true };
  }

  const invoice = await withInvoiceRelations(Invoice.findById(toId(transaction.invoice)));

  if (!invoice) throw new ApiError(404, "Invoice not found");

  await syncInvoice(invoice);

  if (invoice.voidedAt) {
    transaction.close(TRANSACTION_STATUSES.FAILED, {
      reason: "The booking was cancelled before the payment completed",
      providerStatus,
    });
    await transaction.save();
    return { transaction, changed: true };
  }

  // The balance can have moved while the guest was on the provider's site -
  // somebody paid cash at the desk in the meantime. The payment is left pending
  // rather than closed, because the money really did move at the provider's
  // end: a person has to decide whether to refund it.
  if (transaction.amount > invoice.balanceDue) {
    throw new ApiError(
      409,
      `This payment of ${transaction.amount} no longer fits the outstanding balance of ` +
        `${invoice.balanceDue}. It has been left pending for the front desk to settle or refund.`
    );
  }

  const customer = await loadCustomer(invoice);

  transaction.providerReference = providerReference ?? transaction.providerReference;
  transaction.providerStatus = providerStatus ?? transaction.providerStatus;

  // The guest is the actor: nobody at the hotel touched this money.
  await applySettledPayment(invoice, transaction, customer);
  await sendReceipt(invoice, transaction, customer);

  await recordAudit({
    action: AUDIT_ACTIONS.PAYMENT_SETTLED,
    entity: auditTransaction(transaction),
    actor: customer,
    description:
      `Online payment of ${transaction.amount} ${invoice.currency} completed against ` +
      `${invoice.reference}`,
    changes: [{ field: "status", from: TRANSACTION_STATUSES.PENDING, to: TRANSACTION_STATUSES.SUCCESS }],
  });

  return { transaction, invoice, changed: true };
};

/**
 * The provider's callback. Open to the internet, so nothing in the body is
 * believed until the provider's own signature over it has been checked.
 */
export const handleProviderCallback = async (providerName, body, { headers } = {}) => {
  const provider = getProviderByName(providerName);
  const parsed = provider.parseCallback(body, { headers });

  const transaction = await Transaction.findOne({
    provider: provider.name,
    providerReference: parsed.providerReference,
  });

  if (!transaction) {
    throw new ApiError(404, "No payment matches that reference");
  }

  // A gateway that reports a different amount than the one we asked for is not
  // something to resolve automatically - it is left pending for a human.
  if (parsed.amount !== null && parsed.amount !== undefined && money(parsed.amount) !== transaction.amount) {
    throw new ApiError(
      409,
      `The provider reported ${parsed.amount} but this payment is for ${transaction.amount}`
    );
  }

  const status =
    parsed.outcome === "success"
      ? TRANSACTION_STATUSES.SUCCESS
      : parsed.outcome === "cancelled"
        ? TRANSACTION_STATUSES.CANCELLED
        : TRANSACTION_STATUSES.FAILED;

  const result = await completeTransaction(transaction, {
    status,
    providerReference: parsed.providerReference,
    providerStatus: parsed.providerStatus,
    reason: status === TRANSACTION_STATUSES.SUCCESS ? "" : parsed.providerStatus || "",
  });

  return {
    reference: result.transaction.reference,
    status: result.transaction.status,
    // Says plainly whether this callback did anything, which is what makes a
    // repeated callback readable in the logs rather than alarming.
    applied: result.changed,
  };
};

/**
 * Asks the provider what happened to a payment.
 *
 * Callbacks get lost. This is the safety net: the guest reopening the booking,
 * or a member of staff pressing "check again", brings the bill up to date
 * without anyone having to touch the database.
 */
export const verifyTransaction = async (viewer, id) => {
  const transaction = await findTransactionOrFail(id, viewer);

  if (!transaction.isOpen) {
    return { transaction: transaction.toSafeObject(), changed: false };
  }

  const provider = getProviderByName(transaction.provider);
  const outcome = provider.verify(transaction);

  const result = await completeTransaction(transaction, {
    status: outcome.status,
    providerReference: outcome.providerReference,
    providerStatus: outcome.providerStatus,
    reason: outcome.reason,
  });

  return { transaction: result.transaction.toSafeObject(), changed: result.changed };
};

/** Stands down a checkout the guest decided against. */
export const cancelTransaction = async (viewer, id, { reason = "" } = {}) => {
  const transaction = await findTransactionOrFail(id, viewer);

  if (!transaction.isOpen) {
    throw new ApiError(409, `This payment is already ${transaction.status} and cannot be cancelled`);
  }

  transaction.close(TRANSACTION_STATUSES.CANCELLED, {
    reason: reason || "Cancelled before it was completed",
  });
  await transaction.save();

  return transaction.toSafeObject();
};

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

/** The numbers the accounts screen leads with. */
export const getPaymentStatistics = async () => {
  await expireStaleCheckouts({});

  const today = startOfToday();

  const [takenToday, byMethod, refunded, invoices] = await Promise.all([
    Transaction.aggregate([
      {
        $match: {
          direction: TRANSACTION_DIRECTIONS.PAYMENT,
          status: TRANSACTION_STATUSES.SUCCESS,
          settledAt: { $gte: today },
        },
      },
      { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Transaction.aggregate([
      {
        $match: { direction: TRANSACTION_DIRECTIONS.PAYMENT, status: TRANSACTION_STATUSES.SUCCESS },
      },
      { $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Transaction.aggregate([
      {
        $match: { direction: TRANSACTION_DIRECTIONS.REFUND, status: TRANSACTION_STATUSES.SUCCESS },
      },
      { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    // Bills are counted in the application rather than in the database because
    // their status is worked out, not stored - see `deriveInvoiceStatus`.
    Invoice.find({}, "amounts dueAt voidedAt").lean(),
  ]);

  const byStatus = Object.fromEntries(INVOICE_STATUS_VALUES.map((status) => [status, 0]));
  let outstanding = 0;

  invoices.forEach((invoice) => {
    const status = deriveInvoiceStatus({
      total: invoice.amounts.total,
      paid: invoice.amounts.paid,
      refunded: invoice.amounts.refunded,
      voidedAt: invoice.voidedAt,
      dueAt: invoice.dueAt,
    });

    byStatus[status] += 1;

    if (OPEN_INVOICE_STATUSES.includes(status)) {
      outstanding += Math.max(
        invoice.amounts.total - (invoice.amounts.paid - invoice.amounts.refunded),
        0
      );
    }
  });

  const methodTotals = Object.fromEntries(
    Object.values(PAYMENT_METHODS).map((method) => [method, { amount: 0, count: 0 }])
  );
  byMethod.forEach((row) => {
    methodTotals[row._id] = { amount: money(row.amount), count: row.count };
  });

  return {
    invoices: { byStatus, total: invoices.length },
    outstanding: money(outstanding),
    takenToday: {
      amount: money(takenToday[0]?.amount || 0),
      count: takenToday[0]?.count || 0,
    },
    refunded: {
      amount: money(refunded[0]?.amount || 0),
      count: refunded[0]?.count || 0,
    },
    byMethod: methodTotals,
  };
};

/* -------------------------------------------------------------------------- */
/* Shared with the refund service                                             */
/*                                                                            */
/* Refunds live in their own file because their rules are the mirror image of  */
/* these, but they write to the same ledger, so the pieces that build and load  */
/* one are shared rather than written out twice.                               */
/* -------------------------------------------------------------------------- */

export { buildTransaction, loadCustomer, syncInvoice };
