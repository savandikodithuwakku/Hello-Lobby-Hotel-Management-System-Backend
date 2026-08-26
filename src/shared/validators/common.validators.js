import { body, param, query } from "express-validator";
import { MAX_PAGE_SIZE } from "../constants/pagination.constants.js";

/**
 * Validation rules that every module needs.
 *
 * Each module used to spell out its own `page`, `limit`, `search` and id rules,
 * which meant four slightly different versions of the same check. These
 * builders are the one definition; a module only declares what is genuinely its
 * own (a room number, a booking reference, a role).
 */

/** `:id` and friends - a route parameter that must be a Mongo id. */
export const mongoIdParam = (field, label) => [
  param(field).isMongoId().withMessage(`Invalid ${label} id`),
];

/** A body field that must be a Mongo id, e.g. the room a booking points at. */
export const mongoIdBody = (field, message, { optional = false } = {}) => {
  const chain = optional ? body(field).optional() : body(field);
  return chain.isMongoId().withMessage(message);
};

/** An optional query filter that must be a Mongo id. */
export const mongoIdQuery = (field, message) =>
  query(field).optional().isMongoId().withMessage(message);

/** `page` and `limit`, identical on every list endpoint. */
export const paginationRules = () => [
  query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive integer").toInt(),
  query("limit")
    .optional()
    .isInt({ min: 1, max: MAX_PAGE_SIZE })
    .withMessage(`limit must be between 1 and ${MAX_PAGE_SIZE}`)
    .toInt(),
];

/** The search box. `maxLength` differs per module: a room number is short. */
export const searchRule = (maxLength = 80) =>
  query("search").optional().trim().isLength({ max: maxLength }).withMessage("Search term is too long");

/**
 * The sort field, restricted to a list the module allows, so an arbitrary
 * field name can never reach `Query.sort()`.
 */
export const sortRule = (allowedValues) =>
  query("sort").optional().isIn(allowedValues).withMessage("Unsupported sort option");

/** Query flags arrive as strings; "any" is expressed by leaving them out. */
export const booleanQuery = (field) =>
  query(field).optional().isBoolean().withMessage(`${field} must be true or false`).toBoolean();

/** A whole-number query filter, e.g. a floor or a party size. */
export const intQuery = (field, { min, max, message }) =>
  query(field).optional().isInt({ min, max }).withMessage(message).toInt();

/** A positive amount of money as a query filter, e.g. a price range. */
export const amountQuery = (field, label, max) =>
  query(field)
    .optional()
    .isFloat({ min: 0, max })
    .withMessage(`${label} must be a positive amount`)
    .toFloat();

/** A free-text note. `null` is accepted and clears it. */
export const noteBody = (field, maxLength, label = "Note") =>
  body(field)
    .optional({ values: "null" })
    .trim()
    .isLength({ max: maxLength })
    .withMessage(`${label} is too long`);

/** A person's name, on both registration and the admin user forms. */
export const nameBody = ({ optional = false } = {}) => {
  const chain = optional ? body("name").optional() : body("name").notEmpty().withMessage("Name is required");
  return chain
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage("Name must be between 2 and 80 characters");
};

/**
 * A phone number.
 *
 * `values: "falsy"` on a create form treats an empty box as "not given";
 * `values: "null"` on an edit form lets an explicit `null` clear the number.
 */
export const phoneBody = ({ clearable = false } = {}) =>
  body("phone")
    .optional({ values: clearable ? "null" : "falsy" })
    .trim()
    .isLength({ min: 7, max: 20 })
    .withMessage("Phone number must be between 7 and 20 characters");

export const avatarBody = () =>
  body("avatar").optional({ values: "null" }).trim().isURL().withMessage("Avatar must be a valid URL");

/**
 * Silently drops fields the client is not allowed to set.
 *
 * Used for anything the server derives or that has its own endpoint - a status,
 * a price, a role - so a stray field in the request body is ignored rather than
 * quietly written to the database.
 */
export const stripFields = (...fields) => body(fields.flat()).customSanitizer(() => undefined);
