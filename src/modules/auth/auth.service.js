import mongoose from "mongoose";
import env from "../../config/env.js";
import ApiError from "../../shared/utils/ApiError.js";
import { hashToken } from "../../shared/utils/crypto.util.js";
import { sendEmailSafely } from "../../shared/mail/mailer.js";
import { getFrontendBaseUrl } from "../../config/app.config.js";
import {
  generateAccessToken,
  generateRefreshToken,
  getRefreshTokenLifetimeMs,
  verifyRefreshToken,
} from "./utils/token.util.js";
import User from "../user/user.model.js";
import Session, { SESSION_REVOKE_REASONS } from "./session.model.js";
import { LOGIN_BLOCKING_STATUSES, USER_ROLES, USER_STATUSES } from "../user/user.constants.js";
import { verifyEmailTemplate } from "./emails/verifyEmail.template.js";
import { welcomeEmailTemplate } from "./emails/welcomeEmail.template.js";
import { forgotPasswordTemplate } from "./emails/forgotPassword.template.js";
import { passwordChangedTemplate } from "./emails/passwordChanged.template.js";
import {
  AUTH_MESSAGES,
  EMAIL_VERIFICATION_TOKEN_EXPIRES_HOURS,
  PASSWORD_RESET_TOKEN_EXPIRES_MINUTES,
} from "./auth.constants.js";

const buildFrontendUrl = (path) => `${getFrontendBaseUrl()}${path}`;

const sendVerificationEmail = (user, verificationToken) =>
  sendEmailSafely({
    to: user.email,
    subject: `Verify your email address - ${env.app.name}`,
    html: verifyEmailTemplate({
      name: user.name,
      verificationUrl: buildFrontendUrl(`/verify-email/${verificationToken}`),
      expiresInHours: EMAIL_VERIFICATION_TOKEN_EXPIRES_HOURS,
    }),
  });

/**
 * Issues an access/refresh token pair and records the device as a session.
 *
 * The session id is generated up-front so it can be embedded in the refresh
 * token, and only the token's digest is stored - a leaked database row cannot
 * be turned back into a usable refresh token.
 */
const issueSession = async (user, { device, userAgent, ipAddress }, rememberMe = false) => {
  const sessionId = new mongoose.Types.ObjectId();

  const refreshToken = generateRefreshToken({ userId: user._id, sessionId, rememberMe });

  await Session.create({
    _id: sessionId,
    user: user._id,
    refreshTokenHash: hashToken(refreshToken),
    device,
    userAgent,
    ipAddress,
    rememberMe,
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + getRefreshTokenLifetimeMs(rememberMe)),
  });

  return {
    accessToken: generateAccessToken({ userId: user._id, role: user.role }),
    refreshToken,
    rememberMe,
    user: user.toSafeObject(),
  };
};

export const registerUser = async ({ name, email, password, phone }) => {
  if (await User.exists({ email })) {
    throw new ApiError(409, "An account with this email already exists");
  }

  const user = new User({
    name,
    email,
    password,
    phone: phone || null,
    // Self-registration always produces a customer; roles are assigned by admins.
    role: USER_ROLES.CUSTOMER,
    status: USER_STATUSES.PENDING_VERIFICATION,
  });

  const verificationToken = user.createEmailVerificationToken();
  await user.save();

  await sendVerificationEmail(user, verificationToken);

  return user.toSafeObject();
};

export const verifyEmail = async (token) => {
  const user = await User.findOne({
    emailVerificationToken: hashToken(token),
    emailVerificationExpires: { $gt: new Date() },
  }).select("+emailVerificationToken +emailVerificationExpires");

  if (!user) {
    throw new ApiError(400, "This verification link is invalid or has expired");
  }

  user.emailVerified = true;
  user.status = USER_STATUSES.ACTIVE;
  user.clearEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  await sendEmailSafely({
    to: user.email,
    subject: `Welcome to ${env.app.name}`,
    html: welcomeEmailTemplate({ name: user.name }),
  });

  return user.toSafeObject();
};

