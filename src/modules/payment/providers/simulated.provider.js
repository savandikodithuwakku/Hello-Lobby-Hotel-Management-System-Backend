import crypto from "crypto";
import env from "../../../config/env.js";
import { getFrontendBaseUrl } from "../../../config/app.config.js";
import ApiError from "../../../shared/utils/ApiError.js";
import { signMessage, signaturesMatch } from "../../../shared/utils/crypto.util.js";
import { ONLINE_METHODS, POLICY, TRANSACTION_STATUSES } from "../payment.constants.js";
import { assertProviderShape } from "./provider.interface.js";

/**
 * A stand-in for a real payment gateway.
 *
 * A commercial gateway costs money to use, and this project does not have one
 * yet. Rather than leave online payments unbuilt until it does, this provider
 * plays the part of a gateway exactly: it hands back a checkout link, waits for
 * the guest, and calls the system back with a signed message that has to be
 * checked before it is believed.
 *
 * That means the whole online-payment path - starting a payment, redirecting,
 * the callback, signature checking, verifying, refunding - is real code that
 * runs today. Swapping in a paid gateway later is one new file in this folder
 * and one changed environment variable; nothing outside this folder moves.
 *
 * `assertEnvIsValid` refuses to boot in production with this provider selected,
 * because it approves whatever it is told to approve.
 */

/** Falls back to the JWT secret so the simulator works with no extra setup. */
const secret = () => env.payment.simulatorSecret || env.jwt.accessSecret;

/** The exact message a callback's signature is taken over. */
const callbackMessage = ({ providerReference, outcome, amount }) =>
  `${providerReference}|${outcome}|${amount}`;

/**
 * Produces the signature a real gateway would send. Exposed so a developer (or
 * the checkout page) can build a valid callback without a live gateway.
 */
export const signSimulatedCallback = (payload) => signMessage(callbackMessage(payload), secret());

const OUTCOMES = Object.freeze({
  success: TRANSACTION_STATUSES.SUCCESS,
  failed: TRANSACTION_STATUSES.FAILED,
  cancelled: TRANSACTION_STATUSES.CANCELLED,
});

export const outcomeToStatus = (outcome) => OUTCOMES[outcome] ?? null;

const newProviderReference = (prefix) =>
  `${prefix}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

export const simulatedProvider = assertProviderShape({
  name: "simulated",

  supports: (method) => ONLINE_METHODS.includes(method),

  initiate: ({ transaction }) => {
    const providerReference = newProviderReference("SIM");
    const expiresAt = new Date(Date.now() + POLICY.CHECKOUT_EXPIRY_MINUTES * 60_000);

    // Where the guest goes to approve or decline. A real gateway would host
    // this page itself; the simulator hands it to our own front end.
    const redirectUrl =
      `${getFrontendBaseUrl()}${env.payment.checkoutPath}` +
      `?reference=${encodeURIComponent(transaction.reference)}` +
      `&provider=simulated`;

    return {
      settled: false,
      providerReference,
      providerStatus: "Awaiting the guest",
      redirectUrl,
      expiresAt,
    };
  },

  /**
   * A real gateway is asked what happened. The simulator has nobody to ask, so
   * a payment nobody completed in time is treated as abandoned.
   */
  verify: (transaction) => {
    const expired = transaction.expiresAt && transaction.expiresAt.getTime() < Date.now();

    if (transaction.status === TRANSACTION_STATUSES.PENDING && expired) {
      return {
        status: TRANSACTION_STATUSES.CANCELLED,
        providerStatus: "Expired before the guest completed it",
        providerReference: transaction.providerReference,
        reason: "The checkout session expired",
      };
    }

    return {
      status: transaction.status,
      providerStatus: transaction.providerStatus,
      providerReference: transaction.providerReference,
      reason: "",
    };
  },

  refund: ({ transaction }) => ({
    settled: true,
    providerReference: newProviderReference("SIMREF"),
    providerStatus: `Refunded against ${transaction.providerReference ?? transaction.reference}`,
  }),

  /**
   * The security boundary. This endpoint is open to the internet, so nothing in
   * the body is trusted until the signature over it checks out.
   */
  parseCallback: (body = {}) => {
    const { providerReference, outcome, amount, signature } = body;

    if (!providerReference || !outcome || !signature) {
      throw new ApiError(400, "The callback is missing required fields");
    }

    if (!outcomeToStatus(outcome)) {
      throw new ApiError(400, `Unknown outcome "${outcome}"`);
    }

    const expected = signSimulatedCallback({ providerReference, outcome, amount });

    if (!signaturesMatch(signature, expected)) {
      throw new ApiError(401, "The callback signature is not valid");
    }

    return {
      providerReference,
      outcome,
      providerStatus: `Gateway reported: ${outcome}`,
      amount: amount === undefined ? null : Number(amount),
    };
  },
});

export default simulatedProvider;
