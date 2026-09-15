"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { LICENSING_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/licensing";
import {
  FEATURES,
  APP_IDS,
  isValidAppId,
  findUnknownFeatures,
  parseFeatures,
} from "@/lib/licensing/features";
import { isSigningKeyConfigured, verifyLicenseToken } from "@/lib/licensing/jwt";

/**
 * Licensing actions — 0108. Same shape as helpdesk-actions.ts: Zod validates,
 * `withAuthorizedTenant` scopes and gates, the repository does the SQL. Reads
 * are open to any authenticated member of the company; writes need
 * LICENSING_WRITE_ROLES. Every mutation returns {success,message} or {error}.
 *
 * Ported from the Lante ERP LicensesController — Issue / Revoke / Renew / List /
 * Expiring / Validate.
 */

const WRITE = LICENSING_WRITE_ROLES as unknown as string[];

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name || "Unknown User" };
}
function s(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v : "";
}
function serialize<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row, _id: String(row.id) };
  // Dates → ISO strings so the row crosses the server/client boundary cleanly.
  for (const k of Object.keys(out)) {
    if (out[k] instanceof Date) out[k] = (out[k] as Date).toISOString();
  }
  if (typeof row.features === "string") {
    out.featureList = parseFeatures(row.features as string);
  }
  return out;
}
function bump() {
  revalidatePath("/dashboard/licensing");
}

// ── reads ────────────────────────────────────────────────────────────────────
export async function getLicensingData(filters: {
  customerId?: string;
  appId?: string;
  active?: boolean;
} = {}) {
  return withAuthorizedTenant([], async (tx) => {
    const [rows, stats, expiring] = await Promise.all([
      repo.listLicenses(tx, filters),
      repo.getLicenseStats(tx),
      repo.getExpiring(tx, 30),
    ]);
    return {
      licenses: rows.map(serialize),
      stats,
      expiring: expiring.map(serialize),
      catalogue: { features: FEATURES, apps: APP_IDS },
      signingKeyConfigured: isSigningKeyConfigured(),
    };
  });
}

export async function getLicenseDetail(id: string) {
  return withAuthorizedTenant([], async (tx) => {
    const license = await repo.getLicenseById(tx, id);
    if (!license) return null;
    const audit = await repo.getLicenseAudit(tx, id);
    return {
      license: serialize(license),
      audit: audit.map(serialize),
    };
  });
}

// ── issue ──────────────────────────────────────────────────────────────────────
const issueSchema = z.object({
  customerId: z.string().trim().min(1, "A customer id is required").max(100),
  customerName: z.string().trim().max(255).optional(),
  appId: z.string().trim().min(1, "Choose an application"),
  features: z.array(z.string().trim()).default([]),
  machineId: z.string().trim().max(255).optional(),
  expiresAt: z.string().min(1, "An expiry date is required"),
  notes: z.string().trim().max(1000).optional(),
});

export async function issueLicense(prevState: unknown, formData: FormData) {
  const parsed = issueSchema.safeParse({
    customerId: s(formData.get("customerId")),
    customerName: s(formData.get("customerName")),
    appId: s(formData.get("appId")),
    // Checkbox group — every checked feature is posted under "features".
    features: formData.getAll("features").map((v) => String(v)),
    machineId: s(formData.get("machineId")),
    expiresAt: s(formData.get("expiresAt")),
    notes: s(formData.get("notes")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;

  if (!isValidAppId(d.appId)) return { error: "Unknown application." };
  const unknown = findUnknownFeatures(d.features);
  if (unknown.length) return { error: `Unknown feature(s): ${unknown.join(", ")}` };

  const expiresAt = new Date(d.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return { error: "Invalid expiry date." };
  if (expiresAt <= new Date()) return { error: "Expiry must be in the future." };

  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.issueLicense(tx, {
        companyId,
        customerId: d.customerId,
        customerName: d.customerName,
        appId: d.appId,
        features: d.features,
        machineId: d.machineId || null,
        expiresAt,
        notes: d.notes,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return {
      success: true,
      message: `${row.licenseNumber} issued`,
      licenseId: String(row.id),
      token: row.token,
    };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── revoke ──────────────────────────────────────────────────────────────────────
export async function revokeLicense(id: string, reason: string) {
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.revokeLicense(tx, id, reason, actorFrom(user)),
    );
    if (!row) return { error: "License not found, or already revoked." };
    bump();
    return { success: true, message: `${row.licenseNumber} revoked` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── renew ──────────────────────────────────────────────────────────────────────
export async function renewLicense(id: string, newExpiresAt: string) {
  const when = new Date(newExpiresAt);
  if (Number.isNaN(when.getTime())) return { error: "Invalid date." };
  try {
    const result = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.renewLicense(tx, id, when, actorFrom(user)),
    );
    if (!result.ok) {
      const msg = {
        not_found: "License not found.",
        revoked: "Cannot renew a revoked license.",
        not_after_current: "New expiry must be after the current expiry.",
      }[result.reason];
      return { error: msg || "Could not renew the license." };
    }
    bump();
    return { success: true, message: `${result.row.licenseNumber} renewed` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── validate (server-side check, callable from the dashboard or an API route) ──
const validateSchema = z.object({
  token: z.string().trim().min(1, "A token is required"),
  appId: z.string().trim().min(1, "An app id is required"),
  machineId: z.string().trim().optional(),
});

/**
 * Validates a license token exactly as a client app's check-in would. Not
 * tenant-scoped — a token is a bearer secret and names its own record. Verifies
 * the JWT signature offline first (cheap, catches tampering), then consults the
 * server record for revoke/expiry/app/machine state.
 */
export async function validateLicense(input: {
  token: string;
  appId: string;
  machineId?: string;
}) {
  const parsed = validateSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, reason: parsed.error.issues[0]?.message, serverChecked: true };
  }
  // Offline signature check — a token that does not verify never touches the DB.
  try {
    verifyLicenseToken(parsed.data.token);
  } catch {
    return { valid: false, reason: "bad_signature", serverChecked: true };
  }
  try {
    return await repo.validateByToken({
      token: parsed.data.token,
      appId: parsed.data.appId,
      machineId: parsed.data.machineId ?? null,
    });
  } catch (error) {
    return { valid: false, reason: userMessage(error), serverChecked: true };
  }
}
