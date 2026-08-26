import env from "../../../config/env.js";
import { emailButton, emailLayout } from "../../../shared/mail/templates/layout.template.js";

export const verifyEmailTemplate = ({ name, verificationUrl, expiresInHours }) =>
  emailLayout({
    title: "Verify your email address",
    bodyHtml: `
      <p>Hello ${name},</p>
      <p>Thank you for registering with ${env.app.name}. Please confirm your email address to activate your account.</p>
      ${emailButton({ url: verificationUrl, label: "Verify Email" })}
      <p>This link expires in ${expiresInHours} hours.</p>
      <p style="font-size: 13px; color: #6b7280;">If you did not create an account, you can safely ignore this email.</p>
    `,
  });

export default verifyEmailTemplate;
