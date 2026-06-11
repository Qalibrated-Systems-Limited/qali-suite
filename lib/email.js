import { Resend } from "resend";

// Lazy-initialized to avoid build-time errors when RESEND_API_KEY is not set
let _resend;
function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const FROM_EMAIL = process.env.FROM_EMAIL || "QaliSuite <onboarding@resend.dev>";

/**
 * Send an invite email to a new user
 */
export async function sendInviteEmail({
  to,
  inviterName,
  companyName,
  role,
  rawToken,
}) {
  const inviteUrl = `${APP_URL}/invite/${rawToken}`;

  const { data, error } = await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject: `You've been invited to join ${companyName} on QaliSuite`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-block; width: 48px; height: 48px; background: linear-gradient(135deg, #facc15, #f97316); border-radius: 12px; line-height: 48px; font-size: 24px; font-weight: 900; color: #000;">Q</div>
          <h1 style="margin: 12px 0 0; font-size: 20px; color: #111;">QaliSuite</h1>
        </div>

        <div style="background: #f9fafb; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
          <h2 style="margin: 0 0 8px; font-size: 18px; color: #111;">You're invited!</h2>
          <p style="margin: 0 0 20px; color: #6b7280; font-size: 14px; line-height: 1.6;">
            <strong>${inviterName}</strong> has invited you to join <strong>${companyName}</strong> as <strong>${role}</strong>.
          </p>

          <a href="${inviteUrl}" style="display: inline-block; background: linear-gradient(135deg, #facc15, #f97316); color: #000; font-weight: 600; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-size: 14px;">
            Accept Invitation
          </a>

          <p style="margin: 20px 0 0; color: #9ca3af; font-size: 12px;">
            This invite expires in 7 days. If you didn't expect this email, you can safely ignore it.
          </p>
        </div>

        <p style="margin: 24px 0 0; text-align: center; color: #9ca3af; font-size: 11px;">
          QaliSuite by Qalibrated Systems Ltd
        </p>
      </div>
    `,
  });

  if (error) {
    console.error("Failed to send invite email:", error);
    throw new Error(`Failed to send invite email: ${error.message}`);
  }

  return data;
}

// ============================================
// SHARED TEMPLATE — branded document email
// ============================================
// Wraps a payload in the QaliSuite-styled shell. Used for PO and Quote
// emails, and any future "send document" flow (delivery notes, statements).
function documentEmailHtml({
  recipientName,
  senderCompany,
  docLabel,
  docNumber,
  bodyHtml,
  ctaUrl,
  ctaLabel,
}) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 48px; height: 48px; background: linear-gradient(135deg, #facc15, #f97316); border-radius: 12px; line-height: 48px; font-size: 24px; font-weight: 900; color: #000;">Q</div>
      </div>

      <div style="background: #f9fafb; border-radius: 12px; padding: 28px; border: 1px solid #e5e7eb;">
        <p style="margin: 0 0 8px; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">
          ${docLabel}
        </p>
        <h2 style="margin: 0 0 20px; font-size: 22px; color: #111; font-weight: 600;">
          ${docNumber}
        </h2>

        ${recipientName ? `<p style="margin: 0 0 16px; color: #374151; font-size: 14px;">Dear ${escapeHtml(recipientName)},</p>` : ""}

        <div style="color: #374151; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
          ${bodyHtml}
        </div>

        ${
          ctaUrl
            ? `<a href="${ctaUrl}" style="display: inline-block; background: linear-gradient(135deg, #facc15, #f97316); color: #000; font-weight: 600; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 14px;">${ctaLabel || "View document"}</a>`
            : ""
        }

        <p style="margin: 24px 0 0; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 13px;">
          Regards,<br/>
          <strong>${escapeHtml(senderCompany)}</strong>
        </p>
      </div>

      <p style="margin: 20px 0 0; text-align: center; color: #9ca3af; font-size: 11px;">
        Sent via QaliSuite. The PDF copy is attached for your records.
      </p>
    </div>
  `;
}

function escapeHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const fmtKES = (n, currency = "KES") =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(n || 0);

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-KE", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

/**
 * Send a Purchase Order to a supplier with the PO PDF attached.
 */
export async function sendPurchaseOrderEmail({
  to,
  cc,
  replyTo,
  supplierName,
  senderCompany,
  poNumber,
  poDate,
  expectedDeliveryDate,
  total,
  currency = "KES",
  customMessage,
  pdfBuffer,
}) {
  const bodyHtml = `
    ${customMessage ? `<p style="margin: 0 0 16px; font-style: italic;">${escapeHtml(customMessage)}</p>` : ""}
    <p style="margin: 0 0 12px;">
      Please find attached our Purchase Order <strong>${escapeHtml(poNumber)}</strong>${poDate ? ` dated ${fmtDate(poDate)}` : ""}.
    </p>
    <table style="width: 100%; margin: 12px 0; font-size: 13px; color: #4b5563;">
      <tr><td style="padding: 4px 0;">PO Number</td><td style="text-align: right; font-weight: 600; color: #111;">${escapeHtml(poNumber)}</td></tr>
      <tr><td style="padding: 4px 0;">Order Date</td><td style="text-align: right; font-weight: 600; color: #111;">${fmtDate(poDate)}</td></tr>
      ${expectedDeliveryDate ? `<tr><td style="padding: 4px 0;">Expected Delivery</td><td style="text-align: right; font-weight: 600; color: #111;">${fmtDate(expectedDeliveryDate)}</td></tr>` : ""}
      <tr><td style="padding: 4px 0;">Total</td><td style="text-align: right; font-weight: 600; color: #111;">${fmtKES(total, currency)}</td></tr>
    </table>
    <p style="margin: 0 0 0;">
      Please confirm receipt and the expected delivery date at your earliest convenience.
    </p>
  `;

  const html = documentEmailHtml({
    recipientName: supplierName,
    senderCompany: senderCompany || "Our Company",
    docLabel: "Purchase Order",
    docNumber: poNumber,
    bodyHtml,
  });

  const { data, error } = await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    cc: cc || undefined,
    reply_to: replyTo || undefined,
    subject: `Purchase Order ${poNumber} from ${senderCompany || "us"}`,
    html,
    attachments: pdfBuffer
      ? [{ filename: `${poNumber}.pdf`, content: pdfBuffer }]
      : undefined,
  });

  if (error) {
    console.error("Failed to send PO email:", error);
    throw new Error(error.message || "PO email send failed");
  }
  return data;
}

