import { body, query } from "express-validator";
import {
  avatarBody,
  mongoIdParam,
  nameBody,
  paginationRules,
  phoneBody,
  searchRule,
  sortRule,
} from "../../shared/validators/common.validators.js";
import { PERMISSION_VALUES } from "../auth/rbac/permissions.js";
import { USER_ROLE_VALUES, USER_SORT_OPTIONS, USER_STATUS_VALUES } from "./user.constants.js";

export const userIdValidation = mongoIdParam("id", "user");

/**
 * Address fields are always optional and may be sent as null to clear them.
 * Declared once so create and update can never validate the same field
 * differently.
 */
const addressLine = (field, label, maxLength) =>
  body(`address.${field}`)
    .optional({ values: "null" })
    .trim()
    .isLength({ max: maxLength })
    .withMessage(`${label} must not exceed ${maxLength} characters`);

const addressValidation = [
  body("address").optional({ values: "null" }).isObject().withMessage("address must be an object"),
  addressLine("line1", "Address line 1", 120),
  addressLine("line2", "Address line 2", 120),
  addressLine("city", "City", 80),
  addressLine("state", "State or province", 80),
  addressLine("postalCode", "Postal code", 20),
  addressLine("country", "Country", 80),
];

const roleBody = () => body("role").isIn(USER_ROLE_VALUES).withMessage("Unknown role");

/** Checks that every entry in a permissions array is one the system knows. */
const permissionsBody = (field) =>
  body(field)
    .optional()
    .isArray()
    .withMessage(`${field} must be an array`)
    .custom((values) => values.every((value) => PERMISSION_VALUES.includes(value)))
    .withMessage(`${field} contains an unknown permission`);

export const listUsersValidation = [
  ...paginationRules(),
  query("role").optional().isIn(USER_ROLE_VALUES).withMessage("Unknown role"),
  query("status").optional().isIn(USER_STATUS_VALUES).withMessage("Unknown status"),
  searchRule(80),
  sortRule(USER_SORT_OPTIONS),
];

export const createUserValidation = [
  nameBody(),
  body("email").trim().isEmail().withMessage("A valid email address is required").normalizeEmail({
    gmail_remove_dots: false,
    gmail_remove_subaddress: false,
  }),
  roleBody(),
  phoneBody(),
  ...addressValidation,
];

export const updateUserValidation = [
  ...userIdValidation,
  nameBody({ optional: true }),
  phoneBody({ clearable: true }),
  avatarBody(),
  ...addressValidation,
];

export const changeRoleValidation = [...userIdValidation, roleBody()];

export const changeStatusValidation = [
  ...userIdValidation,
  body("status").isIn(USER_STATUS_VALUES).withMessage("Unknown status"),
];

export const changePermissionsValidation = [
  ...userIdValidation,
  permissionsBody("extraPermissions"),
  permissionsBody("deniedPermissions"),
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
