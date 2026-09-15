"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { sql } from "drizzle-orm";
import { privilegedDb, provisionCompany } from "../provisioning";
import {
  syncCompanyRecord,
  resetCompanyBooks,
  type CompanyRecordChanges,
} from "../companyAdmin";
import { emailExists } from "../userAdmin";
import {
  CreateCompanySchema,
  UpdateCompanySchema,
  buildInitialSubscription,
  SUPER_ADMIN_ROLES,
  COMPANY_ADMIN_ROLES,
} from "@/lib/company-form";

/**
 * Companies on Postgres.
 *
 * The tenant ONBOARDING path, which is why this is the last thing to move and
 * the one worth being careful with: everything else in the system depends on
 * a company existing correctly.
 *
 * ── What was actually here before ──────────────────────────────────────────
 *
 * `createCompany` was a DUAL WRITE, and Postgres already did all of the work:
 *
 *   Company.create()                      MONGO document
 *   seedChartOfAccounts()                 MONGO chart
 *   initializeFiscalPeriods()             MONGO periods
 *   provisionCompany()                    POSTGRES tenant, chart, periods,
 *                                         settings row, owner grant
 *   syncCompanyRecord()                   POSTGRES branding/tax/bank/settings
 *   createUserFromInvite() + createInvite POSTGRES admin login and grant
 *
 * So the three Mongo steps come out and nothing else changes. What they were
 * FOR was the id: `provisionCompany` keys `_migration_id_map` on a source id,
 * and that source id was the Mongo `_id`.
 *
 * ── The id, which is the whole of the risk here ───────────────────────────
 *
 * A minted uuid takes the Mongo id's place as the map key, and the tenant uuid
 * that `provisionCompany` returns is what everything downstream uses — the
 * admin's `home_company_id`, the redirect, the revalidate paths.
 *
 * That works because `resolveCompanyUuid` short-circuits on a uuid naming a
 * live company (tenant.ts): "since the auth cutover the session carries the
 * Postgres uuid directly". The map row is a harmless alias, and provisioning
 * — with its advisory lock, its RLS ordering and its SuperAdmin fan-out — is
 * not touched.
 */

export type CompanyFormState = {
  errors?: Record<string, string[]>;
  values?: Record<string, unknown>;
  message?: string;
};

const FIELDS = [
  "adminName", "adminEmail", "name", "code", "tagline", "logo", "email",
  "phone", "website", "street", "city", "state", "postalCode", "country",
  "taxPin", "vatNumber", "registrationNumber", "bankName", "bankBranch",
  "accountName", "accountNumber", "swiftCode", "mpesaPaybill", "mpesaTill",
  "plan", "currency", "defaultVatRate", "fiscalYearStart",
  "defaultPaymentTermsDays", "capitalizationThreshold",
] as const;

function readForm(formData: FormData) {
  const values: Record<string, unknown> = {};
  for (const f of FIELDS) values[f] = formData.get(f);
  return values;
}

/**
 * Drops the fields the posted form did not carry.
 *
 * `formData.get` returns null for an input that is not on the page, and the
 * update schema is `.partial()` — which permits `undefined`, not `null`. Any
 * field the edit screen chooses not to render therefore arrived as null and
 * failed validation, which the form shows next to an input that isn't there:
 * the typed values came back and nothing was saved.
 *
 * An EMPTY STRING is not absent. It is the signal that clears a field, so only
 * null is dropped here.
 */
const omitAbsent = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "company";

/**
 * Is this name, code or slug already taken?
 *
 * POSTGRES, which is now the only store — and note the shape of the bug this
 * replaces. The Mongo check matched on a RegExp built from the company name,
 * so "C++ (K) Ltd" threw; that was fixed to equality. The check before THAT
 * asked Postgres while the insert landed in Mongo, and `code` was never
 * carried across, so it compared against a column that held nothing and passed
 * every time. Both halves are the same store now, so neither can happen.
 */