/**
 * Send a Quote to a customer with the quote PDF attached.
 */
export async function sendQuoteEmail({
  to,
  cc,
  replyTo,
  customerName,
  senderCompany,
  quoteNumber,
  quoteDate,
  validUntil,
  total,
  currency = "KES",
  customMessage,
  pdfBuffer,
  publicUrl,
}) {
  const bodyHtml = `
    ${customMessage ? `<p style="margin: 0 0 16px; font-style: italic;">${escapeHtml(customMessage)}</p>` : ""}
    <p style="margin: 0 0 12px;">
      Thank you for your interest. Please find our quote <strong>${escapeHtml(quoteNumber)}</strong> attached.
    </p>
    <table style="width: 100%; margin: 12px 0; font-size: 13px; color: #4b5563;">
      <tr><td style="padding: 4px 0;">Quote Number</td><td style="text-align: right; font-weight: 600; color: #111;">${escapeHtml(quoteNumber)}</td></tr>
      <tr><td style="padding: 4px 0;">Quote Date</td><td style="text-align: right; font-weight: 600; color: #111;">${fmtDate(quoteDate)}</td></tr>
      ${validUntil ? `<tr><td style="padding: 4px 0;">Valid Until</td><td style="text-align: right; font-weight: 600; color: #111;">${fmtDate(validUntil)}</td></tr>` : ""}
      <tr><td style="padding: 4px 0;">Total</td><td style="text-align: right; font-weight: 600; color: #111;">${fmtKES(total, currency)}</td></tr>
    </table>
    <p style="margin: 0 0 0;">
      Reply to this email to accept, request changes, or ask questions.
    </p>
  `;

  const html = documentEmailHtml({
    recipientName: customerName,
    senderCompany: senderCompany || "Our Company",
    docLabel: "Quote",
    docNumber: quoteNumber,
    bodyHtml,
    ctaUrl: publicUrl,
    ctaLabel: "View quote",
  });

  const { data, error } = await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    cc: cc || undefined,
    reply_to: replyTo || undefined,
    subject: `Quote ${quoteNumber} from ${senderCompany || "us"}`,
    html,
    attachments: pdfBuffer
      ? [{ filename: `${quoteNumber}.pdf`, content: pdfBuffer }]
      : undefined,
  });

  if (error) {
    console.error("Failed to send quote email:", error);
    throw new Error(error.message || "Quote email send failed");
  }
  return data;
}

/**
 * Internal notification email (approvals, alerts) — same branding as the
 * document emails but without the "PDF attached" footer. `rows` renders a
 * compact key/value table; `note` is free text under it.
 *
 * Unlike the document senders this does NOT throw on failure — internal
 * notifications are best-effort and must never break the action that
 * triggered them. Returns { ok, error? }.
 */
export async function sendInternalNotificationEmail({
  to,
  subject,
  label,
  heading,
  rows = [],
  note,
  ctaUrl,
  ctaLabel,
}) {
  try {
    if (!process.env.RESEND_API_KEY) {
      return { ok: false, error: "RESEND_API_KEY not configured" };
    }
    const rowsHtml = rows
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(
        ([k, v]) =>
          `<tr><td style="padding: 4px 0; color: #6b7280;">${escapeHtml(String(k))}</td><td style="text-align: right; font-weight: 600; color: #111;">${escapeHtml(String(v))}</td></tr>`,
      )
      .join("");

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; width: 48px; height: 48px; background: linear-gradient(135deg, #facc15, #f97316); border-radius: 12px; line-height: 48px; font-size: 24px; font-weight: 900; color: #000;">Q</div>
        </div>
        <div style="background: #f9fafb; border-radius: 12px; padding: 28px; border: 1px solid #e5e7eb;">
          <p style="margin: 0 0 8px; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">${escapeHtml(label || "Notification")}</p>
          <h2 style="margin: 0 0 16px; font-size: 20px; color: #111; font-weight: 600;">${escapeHtml(heading || subject)}</h2>
          ${rowsHtml ? `<table style="width: 100%; margin: 8px 0 16px; font-size: 13px;">${rowsHtml}</table>` : ""}
          ${note ? `<p style="margin: 0 0 20px; color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(note)}</p>` : ""}
          ${
            ctaUrl
              ? `<a href="${ctaUrl}" style="display: inline-block; background: linear-gradient(135deg, #facc15, #f97316); color: #000; font-weight: 600; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 14px;">${escapeHtml(ctaLabel || "Open")}</a>`
              : ""
          }
        </div>
        <p style="margin: 20px 0 0; text-align: center; color: #9ca3af; font-size: 11px;">
          QaliSuite by Qalibrated Systems Ltd
        </p>
      </div>
    `;

    const { error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });
    if (error) {
      console.error("Internal notification email failed:", error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error("Internal notification email failed:", e);
    return { ok: false, error: e.message };
  }
}
