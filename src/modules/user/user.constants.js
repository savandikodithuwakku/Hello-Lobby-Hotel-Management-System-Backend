export const USER_ROLES = Object.freeze({
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  STAFF: "staff",
  CUSTOMER: "customer",
});

export const USER_STATUSES = Object.freeze({
  ACTIVE: "active",
  INACTIVE: "inactive",
  SUSPENDED: "suspended",
  PENDING_VERIFICATION: "pending_verification",
});

/** Statuses that are not allowed to hold an authenticated session. */
export const LOGIN_BLOCKING_STATUSES = Object.freeze([
  USER_STATUSES.INACTIVE,
  USER_STATUSES.SUSPENDED,
]);

export const USER_ROLE_VALUES = Object.freeze(Object.values(USER_ROLES));
export const USER_STATUS_VALUES = Object.freeze(Object.values(USER_STATUSES));

/** Fields an administrator may fill in on an address. */
export const ADDRESS_FIELDS = Object.freeze([
  "line1",
  "line2",
  "city",
  "state",
  "postalCode",
  "country",
]);

/**
 * Sort options the user list accepts. Kept here rather than inline in the
 * validator so the service and the validator can never drift apart, and so an
 * arbitrary field name can never reach `Query.sort()`.
 */
export const USER_SORT_OPTIONS = Object.freeze([
  "createdAt",
  "-createdAt",
  "lastLoginAt",
  "-lastLoginAt",
  "name",
  "-name",
  "email",
  "-email",
]);

export const DEFAULT_USER_SORT = "-createdAt";
/** Paging limits are the same everywhere; re-exported so this module's
 * imports stay in one place. */
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../shared/constants/pagination.constants.js";
