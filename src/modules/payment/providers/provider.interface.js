/**
 * What a payment provider has to be able to do.
 *
 * Everything that differs between "a member of staff took cash at the desk" and
 * "a guest paid by card on a gateway's website" is hidden behind these four
 * functions. The payment service only ever talks to a provider through them, so
 * adding a real gateway later means writing one new file in this folder and
 * changing one environment variable - no service, controller or model changes.
 *
 * A provider is a plain object with these members:
 *
 *   name        A short lowercase id stored on every transaction it handles.
 *
 *   supports(method)
 *               Whether this provider can handle that payment method.
 *
 *   initiate({ transaction, invoice, reservation, customer })
 *               Starts a payment. Returns:
 *                 settled           true when the money has already moved (cash
 *                                   in hand), false when the guest still has to
 *                                   do something.
 *                 providerReference the provider's own id for this payment.
 *                 providerStatus    the provider's own wording, for support.
 *                 redirectUrl       where to send the guest, when settled is false.
 *                 expiresAt         when an unfinished payment is abandoned.
 *
 *   verify(transaction)
 *               Asks the provider what actually happened. Returns
 *                 { status, providerStatus, providerReference, reason }
 *               where status is one of the transaction statuses. Used when a
 *               callback never arrived, or when the guest reopens the page.
 *
 *   refund({ transaction, amount })
 *               Sends money back. Returns { settled, providerReference,
 *               providerStatus }.
 *
 *   parseCallback(body, { headers })
 *               Turns a provider's callback into
 *                 { providerReference, outcome, providerStatus, amount }
 *               where outcome is "success", "failed" or "cancelled". Must throw
 *               if the callback is not genuine - this is the security boundary
 *               between the open internet and the ledger.
 *
 * Two rules every provider must follow:
 *
 *  1. Never return, log or store card numbers, expiry dates or security codes.
 *     Only references and statuses belong in this system.
 *  2. `parseCallback` must verify the provider's signature before trusting a
 *     single field in the body.
 */

import ApiError from "../../../shared/utils/ApiError.js";

/**
 * Used by providers that do not take callbacks - a cash payment has no website
 * to call anything back.
 */
export const callbacksNotSupported = (providerName) => () => {
  throw new ApiError(400, `The ${providerName} provider does not accept callbacks`);
};

/** Small guard so a provider fails loudly rather than half-working. */
export const assertProviderShape = (provider) => {
  const required = ["name", "supports", "initiate", "verify", "refund", "parseCallback"];
  const missing = required.filter((key) => provider?.[key] === undefined);

  if (missing.length > 0) {
    throw new Error(
      `Payment provider "${provider?.name ?? "unknown"}" is missing: ${missing.join(", ")}`
    );
  }

  return provider;
};
