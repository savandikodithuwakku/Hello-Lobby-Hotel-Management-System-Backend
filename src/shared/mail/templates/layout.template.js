import env from "../../../config/env.js";

const COLORS = {
  text: "#1f2937",
  muted: "#6b7280",
  border: "#e5e7eb",
  brand: "#2563eb",
};

/**
 * Shared shell for every transactional email so branding lives in one place.
 * The application name comes from configuration, which keeps this auth module
 * reusable across projects without editing templates.
 */
export const emailLayout = ({ title, bodyHtml }) => `
  <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: ${COLORS.text}; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid ${COLORS.border}; border-radius: 8px;">
    <h2 style="color: ${COLORS.brand}; margin-top: 0;">${title}</h2>
    ${bodyHtml}
    <hr style="border: 0; border-top: 1px solid ${COLORS.border}; margin: 24px 0;" />
    <p style="font-size: 12px; color: ${COLORS.muted};">
      ${env.app.name} &middot; This is an automated message, please do not reply.
      Need help? Contact <a href="mailto:${env.app.supportEmail}" style="color: ${COLORS.brand};">${env.app.supportEmail}</a>.
    </p>
  </div>
`;

export const emailButton = ({ url, label }) => `
  <p style="margin: 24px 0;">
    <a href="${url}" style="background-color: ${COLORS.brand}; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">${label}</a>
  </p>
  <p style="font-size: 13px; color: ${COLORS.muted};">
    If the button does not work, copy and paste this link into your browser:<br />
    <a href="${url}" style="color: ${COLORS.brand}; word-break: break-all;">${url}</a>
  </p>
`;
