import jwt from "jsonwebtoken";
import env from "../../../config/env.js";

export const TOKEN_TYPES = Object.freeze({
  ACCESS: "access",
  REFRESH: "refresh",
});

const sign = (payload, secret, expiresIn) =>
  jwt.sign(payload, secret, {
    expiresIn,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });

const verify = (token, secret, expectedType) => {
  const decoded = jwt.verify(token, secret, {
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });

  // Stops an access token from ever being replayed as a refresh token.
  if (decoded.type !== expectedType) {
    const error = new Error("Invalid token type");
    error.name = "JsonWebTokenError";
    throw error;
  }

  return decoded;
};

export const generateAccessToken = ({ userId, role }) =>
  sign({ sub: String(userId), role, type: TOKEN_TYPES.ACCESS }, env.jwt.accessSecret, env.jwt.accessExpiresIn);

export const generateRefreshToken = ({ userId, sessionId, rememberMe = false }) =>
  sign(
    { sub: String(userId), sessionId: String(sessionId), type: TOKEN_TYPES.REFRESH },
    env.jwt.refreshSecret,
    rememberMe ? env.jwt.refreshRememberMeExpiresIn : env.jwt.refreshExpiresIn
  );

export const verifyAccessToken = (token) => verify(token, env.jwt.accessSecret, TOKEN_TYPES.ACCESS);

export const verifyRefreshToken = (token) => verify(token, env.jwt.refreshSecret, TOKEN_TYPES.REFRESH);

/**
 * Converts a JWT-style duration ("15m", "7d", "3600") into milliseconds so the
 * session document and the cookie expire at exactly the same moment as the JWT.
 */
export const durationToMilliseconds = (duration) => {
  if (typeof duration === "number") return duration * 1000;

  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(String(duration).trim());
  if (!match) {
    throw new Error(`Unsupported duration format: ${duration}`);
  }

  const value = Number(match[1]);
  const unitMultipliers = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * unitMultipliers[match[2] || "s"];
};

export const getRefreshTokenLifetimeMs = (rememberMe = false) =>
  durationToMilliseconds(rememberMe ? env.jwt.refreshRememberMeExpiresIn : env.jwt.refreshExpiresIn);
