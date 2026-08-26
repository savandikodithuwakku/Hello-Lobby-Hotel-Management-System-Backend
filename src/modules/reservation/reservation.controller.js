import ApiResponse from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import * as reservationService from "./reservation.service.js";
import * as availabilityService from "./availability.service.js";
import { RESERVATION_MESSAGES } from "./reservation.constants.js";

/* ------------------------------- Availability ----------------------------- */

export const checkAvailability = asyncHandler(async (req, res) => {
  const result = await availabilityService.findAvailableRooms(req.validatedQuery);
  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        `${result.total} room(s) available for those dates`,
        result
      )
    );
});

export const getOccupancy = asyncHandler(async (req, res) => {
  const result = await availabilityService.getOccupancyForRange(req.validatedQuery);
  res.status(200).json(new ApiResponse(200, "Occupancy fetched successfully", result));
});

/* ------------------------------- Reservations ----------------------------- */

export const listReservations = asyncHandler(async (req, res) => {
  // The service scopes the list to the caller when they may only read their own.
  const result = await reservationService.listReservations(req.validatedQuery, req.user);
  res.status(200).json(new ApiResponse(200, "Reservations fetched successfully", result));
});

export const getReservationStatistics = asyncHandler(async (req, res) => {
  const statistics = await reservationService.getReservationStatistics();
  res.status(200).json(new ApiResponse(200, "Reservation statistics fetched", statistics));
});

export const getReservation = asyncHandler(async (req, res) => {
  const reservation = await reservationService.getReservationById(req.params.id, req.user);
  res.status(200).json(new ApiResponse(200, "Reservation fetched successfully", { reservation }));
});

export const getReservationHistory = asyncHandler(async (req, res) => {
  const result = await reservationService.getReservationHistory(req.params.id, req.user);
  res.status(200).json(new ApiResponse(200, "Reservation history fetched", result));
});

export const createReservation = asyncHandler(async (req, res) => {
  const reservation = await reservationService.createReservation(req.user, req.body);
  res.status(201).json(
    new ApiResponse(
      201,
      `${RESERVATION_MESSAGES.CREATED}. Pay ${reservation.payment.advanceAmount} by ` +
        `${reservation.payment.advanceDeadline.toISOString().slice(0, 10)} to confirm it.`,
      { reservation }
    )
  );
});

export const updateReservation = asyncHandler(async (req, res) => {
  const reservation = await reservationService.updateReservation(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, RESERVATION_MESSAGES.UPDATED, { reservation }));
});

export const confirmReservation = asyncHandler(async (req, res) => {
  const reservation = await reservationService.confirmReservation(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, RESERVATION_MESSAGES.CONFIRMED, { reservation }));
});

export const cancelReservation = asyncHandler(async (req, res) => {
  const reservation = await reservationService.cancelReservation(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, RESERVATION_MESSAGES.CANCELLED, { reservation }));
});

export const checkIn = asyncHandler(async (req, res) => {
  const reservation = await reservationService.checkInReservation(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, RESERVATION_MESSAGES.CHECKED_IN, { reservation }));
});

export const checkOut = asyncHandler(async (req, res) => {
  const reservation = await reservationService.checkOutReservation(
    req.user,
    req.params.id,
    req.body
  );
  res.status(200).json(new ApiResponse(200, RESERVATION_MESSAGES.CHECKED_OUT, { reservation }));
});

export const completeReservation = asyncHandler(async (req, res) => {
  const reservation = await reservationService.completeReservation(
    req.user,
    req.params.id,
    req.body
  );
  res.status(200).json(new ApiResponse(200, RESERVATION_MESSAGES.COMPLETED, { reservation }));
});

export const markNoShow = asyncHandler(async (req, res) => {
  const reservation = await reservationService.markNoShow(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, RESERVATION_MESSAGES.NO_SHOW, { reservation }));
});

export const recordPayment = asyncHandler(async (req, res) => {
  const result = await reservationService.recordPayment(req.user, req.params.id, req.body);
  res.status(200).json(
    new ApiResponse(
      200,
      result.autoConfirmed
        ? "Advance received. The reservation is now confirmed."
        : RESERVATION_MESSAGES.PAYMENT_RECORDED,
      result
    )
  );
});
