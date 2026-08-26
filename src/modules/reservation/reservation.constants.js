/**
 * Reservation lifecycle and booking policy.
 *
 * Everything that decides whether a booking is valid, what it costs and what it
 * may do next lives here, so the service, the validators and the reports all
 * read the same rules.
 */
export const RESERVATION_STATUSES = Object.freeze({
  PENDING: "pending",
  CONFIRMED: "confirmed",
  CHECKED_IN: "checked_in",
  CHECKED_OUT: "checked_out",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
});

export const RESERVATION_STATUS_VALUES = Object.freeze(Object.values(RESERVATION_STATUSES));

/**
 * Statuses that hold a room for their dates. Only these take part in the
 * overlap check - a cancelled or finished booking never blocks a new one.
 */
export const BLOCKING_STATUSES = Object.freeze([
  RESERVATION_STATUSES.PENDING,
  RESERVATION_STATUSES.CONFIRMED,
  RESERVATION_STATUSES.CHECKED_IN,
]);

/** Nothing further can happen to a reservation in one of these. */
export const TERMINAL_STATUSES = Object.freeze([
  RESERVATION_STATUSES.COMPLETED,
  RESERVATION_STATUSES.CANCELLED,
  RESERVATION_STATUSES.NO_SHOW,
]);

/** Statuses a guest may still call off themselves. */
export const CANCELLABLE_STATUSES = Object.freeze([
  RESERVATION_STATUSES.PENDING,
  RESERVATION_STATUSES.CONFIRMED,
]);

/** Dates, guests and services can only be edited before arrival. */
export const EDITABLE_STATUSES = Object.freeze([
  RESERVATION_STATUSES.PENDING,
  RESERVATION_STATUSES.CONFIRMED,
]);

/**
 * The state machine. Every move is explicit; anything not listed is refused
 * with a message naming what is actually possible.
 */
export const ALLOWED_TRANSITIONS = Object.freeze({
  [RESERVATION_STATUSES.PENDING]: Object.freeze([
    RESERVATION_STATUSES.CONFIRMED,
    RESERVATION_STATUSES.CANCELLED,
    RESERVATION_STATUSES.NO_SHOW,
  ]),
  [RESERVATION_STATUSES.CONFIRMED]: Object.freeze([
    RESERVATION_STATUSES.CHECKED_IN,
    RESERVATION_STATUSES.CANCELLED,
    RESERVATION_STATUSES.NO_SHOW,
  ]),
  [RESERVATION_STATUSES.CHECKED_IN]: Object.freeze([RESERVATION_STATUSES.CHECKED_OUT]),
  // Checked out but not yet settled; completing it closes the booking.
  [RESERVATION_STATUSES.CHECKED_OUT]: Object.freeze([RESERVATION_STATUSES.COMPLETED]),
  [RESERVATION_STATUSES.COMPLETED]: Object.freeze([]),
  [RESERVATION_STATUSES.CANCELLED]: Object.freeze([]),
  [RESERVATION_STATUSES.NO_SHOW]: Object.freeze([]),
});

export const getAllowedTransitions = (status) => ALLOWED_TRANSITIONS[status] || [];

export const canTransition = (from, to) => getAllowedTransitions(from).includes(to);

/* -------------------------------------------------------------------------- */
/* Booking policy                                                             */
/* -------------------------------------------------------------------------- */

export const POLICY = Object.freeze({
  /** Share of the total taken up front to hold the room. */
  ADVANCE_PERCENTAGE: 20,
  /** How long the guest has to pay the advance before the hold lapses. */
  ADVANCE_DEADLINE_HOURS: 48,
  /** Longest stay a single reservation may cover. */
  MAX_NIGHTS: 90,
  /** How far ahead a booking may be made. */
  MAX_ADVANCE_DAYS: 730,
  MAX_SERVICES: 20,
  MAX_GUESTS: 20,
  NOTE_MAX: 500,
  SERVICE_NAME_MAX: 80,
  MAX_AMOUNT: 100_000_000,
});

/** Rooms in these statuses cannot take a booking at all, on any date. */
export const NON_BOOKABLE_ROOM_STATUSES = Object.freeze(["maintenance", "out_of_service"]);

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A stay is counted in nights, not moments: a booking is stored as two UTC
 * midnights so that a check-in at 14:00 and one at 22:00 on the same day are
 * the same night, whatever timezone the browser sent.
 */
export const toDateOnly = (value) => {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

export const today = () => toDateOnly(new Date());

export const nightsBetween = (checkIn, checkOut) =>
  Math.round((toDateOnly(checkOut) - toDateOnly(checkIn)) / 86_400_000);

export const addDays = (date, days) => {
  const next = toDateOnly(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

/* -------------------------------------------------------------------------- */
/* Listing options                                                            */
/* -------------------------------------------------------------------------- */

export const RESERVATION_SORT_OPTIONS = Object.freeze([
  "checkIn",
  "-checkIn",
  "checkOut",
  "-checkOut",
  "createdAt",
  "-createdAt",
  "totalAmount",
  "-totalAmount",
]);

export const DEFAULT_RESERVATION_SORT = "-createdAt";
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const RESERVATION_MESSAGES = Object.freeze({
  CREATED: "Reservation created successfully",
  UPDATED: "Reservation updated successfully",
  CONFIRMED: "Reservation confirmed",
  CANCELLED: "Reservation cancelled",
  CHECKED_IN: "Guest checked in",
  CHECKED_OUT: "Guest checked out",
  COMPLETED: "Reservation completed",
  NO_SHOW: "Reservation marked as a no-show",
  PAYMENT_RECORDED: "Payment recorded",
});
