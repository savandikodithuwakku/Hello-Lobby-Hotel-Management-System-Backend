/**
 * The room state machine.
 *
 * A room carries two statuses, not one, because two different people need to
 * describe it at the same time and they are describing different things:
 *
 *   occupancy    Is somebody attached to this room? Driven entirely by
 *                reservations - a room becomes reserved because a booking was
 *                made and occupied because a guest arrived. Never set by hand.
 *
 *   housekeeping Is this room fit to sell? Driven entirely by housekeeping -
 *                a room is dirty after a night's stay, cleaned, then inspected.
 *                Nothing about a booking changes it.
 *
 * They move independently. An occupied room is dirty every morning and clean
 * again by the afternoon; a vacant room stays dirty until somebody services it.
 * Holding both in one field, as this module first did, meant housekeeping had
 * nowhere to write while a guest was in the room - and it made the one report
 * that matters impossible to produce: rooms standing empty and dirty, silently
 * unsellable, because nobody noticed they had not been cleaned.
 *
 * A room can be sold only when both agree: nobody in it, and fit for a guest.
 */

/* -------------------------------------------------------------------------- */
/* Occupancy - is somebody attached to this room                              */
/* -------------------------------------------------------------------------- */

export const OCCUPANCY_STATUSES = Object.freeze({
  VACANT: "vacant",
  /** Held by a booking that has not arrived yet. */
  RESERVED: "reserved",
  /** A guest has checked in. */
  OCCUPIED: "occupied",
});

export const OCCUPANCY_STATUS_VALUES = Object.freeze(Object.values(OCCUPANCY_STATUSES));

/**
 * Occupancy is never set through the room endpoints. It changes because
 * something happened to a booking, so the reservation and front-desk modules
 * drive it through the transition helpers in `room.service.js`. That is what
 * stops a room being freed by hand while a booking still points at it.
 */
export const IN_USE_OCCUPANCY = Object.freeze([
  OCCUPANCY_STATUSES.RESERVED,
  OCCUPANCY_STATUSES.OCCUPIED,
]);

/* -------------------------------------------------------------------------- */
/* Housekeeping - is this room fit to sell                                    */
/* -------------------------------------------------------------------------- */

export const HOUSEKEEPING_STATUSES = Object.freeze({
  /** Serviced and ready. */
  CLEAN: "clean",
  /** Needs servicing - where a room lands the moment a guest leaves, and
   * where an occupied room sits each morning. */
  DIRTY: "dirty",
  /** Somebody is working on it now. */
  CLEANING: "cleaning",
  /** Cleaned and checked by a supervisor. The sign-off is what makes "clean"
   * worth trusting, and it is the strongest state a room can be in. */
  INSPECTED: "inspected",
  /** Broken, being repaired, or otherwise not to be sold at any price. */
  OUT_OF_ORDER: "out_of_order",
});

export const HOUSEKEEPING_STATUS_VALUES = Object.freeze(Object.values(HOUSEKEEPING_STATUSES));

/** The two states in which a room may be given to a guest. */
export const SELLABLE_HOUSEKEEPING = Object.freeze([
  HOUSEKEEPING_STATUSES.CLEAN,
  HOUSEKEEPING_STATUSES.INSPECTED,
]);

/**
 * Housekeeping transitions an operator may perform directly.
 *
 * The normal round is dirty → cleaning → clean → inspected. Anything can be
 * taken out of order, and a room that was out of order comes back through
 * cleaning rather than straight to sellable - it has been sitting unused.
 */
export const ALLOWED_HOUSEKEEPING_TRANSITIONS = Object.freeze({
  [HOUSEKEEPING_STATUSES.DIRTY]: Object.freeze([
    HOUSEKEEPING_STATUSES.CLEANING,
    HOUSEKEEPING_STATUSES.OUT_OF_ORDER,
  ]),
  [HOUSEKEEPING_STATUSES.CLEANING]: Object.freeze([
    HOUSEKEEPING_STATUSES.CLEAN,
    HOUSEKEEPING_STATUSES.DIRTY,
    HOUSEKEEPING_STATUSES.OUT_OF_ORDER,
  ]),
  [HOUSEKEEPING_STATUSES.CLEAN]: Object.freeze([
    HOUSEKEEPING_STATUSES.INSPECTED,
    HOUSEKEEPING_STATUSES.DIRTY,
    HOUSEKEEPING_STATUSES.OUT_OF_ORDER,
  ]),
  [HOUSEKEEPING_STATUSES.INSPECTED]: Object.freeze([
    HOUSEKEEPING_STATUSES.DIRTY,
    HOUSEKEEPING_STATUSES.OUT_OF_ORDER,
  ]),
  [HOUSEKEEPING_STATUSES.OUT_OF_ORDER]: Object.freeze([
    HOUSEKEEPING_STATUSES.CLEANING,
    HOUSEKEEPING_STATUSES.DIRTY,
  ]),
});

