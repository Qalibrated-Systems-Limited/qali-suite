import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { privilegedDb } from "../provisioning";
import { licenses, licenseAuditLogs } from "../schema";
import { isUuid } from "./sqlHelpers";
import { signLicenseToken } from "@/lib/licensing/jwt";
import { parseFeatures } from "@/lib/licensing/features";

/**
 * Licensing repository — 0108. Same contract as every other repository: `tx` is
 * already RLS-scoped to the company, so nothing here filters on companyId, and
 * no session/role logic lives here (that is licensing-actions.ts). Ported from
 * the Lante ERP LicenseService — IssueAsync / RevokeAsync / RenewAsync /
 * GetExpiringAsync map onto the functions below.
 *
 * `validateByToken` is the one exception to the tx contract: a client app
 * checking in presents a token and NOTHING ELSE — no session, no tenant — so it
 * cannot run under a company scope. It reads the single row by its (unique,
 * bearer-secret) token on the privileged connection, exactly as companyExists()
 * reads a company from outside a tenant. A token match returns one row; there
 * is nothing cross-tenant to leak.
 */

async function nextNumber(tx: Tx, companyId: string) {
  const [{ n }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'LIC') AS n`,
  )) as unknown as Array<{ n: string }>;
  return n;
}

type Actor = { id?: string | null; name?: string | null };

async function writeAudit(
  tx: Tx,
  input: {
    companyId: string;
    licenseId: string | null;
    action: string;
    actor: Actor;
    details?: string | null;
  },
) {
  await tx.insert(licenseAuditLogs).values({
    companyId: input.companyId,
    licenseId: input.licenseId,
    entity: "License",
    entityId: input.licenseId ?? "",
    action: input.action,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name || "System",
    details: input.details ?? null,
  });
}

// ── Issue ─────────────────────────────────────────────────────────────────────
export async function issueLicense(
  tx: Tx,
  input: {
    companyId: string;
    customerId: string;
    customerName?: string | null;
    appId: string;
    features: string[];
    machineId?: string | null;
    expiresAt: Date;
    notes?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const features = input.features ?? [];
  const token = signLicenseToken({
    customerId: input.customerId,
    appId: input.appId,
    features,
    expiresAt: input.expiresAt,
    machineId: input.machineId || undefined,
  });

  const licenseNumber = await nextNumber(tx, input.companyId);

  const [row] = await tx
    .insert(licenses)
    .values({
      companyId: input.companyId,
      licenseNumber,
      token,
      customerId: input.customerId.trim(),
      customerName: input.customerName?.trim() ?? "",
      appId: input.appId,
      features: features.join(","),
      machineId: input.machineId?.trim() || null,
      expiresAt: input.expiresAt,
      notes: input.notes?.trim() || null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedById: input.createdById ?? null,
      lastModifiedByName: input.createdByName,
    })
    .returning();

  await writeAudit(tx, {
    companyId: input.companyId,
    licenseId: row.id,
    action: "issued",
    actor: { id: input.createdById, name: input.createdByName },
    details: `${input.appId} · [${features.join(", ")}] · expires ${input.expiresAt.toISOString().slice(0, 10)}`,
  });

  return row;
}

// ── Reads ─────────────────────────────────────────────────────────────────────
export function listLicenses(
  tx: Tx,
  filters: { customerId?: string; appId?: string; active?: boolean } = {},
) {
  const clauses = [];
  if (filters.customerId) clauses.push(eq(licenses.customerId, filters.customerId));
  if (filters.appId) clauses.push(eq(licenses.appId, filters.appId));
  if (filters.active === true) {
    clauses.push(eq(licenses.revoked, false));
    clauses.push(gt(licenses.expiresAt, new Date()));
  } else if (filters.active === false) {
    // Inactive = revoked OR expired.
    clauses.push(
      sql`(${licenses.revoked} = true OR ${licenses.expiresAt} <= now())`,
    );
  }

  const q = tx.select().from(licenses).orderBy(desc(licenses.createdAt));
  return clauses.length ? q.where(and(...clauses)) : q;
}

export async function getLicenseById(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(licenses).where(eq(licenses.id, id));
  return row ?? null;
}

export async function getLicenseAudit(tx: Tx, id: string) {
  if (!isUuid(id)) return [];
  return tx
    .select()
    .from(licenseAuditLogs)
    .where(eq(licenseAuditLogs.licenseId, id))
    .orderBy(desc(licenseAuditLogs.at))
    .limit(200);
}

/** Licenses expiring within `withinDays` (active, not yet expired). */
export function getExpiring(tx: Tx, withinDays = 30) {
  const cutoff = new Date(Date.now() + withinDays * 86_400_000);
  return tx
    .select()
    .from(licenses)
    .where(
      and(
        eq(licenses.revoked, false),
        gt(licenses.expiresAt, new Date()),
        lte(licenses.expiresAt, cutoff),
      ),
    )
    .orderBy(asc(licenses.expiresAt));
}

/** Header stat cards: totals by state. One pass over the tenant's licenses. */
export async function getLicenseStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*)::int                                                         AS total,
      count(*) FILTER (WHERE revoked = false AND expires_at > now())::int   AS active,
      count(*) FILTER (WHERE revoked = true)::int                           AS revoked,
      count(*) FILTER (WHERE revoked = false AND expires_at <= now())::int  AS expired,
      count(*) FILTER (
        WHERE revoked = false
          AND expires_at > now()
          AND expires_at <= now() + interval '30 days'
      )::int                                                                AS expiring_soon
    FROM licenses
  `)) as unknown as Array<{
    total: number;
    active: number;
    revoked: number;
    expired: number;
    expiring_soon: number;
  }>;
  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    revoked: row?.revoked ?? 0,
    expired: row?.expired ?? 0,
    expiringSoon: row?.expiring_soon ?? 0,
  };
}

