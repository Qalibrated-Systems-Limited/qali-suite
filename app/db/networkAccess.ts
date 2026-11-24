import "server-only";
import { createHash, randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { privilegedDb } from "./provisioning";
import { ipInNetworks, clientIpFrom } from "@/lib/net/cidr";

/**
 * OFFICE-ONLY ACCESS, AND THE TOKEN THAT LETS SOMEONE IN FROM ELSEWHERE.
 *
 * A company may keep QaliSuite to its office network. When it does, a request
 * is let through when it comes from one of the office addresses, or when the
 * person holds an unexpired, unrevoked remote-access token of their own for
 * that company (sent as the `qs_remote` cookie, set by the waiting page).
 * Otherwise the person is AWAY: the dashboard shows the waiting page and every
 * data request is refused.
 *
 * Checked server-side on every page and every action (the dashboard layout and
 * withAuthorizedTenant), not only by hiding links. Privileged reads, filtered
 * by company explicitly: it runs before, and around, the tenant scope.
 *
 * Off by default — a company that never sets it is exactly as before.
 */

export const REMOTE_COOKIE = "qs_remote";

export type Verdict =
  | { allowed: true; reason: "open" | "office" | "token" | "no-request" }
  | { allowed: false; reason: "away"; ip: string | null };

const POLICY_TTL = 30_000;
const TOKEN_TTL = 60_000;
const policyCache = new Map<string, { at: number; officeOnly: boolean; networks: string[] }>();
const tokenCache = new Map<string, { at: number; ok: boolean; id: string | null }>();
const lastTouched = new Map<string, number>();

export function hashToken(raw: string) {
  return createHash("sha256").update(String(raw).trim().toUpperCase()).digest("hex");
}

/** A token people can read out and type: QSR-XXXX-XXXX-XXXX-XXXX. */
export function generateToken() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
  const group = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `QSR-${group()}-${group()}-${group()}-${group()}`;
}

/** Called after an administrator changes a company's settings or tokens. */
export function forgetNetworkCache(companyId?: string) {
  if (companyId) policyCache.delete(companyId);
  else policyCache.clear();
  tokenCache.clear();
}

export async function getNetworkPolicy(companyId: string) {
  const hit = policyCache.get(companyId);
  if (hit && Date.now() - hit.at < POLICY_TTL) return hit;
  const db = privilegedDb();
  const [p] = (await db.execute(sql`
    SELECT office_only FROM company_network_policy WHERE company_id = ${companyId}::uuid
  `)) as unknown as Array<{ office_only: boolean }>;
  const nets = (await db.execute(sql`
    SELECT network FROM company_office_networks WHERE company_id = ${companyId}::uuid
  `)) as unknown as Array<{ network: string }>;
  const value = { at: Date.now(), officeOnly: Boolean(p?.office_only), networks: nets.map((n) => n.network) };
  policyCache.set(companyId, value);
  return value;
}

/** Is this raw token valid for this person in this company right now? */
export async function tokenIsValid(raw: string | null | undefined, userId: string, companyId: string, ip: string | null) {
  if (!raw) return { ok: false, id: null as string | null };
  const hash = hashToken(raw);
  const key = `${hash}|${userId}|${companyId}`;
  const hit = tokenCache.get(key);
  if (hit && Date.now() - hit.at < TOKEN_TTL) return hit;
  const [row] = (await privilegedDb().execute(sql`
    SELECT id FROM remote_access_tokens
     WHERE token_hash = ${hash} AND user_id = ${userId} AND company_id = ${companyId}::uuid
       AND revoked_at IS NULL AND expires_at > now()
  `)) as unknown as Array<{ id: string }>;
  const value = { at: Date.now(), ok: Boolean(row), id: row ? String(row.id) : null };
  tokenCache.set(key, value);
  if (tokenCache.size > 5000) tokenCache.clear();
  // Record use — at most every five minutes per token, not on every click.
  if (row) {
    const last = lastTouched.get(row.id) ?? 0;
    if (Date.now() - last > 300_000) {
      lastTouched.set(row.id, Date.now());
      await privilegedDb()
        .execute(sql`UPDATE remote_access_tokens SET last_used_at = now(), last_used_ip = ${ip} WHERE id = ${row.id}::uuid`)
        .catch(() => {});
    }
  }
  return value;
}

/** The verdict for a request, given what it carries. */
export async function judge(opts: {
  userId: string;
  companyId: string;
  ip: string | null;
  token: string | null | undefined;
}): Promise<Verdict> {
  const policy = await getNetworkPolicy(opts.companyId);
  if (!policy.officeOnly) return { allowed: true, reason: "open" };
  if (opts.ip && ipInNetworks(opts.ip, policy.networks)) return { allowed: true, reason: "office" };
  const t = await tokenIsValid(opts.token, opts.userId, opts.companyId, opts.ip);
  if (t.ok) return { allowed: true, reason: "token" };
  return { allowed: false, reason: "away", ip: opts.ip };
}

/** The current request's address and token, from Next's request context. */
export async function requestNetworkContext(): Promise<{ ip: string | null; token: string | null } | null> {
  try {
    const { headers, cookies } = await import("next/headers");
    const h = await headers();
    const c = await cookies();
    return { ip: clientIpFrom(h), token: c.get(REMOTE_COOKIE)?.value ?? null };
  } catch {
    // No request (a cron job, a script, a test): nothing to judge.
    return null;
  }
}

/** The verdict for the request being served. */
export async function judgeCurrentRequest(userId: string, companyId: string): Promise<Verdict> {
  const ctx = await requestNetworkContext();
  if (!ctx) return { allowed: true, reason: "no-request" };
  return judge({ userId, companyId, ip: ctx.ip, token: ctx.token });
}

export class AwayFromOfficeError extends Error {
  digest = "AWAY_FROM_OFFICE";
  constructor() {
    super("You are away from the office. Enter your remote-access token on the waiting page to continue.");
  }
}

export function isAwayFromOffice(err: unknown) {
  return (err as { digest?: string })?.digest === "AWAY_FROM_OFFICE";
}
