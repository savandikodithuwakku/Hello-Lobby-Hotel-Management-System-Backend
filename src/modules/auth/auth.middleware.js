import ApiError from "../../shared/utils/ApiError.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import { updateRequestContext } from "../../shared/context/requestContext.js";
import { verifyAccessToken } from "./utils/token.util.js";
import User from "../user/user.model.js";
import { LOGIN_BLOCKING_STATUSES, USER_STATUSES } from "../user/user.constants.js";

const extractBearerToken = (req) => {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
};

const loadAuthenticatedUser = async (token) => {
  const decoded = verifyAccessToken(token);
  const user = await User.findById(decoded.sub);

  if (!user) {
    throw new ApiError(401, "The account for this token no longer exists");
  }

  if (LOGIN_BLOCKING_STATUSES.includes(user.status)) {
    throw new ApiError(403, "This account has been disabled. Please contact support.");
  }

  if (user.status === USER_STATUSES.PENDING_VERIFICATION) {
    throw new ApiError(403, "Please verify your email address to continue");
  }

  // A password change invalidates every access token issued before it.
  if (user.hasPasswordChangedAfter(decoded.iat)) {
    throw new ApiError(401, "Password was changed recently. Please sign in again.");
  }

  return user;
};

/** Rejects the request unless a valid access token is presented. */
export const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req);

  if (!token) {
    throw new ApiError(401, "Authentication token is required");
  }

  req.user = await loadAuthenticatedUser(token);
  // The audit log records who did something without every service having to be
  // handed the request, so the account goes into the request context here - the
  // first point at which the token has actually been checked.
  updateRequestContext({ user: req.user });
  next();
});

/**
 * Attaches `req.user` when a valid token is present but never rejects.
 * Useful for endpoints that return richer data to signed-in visitors.
 */
export const optionalAuthenticate = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req);

  if (token) {
    try {
      req.user = await loadAuthenticatedUser(token);
      updateRequestContext({ user: req.user });
    } catch {
      req.user = undefined;
    }
  }

  next();
});