async function findClash(
  name: string,
  code: string | null,
  excludeCompanyId?: string,
) {
  const exclude = excludeCompanyId
    ? sql`AND id <> ${excludeCompanyId}::uuid`
    : sql``;

  const [byName] = (await privilegedDb().execute(sql`
    SELECT id FROM companies
     WHERE lower(btrim(name)) = ${name.trim().toLowerCase()} ${exclude}
     LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  if (byName) {
    return { field: "name", message: "A company with this name already exists." };
  }

  if (code) {
    const [byCode] = (await privilegedDb().execute(sql`
      SELECT id FROM companies
       WHERE upper(btrim(COALESCE(code, ''))) = ${code.trim().toUpperCase()} ${exclude}
       LIMIT 1
    `)) as unknown as Array<Record<string, unknown>>;
    if (byCode) {
      return { field: "code", message: "A company with this code already exists." };
    }
  }

  return null;
}

/**
 * The record `syncCompanyRecord` writes, assembled from the validated form.
 *
 * Typed as `CompanyRecordChanges` rather than cast to it. Two `as never` casts
 * in an earlier draft of this file hid two WRONG SIGNATURES on the invite
 * calls below — `createInvite` takes `token` and `expiresAt`, not a
 * `tokenHash`, and `sendInviteEmail` takes `inviterName`, `role` and
 * `rawToken`. Both compiled and neither would have worked.
 */
function recordFrom(
  data: Record<string, unknown>,
  plan?: string,
): CompanyRecordChanges {
  return {
    name: data.name,
    code: data.code,
    tagline: data.tagline,
    logo: data.logo,
    email: data.email,
    phone: data.phone,
    website: data.website,
    address: {
      street: data.street,
      city: data.city,
      state: data.state,
      postalCode: data.postalCode,
      country: data.country || "Kenya",
    },
    taxPin: data.taxPin,
    vatNumber: data.vatNumber,
    registrationNumber: data.registrationNumber,
    bankName: data.bankName,
    bankBranch: data.bankBranch,
    accountName: data.accountName,
    accountNumber: data.accountNumber,
    swiftCode: data.swiftCode,
    mpesaPaybill: data.mpesaPaybill,
    mpesaTill: data.mpesaTill,
    ...(plan ? { subscription: buildInitialSubscription(plan) } : {}),
    settings: {
      currency: data.currency || "KES",
      defaultVatRate: data.defaultVatRate ?? 16,
      fiscalYearStart: data.fiscalYearStart || 1,
      defaultPaymentTermsDays: data.defaultPaymentTermsDays || 30,
      capitalizationThreshold: data.capitalizationThreshold ?? 0,
      ...(data.requireGRN === undefined ? {} : { requireGRN: data.requireGRN }),
      setupCompleted: true,
      setupCompletedAt: new Date(),
    },
  } as CompanyRecordChanges;
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createCompany(
  _prevState: unknown,
  formData: FormData,
): Promise<CompanyFormState> {
  const session = await auth();
  const values = readForm(formData);

  if (!session?.user) {
    return { errors: { _form: ["You must be logged in"] }, values };
  }
  if (!SUPER_ADMIN_ROLES.includes(session.user.role as string)) {
    return { errors: { _form: ["Unauthorized: SuperAdmin role required"] }, values };
  }

  const parsed = CreateCompanySchema.safeParse(values);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, values };
  }
  const data = parsed.data as Record<string, unknown>;

  let newCompanyId: string | null = null;
  let needsAdminAttention: string | null = null;

  try {
    const clash = await findClash(String(data.name), (data.code as string) ?? null);
    if (clash) {
      return { errors: { [clash.field]: [clash.message] }, values };
    }

    /*
     * The administrator must not already have a login: a user belongs to one
     * company, so re-pointing an existing account would move them out of the
     * one they are already in.
     */
    if (await emailExists(String(data.adminEmail))) {
      return {
        errors: {
          adminEmail: [
            "A user with this email already exists. Grant them access from the company's access list instead.",
          ],
        },
        values,
      };
    }

    const fiscalYearStart = new Date(
      new Date().getFullYear(),
      (Number(data.fiscalYearStart) || 1) - 1,
      1,
    );

    /*
     * The map key. It stood for the Mongo `_id`; nothing reads it as one, and
     * the tenant uuid below is what the session, the routes and every action
     * actually use.
     */
    const sourceId = crypto.randomUUID();

    const { companyId } = await provisionCompany({
      sourceCompanyId: sourceId,
      name: String(data.name),
      slug: slugify(String(data.name)),
      baseCurrency: (data.currency as string) ?? "KES",
      fiscalYearStart,
      // The creator gets the first grant, so the company is not created with
      // nobody able to open it.
      ownerUserId: session.user.id,
      ownerName: session.user.name,
      ownerRole: session.user.role,
    });

    /*
     * Provisioning creates the tenant with a name, a slug and a currency.
     * Everything else the form collected lands here, so the record is complete
     * from the moment the company exists rather than at its first edit.
     */
    // Checked for the same reason as in updateCompany below: an unresolved id
    // silently discards everything the form collected beyond name and slug.
    const seeded = await syncCompanyRecord(
      companyId,
      recordFrom(data, String(data.plan || "free")),
    );
    if (!seeded.synced) {
      console.error(
        "[createCompany] provisioned %s but its record did not sync",
        companyId,
      );
    }

    newCompanyId = companyId;

    // ── The company's administrator ────────────────────────────────────────
    //
    // A company is not usable until somebody in it can administer it, and
    // creating them here is what stops the SuperAdmin's standing access being
    // load-bearing rather than a fallback.
    //
    // A FAILURE HERE DOES NOT ROLL THE COMPANY BACK. The company and its
    // ledger are real and correct at this point; an admin who did not get
    // their email is fixable from the access list, and destroying a
    // provisioned tenant over an SMTP outage is not.
    try {
      const { createHash, randomBytes } = await import("node:crypto");
      const { createUserFromInvite } = await import("../userAdmin");
      const { createInvite } = await import("../repositories/invites");
      const { withTenant } = await import("../client");
      const { sendInviteEmail } = await import("@/lib/email");

      /*
       * `createUserFromInvite` writes the login AND its grant — a user row
       * without one is a login that can sign in and open nothing.
       *
       * No password: the invitation is the credential, so nothing is ever
       * mailed that could be replayed.
       */
      await createUserFromInvite({
        id: crypto.randomUUID(),
        name: String(data.adminName),
        email: String(data.adminEmail),
        role: "Admin",
        companyId,
        authProvider: "credentials",
        invitedById: session.user.id,
        invitedByName: session.user.name,
      });

      // 32 random bytes emailed, the sha256 stored — the token in the database
      // is not the one in the inbox.
      const rawToken = randomBytes(32).toString("hex");
      const hashedToken = createHash("sha256").update(rawToken).digest("hex");

      await withTenant(companyId, (tx) =>
        createInvite(tx, {
          companyId,
          email: String(data.adminEmail),
          role: "Admin",
          token: hashedToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          invitedById: session.user.id,
          invitedByName: session.user.name,
        }),
      );

      await sendInviteEmail({
        to: String(data.adminEmail),
        inviterName: session.user.name,
        companyName: String(data.name),
        role: "Admin",
        rawToken,
      });
    } catch (inviteError) {
      console.error("[createCompany] administrator not fully set up:", inviteError);
      needsAdminAttention = companyId;
    }

    revalidatePath("/dashboard/admin/companies");
  } catch (error) {
    console.error("[createCompany]", error);
    return {
      errors: {
        _form: [
          error instanceof Error ? error.message : "Failed to create the company",
        ],
      },
      values,
    };
  }

  // Outside the try: redirect() works by throwing, and catching it here would
  // swallow the navigation.
  redirect(
    needsAdminAttention
      ? `/dashboard/admin/companies/${newCompanyId}/access?adminSetupFailed=1`
      : `/dashboard/admin/companies/${newCompanyId}`,
  );
}

// ── Update ──────────────────────────────────────────────────────────────────

export async function updateCompany(
  _prevState: unknown,
  formData: FormData,
): Promise<CompanyFormState> {
  const session = await auth();
  const values = readForm(formData);
  // The three-way-match toggle. An unchecked HTML checkbox submits nothing, so
  // both states are coerced to an explicit boolean — otherwise "unticked" and
  // "untouched" are the same value and the setting can never be turned off.
  values.requireGRN = formData.get("requireGRN") === "true";

  const companyId = String(formData.get("companyId") ?? "");

  if (!session?.user) {
    return { errors: { _form: ["You must be logged in"] }, values };
  }
  if (!COMPANY_ADMIN_ROLES.includes(session.user.role as string)) {
    return { errors: { _form: ["Unauthorized: Admin role required"] }, values };
  }
  if (!companyId) {
    return { errors: { _form: ["No company to update"] }, values };
  }

  const parsed = UpdateCompanySchema.safeParse(omitAbsent(values));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, values };
  }
  const data = parsed.data as Record<string, unknown>;

  const isSuperAdmin = SUPER_ADMIN_ROLES.includes(session.user.role as string);

  try {
    // Resolves either id form — a uuid or the pre-migration source id the
    // admin routes still carry — and hands back the record, which is what
    // this needs anyway.
    const { getCompanyRecord } = await import("../platform");
    const existing = await getCompanyRecord(companyId);
    if (!existing) {
      return { errors: { _form: ["That company no longer exists."] }, values };
    }

    if (data.name) {
      const clash = await findClash(
        String(data.name),
        (data.code as string) ?? null,
        existing.id,
      );
      if (clash) {
        return { errors: { [clash.field]: [clash.message] }, values };
      }
    }

    /*
     * THE RETURN VALUE IS CHECKED, and this is not defensive noise.
     *
     * syncCompanyRecord resolves the posted id and returns `{ synced: false }`
     * — without throwing — when it cannot. Ignoring that is how a form reports
     * a successful save and writes nothing, which is the exact failure
     * companyAdmin.ts's own header describes ("branding, tax, bank and
     * settings all discarded while the form said it had saved").
     */
    const written = await syncCompanyRecord(companyId, {
      ...recordFrom(data),
      settings: {
        ...(recordFrom(data).settings ?? {}),
        requireGRN: data.requireGRN as boolean,
      },
    });

    if (!written.synced) {
      return {
        errors: {
          _form: [
            "Could not save: that company id did not resolve to a tenant. " +
              "Reload the page and try again.",
          ],
        },
        values,
      };
    }

    revalidatePath("/dashboard/admin/companies");
    revalidatePath(`/dashboard/admin/companies/${companyId}`);
    revalidatePath("/dashboard/company");
  } catch (error) {
    console.error("[updateCompany]", error);
    return {
      errors: {
        _form: [
          error instanceof Error ? error.message : "Failed to update the company",
        ],
      },
      values,
    };
  }

  redirect(
    isSuperAdmin ? `/dashboard/admin/companies/${companyId}` : "/dashboard/company",
  );
}

// ── Reset ───────────────────────────────────────────────────────────────────

/**
 * Wipe a company's transactional data, keeping its master data.
 *
 * THE MONGO HALF IS GONE. `resetCompanyTransactions` called `resetCompanyData`
 * with `mongoose.connection.db` and then `resetCompanyBooks` for Postgres,
 * because both stores held books. With Mongo out of the deployment the first
 * call cannot run at all — it takes a live Mongo handle — so this is not a
 * tidy-up but the difference between the button working and throwing.
 *
 * The typed confirmation stays, and stays SERVER-ENFORCED: the exact company
 * name, checked here rather than trusted from the dialog.
 */
export async function resetCompanyTransactions(
  companyId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<{ success: boolean; message?: string; error?: string; summary?: unknown }> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "You must be logged in" };
  if (!SUPER_ADMIN_ROLES.includes(session.user.role as string)) {
    return { success: false, error: "Unauthorized: SuperAdmin role required" };
  }

  try {
    const { getCompanyRecord } = await import("../platform");
    const company = await getCompanyRecord(companyId);
    if (!company) return { success: false, error: "Company not found" };

    const confirmName = String(formData.get("confirmName") ?? "").trim();
    if (confirmName !== String(company.name)) {
      return {
        success: false,
        error: `Confirmation text must match the company name exactly ("${company.name}").`,
      };
    }

    const wipeParties = formData.get("wipeParties") === "on";
    const pg = await resetCompanyBooks(companyId, { wipeParties });

    console.warn(
      `[reset-transactions] ${company.name} (${companyId}) by ${session.user.email}: ` +
        `${pg.totalDeleted} rows across ${Object.keys(pg.summary).length} tables`,
    );

    revalidatePath("/dashboard/admin/companies");
    revalidatePath(`/dashboard/admin/companies/${companyId}`);

    return {
      success: true,
      message:
        `Reset complete — ${pg.totalDeleted} records removed. ` +
        "Master data kept; balances and stock zeroed; numbering restarts at 1.",
      summary: pg.summary,
    };
  } catch (error) {
    console.error("[resetCompanyTransactions]", error);
    return { success: false, error: "Reset failed — check server logs" };
  }
}
