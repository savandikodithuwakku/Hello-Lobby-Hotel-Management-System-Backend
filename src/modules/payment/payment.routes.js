import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requirePermission } from "../auth/rbac/rbac.middleware.js";
import { PERMISSIONS } from "../auth/rbac/permissions.js";
import { validateRequest } from "../../shared/middleware/validate.middleware.js";
import { paymentCallbackRateLimiter } from "../../shared/middleware/rateLimit.middleware.js";
import * as paymentController from "./payment.controller.js";
import {
  callbackValidation,
  cancelTransactionValidation,
  getInvoiceValidation,
  listInvoicesValidation,
  listTransactionsValidation,
  postChargeValidation,
  recordPaymentValidation,
  refundValidation,
  reverseChargeValidation,
  startCheckoutValidation,
  transactionIdValidation,
} from "./payment.validation.js";

/**
 * Payments and billing.
 *
 * Two ways in, on purpose. The accounts screen addresses a bill directly under
 * `/invoices/...`, while the front desk works in bookings and addresses the
 * same bill under `/reservations/:reservationId/...` without having to look an
 * invoice up first. Both reach the same handlers, so there is one set of rules.
 *
 * As in the reservation module, reading is scoped by permission rather than by
 * route: a guest holding only `payment:read_own` uses the same endpoints and
 * the service narrows the results to their own bills.
 */
const router = Router();

/* -------------------------------------------------------------------------- */
/* Provider callbacks                                                         */
/*                                                                            */
/* Registered before `authenticate`, because a payment gateway has no session  */
/* to present. What makes this safe is the signature check the provider does   */
/* inside `parseCallback` - nothing in the body is trusted before that.        */
/* -------------------------------------------------------------------------- */

router.post(
  "/webhooks/:provider",
  paymentCallbackRateLimiter,
  callbackValidation,
  validateRequest,
  paymentController.handleProviderCallback
);

router.use(authenticate);

/* -------------------------------------------------------------------------- */
/* What the payment form should offer                                         */
/* -------------------------------------------------------------------------- */

router.get(
  "/methods",
  requirePermission(
    PERMISSIONS.PAYMENT_CREATE,
    PERMISSIONS.PAYMENT_READ,
    PERMISSIONS.PAYMENT_READ_OWN
  ),
  paymentController.listPaymentMethods
);

/* -------------------------------------------------------------------------- */
/* Invoices                                                                   */
/* -------------------------------------------------------------------------- */

/** Declared before `/invoices/:id` so "statistics" is not read as an id. */
router.get(
  "/invoices/statistics",
  requirePermission(PERMISSIONS.PAYMENT_READ),
  paymentController.getPaymentStatistics
);

router.get(
  "/invoices",
  requirePermission(PERMISSIONS.PAYMENT_READ, PERMISSIONS.PAYMENT_READ_OWN),
  listInvoicesValidation,
  validateRequest,
  paymentController.listInvoices
);

router.get(
  "/invoices/:id",
  requirePermission(PERMISSIONS.PAYMENT_READ, PERMISSIONS.PAYMENT_READ_OWN),
  getInvoiceValidation("id"),
  validateRequest,
  paymentController.getInvoice
);

/** Money the hotel already has in hand. Staff only - a guest cannot declare
 * that they handed over cash. */
router.post(
  "/invoices/:id/payments",
  requirePermission(PERMISSIONS.PAYMENT_CREATE),
  recordPaymentValidation("id"),
  validateRequest,
  paymentController.recordPayment
);

/** Starting an online payment is the one write a guest performs on their own
 * bill, so it is gated on either permission and the service checks ownership. */
router.post(
  "/invoices/:id/checkout",
  requirePermission(PERMISSIONS.PAYMENT_CREATE, PERMISSIONS.PAYMENT_READ_OWN),
  startCheckoutValidation("id"),
  validateRequest,
  paymentController.startCheckout
);

/**
 * The folio - what the guest used while they were here.
 *
 * Posted to the bill rather than back onto the booking, so a minibar does not
 * require unfreezing a booking's dates, and so the money side of a stay stays
 * in one place. Only open while the guest is actually in the building.
 */
router.get(
  "/invoices/:id/charges",
  requirePermission(PERMISSIONS.PAYMENT_READ, PERMISSIONS.PAYMENT_READ_OWN),
  getInvoiceValidation("id"),
  validateRequest,
  paymentController.listCharges
);

router.post(
  "/invoices/:id/charges",
  requirePermission(PERMISSIONS.PAYMENT_CREATE),
  postChargeValidation("id"),
  validateRequest,
  paymentController.postCharge
);

