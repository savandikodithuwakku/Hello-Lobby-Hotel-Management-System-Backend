/**
 * The single success envelope for the whole API: { statusCode, success,
 * message, data }. The error middleware produces the matching failure shape.
 */
class ApiResponse {
  constructor(statusCode, message, data = null) {
    this.statusCode = statusCode;
    this.success = statusCode < 400;
    this.message = message;
    this.data = data;
  }
}

/**
 * Sends a success response.
 *
 * Controllers used to write `res.status(200).json(new ApiResponse(200, ...))`,
 * which states the status code twice and lets the two drift apart. These
 * helpers state it once.
 */
export const sendResponse = (res, statusCode, message, data = null) =>
  res.status(statusCode).json(new ApiResponse(statusCode, message, data));

/** 200 - the request succeeded. */
export const sendOk = (res, message, data = null) => sendResponse(res, 200, message, data);

/** 201 - a new record was created. */
export const sendCreated = (res, message, data = null) => sendResponse(res, 201, message, data);

export default ApiResponse;
