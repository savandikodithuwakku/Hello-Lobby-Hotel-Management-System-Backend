import env from "../../../config/env.js";
import ApiError from "../../../shared/utils/ApiError.js";
import { METHOD_LABELS, PAYMENT_METHOD_VALUES, isManualMethod } from "../payment.constants.js";
import manualProvider from "./manual.provider.js";
import simulatedProvider from "./simulated.provider.js";

/**
 * The register of payment providers.
 *
 * Adding a real gateway is: write `<name>.provider.js` next to this file, add
 * one line to `ONLINE_PROVIDERS` below, and set `PAYMENT_PROVIDER=<name>` in
 * the environment. Nothing else in the codebase needs to know it exists.
 */
const ONLINE_PROVIDERS = Object.freeze({
  [simulatedProvider.name]: simulatedProvider,
});

/** The gateway currently configured for online payments. */
export const getOnlineProvider = () => {
  const provider = ONLINE_PROVIDERS[env.payment.provider];

  if (!provider) {
    throw new ApiError(
      503,
      `Online payments are not available: no provider named "${env.payment.provider}" is installed`
    );
  }

  return provider;
};

/** Picks the provider that handles a given method. */
export const getProviderForMethod = (method) => {
  if (isManualMethod(method)) return manualProvider;

  const provider = getOnlineProvider();

  if (!provider.supports(method)) {
    throw new ApiError(
      400,
      `${METHOD_LABELS[method] ?? method} cannot be handled by the ${provider.name} provider`
    );
  }

  return provider;
};

/** Finds a provider by the name stored on an existing transaction. */
export const getProviderByName = (name) => {
  if (name === manualProvider.name) return manualProvider;

  const provider = ONLINE_PROVIDERS[name];

  if (!provider) {
    throw new ApiError(400, `Unknown payment provider "${name}"`);
  }

  return provider;
};

/**
 * What the front end should offer the guest. Built from the register rather
 * than hard-coded, so a method disappears from the UI by itself when no
 * provider can handle it.
 */
export const describeAvailableMethods = () => {
  const online = ONLINE_PROVIDERS[env.payment.provider] ?? null;

  return PAYMENT_METHOD_VALUES.map((method) => {
    const provider = isManualMethod(method)
      ? manualProvider
      : online?.supports(method)
        ? online
        : null;

    return {
      method,
      label: METHOD_LABELS[method] ?? method,
      available: Boolean(provider),
      provider: provider?.name ?? null,
      /** Manual methods are written down after the fact; online ones redirect. */
      requiresRedirect: Boolean(provider) && !isManualMethod(method),
      // Made obvious to the operator so a simulated payment is never mistaken
      // for real money having changed hands.
      simulated: provider?.name === simulatedProvider.name,
    };
  });
};

export { manualProvider, simulatedProvider };
