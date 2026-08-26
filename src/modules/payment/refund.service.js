import ApiError from "../../shared/utils/ApiError.js";
import { toId } from "../../shared/utils/id.util.js";
import { money } from "../../shared/utils/money.util.js";
import { sendEmailSafely } from "../../shared/mail/mailer.js";
import Reservation from "../reservation/reservation.model.js";
import { recordRefund as applyRefundToReservation } from "../reservation/reservation.service.js";
import Transaction from "./transaction.model.js";
import { refundIssuedTemplate } from "./emails/refundIssued.template.js";
import { getProviderByName } from "./providers/index.js";
import { AUDIT_ACTIONS } from "../audit/audit.constants.js";
import { recordAudit } from "../audit/audit.service.js";
import {
  auditTransaction,
  buildTransaction,
  loadCustomer,
  resolveInvoice,
  syncInvoice,
} from "./payment.service.js";
import {
  POLICY,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_STATUSES,
  quoteCancellationRefund,
} from "./payment.constants.js";

/**
 * Giving money back.
 *
 * Kept apart from the service that takes money in, because the rules are the
 * other way round: a payment is limited by what is still owed, a refund by what
 * was actually received. Both write to the same ledger, and neither ever edits
 * an existing entry - a refund is a new row pointing back at the payment it
 * reverses, so the two always add up.
 */

/* -------------------------------------------------------------------------- */
/* Quoting                                                                    */
/* -------------------------------------------------------------------------- */

const loadReservation = async (invoice) =>
  invoice.reservation && invoice.reservation.pricing
    ? invoice.reservation
    : Reservation.findById(toId(invoice.reservation));

/**
 * What the cancellation policy allows on this booking, and why.
 *
 * A quote changes nothing. The front desk can show the guest the number before
 * anybody commits to it, and the reason is written out in words so staff do not
 * have to know the policy by heart.
 */
export const quoteRefund = async (address, viewer) => {
  const invoice = await resolveInvoice(address, viewer);
  const reservation = await loadReservation(invoice);

  const quote = quoteCancellationRefund({
    paid: invoice.amounts.paid,
    refunded: invoice.amounts.refunded,
    advanceAmount: invoice.amounts.advance,
    checkIn: reservation?.checkIn ?? null,
  });

  return {
    invoice: invoice.toSafeObject(),
    quote: {
      ...quote,
      currency: invoice.currency,
      /** The most that could be given back if the policy were overridden. */
      maximum: invoice.netPaid,
    },
  };
};

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Chooses which payment a refund is taken against.
 *
 * Refunds go back the way the money came in - a card payment is reversed on the
 * card, not handed over as cash - so the refund is attached to a real payment
 * rather than floating free. The oldest payment with room left is used first,
 * which is what keeps a part-refunded bill simple to read.
 */
const findPaymentToReverse = async (invoice, amount, requestedTransactionId) => {
  if (requestedTransactionId) {
    const chosen = await Transaction.findOne({
      _id: requestedTransactionId,
      invoice: invoice._id,
      direction: TRANSACTION_DIRECTIONS.PAYMENT,
      status: TRANSACTION_STATUSES.SUCCESS,
    });

    if (!chosen) {
      throw new ApiError(404, "That payment does not belong to this invoice");
    }

    if (chosen.refundableAmount < amount) {
      throw new ApiError(
        400,
        `Only ${chosen.refundableAmount} of payment ${chosen.reference} can still be refunded`
      );
    }

    return chosen;
  }

  const payments = await Transaction.find({
    invoice: invoice._id,
    direction: TRANSACTION_DIRECTIONS.PAYMENT,
    status: TRANSACTION_STATUSES.SUCCESS,
  }).sort("createdAt");

  const usable = payments.find((payment) => payment.refundableAmount >= amount);

  if (!usable) {
    // Deliberately not split across several payments: a refund that has to be
    // broken up is a decision for a person, who can issue one per payment.
    throw new ApiError(
      400,
      `No single payment on this invoice has ${amount} left to refund. Refund against one payment at a time.`
    );
  }

  return usable;
};

