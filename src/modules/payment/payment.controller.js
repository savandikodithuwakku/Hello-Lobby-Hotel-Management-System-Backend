import { sendCreated, sendOk } from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import * as paymentService from "./payment.service.js";
import * as refundService from "./refund.service.js";
import { describeAvailableMethods } from "./providers/index.js";
import { PAYMENT_MESSAGES } from "./payment.constants.js";

/**
 * A bill can be asked for by its own id or by the booking it belongs to. Both
 * routes reach the same handlers, so the address is read from whichever
 * parameter the route supplied.
 */
const addressOf = (req) => ({
  invoiceId: req.params.id,
  reservationId: req.params.reservationId,
});

/* --------------------------------- Reading -------------------------------- */

export const listInvoices = asyncHandler(async (req, res) => {
  // The service narrows the list to the caller when they may only see their own.
  const result = await paymentService.listInvoices(req.validatedQuery, req.user);
  sendOk(res, "Invoices fetched successfully", result);
});

export const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await paymentService.getInvoice(addressOf(req), req.user);
  sendOk(res, PAYMENT_MESSAGES.INVOICE_FETCHED, { invoice });
});

export const getPaymentStatistics = asyncHandler(async (req, res) => {
  const statistics = await paymentService.getPaymentStatistics();
  sendOk(res, "Payment statistics fetched", statistics);
});

export const listTransactions = asyncHandler(async (req, res) => {
  const result = await paymentService.listTransactions(req.validatedQuery, req.user);
  sendOk(res, "Payments fetched successfully", result);
});

export const getTransaction = asyncHandler(async (req, res) => {
  const transaction = await paymentService.getTransaction(req.params.id, req.user);
  sendOk(res, "Payment fetched successfully", { transaction });
});

/**
 * What the front end should offer the guest. Read from the provider register,
 * so a method disappears from the payment form by itself when nothing can
 * handle it - rather than the UI keeping its own list that goes out of date.
 */
export const listPaymentMethods = asyncHandler(async (req, res) => {
  sendOk(res, "Payment methods fetched", { methods: describeAvailableMethods() });
});

/* -------------------------------- Receiving ------------------------------- */

export const recordPayment = asyncHandler(async (req, res) => {
  const result = await paymentService.recordManualPayment(req.user, addressOf(req), req.body);

  sendCreated(
    res,
    // Paying the advance confirms the booking, so say so rather than leaving
    // the operator to notice the status changed on its own.
    result.autoConfirmed
      ? "Advance received. The reservation is now confirmed."
      : PAYMENT_MESSAGES.PAYMENT_RECORDED,
    result
  );
});

export const startCheckout = asyncHandler(async (req, res) => {
  const result = await paymentService.startCheckout(req.user, addressOf(req), req.body);

  sendCreated(
    res,
    result.redirectUrl
      ? PAYMENT_MESSAGES.CHECKOUT_STARTED
      : PAYMENT_MESSAGES.PAYMENT_RECORDED,
    result
  );
});

export const verifyTransaction = asyncHandler(async (req, res) => {
  const result = await paymentService.verifyTransaction(req.user, req.params.id);
  sendOk(res, PAYMENT_MESSAGES.TRANSACTION_VERIFIED, result);
});

export const cancelTransaction = asyncHandler(async (req, res) => {
  const transaction = await paymentService.cancelTransaction(req.user, req.params.id, req.body);
  sendOk(res, PAYMENT_MESSAGES.CHECKOUT_CANCELLED, { transaction });
});

/**
 * The provider's callback.
 *
 * Unauthenticated by necessity - a gateway has no session - so the provider's
 * signature check inside `parseCallback` is what makes it safe. The reply is
 * deliberately small: a gateway only needs to know the call was accepted.
 */
export const handleProviderCallback = asyncHandler(async (req, res) => {
  const result = await paymentService.handleProviderCallback(req.params.provider, req.body, {
    headers: req.headers,
  });

  sendOk(res, "Callback processed", result);
});

/* -------------------------------- Refunding ------------------------------- */

export const quoteRefund = asyncHandler(async (req, res) => {
  const result = await refundService.quoteRefund(addressOf(req), req.user);
  sendOk(res, "Refund quote calculated", result);
});

export const issueRefund = asyncHandler(async (req, res) => {
  const result = await refundService.issueRefund(req.user, addressOf(req), req.body);

  sendCreated(
    res,
    result.settled ? PAYMENT_MESSAGES.REFUND_ISSUED : "Refund submitted to the provider",
    result
  );
});