export const resendVerificationEmail = async ({ email }) => {
  const user = await User.findOne({ email });

  // Always report the same result so the endpoint cannot be used to discover
  // which email addresses are registered.
  if (!user || user.emailVerified) {
    return { message: AUTH_MESSAGES.VERIFICATION_RESENT };
  }

  const verificationToken = user.createEmailVerificationToken();
  await user.save({ validateBeforeSave: false });
  await sendVerificationEmail(user, verificationToken);

  return { message: AUTH_MESSAGES.VERIFICATION_RESENT };
};

export const loginUser = async ({ email, password, rememberMe = false }, context) => {
  const user = await User.findOne({ email }).select("+password +failedLoginAttempts +lockedUntil");

  // Generic message on purpose: never reveal whether the email exists.
  const invalidCredentials = new ApiError(401, "Invalid email or password");

  if (!user) {
    throw invalidCredentials;
  }

  if (user.isLocked) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw new ApiError(423, `Account temporarily locked. Try again in ${minutesLeft} minute(s).`);
  }

  if (!(await user.comparePassword(password))) {
    const locked = await user.registerFailedLogin();
    if (locked) {
      throw new ApiError(
        423,
        `Too many failed attempts. Account locked for ${env.security.accountLockMinutes} minutes.`
      );
    }
    throw invalidCredentials;
  }

  if (user.status === USER_STATUSES.PENDING_VERIFICATION) {
    throw new ApiError(403, "Please verify your email address before signing in");
  }

  if (LOGIN_BLOCKING_STATUSES.includes(user.status)) {
    throw new ApiError(403, "This account has been disabled. Please contact support.");
  }

  await user.resetLoginAttempts();
  user.lastLoginAt = new Date();
  user.lastLoginIp = context.ipAddress;
  await user.save({ validateBeforeSave: false });

  return issueSession(user, context, rememberMe);
};

/**
 * Rotates a refresh token: the presented session is retired and a brand new one
 * is issued. Presenting an already-rotated token means the token was stolen, so
 * every session for that user is destroyed.
 */
export const refreshSession = async (refreshToken, context) => {
  if (!refreshToken) {
    throw new ApiError(401, "Refresh token is missing");
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const session = await Session.findOne({
    _id: decoded.sessionId,
    user: decoded.sub,
  }).select("+refreshTokenHash");

  if (!session) {
    throw new ApiError(401, "Session not found. Please sign in again.");
  }

  if (session.refreshTokenHash !== hashToken(refreshToken)) {
    throw new ApiError(401, "Invalid refresh token");
  }

  if (session.revokedAt) {
    await Session.updateMany(
      { user: decoded.sub, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: SESSION_REVOKE_REASONS.REUSE_DETECTED } }
    );
    throw new ApiError(
      401,
      "This session was already used. For your security all sessions have been signed out."
    );
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(401, "Session has expired. Please sign in again.");
  }

  const user = await User.findById(decoded.sub);

  if (!user) {
    throw new ApiError(401, "The account for this session no longer exists");
  }

  if (user.status !== USER_STATUSES.ACTIVE) {
    throw new ApiError(403, "This account is not active");
  }

  session.revokedAt = new Date();
  session.revokedReason = SESSION_REVOKE_REASONS.ROTATED;
  await session.save();

  return issueSession(user, context, session.rememberMe);
};

export const logoutUser = async (refreshToken) => {
  if (!refreshToken) return;

  try {
    const decoded = verifyRefreshToken(refreshToken);
    await Session.updateOne(
      { _id: decoded.sessionId, user: decoded.sub, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: SESSION_REVOKE_REASONS.LOGOUT } }
    );
  } catch {
    // A malformed or expired token still results in a successful logout:
    // the client cookie is cleared either way.
  }
};

export const revokeAllSessions = async (
  userId,
  { exceptSessionId = null, reason = SESSION_REVOKE_REASONS.REVOKED_BY_USER } = {}
) => {
  const filter = { user: userId, revokedAt: null };
  if (exceptSessionId) {
    filter._id = { $ne: exceptSessionId };
  }

  const result = await Session.updateMany(filter, {
    $set: { revokedAt: new Date(), revokedReason: reason },
  });

  return { revokedCount: result.modifiedCount };
};

