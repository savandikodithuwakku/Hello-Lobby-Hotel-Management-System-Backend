import env from "./env.js";

export const API_PREFIX = env.app.apiPrefix;
export const APP_NAME = env.app.name;

export const getAllowedOrigins = () => env.cors.allowedOrigins;

/**
 * Base URL used to build email links (verification, password reset).
 */
export const getFrontendBaseUrl = () => getAllowedOrigins()[0];
