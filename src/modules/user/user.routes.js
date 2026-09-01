import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { validateRequest } from "../../shared/middleware/validate.middleware.js";
import { requirePermission } from "../auth/rbac/rbac.middleware.js";
import { PERMISSIONS } from "../auth/rbac/index.js";
import * as userController from "./user.controller.js";
import {
  changePermissionsValidation,
  changeRoleValidation,
  changeStatusValidation,
  createUserValidation,
  deleteUserValidation,
  listUsersValidation,
  updateUserValidation,
  userIdValidation,
} from "./user.validation.js";

/**
 * Identity administration. Every route is gated by an explicit permission
 * rather than a hard-coded role list, so the role matrix stays the single
 * place where access decisions are configured.
 */
const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission(PERMISSIONS.USER_READ),
  listUsersValidation,
  validateRequest,
  userController.listUsers
);

router.post(
  "/",
  requirePermission(PERMISSIONS.USER_CREATE),
  createUserValidation,
  validateRequest,
  userController.createUser
);

router.get(
  "/:id",
  requirePermission(PERMISSIONS.USER_READ),
  userIdValidation,
  validateRequest,
  userController.getUser
);

router.patch(
  "/:id",
  requirePermission(PERMISSIONS.USER_UPDATE),
  updateUserValidation,
  validateRequest,
  userController.updateUser
);

router.patch(
  "/:id/role",
  requirePermission(PERMISSIONS.USER_MANAGE_ROLE),
  changeRoleValidation,
  validateRequest,
  userController.changeUserRole
);

router.patch(
  "/:id/status",
  requirePermission(PERMISSIONS.USER_MANAGE_STATUS),
  changeStatusValidation,
  validateRequest,
  userController.changeUserStatus
);

router.patch(
  "/:id/permissions",
  requirePermission(PERMISSIONS.USER_MANAGE_ROLE),
  changePermissionsValidation,
  validateRequest,
  userController.changeUserPermissions
);

router.delete(
  "/:id",
  requirePermission(PERMISSIONS.USER_DELETE, PERMISSIONS.USER_MANAGE_STATUS),
  userIdValidation,
  validateRequest,
  userController.deactivateUser
);

/**
 * Permanent removal. `user:delete` is held only by the super admin in the role
 * matrix, and the service asserts the role again rather than trusting the
 * matrix alone.
 */
router.delete(
  "/:id/permanent",
  requirePermission(PERMISSIONS.USER_DELETE),
  deleteUserValidation,
  validateRequest,
  userController.deleteUser
);

router.delete(
  "/:id/sessions",
  requirePermission(PERMISSIONS.SESSION_REVOKE_ANY),
  userIdValidation,
  validateRequest,
  userController.revokeUserSessions
);

export default router;
