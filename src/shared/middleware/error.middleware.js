import env from "../../config/env.js";
import ApiError from "../utils/ApiError.js";

/**
 * Translates any thrown error into the single response envelope used by the
 * whole API: { success, message, errors }.
 *
 * Unexpected (non-operational) errors are logged in full but reported to the
 * client as a generic message in production, so internals never leak.
 */
const normaliseError = (err) => {
  if (err instanceof ApiError) {
    return err;
  }

  if (err.name === "ValidationError" && err.errors) {
    return new ApiError(
      422,
      "Validation failed",
      Object.values(err.errors).map((error) => ({ field: error.path, message: error.message }))
    );
  }

  if (err.name === "CastError") {
    return new ApiError(400, `Invalid value for ${err.path}`);
  }

  if (err.code === 11000) {
    return new ApiError(
      409,
      "A record with this value already exists",
      Object.keys(err.keyValue || {}).map((field) => ({
        field,
        message: `${field} is already in use`,
      }))
    );
  }

  if (err.name === "JsonWebTokenError") {
    return new ApiError(401, "Invalid authentication token");
  }

  if (err.name === "TokenExpiredError") {
    return new ApiError(401, "Authentication token has expired");
  }

  if (err.message === "Origin is not allowed by CORS") {
    return new ApiError(403, "Origin is not allowed by CORS");
  }

  return new ApiError(err.statusCode || 500, err.message || "Internal server error");
};

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export const errorHandler = (err, req, res, next) => {
  const error = normaliseError(err);

  if (error.statusCode >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
  }

  res.status(error.statusCode).json({
    success: false,
    message:
      error.statusCode >= 500 && env.isProduction ? "Internal server error" : error.message,
    errors: error.errors,
    ...(env.isProduction ? {} : { stack: err.stack }),
  });
};

export default errorHandler;
