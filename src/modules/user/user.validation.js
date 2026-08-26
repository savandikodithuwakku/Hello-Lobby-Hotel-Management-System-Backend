import { body, param, query } from "express-validator";
import { PERMISSION_VALUES } from "../auth/rbac/permissions.js";
import {
  MAX_PAGE_SIZE,
  USER_ROLE_VALUES,
  USER_SORT_OPTIONS,
  USER_STATUS_VALUES,
} from "./user.constants.js";

export const userIdValidation = [param("id").isMongoId().withMessage("Invalid user id")];

/**
 * Address fields are always optional and may be sent as null to clear them.
 * Declared once so create and update can never validate the same field
 * differently.
 */
const addressValidation = [
  body("address").optional({ values: "null" }).isObject().withMessage("address must be an object"),
  body("address.line1")
    .optional({ values: "null" })
    .trim()
    .isLength({ max: 120 })
    .withMessage("Address line 1 must not exceed 120 characters"),
  body("address.line2")
    .optional({ values: "null" })
    .trim()
    .isLength({ max: 120 })
    .withMessage("Address line 2 must not exceed 120 characters"),
  body("address.city")
    .optional({ values: "null" })
    .trim()
    .isLength({ max: 80 })
    .withMessage("City must not exceed 80 characters"),
  body("address.state")
    .optional({ values: "null" })
    .trim()
    .isLength({ max: 80 })
    .withMessage("State or province must not exceed 80 characters"),
  body("address.postalCode")
    .optional({ values: "null" })
    .trim()
    .isLength({ max: 20 })
    .withMessage("Postal code must not exceed 20 characters"),
  body("address.country")
    .optional({ values: "null" })
    .trim()
    .isLength({ max: 80 })
    .withMessage("Country must not exceed 80 characters"),
];

export const listUsersValidation = [
  query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive integer").toInt(),
  query("limit")
    .optional()
    .isInt({ min: 1, max: MAX_PAGE_SIZE })
    .withMessage(`limit must be between 1 and ${MAX_PAGE_SIZE}`)
    .toInt(),
  query("role").optional().isIn(USER_ROLE_VALUES).withMessage("Unknown role"),
  query("status").optional().isIn(USER_STATUS_VALUES).withMessage("Unknown status"),
  query("search").optional().trim().isLength({ max: 80 }).withMessage("Search term is too long"),
  query("sort").optional().isIn(USER_SORT_OPTIONS).withMessage("Unsupported sort option"),
];

export const createUserValidation = [
  body("name").trim().isLength({ min: 2, max: 80 }).withMessage("Name must be between 2 and 80 characters"),
  body("email").trim().isEmail().withMessage("A valid email address is required").normalizeEmail({
    gmail_remove_dots: false,
    gmail_remove_subaddress: false,
  }),
  body("role").isIn(USER_ROLE_VALUES).withMessage("Unknown role"),
  body("phone").optional({ values: "falsy" }).trim().isLength({ min: 7, max: 20 }).withMessage("Invalid phone number"),
  ...addressValidation,
];

export const updateUserValidation = [
  ...userIdValidation,
  body("name").optional().trim().isLength({ min: 2, max: 80 }).withMessage("Name must be between 2 and 80 characters"),
  body("phone").optional({ values: "null" }).trim().isLength({ min: 7, max: 20 }).withMessage("Invalid phone number"),
  body("avatar").optional({ values: "null" }).trim().isURL().withMessage("Avatar must be a valid URL"),
  ...addressValidation,
];

export const changeRoleValidation = [
  ...userIdValidation,
  body("role").isIn(USER_ROLE_VALUES).withMessage("Unknown role"),
];

export const changeStatusValidation = [
  ...userIdValidation,
  body("status").isIn(USER_STATUS_VALUES).withMessage("Unknown status"),
];

export const changePermissionsValidation = [
  ...userIdValidation,
  body("extraPermissions")
    .optional()
    .isArray()
    .withMessage("extraPermissions must be an array")
    .custom((values) => values.every((value) => PERMISSION_VALUES.includes(value)))
    .withMessage("extraPermissions contains an unknown permission"),
  body("deniedPermissions")
    .optional()
    .isArray()
    .withMessage("deniedPermissions must be an array")
    .custom((values) => values.every((value) => PERMISSION_VALUES.includes(value)))
    .withMessage("deniedPermissions contains an unknown permission"),
];

/**
 * A permanent delete is irreversible, so the caller must repeat the account's
 * email address in the body. This is the API-level equivalent of a
 * "type the name to confirm" dialog and stops a mistyped id from erasing the
 * wrong account.
 */
export const deleteUserValidation = [
  ...userIdValidation,
  body("confirmEmail")
    .trim()
    .isEmail()
    .withMessage("Confirm the deletion by sending the account's email address"),
];
