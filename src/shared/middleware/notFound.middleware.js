import ApiError from "../utils/ApiError.js";

export const notFoundHandler = (req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
};
