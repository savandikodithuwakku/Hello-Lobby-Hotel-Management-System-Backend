/**
 * Baggage held at the desk.
 *
 * A guest arrives at nine in the morning for a two o'clock check-in, or checks
 * out at eleven and comes back for their bags at six. Both are the same job:
 * the hotel takes something that is not theirs and has to be able to give it
 * back to the right person.
 *
 * Which is why baggage is not part of a reservation. Plenty of the bags behind
 * a hotel desk belong to somebody with no booking at all - a day visitor, a
 * guest whose stay ended this morning - so the booking is recorded when there
 * is one and left empty when there is not.
 */
import { POLICY as RESERVATION_POLICY } from "../reservation/reservation.constants.js";

/* -------------------------------------------------------------------------- */
/* Where it is being held                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A note like "store room B, shelf 3", not a fixed list.
 *
 * Every hotel's storage is laid out differently, and an enum here would be
 * wrong for all of them. What matters is that whoever goes to fetch the bags
 * can find them.
 */
export const LOCATION_MAX = 80;

/* -------------------------------------------------------------------------- */
/* What has happened to it                                                    */
/* -------------------------------------------------------------------------- */

export const BAGGAGE_STATUSES = Object.freeze({
  /** Behind the desk now. */
  STORED: "stored",
  /** Handed back. */
  COLLECTED: "collected",
  /** Still here long after it should have been picked up. */
  UNCLAIMED: "unclaimed",
});

export const BAGGAGE_STATUS_VALUES = Object.freeze(Object.values(BAGGAGE_STATUSES));

export const POLICY = Object.freeze({
  /**
   * After this long, stored baggage is treated as unclaimed.
   *
   * Not a deletion rule - nothing is thrown away by software. It puts the bags
   * on a list somebody has to look at, which is the only way anyone notices a
   * suitcase that has been behind the desk since March.
   */
  UNCLAIMED_AFTER_DAYS: 7,
  MAX_BAGS: 30,
  NOTE_MAX: RESERVATION_POLICY.NOTE_MAX,
  GUEST_NAME_MAX: 80,
  DESCRIPTION_MAX: 200,
});

/**
 * Worked out, never stored.
 *
 * Same reasoning as an invoice's status: a stored flag saying "unclaimed" would
 * only be right if something ran every night to update it, and the first time
 * that job failed the list would quietly go stale. Deriving it from the dates
 * means it cannot be wrong.
 */
export const deriveBaggageStatus = ({ receivedAt, collectedAt, reference = new Date() } = {}) => {
  if (collectedAt) return BAGGAGE_STATUSES.COLLECTED;

  const age = reference.getTime() - new Date(receivedAt).getTime();

  return age > POLICY.UNCLAIMED_AFTER_DAYS * 86_400_000
    ? BAGGAGE_STATUSES.UNCLAIMED
    : BAGGAGE_STATUSES.STORED;
};

/* -------------------------------------------------------------------------- */
/* Listing options                                                            */
/* -------------------------------------------------------------------------- */

export const BAGGAGE_SORT_OPTIONS = Object.freeze([
  "receivedAt",
  "-receivedAt",
  "bagCount",
  "-bagCount",
]);

/** Longest-held first: the bags most likely to have been forgotten. */
export const DEFAULT_BAGGAGE_SORT = "receivedAt";

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../shared/constants/pagination.constants.js";

export const BAGGAGE_MESSAGES = Object.freeze({
  STORED: "Baggage checked in",
  COLLECTED: "Baggage handed back",
  UPDATED: "Baggage record updated",
  FETCHED: "Baggage fetched successfully",
});
