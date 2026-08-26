import { body, param, query } from "express-validator";
import {
  LIMITS,
  ROOM_SORT_OPTIONS,
  ROOM_STATUS_VALUES,
  ROOM_TYPE_SORT_OPTIONS,
} from "./room.constants.js";

/* -------------------------------------------------------------------------- */
/* Shared field builders                                                      */
/* -------------------------------------------------------------------------- */

/** Query flags arrive as strings; "any" is expressed by leaving them out. */
const booleanQuery = (field) =>
  query(field)
    .optional()
    .isBoolean()
    .withMessage(`${field} must be true or false`)
    .toBoolean();

const positiveNumberQuery = (field, label) =>
  query(field)
    .optional()
    .isFloat({ min: 0, max: LIMITS.MAX_PRICE })
    .withMessage(`${label} must be a positive amount`)
    .toFloat();

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

export const roomTypeIdValidation = [param("id").isMongoId().withMessage("Invalid room type id")];
export const roomIdValidation = [param("id").isMongoId().withMessage("Invalid room id")];

/* -------------------------------------------------------------------------- */
/* Room types                                                                 */
/* -------------------------------------------------------------------------- */

export const listRoomTypesValidation = [
  query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive integer").toInt(),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100")
    .toInt(),
  query("search").optional().trim().isLength({ max: 80 }).withMessage("Search term is too long"),
  booleanQuery("isActive"),
  positiveNumberQuery("minPrice", "Minimum price"),
  positiveNumberQuery("maxPrice", "Maximum price"),
  query("occupancy")
    .optional()
    .isInt({ min: 1, max: LIMITS.MAX_OCCUPANCY })
    .withMessage("Occupancy must be a whole number of guests")
    .toInt(),
  query("sort").optional().isIn(ROOM_TYPE_SORT_OPTIONS).withMessage("Unsupported sort option"),
];

export const createRoomTypeValidation = [
  body("name")
    .trim()
    .isLength({ min: LIMITS.NAME_MIN, max: LIMITS.NAME_MAX })
    .withMessage("Name must be between 2 and 60 characters"),
  body("description")
    .optional({ values: "null" })
    .trim()
    .isLength({ max: LIMITS.DESCRIPTION_MAX })
    .withMessage("Description is too long"),
  body("basePrice")
    .isFloat({ min: 0, max: LIMITS.MAX_PRICE })
    .withMessage("Base price must be a positive amount")
    .toFloat(),
  body("maxOccupancy")
    .isInt({ min: 1, max: LIMITS.MAX_OCCUPANCY })
    .withMessage(`Maximum occupancy must be between 1 and ${LIMITS.MAX_OCCUPANCY} guests`)
    .toInt(),
  facilitiesField(),
  imagesField(),
];

export const updateRoomTypeValidation = [
  ...roomTypeIdValidation,
  body("name")
    .optional()
    .trim()
    .isLength({ min: LIMITS.NAME_MIN, max: LIMITS.NAME_MAX })
    .withMessage("Name must be between 2 and 60 characters"),
  body("description")
    .optional({ values: "null" })
    .trim()
    .isLength({ max: LIMITS.DESCRIPTION_MAX })
    .withMessage("Description is too long"),
  body("basePrice")
    .optional()
    .isFloat({ min: 0, max: LIMITS.MAX_PRICE })
    .withMessage("Base price must be a positive amount")
    .toFloat(),
  body("maxOccupancy")
    .optional()
    .isInt({ min: 1, max: LIMITS.MAX_OCCUPANCY })
    .withMessage(`Maximum occupancy must be between 1 and ${LIMITS.MAX_OCCUPANCY} guests`)
    .toInt(),
  facilitiesField(),
  imagesField(),
  // Activation has its own endpoints; it must not ride along on a field patch.
  body("isActive").customSanitizer(() => undefined),
];

/* -------------------------------------------------------------------------- */
/* Rooms                                                                      */
/* -------------------------------------------------------------------------- */

export const listRoomsValidation = [
  query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive integer").toInt(),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100")
    .toInt(),
  query("search").optional().trim().isLength({ max: 20 }).withMessage("Search term is too long"),
  query("roomType").optional().isMongoId().withMessage("Invalid room type filter"),
  query("status").optional().isIn(ROOM_STATUS_VALUES).withMessage("Unknown room status"),
  query("floor")
    .optional()
    .isInt({ min: LIMITS.MIN_FLOOR, max: LIMITS.MAX_FLOOR })
    .withMessage("Floor is out of range")
    .toInt(),
  booleanQuery("isActive"),
  positiveNumberQuery("minPrice", "Minimum price"),
  positiveNumberQuery("maxPrice", "Maximum price"),
  query("sort").optional().isIn(ROOM_SORT_OPTIONS).withMessage("Unsupported sort option"),
];

export const availableRoomsValidation = [
  query("roomType").optional().isMongoId().withMessage("Invalid room type filter"),
  query("floor")
    .optional()
    .isInt({ min: LIMITS.MIN_FLOOR, max: LIMITS.MAX_FLOOR })
    .withMessage("Floor is out of range")
    .toInt(),
  query("occupancy")
    .optional()
    .isInt({ min: 1, max: LIMITS.MAX_OCCUPANCY })
    .withMessage("Occupancy must be a whole number of guests")
    .toInt(),
];

const roomNumberField = (optional = false) => {
  const field = body("roomNumber");
  const chain = optional ? field.optional() : field;

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

export const createRoomValidation = [
  roomNumberField(),
  body("roomType").isMongoId().withMessage("A valid room type is required"),
  body("floor")
    .isInt({ min: LIMITS.MIN_FLOOR, max: LIMITS.MAX_FLOOR })
    .withMessage("Floor is out of range")
    .toInt(),
  priceOverrideField(),
  facilitiesField(),
  body("status").optional().isIn(ROOM_STATUS_VALUES).withMessage("Unknown room status"),
  body("statusNote")
    .optional({ values: "null" })
    .trim()
    .isLength({ max: LIMITS.NOTE_MAX })
    .withMessage("Status note is too long"),
];

export const updateRoomValidation = [
  ...roomIdValidation,
  roomNumberField(true),
  body("roomType").optional().isMongoId().withMessage("A valid room type is required"),
  body("floor")
    .optional()
    .isInt({ min: LIMITS.MIN_FLOOR, max: LIMITS.MAX_FLOOR })
    .withMessage("Floor is out of range")
    .toInt(),
  priceOverrideField(),
  facilitiesField(),
  // Status and activation are state transitions with their own rules.
  body(["status", "isActive"]).customSanitizer(() => undefined),
];

export const changeRoomStatusValidation = [
  ...roomIdValidation,
  body("status").isIn(ROOM_STATUS_VALUES).withMessage("Unknown room status"),
  body("note")
    .optional({ values: "null" })
    .trim()
    .isLength({ max: LIMITS.NOTE_MAX })
    .withMessage("Note is too long"),
];

export const deactivateRoomValidation = [
  ...roomIdValidation,
  body("note")
    .optional({ values: "null" })
    .trim()
    .isLength({ max: LIMITS.NOTE_MAX })
    .withMessage("Note is too long"),
];
