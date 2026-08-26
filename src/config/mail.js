import nodemailer from "nodemailer";
import env from "./env.js";

let cachedTransport = null;

export const isMailConfigured = () => Boolean(env.mail.host && env.mail.user && env.mail.pass);

/**
 * Returns a memoised SMTP transport, or `null` when SMTP is not configured
 * (development convenience: links are logged to the console instead).
 */
export const getMailTransport = () => {
  if (!isMailConfigured()) {
    return null;
  }

  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.port === 465,
      auth: {
        user: env.mail.user,
        pass: env.mail.pass,
      },
    });
  }

  return cachedTransport;
};

export default getMailTransport;
