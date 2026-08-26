import { runWithRequestContext } from "../context/requestContext.js";
import { getRequestContext as describeRequest } from "../utils/request.util.js";

/**
 * Opens a context for the request and keeps it open until the response is done.
 *
 * Registered early - before the routers - so that everything a request touches,
 * including the error handler, can find out where the request came from without
 * being handed it explicitly.
 */
export const attachRequestContext = (req, res, next) => {
  const { userAgent, device, ipAddress } = describeRequest(req);

  runWithRequestContext(
    {
      ipAddress,
      userAgent,
      device,
      method: req.method,
      path: req.originalUrl,
      /** Filled in by `authenticate` once the token has been checked. */
      user: null,
    },
    next
  );
};

export default attachRequestContext;
