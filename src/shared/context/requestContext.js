import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries "who is doing this, and from where" alongside a request.
 *
 * The audit log wants the caller's address, device and account on every entry.
 * The alternative is passing `req` down into every service function, which
 * would tie the services to Express and put an unused argument in dozens of
 * signatures.
 *
 * Node's AsyncLocalStorage solves this properly: a value stored at the start of
 * a request stays readable anywhere further down the same request, however many
 * awaits deep, and two requests handled at the same time never see each other's
 * values. Nothing outside a request has a store at all, which is why every read
 * copes with there being none - a seed script writing to the database is not a
 * bug, it simply has no browser behind it.
 */
const storage = new AsyncLocalStorage();

/** Wraps the rest of the request so anything it calls can read the context. */
export const runWithRequestContext = (context, callback) => storage.run(context, callback);

/** The current request's context, or an empty one outside a request. */
export const getRequestContext = () => storage.getStore() ?? {};

/**
 * Adds to the current context after it was created.
 *
 * Authentication happens after the context is set up - the address is known
 * from the first moment, the account only once the token has been checked - so
 * the middleware fills the user in later rather than building the context twice.
 */
export const updateRequestContext = (values) => {
  const store = storage.getStore();

  if (!store) return;

  Object.assign(store, values);
};

export default storage;
