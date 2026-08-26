/**
 * SMTP diagnostic.
 *
 *   npm run mail:test -- you@example.com
 *
 * Verifies the SMTP credentials in .env, then sends one real message using the
 * same transport and templates the application uses. Run this before blaming
 * the auth flows: if this fails, no verification or reset email can arrive.
 */
import env from "../config/env.js";
import { getMailTransport, isMailConfigured } from "../config/mail.js";
import { sendEmail } from "../shared/mail/mailer.js";
import { emailButton, emailLayout } from "../shared/mail/templates/layout.template.js";
import { getFrontendBaseUrl } from "../config/app.config.js";

const recipient = process.argv[2] || env.mail.user;

const describeFailure = (error) => {
  const hints = {
    EAUTH:
      "Authentication was rejected. For Gmail you must use a 16-character App Password (2-Step Verification enabled), not your normal account password.",
    ECONNECTION: "Could not reach the SMTP host. Check SMTP_HOST/SMTP_PORT and your network or firewall.",
    ETIMEDOUT: "The connection timed out. Port 587 (STARTTLS) or 465 (SSL) may be blocked on your network.",
    ESOCKET: "TLS negotiation failed. Use port 587 for STARTTLS or 465 for implicit SSL.",
    EDNS: "The SMTP host name could not be resolved. Check SMTP_HOST for typos.",
  };

  return hints[error.code] || error.message;
};

const run = async () => {
  console.log(`Environment : ${env.nodeEnv}`);
  console.log(`SMTP host   : ${env.mail.host || "(empty)"}`);
  console.log(`SMTP port   : ${env.mail.port}`);
  console.log(`SMTP user   : ${env.mail.user || "(empty)"}`);
  console.log(`SMTP pass   : ${env.mail.pass ? `${env.mail.pass.length} characters` : "(empty)"}`);
  console.log(`From address: ${env.mail.from || "(falls back to SMTP_USER)"}`);
  console.log("");

  if (!isMailConfigured()) {
    console.error("SMTP is NOT configured: SMTP_HOST, SMTP_USER and SMTP_PASS must all be set.");
    console.error("Until then the application prints email links to the server console instead");
    console.error('of sending them - look for a line starting with "[DEV EMAIL] Link:".');
    process.exitCode = 1;
    return;
  }

  if (!recipient) {
    throw new Error("Pass a recipient: npm run mail:test -- you@example.com");
  }

  console.log("Verifying SMTP connection and credentials...");
  await getMailTransport().verify();
  console.log("SMTP connection OK.");

  console.log(`Sending a test message to ${recipient}...`);
  await sendEmail({
    to: recipient,
    subject: `${env.app.name} SMTP test`,
    html: emailLayout({
      title: "SMTP is working",
      bodyHtml: `
        <p>This test message was sent by <code>npm run mail:test</code>.</p>
        <p>Verification and password reset emails will now be delivered normally.</p>
        ${emailButton({ url: `${getFrontendBaseUrl()}/login`, label: "Open the app" })}
      `,
    }),
  });

  console.log("Sent. Check the inbox (and the spam folder).");
};

run().catch((error) => {
  console.error("\nSMTP test failed:", describeFailure(error));
  process.exitCode = 1;
});
