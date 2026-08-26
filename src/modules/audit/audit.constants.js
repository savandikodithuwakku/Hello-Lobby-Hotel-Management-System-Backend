/**
 * The audit log: what the system records about who changed what.
 *
 * This is not the same thing as a reservation's history. That history is part
 * of the booking - it is shown to the guest and it only knows about statuses.
 * The audit log sits underneath the whole system and answers a different
 * question: which account made this change, when, from where, and what did the
 * record look like before and after. It is the thing you read when something
 * has gone wrong and nobody remembers doing it.
 */
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../shared/constants/pagination.constants.js";

/* -------------------------------------------------------------------------- */
/* What can be acted upon                                                     */
/* -------------------------------------------------------------------------- */

export const AUDIT_ENTITIES = Object.freeze({
  USER: "user",
  SESSION: "session",
  ROOM: "room",
  ROOM_TYPE: "room_type",
  RESERVATION: "reservation",
  INVOICE: "invoice",
  TRANSACTION: "transaction",
});

export const AUDIT_ENTITY_VALUES = Object.freeze(Object.values(AUDIT_ENTITIES));

/* -------------------------------------------------------------------------- */
/* What can be done                                                           */
/*                                                                            */
/* Named `<entity>.<action>`, the same convention as the permission registry.  */
/* Every action a service records must be listed here first, so the log has a  */
/* fixed vocabulary that a filter drop-down and a report can rely on rather    */
/* than a free-text field that quietly grows new spellings.                    */
/* -------------------------------------------------------------------------- */

export const AUDIT_ACTIONS = Object.freeze({
  // Signing in and out. Failures are recorded too - a run of them is the
  // clearest sign of an account being attacked.
  AUTH_REGISTER: "auth.register",
  AUTH_LOGIN: "auth.login",
  AUTH_LOGIN_FAILED: "auth.login_failed",
  AUTH_LOGOUT: "auth.logout",
  AUTH_PASSWORD_CHANGED: "auth.password_changed",
  AUTH_PASSWORD_RESET: "auth.password_reset",
  AUTH_EMAIL_VERIFIED: "auth.email_verified",
  AUTH_SESSION_REVOKED: "auth.session_revoked",

  // Accounts and privileges. The most sensitive entries in the log.
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  USER_ROLE_CHANGED: "user.role_changed",
  USER_STATUS_CHANGED: "user.status_changed",
  USER_PERMISSIONS_CHANGED: "user.permissions_changed",
  USER_DELETED: "user.deleted",

  // Inventory.
  ROOM_CREATED: "room.created",
  ROOM_UPDATED: "room.updated",
  ROOM_STATUS_CHANGED: "room.status_changed",
  ROOM_DEACTIVATED: "room.deactivated",
  ROOM_RESTORED: "room.restored",
  ROOM_TYPE_CREATED: "room_type.created",
  ROOM_TYPE_UPDATED: "room_type.updated",
  ROOM_TYPE_DEACTIVATED: "room_type.deactivated",
  ROOM_TYPE_RESTORED: "room_type.restored",

  // Bookings. `reservation.updated` is the one that was missing before this
  // module existed: a booking's dates could be moved with nothing recorded.
  RESERVATION_CREATED: "reservation.created",
  RESERVATION_UPDATED: "reservation.updated",
  RESERVATION_STATUS_CHANGED: "reservation.status_changed",

  // Money.
  PAYMENT_RECORDED: "payment.recorded",
  PAYMENT_CHECKOUT_STARTED: "payment.checkout_started",
  PAYMENT_SETTLED: "payment.settled",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_REFUNDED: "payment.refunded",
});

export const AUDIT_ACTION_VALUES = Object.freeze(Object.values(AUDIT_ACTIONS));

/**
 * Actions worth pulling out on their own.
 *
 * A security review does not want to read a month of room-status changes; it
 * wants the sign-ins, the privilege changes and the deletions. Marking them
 * here means the filter is defined once instead of being retyped in the UI.
 */
export const SECURITY_ACTIONS = Object.freeze([
  AUDIT_ACTIONS.AUTH_LOGIN,
  AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
  AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED,
  AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
  AUDIT_ACTIONS.AUTH_SESSION_REVOKED,
  AUDIT_ACTIONS.USER_ROLE_CHANGED,
  AUDIT_ACTIONS.USER_STATUS_CHANGED,
  AUDIT_ACTIONS.USER_PERMISSIONS_CHANGED,
  AUDIT_ACTIONS.USER_DELETED,
]);

/** Whether the attempt worked. A refused action is worth recording too. */
export const AUDIT_OUTCOMES = Object.freeze({
  SUCCESS: "success",
  FAILURE: "failure",
});

export const AUDIT_OUTCOME_VALUES = Object.freeze(Object.values(AUDIT_OUTCOMES));

/* -------------------------------------------------------------------------- */
/* Policy                                                                     */
/* -------------------------------------------------------------------------- */

export const POLICY = Object.freeze({
  /** Longest a single recorded value is kept, so one huge field cannot bloat
   * the log. Anything longer is cut off with an ellipsis. */
  VALUE_MAX: 500,
  /** Most changed fields recorded for one entry. */
  MAX_CHANGES: 40,
  DESCRIPTION_MAX: 300,
  LABEL_MAX: 120,
});

/**
 * Fields whose values must never be written to the log.
 *
 * The audit log is read by more people than the records it describes, and it is
 * kept for far longer, so a secret copied into it is a secret leaked twice
 * over. Only the fact that these changed is recorded - never what they changed
 * from or to.
 */
export const REDACTED_FIELDS = Object.freeze([
  "password",
  "currentPassword",
  "newPassword",
  "passwordHash",
  "passwordResetToken",
  "emailVerificationToken",
  "refreshToken",
  "accessToken",
  "token",
  "signature",
  "simulatorSecret",
]);

export const REDACTED_PLACEHOLDER = "[redacted]";

export const isRedactedField = (field) =>
  REDACTED_FIELDS.some((name) => String(field).toLowerCase().includes(name.toLowerCase()));

/* -------------------------------------------------------------------------- */
/* Listing options                                                            */
/* -------------------------------------------------------------------------- */

export const AUDIT_SORT_OPTIONS = Object.freeze(["createdAt", "-createdAt"]);

/** Newest first: an audit log is almost always read from the top. */
export const DEFAULT_AUDIT_SORT = "-createdAt";

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };

export const AUDIT_MESSAGES = Object.freeze({
  FETCHED: "Audit log fetched successfully",
  ENTRY_FETCHED: "Audit entry fetched successfully",
});
