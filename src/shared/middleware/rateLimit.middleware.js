import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import ApiError from "../utils/ApiError.js";
import env from "../../config/env.js";

const MINUTE = 60 * 1000;

/**
 * Factory so every limiter reports failures through the standard error shape
 * instead of express-rate-limit's default plain-text body.
 */
const createLimiter = ({ windowMs, limit, message, keyGenerator }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Rate limiting would make local development painful and tests flaky.
    skip: () => env.isTest,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res, next) => next(new ApiError(429, message)),
  });

/**
 * Credential endpoints are limited per IP *and* per submitted email, so a
 * distributed attack cannot spread attempts against one account across many IPs.
 */
const emailAwareKey = (req) => {
  // ipKeyGenerator normalises IPv6 addresses to their /56 subnet, so a single
  // client cannot bypass the limit by rotating through its address range.
  const ipKey = ipKeyGenerator(req.ip || "");
  const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "";
  return email ? `${ipKey}:${email}` : ipKey;
};

export const loginRateLimiter = createLimiter({
  windowMs: 15 * MINUTE,
  limit: 10,
  keyGenerator: emailAwareKey,
  message: "Too many sign-in attempts. Please try again in 15 minutes.",
});

export const registerRateLimiter = createLimiter({
  windowMs: 60 * MINUTE,
  limit: 10,
  message: "Too many accounts created from this address. Please try again later.",
});

export const passwordResetRateLimiter = createLimiter({
  windowMs: 60 * MINUTE,
  limit: 5,
  keyGenerator: emailAwareKey,
  message: "Too many password reset requests. Please try again in an hour.",
});

export const emailVerificationRateLimiter = createLimiter({
  windowMs: 60 * MINUTE,
  limit: 5,
  keyGenerator: emailAwareKey,
  message: "Too many verification emails requested. Please try again in an hour.",
});

export const refreshRateLimiter = createLimiter({
  windowMs: 15 * MINUTE,
  limit: 60,
  message: "Too many token refresh attempts. Please try again shortly.",
});

/** Broad safety net applied to the whole API. */
export const globalRateLimiter = createLimiter({
  windowMs: 15 * MINUTE,
  limit: 600,
  message: "Too many requests. Please slow down.",
});
