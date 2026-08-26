import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import env from "./config/env.js";
import { API_PREFIX, getAllowedOrigins } from "./config/app.config.js";
import modulesRouter from "./modules/index.js";
import { globalRateLimiter } from "./shared/middleware/rateLimit.middleware.js";
import { attachRequestContext } from "./shared/middleware/requestContext.middleware.js";
import { notFoundHandler } from "./shared/middleware/notFound.middleware.js";
import { errorHandler } from "./shared/middleware/error.middleware.js";

const app = express();

// Required for correct client IPs (rate limiting, session records) behind a
// reverse proxy such as Nginx, Render or Heroku.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet());

const allowedOrigins = getAllowedOrigins();

app.use(
  cors({
    origin(origin, callback) {
      // Requests without an Origin header (server-to-server, curl, health
      // checks) are allowed; browsers must match the configured list.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin is not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());

// Opens the per-request context (address, device, and later the signed-in
// account) that the audit log reads. Registered before the routers so every
// handler below it can be recorded with where the request came from.
app.use(attachRequestContext);

if (!env.isProduction) {
  app.use(morgan("dev"));
}

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: `${env.app.name} API is running`,
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

app.use(API_PREFIX, globalRateLimiter, modulesRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
