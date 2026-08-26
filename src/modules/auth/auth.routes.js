import { Router } from "express";
import { authenticate } from "./auth.middleware.js";
import { validateRequest } from "../../shared/middleware/validate.middleware.js";
import {
  emailVerificationRateLimiter,
  loginRateLimiter,
  passwordResetRateLimiter,
  refreshRateLimiter,
  registerRateLimiter,
} from "../../shared/middleware/rateLimit.middleware.js";
import * as authController from "./auth.controller.js";
import {
  changePasswordValidation,
  emailOnlyValidation,
  loginValidation,
  registerValidation,
  resetPasswordValidation,
  sessionIdValidation,
  updateProfileValidation,
  verifyEmailValidation,
} from "./auth.validation.js";

const router = Router();

/* ------------------------------ Public routes ----------------------------- */

router.post("/register", registerRateLimiter, registerValidation, validateRequest, authController.register);
router.post("/login", loginRateLimiter, loginValidation, validateRequest, authController.login);

// Rotates the refresh cookie; authentication comes from the cookie itself.
router.post("/refresh", refreshRateLimiter, authController.refresh);

// Deliberately unauthenticated so an expired access token can still sign out.
router.post("/logout", authController.logout);

router.post(
  "/verify-email/:token",
  emailVerificationRateLimiter,
  verifyEmailValidation,
  validateRequest,
  authController.verifyEmail
);
router.post(
  "/resend-verification",
  emailVerificationRateLimiter,
  emailOnlyValidation,
  validateRequest,
  authController.resendVerificationEmail
);
router.post(
  "/forgot-password",
  passwordResetRateLimiter,
  emailOnlyValidation,
  validateRequest,
  authController.forgotPassword
);
router.post(
  "/reset-password/:token",
  passwordResetRateLimiter,
  resetPasswordValidation,
  validateRequest,
  authController.resetPassword
);

/* ---------------------------- Protected routes ---------------------------- */

router.use(authenticate);

router.get("/me", authController.getMe);
router.patch("/me", updateProfileValidation, validateRequest, authController.updateMe);
router.patch(
  "/change-password",
  changePasswordValidation,
  validateRequest,
  authController.changePassword
);
router.post("/logout-all", authController.logoutAllDevices);
router.get("/sessions", authController.getMySessions);
router.delete(
  "/sessions/:sessionId",
  sessionIdValidation,
  validateRequest,
  authController.revokeMySession
);
router.get("/permissions", authController.getPermissionMatrix);

export default router;
