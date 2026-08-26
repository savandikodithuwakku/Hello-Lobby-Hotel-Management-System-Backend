import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requirePermission } from "../auth/rbac/rbac.middleware.js";
import { PERMISSIONS } from "../auth/rbac/permissions.js";
import { validateRequest } from "../../shared/middleware/validate.middleware.js";
import * as reservationController from "./reservation.controller.js";
import {
  availabilityValidation,
  cancelReservationValidation,
  createReservationValidation,
  listReservationsValidation,
  occupancyValidation,
  recordPaymentValidation,
  reservationIdValidation,
  transitionValidation,
  updateReservationValidation,
} from "./reservation.validation.js";

/**
 * Reservations.
 *
 * Reading is permission-scoped rather than route-scoped: a guest holding only
 * `reservation:read_own` uses the same endpoints, and the service narrows the
 * results to their own bookings.
 */
const router = Router();

router.use(authenticate);

/**
 * Availability search. Open to anyone who can make a booking - a guest needs it
 * to find a room - and it returns only free rooms plus a price quote, never the
 * live status of the rest of the inventory.
 */
router.get(
  "/availability",
  requirePermission(PERMISSIONS.RESERVATION_CREATE, PERMISSIONS.RESERVATION_READ),
  availabilityValidation,
  validateRequest,
  reservationController.checkAvailability
);

/** Night-by-night occupancy for the front desk and, later, analytics. */
router.get(
  "/occupancy",
  requirePermission(PERMISSIONS.RESERVATION_READ),
  occupancyValidation,
  validateRequest,
  reservationController.getOccupancy
);

router.get(
  "/statistics",
  requirePermission(PERMISSIONS.RESERVATION_READ),
  reservationController.getReservationStatistics
);

router.get(
  "/",
  requirePermission(PERMISSIONS.RESERVATION_READ, PERMISSIONS.RESERVATION_READ_OWN),
  listReservationsValidation,
  validateRequest,
  reservationController.listReservations
);

router.post(
  "/",
  requirePermission(PERMISSIONS.RESERVATION_CREATE),
  createReservationValidation,
  validateRequest,
  reservationController.createReservation
);

router.get(
  "/:id",
  requirePermission(PERMISSIONS.RESERVATION_READ, PERMISSIONS.RESERVATION_READ_OWN),
  reservationIdValidation,
  validateRequest,
  reservationController.getReservation
);

router.get(
  "/:id/history",
  requirePermission(PERMISSIONS.RESERVATION_READ, PERMISSIONS.RESERVATION_READ_OWN),
  reservationIdValidation,
  validateRequest,
  reservationController.getReservationHistory
);

router.patch(
  "/:id",
  requirePermission(PERMISSIONS.RESERVATION_UPDATE),
  updateReservationValidation,
  validateRequest,
  reservationController.updateReservation
);

/**
 * Cancelling is the one action a guest performs on their own booking, so it is
 * gated on either permission and the service checks ownership.
 */
router.post(
  "/:id/cancel",
  requirePermission(PERMISSIONS.RESERVATION_CANCEL, PERMISSIONS.RESERVATION_READ_OWN),
  cancelReservationValidation,
  validateRequest,
  reservationController.cancelReservation
);

router.post(
  "/:id/confirm",
  requirePermission(PERMISSIONS.RESERVATION_UPDATE),
  transitionValidation,
  validateRequest,
  reservationController.confirmReservation
);

router.post(
  "/:id/no-show",
  requirePermission(PERMISSIONS.RESERVATION_UPDATE),
  transitionValidation,
  validateRequest,
  reservationController.markNoShow
);

router.post(
  "/:id/check-in",
  requirePermission(PERMISSIONS.FRONTDESK_CHECKIN),
  transitionValidation,
  validateRequest,
  reservationController.checkIn
);

router.post(
  "/:id/check-out",
  requirePermission(PERMISSIONS.FRONTDESK_CHECKOUT),
  transitionValidation,
  validateRequest,
  reservationController.checkOut
);

router.post(
  "/:id/complete",
  requirePermission(PERMISSIONS.RESERVATION_UPDATE),
  transitionValidation,
  validateRequest,
  reservationController.completeReservation
);

/**
 * Records money against a booking. Provisional home: when the payments module
 * lands it will own the gateway, receipts and refunds, and will call
 * `recordPayment` in this service rather than writing to the reservation.
 */
router.patch(
  "/:id/payment",
  requirePermission(PERMISSIONS.PAYMENT_CREATE),
  recordPaymentValidation,
  validateRequest,
  reservationController.recordPayment
);

export default router;
