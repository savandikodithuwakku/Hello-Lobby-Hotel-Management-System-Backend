import ApiError from "../../shared/utils/ApiError.js";
import { toId } from "../../shared/utils/id.util.js";
import { money } from "../../shared/utils/money.util.js";
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from "../audit/audit.constants.js";
import { recordAudit } from "../audit/audit.service.js";
import { RESERVATION_STATUSES } from "../reservation/reservation.constants.js";
import { applyFolioTotal } from "../reservation/reservation.service.js";
import { resolveInvoice, syncInvoice } from "./payment.service.js";
import { CHARGE_CATEGORIES, POLICY, POSTABLE_CHARGE_CATEGORIES } from "./payment.constants.js";

/**
 * The folio: what a guest used while they were staying.
 *
 * A booking's `additionalServices` is what was agreed when the room was booked
 * and is frozen once the guest arrives. This is the other half - the minibar,
 * the laundry, the late checkout - and it has to stay open for exactly the
 * period the other half is closed.
 *
 * Charges are posted to the invoice rather than back onto the booking, so the
 * bill stays the one place money lives and adding a bottle of water does not
 * mean unfreezing a booking's dates. The booking is told the running total
 * afterwards, and nothing else.
 *
 * Lines are never edited or deleted. A mistake is corrected by reversing it,
 * which leaves both the error and the correction on the guest's bill where
 * they can be explained.
 */

/** Charges can only be added while the guest is actually here. */
const CHARGEABLE_STATUSES = Object.freeze([
  RESERVATION_STATUSES.CHECKED_IN,
  // Still allowed at the desk on the way out: a late checkout or a last-minute
  // minibar is exactly the thing being settled at that moment.
  RESERVATION_STATUSES.CHECKED_OUT,
]);

const assertChargeable = (invoice, reservation) => {
  if (invoice.voidedAt) {
    throw new ApiError(409, "This booking was cancelled, so nothing more can be charged to it");
  }

  if (!CHARGEABLE_STATUSES.includes(reservation.status)) {
    throw new ApiError(
      409,
      reservation.status === RESERVATION_STATUSES.COMPLETED
        ? "This stay is closed. Charges can no longer be added to it."
        : "Charges can only be added once the guest has checked in"
    );
  }

  if (invoice.charges.length >= POLICY.MAX_CHARGES) {
    throw new ApiError(409, "This folio has reached its maximum number of lines");
  }
};

/**
 * Pushes the folio total onto the booking, then brings the bill back in step.
 *
 * The booking is updated first because its total is what the invoice reads when
 * it syncs; doing it the other way round would show the old total until
 * something else happened to touch the bill.
 */
const settleTotals = async (invoice, actor) => {
  await applyFolioTotal(actor, toId(invoice.reservation), { total: invoice.chargesTotal });
  return syncInvoice(invoice);
};

/** Everything charged to a room, oldest first, with the running total. */
export const listCharges = async (address, viewer) => {
  const invoice = await resolveInvoice(address, viewer);

  return {
    invoice: invoice.toSafeObject(),
    total: invoice.chargesTotal,
    currency: invoice.currency,
  };
};

/**
 * Posts one thing the guest used to their bill.
 *
 * The room's own charges - a late checkout, an extra bed - go under
 * `room_charge`; everything else names what it was. The description is what the
 * guest reads on the bill, so it is required and never generated.
 */
export const postCharge = async (actor, address, payload) => {
  const invoice = await resolveInvoice(address, actor, { actorId: actor._id });
  const reservation = invoice.reservation;

  assertChargeable(invoice, reservation);

  const category = payload.category || CHARGE_CATEGORIES.OTHER;

  if (!POSTABLE_CHARGE_CATEGORIES.includes(category)) {
    throw new ApiError(400, `${category} is not a category a charge can be posted under`);
  }

  const unitPrice = money(payload.unitPrice);
  const quantity = Math.max(1, Math.floor(Number(payload.quantity) || 1));
  const amount = money(unitPrice * quantity);

  if (amount <= 0) {
    throw new ApiError(400, "A charge must be greater than zero");
  }

  if (amount > POLICY.MAX_AMOUNT) {
    throw new ApiError(400, "That amount is too large");
  }

  invoice.charges.push({
    description: payload.description,
    category,
    unitPrice,
    quantity,
    amount,
    postedBy: actor._id,
    postedAt: new Date(),
    note: payload.note || "",
  });

  invoice.updatedBy = actor._id;
  await invoice.save();

  const charge = invoice.charges[invoice.charges.length - 1];
  const updated = await settleTotals(invoice, actor);

  await recordAudit({
    action: AUDIT_ACTIONS.FOLIO_CHARGE_POSTED,
    entity: { type: AUDIT_ENTITIES.INVOICE, id: invoice._id, label: invoice.reference },
    actor,
    description:
      `Charged ${amount} ${invoice.currency} to ${reservation.reference}: ${payload.description}`,
    changes: [
      {
        field: "folio.total",
        from: String(money(updated.chargesTotal - amount)),
        to: String(updated.chargesTotal),
      },
    ],
    reason: payload.note || "",
  });

  return {
    invoice: updated.toSafeObject(),
    charge: updated.charges.id(charge._id),
    total: updated.chargesTotal,
  };
};

/**
 * Cancels a charge out.
 *
 * A posted line is never removed, because a guest who queried their bill and
 * watched a line vanish has no way to check what happened. Instead an opposite
 * line is added pointing at the original, so the bill shows both the charge and
 * the fact that it was taken off again.
 */
export const reverseCharge = async (actor, address, chargeId, { reason = "" } = {}) => {
  const invoice = await resolveInvoice(address, actor, { actorId: actor._id });
  const reservation = invoice.reservation;

  const original = invoice.charges.id(chargeId);

  if (!original) {
    throw new ApiError(404, "That charge is not on this bill");
  }

  if (original.category === CHARGE_CATEGORIES.ADJUSTMENT) {
    throw new ApiError(409, "An adjustment cannot itself be reversed");
  }

  const alreadyReversed = invoice.charges.some(
    (charge) => charge.reverses && charge.reverses.toString() === chargeId
  );

  if (alreadyReversed) {
    throw new ApiError(409, `${original.description} has already been taken off this bill`);
  }

  if (invoice.voidedAt) {
    throw new ApiError(409, "This bill is closed");
  }

  invoice.charges.push({
    description: `Reversal of: ${original.description}`,
    category: CHARGE_CATEGORIES.ADJUSTMENT,
    unitPrice: -original.unitPrice,
    quantity: original.quantity,
    amount: money(-original.amount),
    reverses: original._id,
    postedBy: actor._id,
    postedAt: new Date(),
    note: reason,
  });

  invoice.updatedBy = actor._id;
  await invoice.save();

  const updated = await settleTotals(invoice, actor);

  await recordAudit({
    action: AUDIT_ACTIONS.FOLIO_CHARGE_REVERSED,
    entity: { type: AUDIT_ENTITIES.INVOICE, id: invoice._id, label: invoice.reference },
    actor,
    description:
      `Took ${original.amount} ${invoice.currency} off ${reservation.reference}: ` +
      `${original.description}`,
    changes: [
      {
        field: "folio.total",
        from: String(money(updated.chargesTotal + original.amount)),
        to: String(updated.chargesTotal),
      },
    ],
    reason,
  });

  return { invoice: updated.toSafeObject(), total: updated.chargesTotal };
};
