/**
 * Push notifications (people_get_notifications_on_their_devices): a send
 * never throws, counts failures, and only reaches the named people.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import webpush from "web-push";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));

suite("push notifications", () => {
  let admin;
  let push;
  const alice = randomUUID();
  const bob = randomUUID();

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
    push = await import("@/lib/push");
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });
  beforeEach(async () => {
    await admin`TRUNCATE users CASCADE`;
    for (const id of [alice, bob]) {
      await admin`INSERT INTO users (id, name, email, role) VALUES (${id}, ${id.slice(0, 5)}, ${id.slice(0, 8) + "@x.test"}, 'Employee')`;
    }
    const keys = webpush.generateVAPIDKeys(); // any valid P-256 point works as a device key
    await admin`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
                VALUES (${alice}, 'https://127.0.0.1:9/push/alice', ${keys.publicKey}, 'AAAAAAAAAAAAAAAAAAAAAA')`;
  });

  it("is configured from the VAPID keys", () => {
    expect(push.pushConfigured()).toBe(true);
  });

  it("counts a device it could not reach, without throwing", async () => {
    const r = await push.sendPushToUsers([alice], { title: "Hi", body: "Test", href: "/dashboard" });
    expect(r.sent).toBe(0);
    expect(r.failed).toBe(1);
    const [row] = await admin`SELECT failures FROM push_subscriptions WHERE user_id = ${alice}`;
    expect(row.failures).toBe(1);
  });

  it("sends nothing to people without a device", async () => {
    const r = await push.sendPushToUsers([bob], { title: "Hi" });
    expect(r).toMatchObject({ sent: 0, failed: 0 });
  });
});
