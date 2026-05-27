import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import PayrollRun from "@/app/models/payrollRun";
import PayrollEntry from "@/app/models/payrollEntry";
import EmployeeProfile from "@/app/models/employeeProfile";
import { checkPlanAccess } from "@/lib/plan-gate";

const ALLOWED = ["SuperAdmin", "Admin", "HR", "Accountant"];

// ============================================
// SHIF Monthly Contribution Return (CSV)
// Social Health Insurance Fund (replaced NHIF Oct 2024)
// Rate: 2.75% of gross pay
// ============================================
export async function GET(_req, { params }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!ALLOWED.includes(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const gate = await checkPlanAccess("hr");
    if (!gate.allowed) {
      return NextResponse.json({ error: "This feature requires a plan upgrade" }, { status: 403 });
    }

    const { id } = await params;
    await dbConnect();

    const { companyId, isSuperAdmin } = await getTenantContext();

    const run = await PayrollRun.findOne(
      withTenantScope({ _id: id }, companyId, isSuperAdmin)
    ).lean();
    if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });

    if (!["approved", "paid"].includes(run.status)) {
      return NextResponse.json(
        { error: "SHIF export is only available for approved or paid payroll runs" },
        { status: 400 }
      );
    }

    const entries = await PayrollEntry.find({
      payrollRunId: run._id,
      companyId: run.companyId,
    })
      .select("profileId employeeName employeeNumber earnings.grossPay deductions.shif")
      .sort({ employeeName: 1 })
      .lean();

    const profileIds = entries.map((e) => e.profileId).filter(Boolean);
    // Tenant-scope the batch load — without companyId, a known profileId
    // from another tenant could leak personal info into the export.
    const profiles = await EmployeeProfile.find({
      _id: { $in: profileIds },
      companyId: run.companyId,
    })
      // Select both new + legacy field so records created before the rename still surface.
      .select("_id personalInfo.nationalId personalInfo.shaNumber personalInfo.nhifNumber")
      .lean();
    const profileMap = Object.fromEntries(profiles.map((p) => [p._id.toString(), p]));

    const periodLabel = run.period?.label || `${run.period?.month}/${run.period?.year}`;

    const headers = [
      "Employee Name",
      "Employee No",
      "National ID",
      "SHA No",
      "Gross Pay (KES)",
      "SHIF Contribution (KES)",
    ];

    const q = (s) => `"${(s || "").toString().replace(/"/g, '""')}"`;
    const n = (v) => (v || 0).toFixed(2);

    const rows = entries.map((e) => {
      const prof = profileMap[e.profileId?.toString()] || {};
      return [
        q(e.employeeName),
        q(e.employeeNumber),
        q(prof.personalInfo?.nationalId),
        q(prof.personalInfo?.shaNumber || prof.personalInfo?.nhifNumber),
        n(e.earnings?.grossPay),
        n(e.deductions?.shif),
      ].join(",");
    });

    const totals = entries.reduce(
      (acc, e) => {
        acc.gross += e.earnings?.grossPay || 0;
        acc.shif += e.deductions?.shif || 0;
        return acc;
      },
      { gross: 0, shif: 0 }
    );
    const totalsRow = [
      `"TOTAL (${entries.length} employees)"`,
      `""`, `""`, `""`,
      n(totals.gross),
      n(totals.shif),
    ].join(",");

    const csv = [
      `"SHIF Monthly Contribution Return — ${periodLabel}"`,
      headers.join(","),
      ...rows,
      totalsRow,
    ].join("\n");

    const filename = `shif-${run.payrollNumber}-${periodLabel.replace(/\s/g, "-")}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "Export failed") }, { status: 500 });
  }
}
