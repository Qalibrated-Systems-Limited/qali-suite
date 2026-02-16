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
