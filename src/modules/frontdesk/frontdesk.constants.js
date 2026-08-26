/**
 * The front desk.
 *
 * This module does not own any records of its own. It is the place where the
 * modules that do own them are put together into the two moments that matter
 * most in a hotel: a guest arriving and a guest leaving.
 *
 *   Arrival                            Departure
 *   -------                            ---------
 *   the booking is confirmed           the guest is checked in
 *   today is the arrival day           everything used is on the bill
 *   the room is fit for a guest        nothing is left outstanding
 *   the advance has been paid          -> checked out, room left dirty
 *   -> occupied
 *
 * Each of those conditions is checked by the module that owns it - the
 * reservation state machine, the room's two statuses, the invoice - and this
 * module refuses the arrival or the departure until they all agree. Putting the
 * sequence here rather than in any one of them is what stops the reservation
 * module having to know about money and the payments module having to know
 * about housekeeping.
 */

/** Why an arrival was refused. Each maps to something a person can act on. */
export const CHECK_IN_BLOCKERS = Object.freeze({
  NOT_CONFIRMED: "not_confirmed",
  TOO_EARLY: "too_early",
  ROOM_NOT_READY: "room_not_ready",
  ROOM_UNAVAILABLE: "room_unavailable",
  ADVANCE_UNPAID: "advance_unpaid",
});

/** Why a departure was refused. */
export const CHECK_OUT_BLOCKERS = Object.freeze({
  NOT_CHECKED_IN: "not_checked_in",
  BALANCE_OUTSTANDING: "balance_outstanding",
});

/**
 * The only blocker a manager may wave through.
 *
 * A guest standing at the desk who has not paid their advance is a judgement
 * call - they may be a regular, or the transfer may be in flight - so somebody
 * senior can let them in. The others are not judgement calls: a room that has
 * not been cleaned is not made ready by deciding it is, and an arrival two days
 * early does not become today.
 */
export const OVERRIDABLE_BLOCKERS = Object.freeze([CHECK_IN_BLOCKERS.ADVANCE_UNPAID]);

export const isOverridable = (blocker) => OVERRIDABLE_BLOCKERS.includes(blocker);

/** A manager waving a guest through has to say why, and say something real. */
export const OVERRIDE_REASON_MIN = 10;
export const OVERRIDE_REASON_MAX = 300;

/** How far ahead the arrivals and departures boards look. */
export const BOARD_DAYS_AHEAD = 1;

export const FRONTDESK_MESSAGES = Object.freeze({
  BOARD_FETCHED: "Front desk board fetched",
  CHECKED_IN: "Guest checked in",
  CHECKED_OUT: "Guest checked out",
  READY: "This booking is ready to check in",
  HOUSEKEEPING_FETCHED: "Housekeeping board fetched",
});
