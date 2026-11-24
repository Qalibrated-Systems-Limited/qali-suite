/**
 * Office-only access: in from the office, in with your own token, otherwise
 * away. Off by default.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
const na = await import("@/app/db/networkAccess");

suite("office-only access", () => {
  let admin, co, other;
  const ann = "u-ann", bob = "u-bob";

  beforeAll(() => { admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} }); });
  afterAll(async () => { if (admin) await admin.end(); });
  beforeEach(async () => {
    await admin`TRUNCATE companies, users, entry_counters CASCADE`;
    co = randomUUID(); other = randomUUID();
    for (const c of [co, other]) await admin`INSERT INTO companies (id, name, slug) VALUES (${c}, 'C', ${"c-" + c.slice(0, 8)})`;
    for (const u of [ann, bob]) await admin`INSERT INTO users (id, name, email, role, home_company_id) VALUES (${u}, ${u}, ${u + "@x.co"}, 'Employee', ${co})`;
    na.forgetNetworkCache();
  });

  const turnOn = async () => {
    await admin`INSERT INTO company_network_policy (company_id, office_only) VALUES (${co}, true)`;
    await admin`INSERT INTO company_office_networks (company_id, network) VALUES (${co}, '41.90.12.0/24')`;
    na.forgetNetworkCache();
  };
  const issue = async (user, company = co, extra = "") => {
    const token = na.generateToken();
    await admin`INSERT INTO remote_access_tokens (company_id, user_id, user_name, token_hash, token_hint, expires_at)
                VALUES (${company}, ${user}, ${user}, ${na.hashToken(token)}, ${token.slice(-4)}, now() + interval '7 days')`;
    return token;
  };

  it("is off by default: everyone gets in from anywhere", async () => {
    expect(await na.judge({ userId: ann, companyId: co, ip: "8.8.8.8", token: null })).toMatchObject({ allowed: true, reason: "open" });
  });

  it("when on, lets the office in and keeps everyone else out", async () => {
    await turnOn();
    expect(await na.judge({ userId: ann, companyId: co, ip: "41.90.12.77", token: null })).toMatchObject({ allowed: true, reason: "office" });
    expect(await na.judge({ userId: ann, companyId: co, ip: "8.8.8.8", token: null })).toMatchObject({ allowed: false, reason: "away" });
    expect(await na.judge({ userId: ann, companyId: co, ip: null, token: null })).toMatchObject({ allowed: false });
  });

  it("lets a person in from anywhere with their own token, not someone else's", async () => {
    await turnOn();
    const t = await issue(ann);
    expect(t).toMatch(/^QSR-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(await na.judge({ userId: ann, companyId: co, ip: "8.8.8.8", token: t.toLowerCase() })).toMatchObject({ allowed: true, reason: "token" });
    na.forgetNetworkCache();
    expect(await na.judge({ userId: bob, companyId: co, ip: "8.8.8.8", token: t })).toMatchObject({ allowed: false });
  });

  it("a token is for one company", async () => {
    await turnOn();
    await admin`INSERT INTO company_network_policy (company_id, office_only) VALUES (${other}, true)`;
    na.forgetNetworkCache();
    const t = await issue(ann, other);
    expect(await na.judge({ userId: ann, companyId: co, ip: "8.8.8.8", token: t })).toMatchObject({ allowed: false });
  });

  it("stops working when revoked or expired, and records use", async () => {
    await turnOn();
    const t = await issue(ann);
    expect((await na.judge({ userId: ann, companyId: co, ip: "8.8.8.8", token: t })).allowed).toBe(true);
    const [used] = await admin`SELECT last_used_ip FROM remote_access_tokens WHERE user_id = ${ann}`;
    expect(used.last_used_ip).toBe("8.8.8.8");
    await admin`UPDATE remote_access_tokens SET revoked_at = now() WHERE user_id = ${ann}`;
    na.forgetNetworkCache();
    expect((await na.judge({ userId: ann, companyId: co, ip: "8.8.8.8", token: t })).allowed).toBe(false);
    const t2 = await issue(ann);
    await admin`UPDATE remote_access_tokens SET created_at = now() - interval '9 days', expires_at = now() - interval '1 day' WHERE token_hash = ${na.hashToken(t2)}`;
    na.forgetNetworkCache();
    expect((await na.judge({ userId: ann, companyId: co, ip: "8.8.8.8", token: t2 })).allowed).toBe(false);
  });

  it("stores only a fingerprint of the token", async () => {
    const t = await issue(ann);
    const [row] = await admin`SELECT token_hash, token_hint FROM remote_access_tokens WHERE user_id = ${ann}`;
    expect(row.token_hash).not.toContain(t);
    expect(row.token_hash).toHaveLength(64);
    expect(row.token_hint).toBe(t.slice(-4));
  });
});
