import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requirePermission } from "../auth/rbac/rbac.middleware.js";
import { PERMISSIONS } from "../auth/rbac/permissions.js";
import { validateRequest } from "../../shared/middleware/validate.middleware.js";
import * as roomTypeController from "./roomType.controller.js";
import {
  createRoomTypeValidation,
  listRoomTypesValidation,
  roomTypeIdValidation,
  updateRoomTypeValidation,
} from "./room.validation.js";

/**
 * The room catalogue. Reading is open to every signed-in role (a customer
 * browses types before booking); maintaining it is an administrative action.
 */
const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission(PERMISSIONS.ROOM_TYPE_READ),
  listRoomTypesValidation,
  validateRequest,
  roomTypeController.listRoomTypes
);

router.post(
  "/",
  requirePermission(PERMISSIONS.ROOM_TYPE_CREATE),
  createRoomTypeValidation,
  validateRequest,
  roomTypeController.createRoomType
);

router.get(
  "/:id",
  requirePermission(PERMISSIONS.ROOM_TYPE_READ),
  roomTypeIdValidation,
  validateRequest,
  roomTypeController.getRoomType
);

router.patch(
  "/:id",
  requirePermission(PERMISSIONS.ROOM_TYPE_UPDATE),
  updateRoomTypeValidation,
  validateRequest,
  roomTypeController.updateRoomType
);

/** Soft delete: the type is withdrawn from the catalogue but never removed. */
router.delete(
  "/:id",
  requirePermission(PERMISSIONS.ROOM_TYPE_DELETE),
  roomTypeIdValidation,
  validateRequest,
  roomTypeController.deactivateRoomType
);

router.post(
  "/:id/restore",
  requirePermission(PERMISSIONS.ROOM_TYPE_UPDATE),
  roomTypeIdValidation,
  validateRequest,
  roomTypeController.restoreRoomType
);

export default router;
