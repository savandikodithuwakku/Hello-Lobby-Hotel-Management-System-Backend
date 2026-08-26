import dotenv from "dotenv";

dotenv.config();

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toList = (value, fallback = []) => {
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

/**
 * Central, validated application configuration.
 *
 * Every module reads configuration from here instead of touching
 * `process.env` directly, so the auth module can be dropped into another
 * project by supplying a single `.env` file.
 */
export const env = Object.freeze({
  nodeEnv: NODE_ENV,
  isProduction,
  isDevelopment: NODE_ENV === "development",
  isTest: NODE_ENV === "test",

  app: {
    name: process.env.APP_NAME || "HelloLobby",
    port: toNumber(process.env.PORT, 5000),
    apiPrefix: process.env.API_PREFIX || "/api/v1",
    supportEmail: process.env.SUPPORT_EMAIL || "support@hellolobby.local",
  },

  db: {
    uri: process.env.MONGO_URI || "",
  },

  cors: {
    allowedOrigins: toList(process.env.FRONTEND_URL, ["http://localhost:5173"]),
  },

  jwt: {
    accessSecret: process.env.JWT_SECRET || "",
    refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "",
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "1d",
    // Used when the client ticked "remember me" on the login form.
    refreshRememberMeExpiresIn: process.env.JWT_REFRESH_REMEMBER_ME_EXPIRES_IN || "30d",
    issuer: process.env.JWT_ISSUER || "hellolobby-api",
    audience: process.env.JWT_AUDIENCE || "hellolobby-client",
  },

  security: {
    bcryptSaltRounds: toNumber(process.env.BCRYPT_SALT_ROUNDS, 12),
    maxFailedLoginAttempts: toNumber(process.env.MAX_FAILED_LOGIN_ATTEMPTS, 5),
    accountLockMinutes: toNumber(process.env.ACCOUNT_LOCK_MINUTES, 15),
    passwordResetTokenMinutes: toNumber(process.env.PASSWORD_RESET_TOKEN_MINUTES, 15),
    emailVerificationTokenHours: toNumber(process.env.EMAIL_VERIFICATION_TOKEN_HOURS, 24),
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  },

  mail: {
    host: process.env.SMTP_HOST || "",
    port: toNumber(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  },

  seed: {
    superAdminName: process.env.SEED_SUPER_ADMIN_NAME || "Super Admin",
    superAdminEmail: process.env.SEED_SUPER_ADMIN_EMAIL || "",
    superAdminPassword: process.env.SEED_SUPER_ADMIN_PASSWORD || "",
  },
});

const REQUIRED_ALWAYS = [
  ["MONGO_URI", env.db.uri],
  ["JWT_SECRET", env.jwt.accessSecret],
];

const REQUIRED_IN_PRODUCTION = [
  ["JWT_REFRESH_SECRET", process.env.JWT_REFRESH_SECRET],
  ["FRONTEND_URL", process.env.FRONTEND_URL],
  ["SMTP_HOST", env.mail.host],
  ["SMTP_USER", env.mail.user],
  ["SMTP_PASS", env.mail.pass],
];

/**
 * Fails fast at boot instead of surfacing confusing runtime errors later.
 */
export const assertEnvIsValid = () => {
  const missing = REQUIRED_ALWAYS.filter(([, value]) => !value).map(([key]) => key);

  if (env.isProduction) {
    missing.push(...REQUIRED_IN_PRODUCTION.filter(([, value]) => !value).map(([key]) => key));
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (env.isProduction && env.jwt.accessSecret === env.jwt.refreshSecret) {
    throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must be different values");
  }

  if (env.isProduction && env.jwt.accessSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long in production");
  }
};

export default env;
