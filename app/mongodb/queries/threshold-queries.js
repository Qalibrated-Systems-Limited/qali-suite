import "server-only";
import { cache } from "react";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import Company from "@/app/models/Company";

// ============================================
// APPROVAL THRESHOLDS — per-company configuration
// ============================================
// Single source of truth for the action layer. Replaces hardcoded
// constants. Cached per request — multiple actions calling this in the
// same render share one DB read.
//
// Returns sensible fallbacks if the company doc lacks the sub-doc (e.g.
// for tenants created before the schema was added).

const DEFAULTS = Object.freeze({
  stockAdjustmentValue: 50_000,
  stockHighRiskTypes: ["theft", "write_off", "expiry"],
  minimumMarginPercent: 8,
  creditNoteValue: 25_000,
  billPaymentValue: 100_000,
  discountCapPercent: 15,
});

export const getCompanyThresholds = cache(async (companyId) => {
  if (!companyId) return { ...DEFAULTS };
  try {
    await dbConnect();
    const company = await Company.findById(companyId)
      .select("settings.approvalThresholds")
      .lean();
    const cfg = company?.settings?.approvalThresholds || {};
    return {
      stockAdjustmentValue:
        cfg.stockAdjustmentValue ?? DEFAULTS.stockAdjustmentValue,
      stockHighRiskTypes:
        cfg.stockHighRiskTypes && cfg.stockHighRiskTypes.length > 0
          ? cfg.stockHighRiskTypes
          : DEFAULTS.stockHighRiskTypes,
      minimumMarginPercent:
        cfg.minimumMarginPercent ?? DEFAULTS.minimumMarginPercent,
      creditNoteValue: cfg.creditNoteValue ?? DEFAULTS.creditNoteValue,
      billPaymentValue: cfg.billPaymentValue ?? DEFAULTS.billPaymentValue,
      discountCapPercent:
        cfg.discountCapPercent ?? DEFAULTS.discountCapPercent,
    };
  } catch (error) {
    console.error("getCompanyThresholds error:", error);
    return { ...DEFAULTS };
  }
});

/**
 * Convenience wrapper that auto-resolves the caller's tenant context.
 * Use this from server actions where you already have getTenantContext.
 */
export async function getCallerThresholds() {
  try {
    const { companyId } = await getTenantContext();
    return getCompanyThresholds(companyId?.toString?.() || null);
  } catch {
    return { ...DEFAULTS };
  }
}

export const APPROVAL_THRESHOLD_DEFAULTS = DEFAULTS;
