import { PERMISSIONS, PERMISSION_VALUES } from "./permissions.js";
import { USER_ROLES } from "../../user/user.constants.js";

/**
 * Role hierarchy level. Higher wins.
 * Used to stop a user from editing or elevating someone at or above their level.
 */
export const ROLE_LEVELS = Object.freeze({
  [USER_ROLES.CUSTOMER]: 10,
  [USER_ROLES.STAFF]: 20,
  [USER_ROLES.ADMIN]: 30,
  [USER_ROLES.SUPER_ADMIN]: 40,
});

const CUSTOMER_PERMISSIONS = [
  // Guests browse the catalogue (room types), never the physical inventory:
  // live room statuses would reveal which rooms are occupied and which are
  // empty, and the occupancy statistics are commercially sensitive.
  PERMISSIONS.ROOM_TYPE_READ,
  PERMISSIONS.RESERVATION_CREATE,
  PERMISSIONS.RESERVATION_READ_OWN,
  PERMISSIONS.RESERVATION_CANCEL,
  PERMISSIONS.PAYMENT_READ_OWN,
  PERMISSIONS.FRONTDESK_TICKET_CREATE,
  PERMISSIONS.CRM_FEEDBACK_CREATE,
];

const STAFF_PERMISSIONS = [
  PERMISSIONS.ROOM_READ,
  PERMISSIONS.ROOM_TYPE_READ,
  // Staff move rooms through the housekeeping cycle but cannot edit a room's
  // type, price or number - that stays with the admin.
  PERMISSIONS.ROOM_MANAGE_STATUS,
  PERMISSIONS.RESERVATION_CREATE,
  PERMISSIONS.RESERVATION_READ,
  PERMISSIONS.RESERVATION_UPDATE,
  PERMISSIONS.RESERVATION_CANCEL,
  PERMISSIONS.PAYMENT_CREATE,
  PERMISSIONS.PAYMENT_READ,
  PERMISSIONS.FRONTDESK_CHECKIN,
  PERMISSIONS.FRONTDESK_CHECKOUT,
  PERMISSIONS.FRONTDESK_TICKET_CREATE,
  PERMISSIONS.FRONTDESK_TICKET_MANAGE,
  PERMISSIONS.FRONTDESK_BAGGAGE_MANAGE,
  PERMISSIONS.CRM_FEEDBACK_READ,
  PERMISSIONS.SUPPLIER_READ,
];

const ADMIN_PERMISSIONS = [
  ...STAFF_PERMISSIONS,
  PERMISSIONS.USER_CREATE,
  PERMISSIONS.USER_READ,
  PERMISSIONS.USER_UPDATE,
  PERMISSIONS.USER_MANAGE_STATUS,
  PERMISSIONS.SESSION_READ_ANY,
  PERMISSIONS.SESSION_REVOKE_ANY,
  PERMISSIONS.ROOM_CREATE,
  PERMISSIONS.ROOM_UPDATE,
  PERMISSIONS.ROOM_DELETE,
  PERMISSIONS.ROOM_TYPE_CREATE,
  PERMISSIONS.ROOM_TYPE_UPDATE,
  PERMISSIONS.ROOM_TYPE_DELETE,
  PERMISSIONS.PAYMENT_REFUND,
  // Checking a guest in before their advance has been paid is a manager's call.
  PERMISSIONS.FRONTDESK_OVERRIDE_PAYMENT,
  PERMISSIONS.CRM_FEEDBACK_MANAGE,
  PERMISSIONS.SUPPLIER_MANAGE,
  PERMISSIONS.REPORT_VIEW,
  PERMISSIONS.REPORT_EXPORT,
  PERMISSIONS.ANALYTICS_VIEW,
  // Administrators can read the audit log. It shows who did what from which
  // address across the whole system, so it stops at admin - staff never see it.
  PERMISSIONS.AUDIT_LOG_VIEW,
];

/**
 * Role -> permission matrix. Super admin implicitly holds every permission,
 * so new permissions never need to be granted to it by hand.
 */
export const ROLE_PERMISSIONS = Object.freeze({
  [USER_ROLES.CUSTOMER]: Object.freeze([...new Set(CUSTOMER_PERMISSIONS)]),
  [USER_ROLES.STAFF]: Object.freeze([...new Set(STAFF_PERMISSIONS)]),
  [USER_ROLES.ADMIN]: Object.freeze([...new Set(ADMIN_PERMISSIONS)]),
  [USER_ROLES.SUPER_ADMIN]: Object.freeze([...PERMISSION_VALUES]),
});

export const getRolePermissions = (role) => ROLE_PERMISSIONS[role] || [];

export const getRoleLevel = (role) => ROLE_LEVELS[role] || 0;

/**
 * Effective permissions = role defaults + per-user extra grants - per-user denials.
 * Extra grants let an admin give one staff member a single elevated capability
 * without inventing a whole new role.
 */
export const resolvePermissions = ({ role, extraPermissions = [], deniedPermissions = [] }) => {
  const granted = new Set([...getRolePermissions(role), ...extraPermissions]);
  deniedPermissions.forEach((permission) => granted.delete(permission));
  return [...granted];
};

export const roleCanActOn = (actorRole, targetRole) => getRoleLevel(actorRole) > getRoleLevel(targetRole);

export default ROLE_PERMISSIONS;
