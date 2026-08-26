import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requirePermission } from "../auth/rbac/rbac.middleware.js";
import { PERMISSIONS } from "../auth/rbac/permissions.js";
import { validateRequest } from "../../shared/middleware/validate.middleware.js";
import * as roomController from "./room.controller.js";
import {
  availableRoomsValidation,
  changeRoomStatusValidation,
  createRoomValidation,
  deactivateRoomValidation,
  listRoomsValidation,
  roomIdValidation,
  updateRoomValidation,
} from "./room.validation.js";

/**
 * Room inventory.
 *
 * Editing a room (number, type, price) and moving it through the housekeeping
 * cycle are separate permissions, so front-desk staff can mark a room clean
 * without being able to reprice it.
 */
const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission(PERMISSIONS.ROOM_READ),
  listRoomsValidation,
  validateRequest,
  roomController.listRooms
);

// Declared before "/:id" so "available" and "statistics" are not read as ids.
router.get(
  "/available",
  requirePermission(PERMISSIONS.ROOM_READ),
  availableRoomsValidation,
  validateRequest,
  roomController.listAvailableRooms
);

router.get(
  "/statistics",
  requirePermission(PERMISSIONS.ROOM_READ),
  roomController.getRoomStatistics
);

router.post(
  "/",
  requirePermission(PERMISSIONS.ROOM_CREATE),
  createRoomValidation,
  validateRequest,
  roomController.createRoom
);

router.get(
  "/:id",
  requirePermission(PERMISSIONS.ROOM_READ),
  roomIdValidation,
  validateRequest,
  roomController.getRoom
);

router.patch(
  "/:id",
  requirePermission(PERMISSIONS.ROOM_UPDATE),
  updateRoomValidation,
  validateRequest,
  roomController.updateRoom
);

/** Housekeeping and maintenance transitions, available to staff. */
router.patch(
  "/:id/status",
  requirePermission(PERMISSIONS.ROOM_MANAGE_STATUS),
  changeRoomStatusValidation,
  validateRequest,
  roomController.changeRoomStatus
);

/** Soft delete: `isActive` goes false, the document and its history remain. */
router.delete(
  "/:id",
  requirePermission(PERMISSIONS.ROOM_DELETE),
  deactivateRoomValidation,
  validateRequest,
  roomController.deactivateRoom
);

router.post(
  "/:id/restore",
  requirePermission(PERMISSIONS.ROOM_DELETE),
  roomIdValidation,
  validateRequest,
  roomController.restoreRoom
);

export default router;
