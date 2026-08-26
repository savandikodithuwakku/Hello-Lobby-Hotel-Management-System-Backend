import { body, param, query } from "express-validator";
import {
  mongoIdBody,
  mongoIdParam,
  mongoIdQuery,
  noteBody,
  paginationRules,
  searchRule,
  sortRule,
} from "../../shared/validators/common.validators.js";
import {
  BAGGAGE_SORT_OPTIONS,
  BAGGAGE_STATUS_VALUES,
  LOCATION_MAX,
  POLICY,
} from "./baggage.constants.js";

export const baggageIdValidation = mongoIdParam("id", "baggage record");

const noteField = () => noteBody("note", POLICY.NOTE_MAX, "Note");

const locationField = () =>
  body("location")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: LOCATION_MAX })
    .withMessage("The location is too long");

const descriptionField = () =>
  body("description")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: POLICY.DESCRIPTION_MAX })
    .withMessage("The description is too long");

const bagCountField = ({ optional = false } = {}) => {
  const chain = optional ? body("bagCount").optional() : body("bagCount");

  return chain
    .isInt({ min: 1, max: POLICY.MAX_BAGS })
    .withMessage(`There must be between 1 and ${POLICY.MAX_BAGS} pieces`)
    .toInt();
};

export const listBaggageValidation = [
  ...paginationRules(),
  searchRule(80),
  query("status").optional().isIn(BAGGAGE_STATUS_VALUES).withMessage("Unknown status"),
  mongoIdQuery("guest", "Invalid guest filter"),
  mongoIdQuery("reservation", "Invalid reservation filter"),
  sortRule(BAGGAGE_SORT_OPTIONS),
];

/** How the desk actually finds baggage: the number on the guest's ticket. */
export const tagValidation = [
  param("tag")
    .trim()
    .notEmpty()
    .withMessage("Give a claim tag")
    .isLength({ max: 40 })
    .withMessage("That is not a claim tag"),
];

/**
 * Taking baggage in.
 *
 * Either a guest or a written-down name is needed, but which one is not a rule
 * a validator can express on its own - naming a booking supplies the guest as
 * a side effect - so the service makes that check with the booking in hand.
 */
export const storeBaggageValidation = [
  bagCountField(),
  mongoIdBody("guest", "Invalid guest", { optional: true }),
  mongoIdBody("reservation", "Invalid reservation", { optional: true }),
  body("guestName")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: POLICY.GUEST_NAME_MAX })
    .withMessage("The name is too long"),
  descriptionField(),
  locationField(),
  body("receivedAt").optional().isISO8601().withMessage("Received time must be a valid date").toDate(),
  noteField(),
];

export const updateBaggageValidation = [
  ...baggageIdValidation,
  bagCountField({ optional: true }),
  descriptionField(),
  locationField(),
  noteField(),
];

export const collectBaggageValidation = [
  ...baggageIdValidation,
  body("collectedByName")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: POLICY.GUEST_NAME_MAX })
    .withMessage("The name is too long"),
  noteField(),
];
