/**
 * Guest service tickets.
 *
 * "The air conditioner isn't working." Somebody has to know about it, somebody
 * has to be given it, and somebody has to be able to see it was dealt with.
 * That is all a ticket is.
 *
 * The rules that make it a hotel system rather than a to-do list live here: how
 * quickly each priority has to be picked up, and the fact that a fault with a
 * room and an unsellable room are the same fact - a ticket can take the room
 * out of order and give it back when it is fixed.
 */
import { POLICY as RESERVATION_POLICY } from "../reservation/reservation.constants.js";

/* -------------------------------------------------------------------------- */
/* What the ticket is about                                                   */
/* -------------------------------------------------------------------------- */

export const TICKET_CATEGORIES = Object.freeze({
  MAINTENANCE: "maintenance",
  HOUSEKEEPING: "housekeeping",
  AMENITIES: "amenities",
  NOISE: "noise",
  INTERNET: "internet",
  FOOD_AND_DRINK: "food_and_drink",
  BILLING: "billing",
  SECURITY: "security",
  OTHER: "other",
});

export const TICKET_CATEGORY_VALUES = Object.freeze(Object.values(TICKET_CATEGORIES));

/**
 * Categories that can render a room unsellable.
 *
 * A broken air conditioner is a maintenance problem and an inventory problem at
 * the same time. Only these categories may take a room out of order - a guest
 * complaining about the wifi should never be able to empty a floor.
 */
export const ROOM_BLOCKING_CATEGORIES = Object.freeze([
  TICKET_CATEGORIES.MAINTENANCE,
  TICKET_CATEGORIES.HOUSEKEEPING,
  TICKET_CATEGORIES.SECURITY,
]);

export const canBlockRoom = (category) => ROOM_BLOCKING_CATEGORIES.includes(category);

/* -------------------------------------------------------------------------- */
/* How urgent it is                                                           */
/* -------------------------------------------------------------------------- */

export const TICKET_PRIORITIES = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  URGENT: "urgent",
});

export const TICKET_PRIORITY_VALUES = Object.freeze(Object.values(TICKET_PRIORITIES));

/**
 * How long the hotel has to pick a ticket up, in minutes.
 *
 * This is a response target, not a fix target: how long a guest waits before
 * somebody tells them it is being dealt with. A blocked drain may take a day to
 * fix, but nobody should be left wondering for a day whether anyone heard them.
 */
export const RESPONSE_TARGET_MINUTES = Object.freeze({
  [TICKET_PRIORITIES.URGENT]: 15,
  [TICKET_PRIORITIES.HIGH]: 60,
  [TICKET_PRIORITIES.MEDIUM]: 240,
  [TICKET_PRIORITIES.LOW]: 1440,
});

export const responseTargetFor = (priority) =>
  RESPONSE_TARGET_MINUTES[priority] ?? RESPONSE_TARGET_MINUTES[TICKET_PRIORITIES.MEDIUM];

/** Sorting weight, so an urgent ticket is never below a low one on a board. */
export const PRIORITY_RANK = Object.freeze({
  [TICKET_PRIORITIES.URGENT]: 0,
  [TICKET_PRIORITIES.HIGH]: 1,
  [TICKET_PRIORITIES.MEDIUM]: 2,
  [TICKET_PRIORITIES.LOW]: 3,
});

/* -------------------------------------------------------------------------- */
/* Where it has got to                                                        */
/* -------------------------------------------------------------------------- */

export const TICKET_STATUSES = Object.freeze({
  /** Raised, nobody has picked it up yet. This is what the target measures. */
  OPEN: "open",
  /** Somebody has seen it and told the guest it is in hand. */
  ACKNOWLEDGED: "acknowledged",
  IN_PROGRESS: "in_progress",
  /** Waiting on something outside the hotel - a part, a contractor. */
  ON_HOLD: "on_hold",
  /** Dealt with. The resolution says what was done. */
  RESOLVED: "resolved",
  /** Signed off. Nothing further happens to it. */
  CLOSED: "closed",
  /** Withdrawn - raised in error, or the guest no longer needs it. */
  CANCELLED: "cancelled",
});

export const TICKET_STATUS_VALUES = Object.freeze(Object.values(TICKET_STATUSES));

