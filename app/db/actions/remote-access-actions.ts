"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { ADMIN_ROLES } from "@/lib/utils/role-gates";
import { isValidNetwork, ipInNetworks } from "@/lib/net/cidr";
import { privilegedDb } from "../provisioning";
import {
  REMOTE_COOKIE,
  generateToken,
  hashToken,
  forgetNetworkCache,
  requestNetworkContext,
  tokenIsValid,
} from "../networkAccess";

/**
 * Remote access — the waiting page's token, and the system administrator's
 * settings: office-only on/off, the office addresses, and the tokens issued
 * to people who work away. See app/db/networkAccess.ts.
 */

const ADMIN = ADMIN_ROLES as unknown as string[];
type Tx = Parameters<Parameters<typeof withAuthorizedTenant>[1]>[0];

function bump() {
  revalidatePath("/dashboard/settings/remote-access");
}

// ── The waiting page ─────────────────────────────────────────────────────────

const attempts = new Map<string, { n: number; since: number }>();

/**
 * A person away from the office enters their token. It must be theirs, for
 * the company they are working in, unexpired and unrevoked. Valid: it is kept
 * in a secure cookie until it expires. Five wrong tries in ten minutes and the
 * page waits before trying again.
 */
export async function redeemRemoteToken(raw: string) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return { error: "Sign in first." };
  const su = user as { activeCompanyId?: string | null; companyId?: string | null };
  const companyId = String(su.activeCompanyId ?? su.companyId ?? "");
  if (!companyId) return { error: "Choose a company first." };

  const key = String(user.id);
  const a = attempts.get(key);
  const now = Date.now();
  if (a && now - a.since < 600_000 && a.n >= 5) {
    return { error: "Too many tries. Wait ten minutes, then try again — or ask your system administrator." };
  }

  const token = String(raw ?? "").trim().toUpperCase();
  const ctx = await requestNetworkContext();
  const check = token ? await tokenIsValid(token, String(user.id), companyId, ctx?.ip ?? null) : { ok: false };
  if (!check.ok) {
    attempts.set(key, a && now - a.since < 600_000 ? { n: a.n + 1, since: a.since } : { n: 1, since: now });
    return { error: "That token is not valid for you here. Check it, or ask your system administrator for a new one." };
  }
  attempts.delete(key);

  const [row] = (await privilegedDb().execute(sql`
    SELECT expires_at FROM remote_access_tokens WHERE token_hash = ${hashToken(token)}
  `)) as unknown as Array<{ expires_at: Date }>;
  (await cookies()).set(REMOTE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: row?.expires_at ? new Date(row.expires_at) : undefined,
  });
  return { success: true, message: "Welcome back — you're in." };
}

/** Forget the token on this device. */
export async function forgetRemoteToken() {
  (await cookies()).delete(REMOTE_COOKIE);
  return { success: true };
}

// ── System administrator ─────────────────────────────────────────────────────

/** Would the administrator still get in, with these networks, from here? */
async function adminStillGetsIn(tx: Tx, userId: string, companyId: string, networks: string[]) {
  const ctx = await requestNetworkContext();
  if (!ctx) return true;
  if (ctx.ip && ipInNetworks(ctx.ip, networks)) return true;
  return (await tokenIsValid(ctx.token, userId, companyId, ctx.ip)).ok;
}

async function networksOf(tx: Tx) {
  const rows = (await tx.execute(sql`SELECT network FROM company_office_networks`)) as unknown as Array<{ network: string }>;
  return rows.map((r) => r.network);
}

export async function getRemoteAccessSettings() {
  return withAuthorizedTenant(ADMIN, async (tx) => {
    const [policy] = (await tx.execute(sql`
      SELECT office_only AS "officeOnly", updated_by_name AS "updatedByName", updated_at AS "updatedAt"
        FROM company_network_policy
    `)) as unknown as Array<{ officeOnly: boolean; updatedByName: string; updatedAt: Date }>;
    const networks = (await tx.execute(sql`
      SELECT id, network, label, created_by_name AS "createdByName", created_at AS "createdAt"
        FROM company_office_networks ORDER BY created_at
    `)) as unknown as Array<Record<string, unknown>>;
    const tokens = (await tx.execute(sql`
      SELECT id, user_id AS "userId", user_name AS "userName", token_hint AS "hint", label,
             expires_at AS "expiresAt", revoked_at AS "revokedAt", revoked_by_name AS "revokedByName",
             last_used_at AS "lastUsedAt", last_used_ip AS "lastUsedIp",
             created_by_name AS "createdByName", created_at AS "createdAt",
             (revoked_at IS NULL AND expires_at > now()) AS active
        FROM remote_access_tokens ORDER BY (revoked_at IS NULL AND expires_at > now()) DESC, created_at DESC
       LIMIT 300
    `)) as unknown as Array<Record<string, unknown>>;
    const people = (await tx.execute(sql`
      SELECT u.id, u.name, COALESCE(a.role, u.role) AS role
        FROM users u JOIN user_company_access a
          ON a.user_id = u.id AND a.status = 'active'
         AND a.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
       WHERE COALESCE(u.status, 'active') NOT IN ('inactive', 'Inactive')
       ORDER BY u.name
    `)) as unknown as Array<{ id: string; name: string; role: string }>;
    const ctx = await requestNetworkContext();
    const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d ? String(d) : null);
    return {
      officeOnly: Boolean(policy?.officeOnly),
      updatedByName: policy?.updatedByName ?? null,
      updatedAt: iso(policy?.updatedAt),
      networks: networks.map((n) => ({ ...n, id: String(n.id), createdAt: iso(n.createdAt) })),
      tokens: tokens.map((t) => ({
        ...t,
        id: String(t.id),
        expiresAt: iso(t.expiresAt),
        revokedAt: iso(t.revokedAt),
        lastUsedAt: iso(t.lastUsedAt),
        createdAt: iso(t.createdAt),
      })),
      people: people.map((p) => ({ id: String(p.id), name: p.name, role: p.role })),
      currentIp: ctx?.ip ?? null,
    };
  });
}

