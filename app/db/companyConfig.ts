import "server-only";
import { cache } from "react";
import { withTenant } from "./client";
import { lookupCompanyUuid } from "./tenant";
import {
  getCompanySettings,
  updateCompanySettings,
  type CompanySettings,
} from "./repositories/companySettings";

/**
 * The rules a request obeys, read through the tenant's own scope.
 *
 * Callers here hold a Mongo company id — the one the session carries — so this
 * resolves it and then goes through `withTenant`, the same RLS path every
 * other read uses. Not the privileged connection: this is a tenant asking
 * about itself, not the platform asking about a tenant.
 *
 * Cached per request. Approval thresholds are consulted by several actions in
 * one render, and the Mongo version cached for the same reason.
 */
/**
 * BOTH FORMS OF COMPANY ID ARRIVE HERE, and only one of them used to work.
 *
 * `lookupCompanyUuid` resolves a MONGO id through `_migration_id_map`, which
 * is what the session carries and what the Mongo actions pass. But every
 * Postgres caller reads its company from `withAuthorizedTenant`'s context, and
 * `ctx.companyId` is `acting.companyUuid` — a UUID, which has no row in that
 * map. It resolved to null, and this threw "no ledger tenant yet" on a company
 * that plainly exists.
 *
 * Four call sites did it: the invoice discount cap, the bill-payment and
 * expense-payment approval thresholds, and stock adjustments. Three of those
 * are financial CONTROLS, and this function was written to fail closed rather
 * than fall back to platform defaults — so the control did not silently pass,
 * it took the whole action down with an error about opening the company.
 *
 * It survived because the two threshold suites mock `getCompanyThresholds`
 * entirely, so the id that reaches this resolver is never the one production
 * sends. Testing the layer above the seam cannot find a bug in the seam.
 */
const COMPANY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ledger tenant, from whichever form of id the caller happens to hold.
 *
 * A UUID is already the tenant and needs no lookup — resolving it would send
 * it to `_migration_id_map`, where UUIDs have no rows. Anything else is a
 * Mongo id and is mapped.
 *
 * Shared by both entry points here, because both had the bug and fixing one
 * would have left the other.
 */
async function resolveSettingsCompany(sourceCompanyId: string) {
  const given = String(sourceCompanyId ?? "").trim();
  const companyUuid = COMPANY_UUID.test(given)
    ? given
    : await lookupCompanyUuid(given);

  if (!companyUuid) {
    throw new Error(
      "This company has no ledger tenant yet. Open it once, then try again.",
    );
  }
  return companyUuid;
}

export const getSettingsFor = cache(
  async (sourceCompanyId: string): Promise<CompanySettings> => {
    const companyUuid = await resolveSettingsCompany(sourceCompanyId);
    return withTenant(companyUuid, (tx) => getCompanySettings(tx, companyUuid));
  },
);

/**
 * Approval thresholds as numbers, for the action layer.
 *
 * NO SILENT FALLBACK. The Mongo version returned platform defaults whenever
 * the read threw, which meant a company that had set `stockAdjustmentValue` to
 * 0 — "always require approval" — got 50,000 instead the moment the database
 * hiccupped, and adjustments up to fifty thousand shillings auto-approved.
 * A control that fails open is worse than one that fails.
 *
 * The row cannot be missing: every column is NOT NULL with a default and the
 * row is created with the company (0035), so there is nothing left to
 * substitute for.
 */
export async function getCompanyThresholds(sourceCompanyId: string) {
  const s = await getSettingsFor(sourceCompanyId);
  const t = s.approvalThresholds;
  return {
    stockAdjustmentValue: Number(t.stockAdjustmentValue),
    stockRequestValue: Number(t.stockRequestValue),
    stockHighRiskTypes: t.stockHighRiskTypes,
    minimumMarginPercent: Number(t.minimumMarginPercent),
    creditNoteValue: Number(t.creditNoteValue),
    billPaymentValue: Number(t.billPaymentValue),
    expensePaymentValue: Number(t.expensePaymentValue),
    discountCapPercent: Number(t.discountCapPercent),
  };
}

/** Writes the thresholds a form collected, inside the tenant's own scope. */
export async function saveCompanyThresholds(
  sourceCompanyId: string,
  patch: Parameters<typeof updateCompanySettings>[2],
) {
  const companyUuid = await resolveSettingsCompany(String(sourceCompanyId));
  await withTenant(companyUuid, (tx) =>
    updateCompanySettings(tx, companyUuid, patch),
  );
  return { companyUuid };
}
