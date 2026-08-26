import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requirePermission } from "../auth/rbac/rbac.middleware.js";
import { PERMISSIONS } from "../auth/rbac/permissions.js";
import { validateRequest } from "../../shared/middleware/validate.middleware.js";
import * as frontdeskController from "./frontdesk.controller.js";
import {
  checkInValidation,
  checkOutValidation,
  housekeepingBoardValidation,
  reservationIdValidation,
} from "./frontdesk.validation.js";

/**
 * The front desk.
 *
 * Arrivals and departures live here rather than under `/reservations` because
 * they are front-desk operations, not edits to a booking - which is what the
 * `frontdesk:checkin` and `frontdesk:checkout` permissions have said all along.
 * The reservation module still owns the state machine; this module decides
 * whether the guest is allowed through the door.
 */
const router = Router();

router.use(authenticate);

/** Today at a glance: who is arriving, who is leaving, who is in the building. */
router.get(
  "/board",
  requirePermission(PERMISSIONS.FRONTDESK_CHECKIN, PERMISSIONS.FRONTDESK_CHECKOUT),
  frontdeskController.getBoard
);

/* -------------------------------------------------------------------------- */
/* Arrivals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Read-only. Lets the desk see every reason a guest cannot be checked in before
 * they try, rather than discovering them one refusal at a time.
 */
router.get(
  "/arrivals/:id",
  requirePermission(PERMISSIONS.FRONTDESK_CHECKIN),
  reservationIdValidation,
  validateRequest,
  frontdeskController.previewCheckIn
);

router.post(
  "/arrivals/:id/check-in",
  requirePermission(PERMISSIONS.FRONTDESK_CHECKIN),
  checkInValidation,
  validateRequest,
  frontdeskController.checkIn
);

/* -------------------------------------------------------------------------- */
/* Departures                                                                 */
/* -------------------------------------------------------------------------- */

/** The final bill, including anything charged to the room during the stay. */
router.get(
  "/departures/:id",
  requirePermission(PERMISSIONS.FRONTDESK_CHECKOUT),
  reservationIdValidation,
  validateRequest,
  frontdeskController.previewCheckOut
);

router.post(
  "/departures/:id/check-out",
  requirePermission(PERMISSIONS.FRONTDESK_CHECKOUT),
  checkOutValidation,
  validateRequest,
  frontdeskController.checkOut
);

/* -------------------------------------------------------------------------- */
/* Housekeeping                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Every room grouped by what needs doing to it. Read by the same permission
 * that lets somebody actually change a room's housekeeping state, which lives
 * on the room itself - `PATCH /rooms/:id/housekeeping`.
 */
router.get(
  "/housekeeping",
  requirePermission(PERMISSIONS.ROOM_MANAGE_STATUS, PERMISSIONS.ROOM_READ),
  housekeepingBoardValidation,
  validateRequest,
  frontdeskController.getHousekeepingBoard
);

export default router;
