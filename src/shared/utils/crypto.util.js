import crypto from "crypto";

export const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * Signs a message with a shared secret.
 *
 * Payment gateways prove a callback really came from them by sending a
 * signature alongside it. This produces the same kind of signature, so the
 * built-in payment simulator behaves like the real thing.
 */
export const signMessage = (message, secret) =>
  crypto.createHmac("sha256", String(secret)).update(String(message)).digest("hex");

/**
 * Compares two signatures without leaking, through how long the comparison
 * takes, how much of a guess was correct. A plain `===` on a secret can be
 * attacked one character at a time; this cannot.
 */
export const signaturesMatch = (a, b) => {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");

  if (left.length !== right.length) return false;

  return crypto.timingSafeEqual(left, right);
};
