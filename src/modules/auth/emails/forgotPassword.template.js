import env from "../../../config/env.js";
import { emailButton, emailLayout } from "../../../shared/mail/templates/layout.template.js";

export const forgotPasswordTemplate = ({ name, resetUrl, expiresInMinutes }) =>
  emailLayout({
    title: "Reset your password",
    bodyHtml: `
      <p>Hello ${name},</p>
      <p>We received a request to reset the password for your ${env.app.name} account.</p>
      ${emailButton({ url: resetUrl, label: "Reset Password" })}
      <p>This link expires in ${expiresInMinutes} minutes and can only be used once.</p>
      <p style="font-size: 13px; color: #6b7280;">If you did not request a password reset, no action is needed - your current password remains active.</p>
    `,
  });

export default forgotPasswordTemplate;