/** Tickets still needing somebody to do something. */
export const ACTIVE_TICKET_STATUSES = Object.freeze([
  TICKET_STATUSES.OPEN,
  TICKET_STATUSES.ACKNOWLEDGED,
  TICKET_STATUSES.IN_PROGRESS,
  TICKET_STATUSES.ON_HOLD,
]);

/**
 * The state machine. Every move is explicit; anything not listed is refused
 * with a message naming what is actually possible.
 */
export const ALLOWED_TICKET_TRANSITIONS = Object.freeze({
  [TICKET_STATUSES.OPEN]: Object.freeze([
    TICKET_STATUSES.ACKNOWLEDGED,
    TICKET_STATUSES.IN_PROGRESS,
    TICKET_STATUSES.CANCELLED,
  ]),
  [TICKET_STATUSES.ACKNOWLEDGED]: Object.freeze([
    TICKET_STATUSES.IN_PROGRESS,
    TICKET_STATUSES.ON_HOLD,
    TICKET_STATUSES.RESOLVED,
    TICKET_STATUSES.CANCELLED,
  ]),
  [TICKET_STATUSES.IN_PROGRESS]: Object.freeze([
    TICKET_STATUSES.ON_HOLD,
    TICKET_STATUSES.RESOLVED,
    TICKET_STATUSES.CANCELLED,
  ]),
  [TICKET_STATUSES.ON_HOLD]: Object.freeze([
    TICKET_STATUSES.IN_PROGRESS,
    TICKET_STATUSES.RESOLVED,
    TICKET_STATUSES.CANCELLED,
  ]),
  // A resolution the guest disputes goes back to work rather than being closed.
  [TICKET_STATUSES.RESOLVED]: Object.freeze([
    TICKET_STATUSES.CLOSED,
    TICKET_STATUSES.IN_PROGRESS,
  ]),
  [TICKET_STATUSES.CLOSED]: Object.freeze([]),
  [TICKET_STATUSES.CANCELLED]: Object.freeze([]),
});

export const getAllowedTicketTransitions = (status) => ALLOWED_TICKET_TRANSITIONS[status] || [];

export const canTransitionTicket = (from, to) => getAllowedTicketTransitions(from).includes(to);

/** Moving to one of these means saying what was actually done. */
export const RESOLUTION_REQUIRED_STATUSES = Object.freeze([TICKET_STATUSES.RESOLVED]);

/**
 * Whether a ticket has been left waiting past its response target.
 *
 * Only an unacknowledged ticket can be late: once somebody has picked it up,
 * the guest knows it is in hand, and how long the repair itself takes is a
 * different question the target was never measuring.
 */
export const isTicketOverdue = (ticket, reference = new Date()) =>
  ticket.status === TICKET_STATUSES.OPEN &&
  Boolean(ticket.respondBy) &&
  new Date(ticket.respondBy).getTime() < reference.getTime();

/* -------------------------------------------------------------------------- */
/* Policy                                                                     */
/* -------------------------------------------------------------------------- */

export const POLICY = Object.freeze({
  SUBJECT_MAX: 140,
  DESCRIPTION_MAX: 2000,
  RESOLUTION_MAX: 1000,
  NOTE_MAX: RESERVATION_POLICY.NOTE_MAX,
  /** How many updates one ticket may carry, so a thread cannot grow forever. */
  MAX_UPDATES: 100,
});

/* -------------------------------------------------------------------------- */
/* Listing options                                                            */
/* -------------------------------------------------------------------------- */

export const TICKET_SORT_OPTIONS = Object.freeze([
  "createdAt",
  "-createdAt",
  "respondBy",
  "-respondBy",
]);

/** Oldest first by default: the ticket waiting longest is the one to look at. */
export const DEFAULT_TICKET_SORT = "createdAt";

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../shared/constants/pagination.constants.js";

export const TICKET_MESSAGES = Object.freeze({
  CREATED: "Ticket raised",
  UPDATED: "Ticket updated",
  ASSIGNED: "Ticket assigned",
  STATUS_CHANGED: "Ticket updated",
  RESOLVED: "Ticket resolved",
  FETCHED: "Tickets fetched successfully",
});