/** A posted line is never deleted - it is cancelled out by an opposite one. */
router.post(
  "/invoices/:id/charges/:chargeId/reverse",
  requirePermission(PERMISSIONS.PAYMENT_CREATE),
  reverseChargeValidation("id"),
  validateRequest,
  paymentController.reverseCharge
);

router.get(
  "/invoices/:id/refund-quote",
  requirePermission(PERMISSIONS.PAYMENT_REFUND, PERMISSIONS.PAYMENT_READ),
  getInvoiceValidation("id"),
  validateRequest,
  paymentController.quoteRefund
);

router.post(
  "/invoices/:id/refunds",
  requirePermission(PERMISSIONS.PAYMENT_REFUND),
  refundValidation("id"),
  validateRequest,
  paymentController.issueRefund
);

/* -------------------------------------------------------------------------- */
/* The same bill, addressed by its booking                                    */
/*                                                                            */
/* The bill is created on first use, so the front desk never has to issue one  */
/* by hand - opening a booking's payment panel is enough.                      */
/* -------------------------------------------------------------------------- */

router.get(
  "/reservations/:reservationId/invoice",
  requirePermission(PERMISSIONS.PAYMENT_READ, PERMISSIONS.PAYMENT_READ_OWN),
  getInvoiceValidation("reservationId"),
  validateRequest,
  paymentController.getInvoice
);

router.post(
  "/reservations/:reservationId/payments",
  requirePermission(PERMISSIONS.PAYMENT_CREATE),
  recordPaymentValidation("reservationId"),
  validateRequest,
  paymentController.recordPayment
);

router.post(
  "/reservations/:reservationId/checkout",
  requirePermission(PERMISSIONS.PAYMENT_CREATE, PERMISSIONS.PAYMENT_READ_OWN),
  startCheckoutValidation("reservationId"),
  validateRequest,
  paymentController.startCheckout
);

router.get(
  "/reservations/:reservationId/charges",
  requirePermission(PERMISSIONS.PAYMENT_READ, PERMISSIONS.PAYMENT_READ_OWN),
  getInvoiceValidation("reservationId"),
  validateRequest,
  paymentController.listCharges
);

router.post(
  "/reservations/:reservationId/charges",
  requirePermission(PERMISSIONS.PAYMENT_CREATE),
  postChargeValidation("reservationId"),
  validateRequest,
  paymentController.postCharge
);

router.post(
  "/reservations/:reservationId/charges/:chargeId/reverse",
  requirePermission(PERMISSIONS.PAYMENT_CREATE),
  reverseChargeValidation("reservationId"),
  validateRequest,
  paymentController.reverseCharge
);

router.get(
  "/reservations/:reservationId/refund-quote",
  requirePermission(PERMISSIONS.PAYMENT_REFUND, PERMISSIONS.PAYMENT_READ),
  getInvoiceValidation("reservationId"),
  validateRequest,
  paymentController.quoteRefund
);

router.post(
  "/reservations/:reservationId/refunds",
  requirePermission(PERMISSIONS.PAYMENT_REFUND),
  refundValidation("reservationId"),
  validateRequest,
  paymentController.issueRefund
);

/* -------------------------------------------------------------------------- */
/* The ledger                                                                 */
/* -------------------------------------------------------------------------- */

router.get(
  "/transactions",
  requirePermission(PERMISSIONS.PAYMENT_READ, PERMISSIONS.PAYMENT_READ_OWN),
  listTransactionsValidation,
  validateRequest,
  paymentController.listTransactions
);

router.get(
  "/transactions/:id",
  requirePermission(PERMISSIONS.PAYMENT_READ, PERMISSIONS.PAYMENT_READ_OWN),
  transactionIdValidation,
  validateRequest,
  paymentController.getTransaction
);

/**
 * Asks the provider what happened to a payment. The safety net for a callback
 * that never arrived, which is why a guest may run it on their own payment.
 */
router.post(
  "/transactions/:id/verify",
  requirePermission(
    PERMISSIONS.PAYMENT_CREATE,
    PERMISSIONS.PAYMENT_READ,
    PERMISSIONS.PAYMENT_READ_OWN
  ),
  transactionIdValidation,
  validateRequest,
  paymentController.verifyTransaction
);

router.post(
  "/transactions/:id/cancel",
  requirePermission(PERMISSIONS.PAYMENT_CREATE, PERMISSIONS.PAYMENT_READ_OWN),
  cancelTransactionValidation,
  validateRequest,
  paymentController.cancelTransaction
);

export default router;
