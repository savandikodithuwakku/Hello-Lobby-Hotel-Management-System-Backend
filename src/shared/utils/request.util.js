const BROWSERS = [
  [/edg/i, "Edge"],
  [/opr|opera/i, "Opera"],
  [/chrome|crios/i, "Chrome"],
  [/firefox|fxios/i, "Firefox"],
  [/safari/i, "Safari"],
  [/postman/i, "Postman"],
];

const PLATFORMS = [
  [/windows/i, "Windows"],
  [/android/i, "Android"],
  [/iphone|ipad|ipod/i, "iOS"],
  [/mac os/i, "macOS"],
  [/linux/i, "Linux"],
];

const match = (candidates, value) => {
  const found = candidates.find(([pattern]) => pattern.test(value));
  return found ? found[1] : null;
};

/**
 * Produces a short, human-readable device label ("Chrome on Windows") for the
 * active-sessions screen. Deliberately dependency-free and best-effort.
 */
export const describeDevice = (userAgent) => {
  if (!userAgent) return "Unknown device";

  const browser = match(BROWSERS, userAgent);
  const platform = match(PLATFORMS, userAgent);

  if (browser && platform) return `${browser} on ${platform}`;
  return browser || platform || "Unknown device";
};

/** Everything the auth layer needs to know about where a request came from. */
export const getRequestContext = (req) => {
  const userAgent = req.get("user-agent") || null;

  return {
    userAgent,
    device: describeDevice(userAgent),
    ipAddress: req.ip || null,
  };
};
