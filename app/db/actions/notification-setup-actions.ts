"use server";

import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { privilegedDb } from "../provisioning";
import { ADMIN_ROLES } from "@/lib/utils/role-gates";
import { pushConfigured, sendPushToUsers } from "@/lib/push";

/**
 * Turning on push for a device, and the administrator's check of email and
 * push. Subscriptions belong to the signed-in person and are only ever read
 * or written filtered by their id.
 */

async function me() {
  const session = await auth();
  const u = session?.user as { id?: string; role?: string; email?: string; name?: string } | undefined;
  if (!u?.id) throw new Error("Sign in first.");
  return u;
}

export async function getPushPublicKey() {
  return pushConfigured() ? process.env.VAPID_PUBLIC_KEY ?? null : null;
}

export async function savePushSubscription(sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }, userAgent = "") {
  try {
    const u = await me();
    const endpoint = String(sub?.endpoint ?? "");
    const p256dh = String(sub?.keys?.p256dh ?? "");
    const authKey = String(sub?.keys?.auth ?? "");
    if (!/^https:\/\//.test(endpoint) || !p256dh || !authKey) return { success: false, error: "This browser did not give a usable subscription." };
    await privilegedDb().execute(sql`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      VALUES (${String(u.id)}, ${endpoint}, ${p256dh}, ${authKey}, ${String(userAgent).slice(0, 300)})
      ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent, failures = 0
    `);
    return { success: true, message: "Notifications are on for this device." };
  } catch (e) {
    return { success: false, error: (e as Error).message || "Could not turn notifications on." };
  }
}

export async function removePushSubscription(endpoint: string) {
  try {
    const u = await me();
    await privilegedDb().execute(sql`
      DELETE FROM push_subscriptions WHERE endpoint = ${String(endpoint)} AND user_id = ${String(u.id)}
    `);
    return { success: true, message: "Notifications are off for this device." };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function sendTestPush() {
  try {
    const u = await me();
    if (!pushConfigured()) return { success: false, error: "Push is not set up on the server yet (VAPID keys)." };
    const r = await sendPushToUsers([String(u.id)], {
      title: "QaliSuite test notification",
      body: "If you can see this, notifications reach this device.",
      href: "/dashboard",
    });
    if (r.sent === 0 && r.failed === 0) return { success: false, error: "No device of yours has notifications turned on. Turn them on from the bell first." };
    if (r.sent === 0) return { success: false, error: `The push service refused it: ${r.errors[0]}` };
    return { success: true, message: `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}${r.failed ? ` (${r.failed} failed)` : ""}.` };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

const ADMIN = ADMIN_ROLES as unknown as string[];

/** What the administrator sees on Settings > Email & notifications. */
export async function getNotificationSetup() {
  const u = await me();
  if (!ADMIN.includes(String(u.role))) throw new Error("Only an administrator can see this.");
  const from = process.env.FROM_EMAIL || "QaliSuite <onboarding@resend.dev>";
  const appUrl = process.env.APP_URL || "";
  const [counts] = (await privilegedDb().execute(sql`
    SELECT count(*)::int AS devices, count(DISTINCT user_id)::int AS people,
           count(*) FILTER (WHERE user_id = ${String(u.id)})::int AS mine
      FROM push_subscriptions
  `)) as unknown as Array<{ devices: number; people: number; mine: number }>;
  const { emailTransport, verifyEmailTransport } = await import("@/lib/email");
  const transport = emailTransport();
  const check = transport === "smtp" ? await verifyEmailTransport() : null;
  return {
    email: {
      transport,
      smtpHost: process.env.SMTP_HOST ? `${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}` : null,
      smtpUser: process.env.SMTP_USER || null,
      smtpOk: check ? check.ok : null,
      smtpError: check && !check.ok ? String(check.error ?? "") : null,
      hasKey: Boolean(process.env.RESEND_API_KEY),
      from,
      sandboxSender: /@resend\.dev>?$/i.test(from),
      appUrl,
      appUrlLooksWrong: !appUrl || /localhost|127\.0\.0\.1/.test(appUrl),
    },
    push: {
      configured: pushConfigured(),
      hasPublic: Boolean(process.env.VAPID_PUBLIC_KEY),
      hasPrivate: Boolean(process.env.VAPID_PRIVATE_KEY),
      subject: process.env.VAPID_SUBJECT || "",
      devices: counts?.devices ?? 0,
      people: counts?.people ?? 0,
      mine: counts?.mine ?? 0,
    },
    myEmail: u.email ?? "",
  };
}

/** Send a real email and report exactly what the email service said. */
export async function sendTestEmail(to: string) {
  try {
    const u = await me();
    if (!ADMIN.includes(String(u.role))) return { success: false, error: "Only an administrator can send a test email." };
    const address = String(to ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return { success: false, error: "Enter an email address." };
    const { deliver, emailTransport } = await import("@/lib/email");
    const via = emailTransport();
    if (!via) return { success: false, error: "Email is not set up on the server: set SMTP_HOST (your mail server) or RESEND_API_KEY." };
    const { data, error } = await deliver({
      from: process.env.FROM_EMAIL || "QaliSuite <onboarding@resend.dev>",
      to: address,
      subject: "QaliSuite test email",
      html: `<p>This is a test from QaliSuite, sent by ${u.name ?? "an administrator"}. If you are reading it, invitations and notifications can reach this address.</p>`,
    });
    const who = via === "smtp" ? "Your mail server" : "Resend";
    if (error) return { success: false, error: `${who} refused it: ${error.message}` };
    return { success: true, message: `Accepted by ${who.toLowerCase()} (id ${data?.id ?? "—"}). Check ${address}, including spam.` };
  } catch (e) {
    return { success: false, error: `Could not reach the email service: ${(e as Error).message}` };
  }
}
