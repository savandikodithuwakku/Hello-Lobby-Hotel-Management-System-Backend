import env from "../../../config/env.js";
import { getRefreshTokenLifetimeMs } from "./token.util.js";

export const REFRESH_TOKEN_COOKIE_NAME = "refreshToken";

/**
 * Cookie flags shared by set and clear. They must match exactly or the browser
 * refuses to remove the cookie.
 *
 * - httpOnly: JavaScript (and therefore XSS) cannot read the refresh token.
 * - secure:   HTTPS only outside development.
 * - sameSite: "none" in production so the SPA on another domain can send it;
 *             "lax" locally where "none" would require HTTPS.
 */
const baseCookieOptions = () => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.isProduction ? "none" : "lax",
  domain: env.security.cookieDomain,
  path: "/",
});

export const setRefreshCookie = (res, token, { rememberMe = false } = {}) => {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, {
    ...baseCookieOptions(),
    // Without "remember me" the cookie is a session cookie: it dies with the browser.
    ...(rememberMe ? { maxAge: getRefreshTokenLifetimeMs(true) } : {}),
  });
};

export const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, baseCookieOptions());
};

export const readRefreshCookie = (req) => req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] || null;
