"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import Company from "@/app/models/Company";

// ============================================
// APPROVAL THRESHOLDS — UPDATE ACTION
// ============================================
// Per-company configuration of the approval engine. Only Admin / CFO
// (and SuperAdmin) can change these — they affect financial controls.

const VALID_HIGH_RISK_TYPES = [
  "physical_count",
  "damage",
  "expiry",
  "theft",
  "correction",
  "write_off",
  "found",
  "other",
];

const ThresholdsSchema = z.object({
  stockAdjustmentValue: z.coerce.number().min(0).max(1_000_000_000),
  stockHighRiskTypes: z
    .array(z.enum(VALID_HIGH_RISK_TYPES))
    .max(VALID_HIGH_RISK_TYPES.length),
  minimumMarginPercent: z.coerce.number().min(0).max(100),
  creditNoteValue: z.coerce.number().min(0).max(1_000_000_000),
  billPaymentValue: z.coerce.number().min(0).max(1_000_000_000),
  discountCapPercent: z.coerce.number().min(0).max(100),
});

const ALLOWED_ROLES = new Set(["SuperAdmin", "Admin", "CFO"]);

export async function updateApprovalThresholds(_prevState, formData) {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!ALLOWED_ROLES.has(user.role)) {
      return {
        success: false,
        error: "Only Admin or CFO can change approval thresholds.",
      };
    }

    // SuperAdmin can target an explicit companyId; tenant users use theirs.
    const targetCompanyId = isSuperAdmin
      ? formData.get("companyId") || companyId
      : companyId;
    if (!targetCompanyId) {
      return { success: false, error: "Company context missing" };
    }

    // Form posts a comma-separated list for high-risk types.
    const raw = Object.fromEntries(formData.entries());
    const highRiskInput =
      typeof raw.stockHighRiskTypes === "string"
        ? raw.stockHighRiskTypes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const parsed = ThresholdsSchema.safeParse({
      stockAdjustmentValue: raw.stockAdjustmentValue,
      stockHighRiskTypes: highRiskInput,
      minimumMarginPercent: raw.minimumMarginPercent,
      creditNoteValue: raw.creditNoteValue,
      billPaymentValue: raw.billPaymentValue,
      discountCapPercent: raw.discountCapPercent,
    });

    if (!parsed.success) {
      return {
        success: false,
        error: "Invalid input",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    await Company.findByIdAndUpdate(
      targetCompanyId,
      {
        $set: {
          "settings.approvalThresholds.stockAdjustmentValue":
            parsed.data.stockAdjustmentValue,
          "settings.approvalThresholds.stockHighRiskTypes":
            parsed.data.stockHighRiskTypes,
          "settings.approvalThresholds.minimumMarginPercent":
            parsed.data.minimumMarginPercent,
          "settings.approvalThresholds.creditNoteValue":
            parsed.data.creditNoteValue,
          "settings.approvalThresholds.billPaymentValue":
            parsed.data.billPaymentValue,
          "settings.approvalThresholds.discountCapPercent":
            parsed.data.discountCapPercent,
        },
      },
      { runValidators: true },
    );

    revalidatePath("/dashboard/settings/approvals");
    return { success: true, message: "Approval thresholds updated." };
  } catch (error) {
    console.error("updateApprovalThresholds error:", error);
    return {
      success: false,
      error: error.message || "Failed to update thresholds",
    };
  }
}
