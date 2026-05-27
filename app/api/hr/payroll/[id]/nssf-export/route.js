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
// NSSF Monthly Contribution Return (CSV)
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
        { error: "NSSF export is only available for approved or paid payroll runs" },
        { status: 400 }
      );
    }

    const entries = await PayrollEntry.find({
      payrollRunId: run._id,
      companyId: run.companyId,
    })
      .select("profileId employeeName employeeNumber earnings.grossPay deductions.nssf employerContributions.nssf")
      .sort({ employeeName: 1 })
      .lean();

    const profileIds = entries.map((e) => e.profileId).filter(Boolean);
    const profiles = await EmployeeProfile.find({ _id: { $in: profileIds } })
      .select("_id personalInfo.nationalId personalInfo.nssfNumber")
      .lean();
    const profileMap = Object.fromEntries(profiles.map((p) => [p._id.toString(), p]));

    const periodLabel = run.period?.label || `${run.period?.month}/${run.period?.year}`;

    const headers = [
      "Employee Name",
      "Employee No",
      "National ID",
      "NSSF No",
      "Gross Pay (KES)",
      "Employee NSSF (KES)",
      "Employer NSSF (KES)",
      "Total NSSF (KES)",
    ];

    const q = (s) => `"${(s || "").toString().replace(/"/g, '""')}"`;
    const n = (v) => (v || 0).toFixed(2);

    const rows = entries.map((e) => {
      const prof = profileMap[e.profileId?.toString()] || {};
      const empNSSF = e.deductions?.nssf || 0;
      const emplrNSSF = e.employerContributions?.nssf || 0;
      return [
        q(e.employeeName),
        q(e.employeeNumber),
        q(prof.personalInfo?.nationalId),
        q(prof.personalInfo?.nssfNumber),
        n(e.earnings?.grossPay),
        n(empNSSF),
        n(emplrNSSF),
        n(empNSSF + emplrNSSF),
      ].join(",");
    });

    const totals = entries.reduce(
      (acc, e) => {
        acc.gross += e.earnings?.grossPay || 0;
        acc.empNSSF += e.deductions?.nssf || 0;
        acc.emplrNSSF += e.employerContributions?.nssf || 0;
        return acc;
      },
      { gross: 0, empNSSF: 0, emplrNSSF: 0 }
    );
    const totalsRow = [
      `"TOTAL (${entries.length} employees)"`,
      `""`, `""`, `""`,
      n(totals.gross),
      n(totals.empNSSF),
      n(totals.emplrNSSF),
      n(totals.empNSSF + totals.emplrNSSF),
    ].join(",");

    const csv = [
      `"NSSF Monthly Contribution Return — ${periodLabel}"`,
      headers.join(","),
      ...rows,
      totalsRow,
    ].join("\n");

    const filename = `nssf-${run.payrollNumber}-${periodLabel.replace(/\s/g, "-")}.csv`;

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
