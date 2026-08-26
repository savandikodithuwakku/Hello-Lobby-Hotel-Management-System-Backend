import env from "../../../config/env.js";
import { emailLayout } from "../../../shared/mail/templates/layout.template.js";
import { METHOD_LABELS } from "../payment.constants.js";

const row = (label, value) => `
  <tr>
    <td style="padding: 6px 0; color: #6b7280;">${label}</td>
    <td style="padding: 6px 0; text-align: right; font-weight: bold;">${value}</td>
  </tr>
`;

/**
 * Sent when money goes back to a guest. It says how much, by which route and on
 * what grounds, so a refund never arrives unexplained.
 */
export const refundIssuedTemplate = ({ name, invoice, refund, reason }) =>
  emailLayout({
    title: "Refund issued",
    bodyHtml: `
      <p>Hello ${name},</p>
      <p>
        We have refunded <strong>${refund.amount} ${invoice.currency}</strong> against invoice
        ${invoice.reference}.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        ${row("Refund reference", refund.reference)}
        ${row("Invoice", invoice.reference)}
        ${row("Refunded to", METHOD_LABELS[refund.method] ?? refund.method)}
        ${row("Amount", `${refund.amount} ${invoice.currency}`)}
        ${row("Total received", `${invoice.amounts.paid} ${invoice.currency}`)}
        ${row("Total refunded", `${invoice.amounts.refunded} ${invoice.currency}`)}
      </table>

      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}

      <p style="font-size: 13px; color: #6b7280;">
        Depending on your bank, a refund can take a few working days to appear. If it has not
        arrived within a week, contact
        <a href="mailto:${env.app.supportEmail}" style="color: #2563eb;">${env.app.supportEmail}</a>.
      </p>
    `,
  });

export default refundIssuedTemplate;
