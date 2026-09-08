"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withAuthorizedTenant } from "@/app/db/tenant";
import { userMessage } from "@/app/db/errors";
import { updateCompanySettings } from "@/app/db/repositories/companySettings";

// ============================================
// APPROVAL THRESHOLDS — UPDATE ACTION
// ============================================
// Per-company configuration of the approval engine. Only Admin / CFO
// (and SuperAdmin) can change these — they affect financial controls.
//
// MOVED HERE FROM app/mongodb/actions/, and the move is most of what
// happened. This action has written to POSTGRES since 0035; it was one of the
// three `settings` hits the counting grep reported as "still on Mongo", and
// the only thing Mongo about it was the directory it sat in.
//
// TWO THINGS DID CHANGE.
//
// THE ROLE GATE READ THE WRONG ROLE. `getTenantContext().user.role` is the
// GLOBAL role, so under the standing-access model somebody who is Admin of one
// company and a Viewer inside the one they are currently in passed it, and
// changed that company's financial controls. `withAuthorizedTenant` re-checks
// against the role for the ACTIVE company, which is the one that decides what
// this request may do.
//
// THE SUPERADMIN CROSS-COMPANY BRANCH IS GONE, because it was never reachable.
// It read `formData.get("companyId")`, and the form has no such field: the
// page renders `<ApprovalThresholdsForm initial={initial} />` with no company
// prop at all, so the value was always null and the branch always fell through
// to the tenant's own id. A SuperAdmin sets another company's thresholds by
// entering that company, which is how every other write in the app works.

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

const ALLOWED_ROLES = ["SuperAdmin", "Admin", "CFO"];

export async function updateApprovalThresholds(_prevState, formData) {
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

  try {
    // Written inside the tenant's own RLS scope. These are rules the books
    // obey, so they live next to the books rather than one store away from
    // the check that reads them.
    await withAuthorizedTenant(ALLOWED_ROLES, (tx, { companyId }) =>
      updateCompanySettings(tx, companyId, {
        stockAdjustmentValue: parsed.data.stockAdjustmentValue,
        stockHighRiskTypes: parsed.data.stockHighRiskTypes,
        minimumMarginPercent: parsed.data.minimumMarginPercent,
        creditNoteValue: parsed.data.creditNoteValue,
        billPaymentValue: parsed.data.billPaymentValue,
        discountCapPercent: parsed.data.discountCapPercent,
      }),
    );

    revalidatePath("/dashboard/settings/approvals");
    return { success: true, message: "Approval thresholds updated." };
  } catch (error) {
    return {
      success: false,
      error: userMessage(error, "Failed to update thresholds"),
    };
  }
}
