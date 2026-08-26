import { body, param, query } from "express-validator";
import {
  POLICY,
  RESERVATION_SORT_OPTIONS,
  RESERVATION_STATUS_VALUES,
} from "./reservation.constants.js";

export const reservationIdValidation = [
  param("id").isMongoId().withMessage("Invalid reservation id"),
];

const noteField = (field = "note") =>
  body(field)
    .optional({ values: "null" })
    .trim()
    .isLength({ max: POLICY.NOTE_MAX })
    .withMessage("Note is too long");

const dateField = (field, label, { optional = false } = {}) => {
  const chain = optional ? body(field).optional() : body(field);

  return chain
    .isISO8601()
    .withMessage(`${label} must be a valid date`)
    .toDate();
};

const guestsField = ({ optional = false } = {}) => {
  const chain = optional ? body("guests").optional() : body("guests");

  return chain
    .isInt({ min: 1, max: POLICY.MAX_GUESTS })
    .withMessage(`Guests must be between 1 and ${POLICY.MAX_GUESTS}`)
    .toInt();
};

/**
 * Additional services arrive as a list of lines. Blank rows are dropped rather
 * than rejected: a form with a spare empty row is not an error.
 */
const servicesField = () =>
  body("additionalServices")
    .optional()
    .isArray({ max: POLICY.MAX_SERVICES })
    .withMessage(`Up to ${POLICY.MAX_SERVICES} additional services can be added`)
    .customSanitizer((services) =>
      Array.isArray(services)
        ? services.filter((service) => service && String(service.name || "").trim())
        : services
    )
    .custom((services) =>
      services.every(
        (service) =>
          String(service.name).trim().length <= POLICY.SERVICE_NAME_MAX &&
          Number.isFinite(Number(service.unitPrice)) &&
          Number(service.unitPrice) >= 0 &&
          Number(service.unitPrice) <= POLICY.MAX_AMOUNT &&
          (service.quantity === undefined ||
            (Number.isFinite(Number(service.quantity)) && Number(service.quantity) >= 1))
      )
    )
    .withMessage("Each service needs a name, a price of zero or more and a quantity of at least 1");

export const availabilityValidation = [
  query("checkIn").isISO8601().withMessage("Check-in must be a valid date").toDate(),
  query("checkOut").isISO8601().withMessage("Check-out must be a valid date").toDate(),
  query("roomType").optional().isMongoId().withMessage("Invalid room type"),
  query("guests")
    .optional()
    .isInt({ min: 1, max: POLICY.MAX_GUESTS })
    .withMessage("Guests must be a whole number")
    .toInt(),
  query("floor").optional().isInt({ min: -5, max: 200 }).withMessage("Floor is out of range").toInt(),
];

export const occupancyValidation = [
  query("checkIn").isISO8601().withMessage("Start date must be valid").toDate(),
  query("checkOut").isISO8601().withMessage("End date must be valid").toDate(),
];

export const listReservationsValidation = [
  query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive integer").toInt(),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100")
    .toInt(),
  query("search").optional().trim().isLength({ max: 80 }).withMessage("Search term is too long"),
  query("status").optional().isIn(RESERVATION_STATUS_VALUES).withMessage("Unknown status"),
  query("customer").optional().isMongoId().withMessage("Invalid customer filter"),
  query("room").optional().isMongoId().withMessage("Invalid room filter"),
  query("roomType").optional().isMongoId().withMessage("Invalid room type filter"),
  query("from").optional().isISO8601().withMessage("from must be a valid date").toDate(),
  query("to").optional().isISO8601().withMessage("to must be a valid date").toDate(),
  query("unpaid").optional().isBoolean().withMessage("unpaid must be true or false").toBoolean(),
  query("sort").optional().isIn(RESERVATION_SORT_OPTIONS).withMessage("Unsupported sort option"),
];

export const createReservationValidation = [
  body("room").isMongoId().withMessage("A room must be selected"),
  // Only staff may set this; the service refuses it for anyone else.
  body("customer").optional().isMongoId().withMessage("Invalid customer"),
  dateField("checkIn", "Check-in"),
  dateField("checkOut", "Check-out"),
  guestsField(),
  servicesField(),
  noteField("specialRequests"),
  // Status, pricing and payment are derived server-side, never accepted.
  body(["status", "pricing", "payment", "reference", "history"]).customSanitizer(() => undefined),
];

export const updateReservationValidation = [
  ...reservationIdValidation,
  body("room").optional().isMongoId().withMessage("Invalid room"),
  dateField("checkIn", "Check-in", { optional: true }),
  dateField("checkOut", "Check-out", { optional: true }),
  guestsField({ optional: true }),
  servicesField(),
  noteField("specialRequests"),
  body(["status", "pricing", "payment", "reference", "history", "customer"]).customSanitizer(
    () => undefined
  ),
];

export const transitionValidation = [...reservationIdValidation, noteField()];

export const cancelReservationValidation = [
  ...reservationIdValidation,
  body("reason")
    .optional({ values: "null" })
    .trim()
    .isLength({ max: POLICY.NOTE_MAX })
    .withMessage("Reason is too long"),
];

export const recordPaymentValidation = [
  ...reservationIdValidation,
  body("amount")
    .isFloat({ gt: 0, max: POLICY.MAX_AMOUNT })
    .withMessage("The payment amount must be greater than zero")
    .toFloat(),
  noteField(),
];
