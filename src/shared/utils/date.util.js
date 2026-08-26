/**
 * Date helpers shared by the modules that show dates in messages.
 */

/** `yyyy-mm-dd`, the form used in user-facing messages and in the API. */
export const toDateString = (value) => new Date(value).toISOString().slice(0, 10);
