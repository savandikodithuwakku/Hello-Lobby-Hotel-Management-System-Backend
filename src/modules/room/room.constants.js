/**
 * The room state machine.
 *
 * A room's status is the single fact the front desk, housekeeping and (later)
 * the reservation module all read, so the rules for changing it live here
 * rather than being re-invented in each caller.
 */
export const ROOM_STATUSES = Object.freeze({
  AVAILABLE: "available",
  RESERVED: "reserved",
  OCCUPIED: "occupied",
  CLEANING: "cleaning",
  MAINTENANCE: "maintenance",
  OUT_OF_SERVICE: "out_of_service",
});

export const ROOM_STATUS_VALUES = Object.freeze(Object.values(ROOM_STATUSES));

/**
 * Statuses owned by the reservation lifecycle. They are never set by hand
 * through the room endpoints: a room becomes reserved because a booking was
 * made, and occupied because a guest checked in. The reservation module drives
 * them through the transition helpers in `room.service.js`.
 */
export const RESERVATION_CONTROLLED_STATUSES = Object.freeze([
  ROOM_STATUSES.RESERVED,
  ROOM_STATUSES.OCCUPIED,
]);

/** The only status in which a room can be booked or walked into. */
export const BOOKABLE_STATUSES = Object.freeze([ROOM_STATUSES.AVAILABLE]);

/**
 * Statuses that mean the room is in use right now. A room in one of these
 * cannot be deactivated, retyped or renumbered - there is a guest attached.
 */
export const IN_USE_STATUSES = Object.freeze([ROOM_STATUSES.RESERVED, ROOM_STATUSES.OCCUPIED]);

/**
 * Transitions an operator may perform directly, keyed by current status.
 *
 * Housekeeping moves a room between available, cleaning and maintenance;
 * an out-of-service room has to be brought back through one of those. Reserved
 * and occupied rooms are absent on purpose: releasing them is the reservation
 * module's job, so a room can never be freed while a booking still points at it.
 */
export const ALLOWED_MANUAL_TRANSITIONS = Object.freeze({
  [ROOM_STATUSES.AVAILABLE]: Object.freeze([
    ROOM_STATUSES.CLEANING,
    ROOM_STATUSES.MAINTENANCE,
    ROOM_STATUSES.OUT_OF_SERVICE,
  ]),
  [ROOM_STATUSES.CLEANING]: Object.freeze([
    ROOM_STATUSES.AVAILABLE,
    ROOM_STATUSES.MAINTENANCE,
    ROOM_STATUSES.OUT_OF_SERVICE,
  ]),
  [ROOM_STATUSES.MAINTENANCE]: Object.freeze([
    ROOM_STATUSES.CLEANING,
    ROOM_STATUSES.AVAILABLE,
    ROOM_STATUSES.OUT_OF_SERVICE,
  ]),
  [ROOM_STATUSES.OUT_OF_SERVICE]: Object.freeze([
    ROOM_STATUSES.MAINTENANCE,
    ROOM_STATUSES.CLEANING,
    ROOM_STATUSES.AVAILABLE,
  ]),
  [ROOM_STATUSES.RESERVED]: Object.freeze([]),
  [ROOM_STATUSES.OCCUPIED]: Object.freeze([]),
});

export const getAllowedTransitions = (status) => ALLOWED_MANUAL_TRANSITIONS[status] || [];

export const canTransitionManually = (from, to) => getAllowedTransitions(from).includes(to);

/**
 * Where a room lands when its reservation ends.
 *
 * A cancelled booking frees the room immediately; a departing guest leaves a
 * room that has to be cleaned first. This is what makes availability come back
 * on its own rather than waiting for someone to remember.
 */
export const RELEASE_STATUS = Object.freeze({
  [ROOM_STATUSES.RESERVED]: ROOM_STATUSES.AVAILABLE,
  [ROOM_STATUSES.OCCUPIED]: ROOM_STATUSES.CLEANING,
});

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

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

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
