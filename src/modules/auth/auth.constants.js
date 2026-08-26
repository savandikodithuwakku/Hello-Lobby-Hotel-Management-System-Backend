import env from "../../config/env.js";

export const PASSWORD_RESET_TOKEN_EXPIRES_MINUTES = env.security.passwordResetTokenMinutes;
export const EMAIL_VERIFICATION_TOKEN_EXPIRES_HOURS = env.security.emailVerificationTokenHours;

export const AUTH_MESSAGES = Object.freeze({
  REGISTERED: "Registration successful. Please check your email to verify your account.",
  EMAIL_VERIFIED: "Email verified successfully. You can now sign in.",
  VERIFICATION_RESENT: "If the account exists and is unverified, a new verification email has been sent.",
  LOGIN_SUCCESS: "Signed in successfully",
  TOKEN_REFRESHED: "Session refreshed successfully",
  LOGOUT_SUCCESS: "Signed out successfully",
  LOGOUT_ALL_SUCCESS: "Signed out from all devices",
  FORGOT_PASSWORD_SENT: "If an account exists for that email, a password reset link has been sent.",
  PASSWORD_RESET_SUCCESS: "Password reset successfully. Please sign in with your new password.",
  PASSWORD_CHANGED: "Password changed successfully. Please sign in again.",
  PROFILE_FETCHED: "Profile fetched successfully",
  PROFILE_UPDATED: "Profile updated successfully",
  SESSIONS_FETCHED: "Active sessions fetched successfully",
  SESSION_REVOKED: "Session revoked successfully",
  PERMISSIONS_FETCHED: "Permission matrix fetched successfully",
});