export const listSessions = async (userId, currentSessionId = null) => {
  const sessions = await Session.find({
    user: userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ lastUsedAt: -1 });

  return sessions.map((session) => session.toSafeObject(currentSessionId));
};

export const revokeSession = async (userId, sessionId) => {
  const session = await Session.findOne({ _id: sessionId, user: userId });

  if (!session) {
    throw new ApiError(404, "Session not found");
  }

  if (session.revokedAt) {
    return { alreadyRevoked: true };
  }

  session.revokedAt = new Date();
  session.revokedReason = SESSION_REVOKE_REASONS.REVOKED_BY_USER;
  await session.save();

  return { alreadyRevoked: false };
};

export const forgotPassword = async ({ email }) => {
  const user = await User.findOne({ email });

  // Constant response prevents account enumeration.
  if (!user || LOGIN_BLOCKING_STATUSES.includes(user.status)) {
    return { message: AUTH_MESSAGES.FORGOT_PASSWORD_SENT };
  }

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const result = await sendEmailSafely({
    to: user.email,
    subject: `Reset your ${env.app.name} password`,
    html: forgotPasswordTemplate({
      name: user.name,
      resetUrl: buildFrontendUrl(`/reset-password/${resetToken}`),
      expiresInMinutes: PASSWORD_RESET_TOKEN_EXPIRES_MINUTES,
    }),
  });

  // Do not leave an unusable token behind if delivery failed outright.
  if (result.delivered === false && result.reason !== "smtp_not_configured") {
    user.clearPasswordResetToken();
    await user.save({ validateBeforeSave: false });
  }

  return { message: AUTH_MESSAGES.FORGOT_PASSWORD_SENT };
};

export const resetPassword = async ({ token, password }) => {
  const user = await User.findOne({
    passwordResetToken: hashToken(token),
    passwordResetExpires: { $gt: new Date() },
  }).select("+passwordResetToken +passwordResetExpires +password");

  if (!user) {
    throw new ApiError(400, "This password reset link is invalid or has expired");
  }

  if (await user.comparePassword(password)) {
    throw new ApiError(400, "Your new password must be different from the current one");
  }

  user.password = password;
  user.clearPasswordResetToken();
  // A completed reset also proves ownership of the mailbox.
  if (!user.emailVerified) {
    user.emailVerified = true;
    user.status = USER_STATUSES.ACTIVE;
    user.clearEmailVerificationToken();
  }
  await user.save();
  await user.resetLoginAttempts();

  await revokeAllSessions(user._id, { reason: SESSION_REVOKE_REASONS.PASSWORD_CHANGED });

  await sendEmailSafely({
    to: user.email,
    subject: `Your ${env.app.name} password was changed`,
    html: passwordChangedTemplate({ name: user.name }),
  });

  return user.toSafeObject();
};

export const changePassword = async ({ userId, currentPassword, newPassword }) => {
  const user = await User.findById(userId).select("+password");

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  if (!(await user.comparePassword(currentPassword))) {
    throw new ApiError(401, "Your current password is incorrect");
  }

  if (await user.comparePassword(newPassword)) {
    throw new ApiError(400, "Your new password must be different from the current one");
  }

  user.password = newPassword;
  await user.save();

  await revokeAllSessions(user._id, { reason: SESSION_REVOKE_REASONS.PASSWORD_CHANGED });

  await sendEmailSafely({
    to: user.email,
    subject: `Your ${env.app.name} password was changed`,
    html: passwordChangedTemplate({ name: user.name }),
  });

  return user.toSafeObject();
};

export const getProfile = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  return user.toSafeObject();
};

export const updateProfile = async (userId, { name, phone, avatar }) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (avatar !== undefined) user.avatar = avatar;

  await user.save();
  return user.toSafeObject();
};
