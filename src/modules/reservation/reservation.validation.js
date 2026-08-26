import { body, query } from "express-validator";
import {
  intQuery,
  mongoIdBody,
  mongoIdParam,
  mongoIdQuery,
  noteBody,
  paginationRules,
  searchRule,
  sortRule,
  stripFields,
} from "../../shared/validators/common.validators.js";
import { POLICY, RESERVATION_SORT_OPTIONS, RESERVATION_STATUS_VALUES } from "./reservation.constants.js";

export const reservationIdValidation = mongoIdParam("id", "reservation");

const noteField = (field = "note", label = "Note") => noteBody(field, POLICY.NOTE_MAX, label);

const dateField = (field, label, { optional = false } = {}) => {
  const chain = optional ? body(field).optional() : body(field);

  return chain.isISO8601().withMessage(`${label} must be a valid date`).toDate();
};

/** The same date rule for a query string, used by the availability search. */
const dateQuery = (field, label) =>
  query(field).isISO8601().withMessage(`${label} must be a valid date`).toDate();

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

/** Fields the server derives itself and must never accept from a client. */
const SERVER_OWNED_FIELDS = ["status", "pricing", "payment", "reference", "history"];

export const availabilityValidation = [
  dateQuery("checkIn", "Check-in"),
  dateQuery("checkOut", "Check-out"),
  mongoIdQuery("roomType", "Invalid room type"),
  intQuery("guests", { min: 1, max: POLICY.MAX_GUESTS, message: "Guests must be a whole number" }),
  intQuery("floor", { min: -5, max: 200, message: "Floor is out of range" }),
];

export const occupancyValidation = [
  dateQuery("checkIn", "Start date"),
  dateQuery("checkOut", "End date"),
];

export const listReservationsValidation = [
  ...paginationRules(),
  searchRule(80),
  query("status").optional().isIn(RESERVATION_STATUS_VALUES).withMessage("Unknown status"),
  mongoIdQuery("customer", "Invalid customer filter"),
  mongoIdQuery("room", "Invalid room filter"),
  mongoIdQuery("roomType", "Invalid room type filter"),
  query("from").optional().isISO8601().withMessage("from must be a valid date").toDate(),
  query("to").optional().isISO8601().withMessage("to must be a valid date").toDate(),
  query("unpaid").optional().isBoolean().withMessage("unpaid must be true or false").toBoolean(),
  sortRule(RESERVATION_SORT_OPTIONS),
];

export const createReservationValidation = [
  mongoIdBody("room", "A room must be selected"),
  // Only staff may set this; the service refuses it for anyone else.
  mongoIdBody("customer", "Invalid customer", { optional: true }),
  dateField("checkIn", "Check-in"),
  dateField("checkOut", "Check-out"),
  guestsField(),
  servicesField(),
  noteField("specialRequests", "Special requests"),
  stripFields(SERVER_OWNED_FIELDS),
];

export const updateReservationValidation = [
  ...reservationIdValidation,
  mongoIdBody("room", "Invalid room", { optional: true }),
  dateField("checkIn", "Check-in", { optional: true }),
  dateField("checkOut", "Check-out", { optional: true }),
  guestsField({ optional: true }),
  servicesField(),
  noteField("specialRequests", "Special requests"),
  // The customer is fixed once the booking exists, on top of the derived fields.
  stripFields([...SERVER_OWNED_FIELDS, "customer"]),
];

export const transitionValidation = [...reservationIdValidation, noteField()];

export const cancelReservationValidation = [
  ...reservationIdValidation,
  noteField("reason", "Reason"),
];

export const recordPaymentValidation = [
  ...reservationIdValidation,
  body("amount")
    .isFloat({ gt: 0, max: POLICY.MAX_AMOUNT })
    .withMessage("The payment amount must be greater than zero")
    .toFloat(),
  noteField(),
];
