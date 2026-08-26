/**
 * Small text helpers used by the search filters and by error messages.
 */

/**
 * Makes a user-supplied string safe to put inside a regular expression.
 *
 * Without this, a search for "a+b" would be read as a pattern rather than as
 * text, which is both wrong and a denial-of-service risk.
 */
export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches anywhere in a field, ignoring case: the usual "search box" match. */
export const containsInsensitive = (value) => new RegExp(escapeRegex(value), "i");

/** Matches the whole field, ignoring case, so "Deluxe" collides with "deluxe". */
export const equalsInsensitive = (value) =>
  new RegExp(`^${escapeRegex(String(value).trim())}$`, "i");

/** Turns a stored status such as `checked_in` into "checked in" for a message. */
export const humanise = (status) => String(status).replace(/_/g, " ");
