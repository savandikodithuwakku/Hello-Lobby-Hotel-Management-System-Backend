import { body, param } from "express-validator";
import {
  avatarBody,
  mongoIdParam,
  nameBody,
  phoneBody,
} from "../../shared/validators/common.validators.js";
import { PASSWORD_RULE_MESSAGE, isStrongPassword } from "./utils/password.util.js";

/**
 * `normalizeEmail` is intentionally configured not to strip dots or subaddress
 * tags: two different people may legitimately own such addresses, and silently
 * rewriting them would break the login lookup.
 */
const emailField = (field = "email") =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage("Email address is required")
    .isEmail()
    .withMessage("A valid email address is required")
    .normalizeEmail({
      gmail_remove_dots: false,
      gmail_remove_subaddress: false,
      outlookdotcom_remove_subaddress: false,
      yahoo_remove_subaddress: false,
      icloud_remove_subaddress: false,
    })
    .isLength({ max: 254 })
    .withMessage("Email address is too long");

const passwordField = (field) =>
  body(field)
    .isString()
    .withMessage(PASSWORD_RULE_MESSAGE)
    .custom(isStrongPassword)
    .withMessage(PASSWORD_RULE_MESSAGE);

const confirmationField = (field, matches) =>
  body(field)
    .notEmpty()
    .withMessage("Please confirm your password")
    .custom((value, { req }) => value === req.body[matches])
    .withMessage("Passwords do not match");

/** Single-use tokens are 32 random bytes rendered as 64 hex characters. */
const tokenParam = (label) =>
  param("token")
    .trim()
    .isHexadecimal()
    .withMessage(`Invalid ${label} token`)
    .isLength({ min: 64, max: 64 })
    .withMessage(`Invalid ${label} token`);

export const registerValidation = [
  nameBody(),
  emailField(),
  passwordField("password"),
  confirmationField("confirmPassword", "password"),
  phoneBody(),
  // Role and status can never be set by the client during self-registration.
  body(["role", "status", "extraPermissions", "deniedPermissions"]).customSanitizer(() => undefined),
];

export const loginValidation = [
  emailField(),
  body("password").notEmpty().withMessage("Password is required"),
  body("rememberMe").optional().isBoolean().withMessage("rememberMe must be true or false").toBoolean(),
];

export const emailOnlyValidation = [emailField()];

export const verifyEmailValidation = [tokenParam("verification")];

export const resetPasswordValidation = [
  tokenParam("password reset"),
  passwordField("password"),
  confirmationField("confirmPassword", "password"),
];

export const changePasswordValidation = [
  body("currentPassword").notEmpty().withMessage("Current password is required"),
  passwordField("newPassword"),
  confirmationField("confirmNewPassword", "newPassword"),
];

export const updateProfileValidation = [
  nameBody({ optional: true }),
  phoneBody({ clearable: true }),
  avatarBody(),
];

export const sessionIdValidation = mongoIdParam("sessionId", "session");
