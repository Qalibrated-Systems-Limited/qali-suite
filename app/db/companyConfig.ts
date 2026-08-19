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
export const getSettingsFor = cache(
  async (sourceCompanyId: string): Promise<CompanySettings> => {
    const companyUuid = await lookupCompanyUuid(String(sourceCompanyId));
    if (!companyUuid) {
      throw new Error(
        "This company has no ledger tenant yet. Open it once, then try again.",
      );
    }
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
  const companyUuid = await lookupCompanyUuid(String(sourceCompanyId));
  if (!companyUuid) {
    throw new Error("This company has no ledger tenant yet.");
  }
  await withTenant(companyUuid, (tx) =>
    updateCompanySettings(tx, companyUuid, patch),
  );
  return { companyUuid };
}