export const getAllowedHousekeepingTransitions = (status) =>
  ALLOWED_HOUSEKEEPING_TRANSITIONS[status] || [];

export const canChangeHousekeeping = (from, to) =>
  getAllowedHousekeepingTransitions(from).includes(to);

/* -------------------------------------------------------------------------- */
/* The two together                                                           */
/* -------------------------------------------------------------------------- */

/** A room can be sold when nobody holds it and it is fit for a guest. */
export const isSellable = ({ occupancy, housekeeping, isActive = true }) =>
  isActive &&
  occupancy === OCCUPANCY_STATUSES.VACANT &&
  SELLABLE_HOUSEKEEPING.includes(housekeeping);

/**
 * Housekeeping states that stop a room being booked at all, on any date.
 *
 * Only out of order counts. A room that is merely dirty today can perfectly
 * well be sold for next month - it will have been cleaned long before then, and
 * refusing the booking would cost the hotel a sale for no reason.
 */
export const NON_BOOKABLE_HOUSEKEEPING = Object.freeze([HOUSEKEEPING_STATUSES.OUT_OF_ORDER]);

/**
 * Where a room's occupancy and housekeeping land when a booking ends.
 *
 * A cancelled booking never had anyone in the room, so it goes back exactly as
 * it was. A guest who has left always leaves the room dirty - that is what
 * puts it on the housekeeping list without anyone having to remember.
 */
export const RELEASE_STATE = Object.freeze({
  [OCCUPANCY_STATUSES.RESERVED]: Object.freeze({
    occupancy: OCCUPANCY_STATUSES.VACANT,
    housekeeping: null,
  }),
  [OCCUPANCY_STATUSES.OCCUPIED]: Object.freeze({
    occupancy: OCCUPANCY_STATUSES.VACANT,
    housekeeping: HOUSEKEEPING_STATUSES.DIRTY,
  }),
});

/**
 * The discrepancy report.
 *
 * A room standing empty and not yet fit to sell is money the hotel is losing
 * without knowing it. This is only answerable because the two statuses are
 * separate - with one field the situation cannot even be written down.
 */
export const isDiscrepant = ({ occupancy, housekeeping, isActive = true }) =>
  isActive &&
  occupancy === OCCUPANCY_STATUSES.VACANT &&
  !SELLABLE_HOUSEKEEPING.includes(housekeeping);

/* -------------------------------------------------------------------------- */
/* Listing options                                                            */
/* -------------------------------------------------------------------------- */

export const ROOM_SORT_OPTIONS = Object.freeze([
  "roomNumber",
  "-roomNumber",
  "floor",
  "-floor",
  "price",
  "-price",
  "createdAt",
  "-createdAt",
]);

export const ROOM_TYPE_SORT_OPTIONS = Object.freeze([
  "name",
  "-name",
  "basePrice",
  "-basePrice",
  "maxOccupancy",
  "-maxOccupancy",
  "createdAt",
  "-createdAt",
]);

export const DEFAULT_ROOM_SORT = "roomNumber";
export const DEFAULT_ROOM_TYPE_SORT = "basePrice";

/** Paging limits are the same everywhere; re-exported so this module's
 * imports stay in one place. */
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../shared/constants/pagination.constants.js";

/* -------------------------------------------------------------------------- */
/* Field limits, shared by the schemas and the validators                     */
/* -------------------------------------------------------------------------- */

export const LIMITS = Object.freeze({
  ROOM_NUMBER_MAX: 10,
  NAME_MIN: 2,
  NAME_MAX: 60,
  DESCRIPTION_MAX: 2000,
  FACILITY_MAX_LENGTH: 60,
  MAX_FACILITIES: 40,
  MAX_IMAGES: 12,
  IMAGE_ALT_MAX: 160,
  NOTE_MAX: 300,
  MIN_FLOOR: -5,
  MAX_FLOOR: 200,
  MAX_OCCUPANCY: 20,
  MAX_PRICE: 10_000_000,
});
