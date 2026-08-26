import { sendCreated, sendOk } from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import { getRequestContext } from "../../shared/utils/request.util.js";
import { verifyRefreshToken } from "./utils/token.util.js";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "./utils/cookie.util.js";
import { ROLE_PERMISSIONS } from "./rbac/roles.js";
import { PERMISSIONS } from "./rbac/permissions.js";
import { AUTH_MESSAGES } from "./auth.constants.js";
import * as authService from "./auth.service.js";

/** Best-effort read of the session id behind the current refresh cookie. */
const getCurrentSessionId = (req) => {
  const token = readRefreshCookie(req);
  if (!token) return null;

  try {
    return verifyRefreshToken(token).sessionId;
  } catch {
    return null;
  }
};

const sendSession = (res, result, message) => {
  setRefreshCookie(res, result.refreshToken, { rememberMe: result.rememberMe });

  // The refresh token itself is never exposed to JavaScript: it only travels
  // in the HTTP-only cookie set above.
  return sendOk(res, message, { accessToken: result.accessToken, user: result.user });
};

export const register = asyncHandler(async (req, res) => {
  const user = await authService.registerUser(req.body);
  sendCreated(res, AUTH_MESSAGES.REGISTERED, { user });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const user = await authService.verifyEmail(req.params.token);
  sendOk(res, AUTH_MESSAGES.EMAIL_VERIFIED, { user });
});

export const resendVerificationEmail = asyncHandler(async (req, res) => {
  const result = await authService.resendVerificationEmail(req.body);
  sendOk(res, result.message);
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.loginUser(req.body, getRequestContext(req));
  sendSession(res, result, AUTH_MESSAGES.LOGIN_SUCCESS);
});

export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refreshSession(readRefreshCookie(req), getRequestContext(req));
  sendSession(res, result, AUTH_MESSAGES.TOKEN_REFRESHED);
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logoutUser(readRefreshCookie(req));
  clearRefreshCookie(res);
  sendOk(res, AUTH_MESSAGES.LOGOUT_SUCCESS);
});

export const logoutAllDevices = asyncHandler(async (req, res) => {
  const result = await authService.revokeAllSessions(req.user._id);
  clearRefreshCookie(res);
  sendOk(res, AUTH_MESSAGES.LOGOUT_ALL_SUCCESS, result);
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPassword(req.body);
  sendOk(res, result.message);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const user = await authService.resetPassword({
    token: req.params.token,
    password: req.body.password,
  });

  clearRefreshCookie(res);
  sendOk(res, AUTH_MESSAGES.PASSWORD_RESET_SUCCESS, { user });
});

export const changePassword = asyncHandler(async (req, res) => {
  const user = await authService.changePassword({
    userId: req.user._id,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
  });

  clearRefreshCookie(res);
  sendOk(res, AUTH_MESSAGES.PASSWORD_CHANGED, { user });
});

export const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user._id);
  sendOk(res, AUTH_MESSAGES.PROFILE_FETCHED, { user });
});

export const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user._id, req.body);
  sendOk(res, AUTH_MESSAGES.PROFILE_UPDATED, { user });
});

export const getMySessions = asyncHandler(async (req, res) => {
  const sessions = await authService.listSessions(req.user._id, getCurrentSessionId(req));
  sendOk(res, AUTH_MESSAGES.SESSIONS_FETCHED, { sessions });
});

export const revokeMySession = asyncHandler(async (req, res) => {
  await authService.revokeSession(req.user._id, req.params.sessionId);

  // Revoking the session you are currently using is an explicit sign-out.
  if (String(getCurrentSessionId(req)) === req.params.sessionId) {
    clearRefreshCookie(res);
  }

  sendOk(res, AUTH_MESSAGES.SESSION_REVOKED);
});

/** Exposes the role/permission matrix so the UI can hide unavailable actions. */
export const getPermissionMatrix = asyncHandler(async (req, res) => {
  sendOk(res, AUTH_MESSAGES.PERMISSIONS_FETCHED, {
    permissions: Object.values(PERMISSIONS),
    roles: ROLE_PERMISSIONS,
  });
});
