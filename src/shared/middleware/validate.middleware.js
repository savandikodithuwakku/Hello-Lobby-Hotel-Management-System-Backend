import { matchedData, validationResult } from "express-validator";
import ApiError from "../utils/ApiError.js";

/**
 * Turns express-validator output into the standard error envelope, and hands
 * the controller the sanitised input.
 *
 * Only the first failure per field is reported: a single input that breaks
 * several rules should produce one actionable message, not a list.
 *
 * `req.validatedQuery` exists because of an Express 5 change: `req.query` is a
 * read-only getter that re-parses the URL, so sanitisers like `toInt`,
 * `toBoolean` and `toDate` cannot write back to it and a controller reading
 * `req.query` would still see raw strings. `req.body` and `req.params` are
 * ordinary properties and are sanitised in place as usual. Any handler whose
 * query parameters are typed must therefore read `req.validatedQuery`.
 */
export const validateRequest = (req, res, next) => {
  const result = validationResult(req);

  if (!result.isEmpty()) {
    const seenFields = new Set();
    const errors = [];

    result.array().forEach((error) => {
      const field = error.path || error.param || "unknown";
      if (seenFields.has(field)) return;

      seenFields.add(field);
      errors.push({ field, message: error.msg });
    });

    return next(new ApiError(422, "Validation failed", errors));
  }

  // Only fields with a validation rule survive, so an unexpected query
  // parameter can never reach a database query.
  req.validatedQuery = matchedData(req, { locations: ["query"] });

  return next();
};

export default validateRequest;
