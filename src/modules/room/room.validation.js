import { body, query } from "express-validator";
import {
  amountQuery,
  booleanQuery,
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
import {
  HOUSEKEEPING_STATUS_VALUES,
  LIMITS,
  OCCUPANCY_STATUS_VALUES,
  ROOM_SORT_OPTIONS,
  ROOM_TYPE_SORT_OPTIONS,
} from "./room.constants.js";

/* -------------------------------------------------------------------------- */
/* Field builders used by more than one endpoint in this module               */
/* -------------------------------------------------------------------------- */

const floorQuery = () =>
  intQuery("floor", { min: LIMITS.MIN_FLOOR, max: LIMITS.MAX_FLOOR, message: "Floor is out of range" });

const occupancyQuery = () =>
  intQuery("occupancy", {
    min: 1,
    max: LIMITS.MAX_OCCUPANCY,
    message: "Occupancy must be a whole number of guests",
  });

const priceRangeQueries = () => [
  amountQuery("minPrice", "Minimum price", LIMITS.MAX_PRICE),
  amountQuery("maxPrice", "Maximum price", LIMITS.MAX_PRICE),
];

const facilitiesField = () =>
  body("facilities")
    .optional()
    .isArray({ max: LIMITS.MAX_FACILITIES })
    .withMessage(`Up to ${LIMITS.MAX_FACILITIES} facilities can be listed`)
    // A form with a spare empty row should not be an error, so blanks are
    // dropped here; the model then trims and de-duplicates what is left.
    .customSanitizer((facilities) =>
      Array.isArray(facilities)
        ? facilities.filter((facility) => typeof facility === "string" && facility.trim())
        : facilities
    )
    .custom((facilities) =>
      facilities.every((facility) => facility.trim().length <= LIMITS.FACILITY_MAX_LENGTH)
    )
    .withMessage(`Each facility must be text of up to ${LIMITS.FACILITY_MAX_LENGTH} characters`);

const imagesField = () =>
  body("images")
    .optional()
    .isArray({ max: LIMITS.MAX_IMAGES })
    .withMessage(`Up to ${LIMITS.MAX_IMAGES} images can be attached`)
    .custom((images) =>
      images.every(
        (image) =>
          image &&
          typeof image.url === "string" &&
          /^(https?:\/\/|\/)/i.test(image.url.trim()) &&
          (image.alt === undefined ||
            (typeof image.alt === "string" && image.alt.length <= LIMITS.IMAGE_ALT_MAX))
      )
    )
    .withMessage("Each image needs a valid URL and an optional short description");

const housekeepingBody = ({ optional = false } = {}) => {
  const chain = optional ? body("housekeeping").optional() : body("housekeeping");
  return chain.isIn(HOUSEKEEPING_STATUS_VALUES).withMessage("Unknown housekeeping status");
};

const noteField = (field = "note", label = "Note") => noteBody(field, LIMITS.NOTE_MAX, label);

export const roomTypeIdValidation = mongoIdParam("id", "room type");
export const roomIdValidation = mongoIdParam("id", "room");

/* -------------------------------------------------------------------------- */
/* Room types                                                                 */
/* -------------------------------------------------------------------------- */

const roomTypeNameBody = ({ optional = false } = {}) => {
  const chain = optional ? body("name").optional() : body("name");
  return chain
    .trim()
    .isLength({ min: LIMITS.NAME_MIN, max: LIMITS.NAME_MAX })
    .withMessage(`Name must be between ${LIMITS.NAME_MIN} and ${LIMITS.NAME_MAX} characters`);
};

const descriptionBody = () => noteBody("description", LIMITS.DESCRIPTION_MAX, "Description");

const basePriceBody = ({ optional = false } = {}) => {
  const chain = optional ? body("basePrice").optional() : body("basePrice");
  return chain
    .isFloat({ min: 0, max: LIMITS.MAX_PRICE })
    .withMessage("Base price must be a positive amount")
    .toFloat();
};

const maxOccupancyBody = ({ optional = false } = {}) => {
  const chain = optional ? body("maxOccupancy").optional() : body("maxOccupancy");
  return chain
    .isInt({ min: 1, max: LIMITS.MAX_OCCUPANCY })
    .withMessage(`Maximum occupancy must be between 1 and ${LIMITS.MAX_OCCUPANCY} guests`)
    .toInt();
};

export const listRoomTypesValidation = [
  ...paginationRules(),
  searchRule(80),
  booleanQuery("isActive"),
  ...priceRangeQueries(),
  occupancyQuery(),
  sortRule(ROOM_TYPE_SORT_OPTIONS),
];

export const createRoomTypeValidation = [
  roomTypeNameBody(),
  descriptionBody(),
  basePriceBody(),
  maxOccupancyBody(),
  facilitiesField(),
  imagesField(),
];

export const updateRoomTypeValidation = [
  ...roomTypeIdValidation,
  roomTypeNameBody({ optional: true }),
  descriptionBody(),
  basePriceBody({ optional: true }),
  maxOccupancyBody({ optional: true }),
  facilitiesField(),
  imagesField(),
  // Activation has its own endpoints; it must not ride along on a field patch.
  stripFields("isActive"),
];

/* -------------------------------------------------------------------------- */
/* Rooms                                                                      */
/* -------------------------------------------------------------------------- */

export const listRoomsValidation = [
  ...paginationRules(),
  // Room numbers are short, so a long search term is certainly a mistake.
  searchRule(20),
  mongoIdQuery("roomType", "Invalid room type filter"),
  query("occupancy").optional().isIn(OCCUPANCY_STATUS_VALUES).withMessage("Unknown occupancy"),
  query("housekeeping")
    .optional()
    .isIn(HOUSEKEEPING_STATUS_VALUES)
    .withMessage("Unknown housekeeping status"),
  // "Empty but not fit to sell" - the rooms losing the hotel money quietly.
  booleanQuery("discrepant"),
  floorQuery(),
  booleanQuery("isActive"),
  ...priceRangeQueries(),
  sortRule(ROOM_SORT_OPTIONS),
];

export const availableRoomsValidation = [
  mongoIdQuery("roomType", "Invalid room type filter"),
  floorQuery(),
  occupancyQuery(),
];

const roomNumberField = ({ optional = false } = {}) => {
  const chain = optional ? body("roomNumber").optional() : body("roomNumber");

  return chain
    .trim()
    .notEmpty()
    .withMessage("Room number is required")
    .isLength({ max: LIMITS.ROOM_NUMBER_MAX })
    .withMessage(`Room number must be at most ${LIMITS.ROOM_NUMBER_MAX} characters`)
    .matches(/^[A-Za-z0-9-]+$/)
    .withMessage("Room number may contain letters, digits and hyphens only");
};

/** `null` is allowed and meaningful: it clears a room's price override. */
const priceOverrideField = () =>
  body("price")
    .optional({ values: "undefined" })
    .custom((value) => value === null || (Number.isFinite(Number(value)) && Number(value) >= 0))
    .withMessage("Price must be a positive amount, or null to follow the room type")
    .customSanitizer((value) => (value === null ? null : Number(value)));

const floorBody = ({ optional = false } = {}) => {
  const chain = optional ? body("floor").optional() : body("floor");
  return chain
    .isInt({ min: LIMITS.MIN_FLOOR, max: LIMITS.MAX_FLOOR })
    .withMessage("Floor is out of range")
    .toInt();
};

export const createRoomValidation = [
  roomNumberField(),
  mongoIdBody("roomType", "A valid room type is required"),
  floorBody(),
  priceOverrideField(),
  facilitiesField(),
  housekeepingBody({ optional: true }),
  noteField("housekeepingNote", "Housekeeping note"),
];

export const updateRoomValidation = [
  ...roomIdValidation,
  roomNumberField({ optional: true }),
  mongoIdBody("roomType", "A valid room type is required", { optional: true }),
  floorBody({ optional: true }),
  priceOverrideField(),
  facilitiesField(),
  // Both statuses and activation are transitions with their own rules, so a
  // stray field in an edit form is dropped rather than written to the room.
  stripFields("occupancy", "housekeeping", "isActive"),
];

export const changeHousekeepingValidation = [
  ...roomIdValidation,
  housekeepingBody(),
  noteField(),
];

export const deactivateRoomValidation = [...roomIdValidation, noteField()];