// ── Revoke ─────────────────────────────────────────────────────────────────────
// Atomic — touches only revoked/revokeReason on a row that is not already
// revoked, so a concurrent renew's expiresAt change can't be lost to a
// full-record overwrite (mirrors LicenseService.TryRevokeAsync).
export async function revokeLicense(
  tx: Tx,
  id: string,
  reason: string,
  actor: Actor,
) {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .update(licenses)
    .set({
      revoked: true,
      revokeReason: reason || "Revoked",
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name || "System",
      updatedAt: new Date(),
    })
    .where(and(eq(licenses.id, id), eq(licenses.revoked, false)))
    .returning();
  if (!row) return null;

  await writeAudit(tx, {
    companyId: row.companyId,
    licenseId: row.id,
    action: "revoked",
    actor,
    details: reason || null,
  });
  return row;
}

// ── Renew ─────────────────────────────────────────────────────────────────────
// Re-checks server-side that the license is not revoked and the new expiry is
// after the current one (mirrors LicenseService.TryRenewAsync). The token is
// NOT re-signed: its own `exp` is the client's offline check, but the server
// record is the authority validate() consults, so extending expires_at extends
// the license. A fresh token can be re-issued if a client needs the longer
// offline window.
export async function renewLicense(
  tx: Tx,
  id: string,
  newExpiresAt: Date,
  actor: Actor,
) {
  if (!isUuid(id)) return { ok: false as const, reason: "not_found" };
  const current = await getLicenseById(tx, id);
  if (!current) return { ok: false as const, reason: "not_found" };
  if (current.revoked) return { ok: false as const, reason: "revoked" };
  if (newExpiresAt <= current.expiresAt) {
    return { ok: false as const, reason: "not_after_current" };
  }

  const [row] = await tx
    .update(licenses)
    .set({
      expiresAt: newExpiresAt,
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name || "System",
      updatedAt: new Date(),
    })
    .where(and(eq(licenses.id, id), eq(licenses.revoked, false)))
    .returning();
  if (!row) return { ok: false as const, reason: "revoked" };

  await writeAudit(tx, {
    companyId: row.companyId,
    licenseId: row.id,
    action: "renewed",
    actor,
    details: `→ ${newExpiresAt.toISOString().slice(0, 10)} (was ${current.expiresAt.toISOString().slice(0, 10)})`,
  });
  return { ok: true as const, row };
}

// ── Validate (client-app check-in) ─────────────────────────────────────────────
export type ValidateResult =
  | {
      valid: true;
      customerId: string;
      appId: string;
      features: string[];
      expiresAt: string;
      serverChecked: true;
    }
  | { valid: false; reason: string; serverChecked: true };

/**
 * Server-side validation, ported from LicenseService.ValidateAsync. Looks the
 * token up on the privileged connection (a client presents no tenant), applies
 * the same checks in the same order, and stamps the check-in audit trail.
 */
export async function validateByToken(input: {
  token: string;
  appId: string;
  machineId?: string | null;
}): Promise<ValidateResult> {
  const db = privilegedDb();
  const [record] = (await db.execute(sql`
    SELECT id, company_id, customer_id, app_id, features, machine_id,
           expires_at, revoked
      FROM licenses
     WHERE token = ${input.token}
     LIMIT 1
  `)) as unknown as Array<{
    id: string;
    company_id: string;
    customer_id: string;
    app_id: string;
    features: string;
    machine_id: string | null;
    expires_at: string;
    revoked: boolean;
  }>;

  if (!record) return { valid: false, reason: "unknown_key", serverChecked: true };
  if (record.revoked) return { valid: false, reason: "revoked", serverChecked: true };
  if (record.app_id !== input.appId)
    return { valid: false, reason: "wrong_app", serverChecked: true };
  if (new Date(record.expires_at) < new Date())
    return { valid: false, reason: "expired", serverChecked: true };
  if (record.machine_id && record.machine_id !== input.machineId)
    return { valid: false, reason: "machine_mismatch", serverChecked: true };

  // Update the check-in trail. Best-effort — a failed stamp must not fail an
  // otherwise-valid activation.
  try {
    await db.execute(sql`
      UPDATE licenses
         SET last_seen = now(), last_machine_id = ${input.machineId ?? null}
       WHERE id = ${record.id}::uuid
    `);
  } catch (err) {
    console.error("[licensing] check-in stamp failed:", err);
  }

  return {
    valid: true,
    customerId: record.customer_id,
    appId: record.app_id,
    features: parseFeatures(record.features),
    expiresAt: record.expires_at,
    serverChecked: true,
  };
}
