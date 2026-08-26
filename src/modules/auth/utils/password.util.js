export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RULE_MESSAGE =
  "Password must be at least 8 characters and include an uppercase letter, a lowercase letter and a number";

const RULES = [
  (value) => value.length >= PASSWORD_MIN_LENGTH,
  (value) => value.length <= PASSWORD_MAX_LENGTH,
  (value) => /[a-z]/.test(value),
  (value) => /[A-Z]/.test(value),
  (value) => /\d/.test(value),
];

/**
 * Password policy used by both registration and password change so the rules
 * can never drift apart between endpoints.
 */
export const isStrongPassword = (password) =>
  typeof password === "string" && RULES.every((rule) => rule(password));
