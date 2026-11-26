import "server-only";
import webpush from "web-push";
import { sql } from "drizzle-orm";
import { privilegedDb } from "@/app/db/provisioning";

/**
 * Browser and phone push notifications (people_get_notifications_on_their_devices).
 *
 * Needs three settings on the server, made once with
 * `npx web-push generate-vapid-keys`:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@company)
 * Without them, push is off and nothing else changes: the bell still works.
 */

let configured: boolean | null = null;
export function pushConfigured() {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (configured = false);
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);
    return (configured = true);
  } catch (e) {
    console.error("[push] VAPID keys are not valid:", e);
    return (configured = false);
  }
}

export interface PushMessage {
  title: string;
  body?: string | null;
  href?: string | null;
  tag?: string;
}

/**
 * Send to every device of these people. Never throws. A device the push
 * service says is gone (404/410) is forgotten; other failures are counted.
 */
export async function sendPushToUsers(userIds: string[], msg: PushMessage) {
  const ids = Array.from(new Set(userIds.filter(Boolean).map(String)));
  if (!ids.length || !pushConfigured()) return { sent: 0, failed: 0, errors: [] as string[] };
  const db = privilegedDb();
  const subs = (await db.execute(sql`
    SELECT id::text AS id, endpoint, p256dh, auth FROM push_subscriptions
     WHERE user_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
  `)) as unknown as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;
  const payload = JSON.stringify({
    title: msg.title.slice(0, 120),
    body: (msg.body ?? "").slice(0, 300),
    url: msg.href && msg.href.startsWith("/") ? msg.href : "/dashboard",
    tag: msg.tag,
  });
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 });
        sent += 1;
        await db.execute(sql`UPDATE push_subscriptions SET last_sent_at = now(), failures = 0 WHERE id = ${s.id}::uuid`);
      } catch (e) {
        failed += 1;
        const code = (e as { statusCode?: number }).statusCode;
        errors.push(`${code ?? ""} ${(e as Error).message}`.trim());
        if (code === 404 || code === 410) {
          await db.execute(sql`DELETE FROM push_subscriptions WHERE id = ${s.id}::uuid`).catch(() => {});
        } else {
          await db.execute(sql`UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ${s.id}::uuid`).catch(() => {});
        }
      }
    }),
  );
  return { sent, failed, errors };
}
