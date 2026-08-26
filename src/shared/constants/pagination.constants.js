/**
 * Paging limits for every list endpoint in the API.
 *
 * One definition for the whole application: each module used to declare its
 * own copy, so a change to the maximum page size had to be made in several
 * places and could easily drift.
 */

/** How many records a list returns when the caller does not ask for a size. */
export const DEFAULT_PAGE_SIZE = 20;

/** The most a caller may ask for, so one request cannot pull the whole table. */
export const MAX_PAGE_SIZE = 100;