/**
 * Sends money back to a guest.
 *
 * The amount defaults to whatever the cancellation policy allows, so the usual
 * case is one click. An operator with the refund permission may name a
 * different amount - a goodwill gesture, a billing mistake - as long as it does
 * not exceed what was actually received.
 */
export const issueRefund = async (actor, address, payload = {}) => {
  const invoice = await resolveInvoice(address, actor, { actorId: actor._id });
  const reservation = await loadReservation(invoice);

  const quote = quoteCancellationRefund({
    paid: invoice.amounts.paid,
    refunded: invoice.amounts.refunded,
    advanceAmount: invoice.amounts.advance,
    checkIn: reservation?.checkIn ?? null,
  });

  const amount = money(payload.amount ?? quote.amount);

  if (amount <= 0) {
    throw new ApiError(
      400,
      quote.reason || "There is nothing to refund on this invoice"
    );
  }

  if (amount > invoice.netPaid) {
    throw new ApiError(
      400,
      `That is more than the ${invoice.netPaid} ${invoice.currency} received on this invoice`
    );
  }

  if (amount > POLICY.MAX_AMOUNT) {
    throw new ApiError(400, "That amount is too large");
  }

  const original = await findPaymentToReverse(invoice, amount, payload.transaction);
  const provider = getProviderByName(original.provider);

  const refund = buildTransaction({
    invoice,
    amount,
    // A refund goes back by the same route the payment arrived.
    method: original.method,
    provider,
    direction: TRANSACTION_DIRECTIONS.REFUND,
    actor,
    payload: { note: payload.reason || "" },
  });
  refund.reverses = original._id;
  await refund.save();

  const outcome = provider.refund({ transaction: original, amount, invoice });

  if (!outcome.settled) {
    // Only reached by a gateway that refunds asynchronously; the callback
    // finishes it off, exactly as it does for a payment.
    refund.providerReference = outcome.providerReference ?? null;
    refund.providerStatus = outcome.providerStatus ?? null;
    await refund.save();

    return {
      invoice: invoice.toSafeObject(),
      refund: refund.toSafeObject(),
      settled: false,
    };
  }

  // The booking is updated first, for the same reason as on the way in: it
  // holds the stricter rule, and a failure there must not leave the ledger
  // claiming money went back when it did not.
  const reservationResult = await applyRefundToReservation(actor, toId(invoice.reservation), {
    amount,
    note: payload.reason || "",
  });

  original.refundedAmount = money(original.refundedAmount + amount);
  await original.save();

  invoice.amounts.refunded = money(invoice.amounts.refunded + amount);
  invoice.updatedBy = actor._id;
  if (!invoice.fullySettled) invoice.settledAt = null;
  await invoice.save();

  refund.settle({
    providerReference: outcome.providerReference,
    providerStatus: outcome.providerStatus,
  });
  await refund.save();

  const customer = await loadCustomer(invoice);

  if (customer?.email) {
    await sendEmailSafely({
      to: customer.email,
      subject: `Refund issued - ${invoice.reference}`,
      html: refundIssuedTemplate({
        name: customer.name,
        invoice,
        refund,
        reason: payload.reason || quote.reason,
      }),
    });
  }

  await recordAudit({
    action: AUDIT_ACTIONS.PAYMENT_REFUNDED,
    entity: auditTransaction(refund),
    actor,
    description:
      `Refunded ${amount} ${invoice.currency} against ${invoice.reference}, reversing ` +
      `${original.reference}`,
    changes: [
      {
        field: "invoice.refunded",
        from: String(money(invoice.amounts.refunded - amount)),
        to: String(invoice.amounts.refunded),
      },
    ],
    // The policy's own wording when nobody typed a reason, so an automatic
    // refund is never left looking unexplained.
    reason: payload.reason || quote.reason,
  });

  return {
    invoice: (await syncInvoice(invoice)).toSafeObject(),
    refund: refund.toSafeObject(),
    reverses: original.reference,
    reservation: reservationResult.reservation,
    settled: true,
  };
};
