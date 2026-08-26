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
 * The receipt a guest gets whenever money is received, whether it was cash at
 * the desk or a card online. It states what is still owed so the guest never
 * has to ask, and carries no card details of any kind.
 */
export const paymentReceiptTemplate = ({ name, invoice, transaction, reservationReference }) =>
  emailLayout({
    title: "Payment received",
    bodyHtml: `
      <p>Hello ${name},</p>
      <p>
        Thank you - we have received your payment of
        <strong>${transaction.amount} ${invoice.currency}</strong>.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        ${row("Receipt number", transaction.reference)}
        ${row("Invoice", invoice.reference)}
        ${reservationReference ? row("Booking", reservationReference) : ""}
        ${row("Paid by", METHOD_LABELS[transaction.method] ?? transaction.method)}
        ${row("Amount", `${transaction.amount} ${invoice.currency}`)}
        ${row("Total for the stay", `${invoice.amounts.total} ${invoice.currency}`)}
        ${row("Still to pay", `${invoice.balanceDue} ${invoice.currency}`)}
      </table>

      ${
        invoice.balanceDue > 0
          ? `<p>The remaining <strong>${invoice.balanceDue} ${invoice.currency}</strong> is due by
             ${new Date(invoice.dueAt).toDateString()}.</p>`
          : `<p>Your booking is now paid in full. We look forward to welcoming you.</p>`
      }

      <p style="font-size: 13px; color: #6b7280;">
        Keep this email as your receipt. Any questions about your bill can go to
        <a href="mailto:${env.app.supportEmail}" style="color: #2563eb;">${env.app.supportEmail}</a>.
      </p>
    `,
  });

export default paymentReceiptTemplate;
