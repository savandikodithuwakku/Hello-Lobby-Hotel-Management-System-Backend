/**
 * Single source of truth for every permission in the system.
 *
 * Naming convention: `<resource>:<action>`.
 * Add new resources here first, then grant them to roles in `roles.js`.
 * Nothing else in the codebase should invent permission strings inline.
 */
export const PERMISSIONS = Object.freeze({
  // Identity & access management
  USER_CREATE: "user:create",
  USER_READ: "user:read",
  USER_UPDATE: "user:update",
  USER_DELETE: "user:delete",
  USER_MANAGE_ROLE: "user:manage_role",
  USER_MANAGE_STATUS: "user:manage_status",
  SESSION_READ_ANY: "session:read_any",
  SESSION_REVOKE_ANY: "session:revoke_any",

  // Room types (the catalogue: standard, deluxe, suite, ...)
  ROOM_TYPE_CREATE: "room_type:create",
  ROOM_TYPE_READ: "room_type:read",
  ROOM_TYPE_UPDATE: "room_type:update",
  ROOM_TYPE_DELETE: "room_type:delete",

  // Rooms & inventory
  ROOM_CREATE: "room:create",
  ROOM_READ: "room:read",
  ROOM_UPDATE: "room:update",
  ROOM_DELETE: "room:delete",
  /**
   * Housekeeping and maintenance transitions (cleaning, maintenance, back to
   * available). Separate from `room:update` so front-desk staff can move a room
   * through its daily cycle without being able to edit its price or type.
   */
  ROOM_MANAGE_STATUS: "room:manage_status",

  // Reservations
  RESERVATION_CREATE: "reservation:create",
  RESERVATION_READ: "reservation:read",
  RESERVATION_READ_OWN: "reservation:read_own",
  RESERVATION_UPDATE: "reservation:update",
  RESERVATION_CANCEL: "reservation:cancel",

  // Payments
  PAYMENT_CREATE: "payment:create",
  PAYMENT_READ: "payment:read",
  PAYMENT_READ_OWN: "payment:read_own",
  PAYMENT_REFUND: "payment:refund",

  // Front desk operations
  FRONTDESK_CHECKIN: "frontdesk:checkin",
  FRONTDESK_CHECKOUT: "frontdesk:checkout",
  /**
   * Lets a manager check a guest in whose advance has not been paid. Held above
   * front-desk level on purpose: it is the one condition the desk may wave
   * through, and every use of it is written to the audit log with a reason.
   */
  FRONTDESK_OVERRIDE_PAYMENT: "frontdesk:override_payment",
  FRONTDESK_TICKET_MANAGE: "frontdesk:ticket_manage",
  FRONTDESK_TICKET_CREATE: "frontdesk:ticket_create",
  /** Taking baggage in at the desk and handing it back. */
  FRONTDESK_BAGGAGE_MANAGE: "frontdesk:baggage_manage",

  // Customer relationship management
  CRM_FEEDBACK_CREATE: "crm:feedback_create",
  CRM_FEEDBACK_READ: "crm:feedback_read",
  CRM_FEEDBACK_MANAGE: "crm:feedback_manage",

  // Suppliers
  SUPPLIER_MANAGE: "supplier:manage",
  SUPPLIER_READ: "supplier:read",

  // Reporting & analytics
  REPORT_VIEW: "report:view",
  REPORT_EXPORT: "report:export",
  ANALYTICS_VIEW: "analytics:view",

  // System administration
  SETTINGS_MANAGE: "settings:manage",
  AUDIT_LOG_VIEW: "audit_log:view",
});

export const PERMISSION_VALUES = Object.freeze(Object.values(PERMISSIONS));

export const isValidPermission = (permission) => PERMISSION_VALUES.includes(permission);

export default PERMISSIONS;
