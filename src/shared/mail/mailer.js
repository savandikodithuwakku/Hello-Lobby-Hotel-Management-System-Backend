import env from "../../config/env.js";
import { getMailTransport } from "../../config/mail.js";

/**
 * Sends a transactional email.
 *
 * In development without SMTP credentials the message is not silently dropped:
 * the action link is printed to the server console so registration, email
 * verification and password reset stay testable end to end. In production a
 * missing transport is a hard error.
 */
export const sendEmail = async ({ to, subject, html, text }) => {
  const transport = getMailTransport();

  if (!transport) {
    if (env.isProduction) {
      throw new Error("SMTP is not configured; cannot send transactional email");
    }

    const link = html?.match(/href="([^"]+)"/)?.[1];
    console.warn(`\n[DEV EMAIL] To: ${to}\n[DEV EMAIL] Subject: ${subject}`);
    if (link) console.warn(`[DEV EMAIL] Link: ${link}\n`);
    return { delivered: false, reason: "smtp_not_configured" };
  }

  await transport.sendMail({
    from: env.mail.from || `${env.app.name} <${env.mail.user}>`,
    to,
    subject,
    html,
    text,
  });

  return { delivered: true };
};

/**
 * Email delivery must never break the surrounding business transaction
 * (a verification email failing should not roll back a registration).
 */
export const sendEmailSafely = async (payload) => {
  try {
    return await sendEmail(payload);
  } catch (error) {
    console.error(`Failed to send email "${payload.subject}" to ${payload.to}:`, error.message);
    return { delivered: false, reason: error.message };
  }
};
