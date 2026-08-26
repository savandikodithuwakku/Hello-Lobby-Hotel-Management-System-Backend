import env from "../../../config/env.js";
import { emailButton, emailLayout } from "../../../shared/mail/templates/layout.template.js";
import { getFrontendBaseUrl } from "../../../config/app.config.js";

export const welcomeEmailTemplate = ({ name }) =>
  emailLayout({
    title: `Welcome to ${env.app.name}`,
    bodyHtml: `
      <p>Hello ${name},</p>
      <p>Your email address has been verified and your account is now active.</p>
      ${emailButton({ url: `${getFrontendBaseUrl()}/login`, label: "Sign in" })}
    `,
  });

export default welcomeEmailTemplate;