export async function setOfficeOnly(on: boolean) {
  try {
    await withAuthorizedTenant(ADMIN, async (tx, { user, companyId }) => {
      if (on) {
        const nets = await networksOf(tx);
        if (!nets.length) throw new Error("Add the office's address first, or nobody could get in.");
        if (!(await adminStillGetsIn(tx, String(user.id), companyId, nets))) {
          throw new Error(
            "You are not on an office address and hold no remote-access token, so switching this on would lock you out. Add this address, or issue yourself a token and enter it first.",
          );
        }
      }
      await tx.execute(sql`
        INSERT INTO company_network_policy (company_id, office_only, updated_by_id, updated_by_name, updated_at)
        VALUES (${companyId}::uuid, ${Boolean(on)}, ${String(user.id)}, ${user.name || "Administrator"}, now())
        ON CONFLICT (company_id) DO UPDATE
          SET office_only = EXCLUDED.office_only, updated_by_id = EXCLUDED.updated_by_id,
              updated_by_name = EXCLUDED.updated_by_name, updated_at = now()
      `);
      forgetNetworkCache(companyId);
    });
    bump();
    return {
      success: true,
      message: on
        ? "Office-only access is on. People away from the office now need a token."
        : "Office-only access is off. QaliSuite works from anywhere again.",
    };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function addOfficeNetwork(network: string, label = "") {
  const net = String(network ?? "").trim();
  if (!isValidNetwork(net)) return { error: "Enter an IP address (41.90.12.7) or a block (41.90.12.0/24)." };
  if (/^(0\.0\.0\.0\/0|::\/0)$/.test(net)) return { error: "That would let the whole internet in. Use your office's address." };
  try {
    await withAuthorizedTenant(ADMIN, async (tx, { user, companyId }) => {
      await tx.execute(sql`
        INSERT INTO company_office_networks (company_id, network, label, created_by_name)
        VALUES (${companyId}::uuid, ${net}, ${String(label ?? "").trim().slice(0, 80)}, ${user.name || "Administrator"})
        ON CONFLICT (company_id, network) DO NOTHING
      `);
      forgetNetworkCache(companyId);
    });
    bump();
    return { success: true, message: `${net} added as an office address` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function removeOfficeNetwork(id: string) {
  try {
    await withAuthorizedTenant(ADMIN, async (tx, { user, companyId }) => {
      const [{ office_only: on } = { office_only: false }] = (await tx.execute(sql`
        SELECT office_only FROM company_network_policy
      `)) as unknown as Array<{ office_only: boolean }>;
      const remaining = (await tx.execute(sql`
        SELECT network FROM company_office_networks WHERE id <> ${id}::uuid
      `)) as unknown as Array<{ network: string }>;
      if (on && !(await adminStillGetsIn(tx, String(user.id), companyId, remaining.map((r) => r.network)))) {
        throw new Error("Removing it would lock you out. Issue yourself a token and enter it first, or switch office-only off.");
      }
      await tx.execute(sql`DELETE FROM company_office_networks WHERE id = ${id}::uuid`);
      forgetNetworkCache(companyId);
    });
    bump();
    return { success: true, message: "Office address removed" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

/** Issue a token to a person. The token is returned ONCE; only its hash is kept. */
export async function issueRemoteToken(userId: string, days: number, label = "") {
  const d = Math.round(Number(days));
  if (!(d >= 1 && d <= 365)) return { error: "Choose how many days it lasts: 1 to 365." };
  try {
    const token = generateToken();
    const row = await withAuthorizedTenant(ADMIN, async (tx, { user, companyId }) => {
      const [person] = (await tx.execute(sql`
        SELECT u.id, u.name FROM users u
          JOIN user_company_access a ON a.user_id = u.id AND a.status = 'active'
           AND a.company_id = ${companyId}::uuid
         WHERE u.id = ${String(userId)}
      `)) as unknown as Array<{ id: string; name: string }>;
      if (!person) throw new Error("Choose someone who works in this company.");
      await tx.execute(sql`
        INSERT INTO remote_access_tokens
          (company_id, user_id, user_name, token_hash, token_hint, label, expires_at, created_by_id, created_by_name)
        VALUES (${companyId}::uuid, ${person.id}, ${person.name}, ${hashToken(token)}, ${token.slice(-4)},
                ${String(label ?? "").trim().slice(0, 80)}, now() + make_interval(days => ${d}),
                ${String(user.id)}, ${user.name || "Administrator"})
      `);
      return person;
    });
    bump();
    return {
      success: true,
      token,
      message: `Token for ${row.name}, valid ${d} day${d === 1 ? "" : "s"}. Copy it now — it is not shown again.`,
    };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function revokeRemoteToken(id: string) {
  try {
    await withAuthorizedTenant(ADMIN, async (tx, { user, companyId }) => {
      await tx.execute(sql`
        UPDATE remote_access_tokens SET revoked_at = now(), revoked_by_name = ${user.name || "Administrator"}
         WHERE id = ${id}::uuid AND revoked_at IS NULL
      `);
      forgetNetworkCache(companyId);
    });
    bump();
    return { success: true, message: "Token revoked — it stops working within a minute" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
