import {
  METHOD_LABELS,
  TRANSACTION_STATUSES,
  isManualMethod,
} from "../payment.constants.js";
import { assertProviderShape, callbacksNotSupported } from "./provider.interface.js";

/**
 * Money the hotel took in the real world.
 *
 * Cash at reception, a card put through the hotel's own terminal, a bank
 * transfer that has landed. In all three cases a person has already handled the
 * money and the system's job is simply to write it down, so these payments are
 * settled the instant they are recorded.
 *
 * This is how most of a hotel's money actually arrives, which is why the
 * payment module is fully usable with no gateway account at all.
 */
export const manualProvider = assertProviderShape({
  name: "manual",

  supports: (method) => isManualMethod(method),

  initiate: ({ transaction }) => ({
    settled: true,
    providerReference: null,
    providerStatus: `Recorded at the front desk (${METHOD_LABELS[transaction.method]})`,
    redirectUrl: null,
    expiresAt: null,
  }),

  /** There is nobody to ask - what was written down is what happened. */
  verify: (transaction) => ({
    status: transaction.status,
    providerStatus: transaction.providerStatus,
    providerReference: transaction.providerReference,
    reason: "",
  }),

  /** The cash is handed back, or the transfer is reversed, by a human. */
  refund: () => ({
    settled: true,
    providerReference: null,
    providerStatus: "Refunded at the front desk",
  }),

  parseCallback: callbacksNotSupported("manual"),
});

export default manualProvider;
