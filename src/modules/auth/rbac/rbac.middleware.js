import ApiError from "../../../shared/utils/ApiError.js";
import { USER_ROLES } from "../../user/user.constants.js";
import { roleCanActOn } from "./roles.js";

const requireAuthenticatedUser = (req) => {
  if (!req.user) {
    throw new ApiError(401, "Authentication is required");
  }
  return req.user;
};

const guard = (check) => (req, res, next) => {
  try {
    const user = requireAuthenticatedUser(req);
    check(user, req);
    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Role gate. Prefer `requirePermission` for business rules and keep this for
 * coarse boundaries such as "admin area only".
 */
export const authorizeRoles = (...allowedRoles) =>
  guard((user) => {
    if (!allowedRoles.includes(user.role)) {
      throw new ApiError(403, "Your role does not have access to this resource");
    }
  });

/** Passes when the user holds at least one of the listed permissions. */
export const requirePermission = (...permissions) =>
  guard((user) => {
    const granted = permissions.some((permission) => user.hasPermission(permission));
    if (!granted) {
      throw new ApiError(403, "You do not have permission to perform this action");
    }
  });

/** Passes only when the user holds every listed permission. */
export const requireAllPermissions = (...permissions) =>
  guard((user) => {
    const missing = permissions.filter((permission) => !user.hasPermission(permission));
    if (missing.length > 0) {
      throw new ApiError(403, "You do not have permission to perform this action");
    }
  });

/**
 * Allows a user to act on their own record, or on someone else's only when they
 * hold the given permission. Covers the common "read own profile vs read any
 * profile" pattern without duplicating handlers.
 */
export const requireSelfOrPermission = (permission, paramName = "id") =>
  guard((user, req) => {
    if (req.params[paramName] === user._id.toString()) return;
    if (!user.hasPermission(permission)) {
      throw new ApiError(403, "You do not have permission to perform this action");
    }
  });

/**
 * Blocks privilege escalation: an actor may never create, modify or delete an
 * account whose role sits at or above their own level. Super admin is exempt
 * only towards lower roles, never towards another super admin.
 */
export const requireHigherRoleThanTarget = (getTargetRole) =>
  guard((user, req) => {
    const targetRole = getTargetRole(req);
    if (!targetRole) return;

    if (!roleCanActOn(user.role, targetRole)) {
      throw new ApiError(403, "You cannot manage an account at or above your own role level");
    }
  });

export const isSuperAdmin = (user) => user?.role === USER_ROLES.SUPER_ADMIN;
