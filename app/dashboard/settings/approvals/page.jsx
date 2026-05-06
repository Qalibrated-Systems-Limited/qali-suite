import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import Company from "@/app/models/Company";
import { APPROVAL_THRESHOLD_DEFAULTS } from "@/app/mongodb/queries/threshold-queries";
import ApprovalThresholdsForm from "./components/ApprovalThresholdsForm";

export const metadata = {
  title: "Approval Thresholds | Settings",
};

const ALLOWED_ROLES = new Set(["SuperAdmin", "Admin", "CFO"]);

export default async function ApprovalThresholdsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  if (!ALLOWED_ROLES.has(role)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Only Admin or CFO can change approval thresholds.
        </p>
      </div>
    );
  }

  // Read current values for this tenant. SuperAdmin without a companyId
  // is excluded — they should configure per-tenant via the SuperAdmin UI.
  await dbConnect();
  const { companyId } = await getTenantContext();
  if (!companyId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <h1 className="text-lg font-semibold">No company context</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          SuperAdmin should configure thresholds via the company admin page.
        </p>
      </div>
    );
  }

  const company = await Company.findById(companyId)
    .select("settings.approvalThresholds")
    .lean();
  const cfg = company?.settings?.approvalThresholds || {};
  const initial = {
    stockAdjustmentValue:
      cfg.stockAdjustmentValue ??
      APPROVAL_THRESHOLD_DEFAULTS.stockAdjustmentValue,
    stockHighRiskTypes:
      cfg.stockHighRiskTypes && cfg.stockHighRiskTypes.length > 0
        ? cfg.stockHighRiskTypes
        : APPROVAL_THRESHOLD_DEFAULTS.stockHighRiskTypes,
    minimumMarginPercent:
      cfg.minimumMarginPercent ??
      APPROVAL_THRESHOLD_DEFAULTS.minimumMarginPercent,
    creditNoteValue:
      cfg.creditNoteValue ?? APPROVAL_THRESHOLD_DEFAULTS.creditNoteValue,
    billPaymentValue:
      cfg.billPaymentValue ?? APPROVAL_THRESHOLD_DEFAULTS.billPaymentValue,
    discountCapPercent:
      cfg.discountCapPercent ??
      APPROVAL_THRESHOLD_DEFAULTS.discountCapPercent,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Settings
        </Link>
        <span>/</span>
        <span className="text-foreground">Approval thresholds</span>
      </nav>

      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          Approval thresholds
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
          Configure when transactions require finance approval. Defaults
          match Kenyan industrial / SMB practice — adjust to your risk
          appetite.
        </p>
      </header>

      <ApprovalThresholdsForm initial={initial} />
    </div>
  );
}
