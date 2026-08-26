import { body, param, query } from "express-validator";
import {
  mongoIdBody,
  mongoIdParam,
  mongoIdQuery,
  noteBody,
  paginationRules,
  searchRule,
  sortRule,
} from "../../shared/validators/common.validators.js";
import {
  INVOICE_SORT_OPTIONS,
  INVOICE_STATUS_VALUES,
  MANUAL_METHODS,
  ONLINE_METHODS,
  POLICY,
  TRANSACTION_DIRECTION_VALUES,
  TRANSACTION_SORT_OPTIONS,
  TRANSACTION_STATUS_VALUES,
} from "./payment.constants.js";

/**
 * A bill can be addressed either by its own id or by the booking it belongs to,
 * because the front desk works in bookings and the accounts screen works in
 * bills. Both routes share one controller, so the only thing that differs is
 * which parameter is checked - hence a factory rather than two copies.
 */
const addressValidation = (paramName) =>
  paramName === "reservationId"
    ? mongoIdParam("reservationId", "reservation")
    : mongoIdParam("id", "invoice");

export const invoiceIdValidation = mongoIdParam("id", "invoice");
export const transactionIdValidation = mongoIdParam("id", "payment");

const noteField = (field = "note", label = "Note") => noteBody(field, POLICY.NOTE_MAX, label);

const amountField = ({ optional = false } = {}) => {
  const chain = optional ? body("amount").optional() : body("amount");

  return chain
    .isFloat({ gt: 0, max: POLICY.MAX_AMOUNT })
    .withMessage("The amount must be greater than zero")
    .toFloat();
};

const dateRangeRules = () => [
  query("from").optional().isISO8601().withMessage("from must be a valid date").toDate(),
  query("to").optional().isISO8601().withMessage("to must be a valid date").toDate(),
];

/* ---------------------------------- Reads --------------------------------- */

export const listInvoicesValidation = [
  ...paginationRules(),
  searchRule(80),
  query("status").optional().isIn(INVOICE_STATUS_VALUES).withMessage("Unknown invoice status"),
  mongoIdQuery("customer", "Invalid customer filter"),
  ...dateRangeRules(),
  sortRule(INVOICE_SORT_OPTIONS),
];

export const listTransactionsValidation = [
  ...paginationRules(),
  mongoIdQuery("invoice", "Invalid invoice filter"),
  mongoIdQuery("reservation", "Invalid reservation filter"),
  mongoIdQuery("customer", "Invalid customer filter"),
  query("method")
    .optional()
    .isIn([...MANUAL_METHODS, ...ONLINE_METHODS])
    .withMessage("Unknown payment method"),
  query("status").optional().isIn(TRANSACTION_STATUS_VALUES).withMessage("Unknown payment status"),
  query("direction")
    .optional()
    .isIn(TRANSACTION_DIRECTION_VALUES)
    .withMessage("Direction must be a payment or a refund"),
  ...dateRangeRules(),
  sortRule(TRANSACTION_SORT_OPTIONS),
];

export const getInvoiceValidation = (paramName = "id") => [...addressValidation(paramName)];

/* --------------------------------- Writes --------------------------------- */

/** Money already taken in person: cash, the hotel's card terminal, a transfer. */
export const recordPaymentValidation = (paramName = "id") => [
  ...addressValidation(paramName),
  amountField(),
  body("method")
    .isIn(MANUAL_METHODS)
    .withMessage(`The method must be one of: ${MANUAL_METHODS.join(", ")}`),
  body("externalReference")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: POLICY.EXTERNAL_REFERENCE_MAX })
    .withMessage("The reference is too long"),
  noteField(),
];

/** Starting an online payment, which the provider then carries out. */
export const startCheckoutValidation = (paramName = "id") => [
  ...addressValidation(paramName),
  amountField(),
  body("method")
    .optional()
    .isIn(ONLINE_METHODS)
    .withMessage(`The method must be one of: ${ONLINE_METHODS.join(", ")}`),
  noteField(),
];

/**
 * The amount is optional: left out, the cancellation policy decides it, which
 * is the normal case. Naming one is the exception and needs the refund
 * permission the route already requires.
 */
export const refundValidation = (paramName = "id") => [
  ...addressValidation(paramName),
  amountField({ optional: true }),
  mongoIdBody("transaction", "Invalid payment reference", { optional: true }),
  noteField("reason", "Reason"),
];

export const cancelTransactionValidation = [...transactionIdValidation, noteField("reason", "Reason")];

/**
 * A provider's callback. Only the provider name is checked here - every field
 * in the body is the provider's own shape, and the provider verifies its
 * signature before any of it is believed.
 */
export const callbackValidation = [
  param("provider")
    .isSlug()
    .withMessage("Unknown payment provider")
    .isLength({ max: 40 })
    .withMessage("Unknown payment provider"),
];
