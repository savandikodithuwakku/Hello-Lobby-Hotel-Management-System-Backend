import { sendCreated, sendOk } from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import { toDateString } from "../../shared/utils/date.util.js";
import * as reservationService from "./reservation.service.js";
import * as availabilityService from "./availability.service.js";
import { RESERVATION_MESSAGES } from "./reservation.constants.js";

/* ------------------------------- Availability ----------------------------- */

export const checkAvailability = asyncHandler(async (req, res) => {
  const result = await availabilityService.findAvailableRooms(req.validatedQuery);
  sendOk(res, `${result.total} room(s) available for those dates`, result);
});

export const getOccupancy = asyncHandler(async (req, res) => {
  const result = await availabilityService.getOccupancyForRange(req.validatedQuery);
  sendOk(res, "Occupancy fetched successfully", result);
});

/* ------------------------------- Reservations ----------------------------- */

export const listReservations = asyncHandler(async (req, res) => {
  // The service scopes the list to the caller when they may only read their own.
  const result = await reservationService.listReservations(req.validatedQuery, req.user);
  sendOk(res, "Reservations fetched successfully", result);
});

export const getReservationStatistics = asyncHandler(async (req, res) => {
  const statistics = await reservationService.getReservationStatistics();
  sendOk(res, "Reservation statistics fetched", statistics);
});

export const getReservation = asyncHandler(async (req, res) => {
  const reservation = await reservationService.getReservationById(req.params.id, req.user);
  sendOk(res, "Reservation fetched successfully", { reservation });
});

export const getReservationHistory = asyncHandler(async (req, res) => {
  const result = await reservationService.getReservationHistory(req.params.id, req.user);
  sendOk(res, "Reservation history fetched", result);
});

export const createReservation = asyncHandler(async (req, res) => {
  const reservation = await reservationService.createReservation(req.user, req.body);

  sendCreated(
    res,
    `${RESERVATION_MESSAGES.CREATED}. Pay ${reservation.payment.advanceAmount} by ` +
      `${toDateString(reservation.payment.advanceDeadline)} to confirm it.`,
    { reservation }
  );
});

export const updateReservation = asyncHandler(async (req, res) => {
  const reservation = await reservationService.updateReservation(req.user, req.params.id, req.body);
  sendOk(res, RESERVATION_MESSAGES.UPDATED, { reservation });
});

/* ------------------------- Status transitions ----------------------------- */

/**
 * Every transition endpoint does the same three things: call its service
 * function, report the module's standard message, and return the reservation.
 * They are built from one factory so a new transition is a single line.
 */
const transitionHandler = (transition, message) =>
  asyncHandler(async (req, res) => {
    const reservation = await transition(req.user, req.params.id, req.body);
    sendOk(res, message, { reservation });
  });

export const confirmReservation = transitionHandler(
  reservationService.confirmReservation,
  RESERVATION_MESSAGES.CONFIRMED
);

export const cancelReservation = transitionHandler(
  reservationService.cancelReservation,
  RESERVATION_MESSAGES.CANCELLED
);

export const checkIn = transitionHandler(
  reservationService.checkInReservation,
  RESERVATION_MESSAGES.CHECKED_IN
);

export const checkOut = transitionHandler(
  reservationService.checkOutReservation,
  RESERVATION_MESSAGES.CHECKED_OUT
);

export const completeReservation = transitionHandler(
  reservationService.completeReservation,
  RESERVATION_MESSAGES.COMPLETED
);

export const markNoShow = transitionHandler(
  reservationService.markNoShow,
  RESERVATION_MESSAGES.NO_SHOW
);
