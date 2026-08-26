import env from "../../../config/env.js";
import { emailLayout } from "../../../shared/mail/templates/layout.template.js";

export const passwordChangedTemplate = ({ name, changedAt = new Date() }) =>
  emailLayout({
    title: "Your password was changed",
    bodyHtml: `
      <p>Hello ${name},</p>
      <p>The password for your ${env.app.name} account was changed on ${changedAt.toUTCString()}.</p>
      <p>For your security, every active session on all devices has been signed out.</p>
      <p style="font-size: 13px; color: #6b7280;">If you did not make this change, contact <a href="mailto:${env.app.supportEmail}" style="color: #2563eb;">${env.app.supportEmail}</a> immediately.</p>
    `,
  });

export default passwordChangedTemplate;
