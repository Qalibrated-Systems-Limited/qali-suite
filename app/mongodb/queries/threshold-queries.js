import "server-only";

import { getTenantContext } from "@/lib/utils/tenant-utils";
import {
  getCompanyThresholds as readThresholds,
} from "@/app/db/companyConfig";

// ============================================
// APPROVAL THRESHOLDS — per-company configuration
// ============================================
// Single source of truth for the action layer, read from Postgres since 0035:
// these are rules the books obey, and a rule read from another store is a rule
// outside the transaction meant to honour it.
//
// NO SILENT FALLBACK ANY MORE. This used to answer platform defaults whenever
// the read threw — so a company that had set stockAdjustmentValue to 0,
// meaning "always require approval", got 50,000 instead the moment the
// database hiccupped, and adjustments up to fifty thousand shillings
// auto-approved. A financial control that fails open is worse than one that
// fails. The caller now sees the error.
//
// The values themselves are still NOT NULL with defaults in the database, and
// the row is created with the company, so there is nothing left to substitute.

const DEFAULTS = Object.freeze({
  stockAdjustmentValue: 50_000,
  stockRequestValue: 100_000,
  stockHighRiskTypes: ["theft", "write_off", "expiry"],
  minimumMarginPercent: 8,
  creditNoteValue: 25_000,
  billPaymentValue: 100_000,
  expensePaymentValue: 50_000,
  discountCapPercent: 15,
});

/** Caching lives in getSettingsFor, which several actions share per request. */
export const getCompanyThresholds = async (companyId) => {
  if (!companyId) {
    throw new Error("Approval thresholds asked for without a company.");
  }
  return readThresholds(String(companyId));
};

/**
 * Convenience wrapper that auto-resolves the caller's tenant context.
 * Use this from server actions where you already have getTenantContext.
 */
export async function getCallerThresholds() {
  const { companyId } = await getTenantContext();
  return getCompanyThresholds(companyId?.toString?.() || companyId);
}

export const APPROVAL_THRESHOLD_DEFAULTS = DEFAULTS;
