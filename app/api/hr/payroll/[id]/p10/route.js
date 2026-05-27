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
// KRA P10 — Monthly PAYE Return (CSV)
// Columns per KRA iTax bulk upload format
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
        { error: "P10 export is only available for approved or paid payroll runs" },
        { status: 400 }
      );
    }

    const entries = await PayrollEntry.find({
      payrollRunId: run._id,
      companyId: run.companyId,
    })
      .select("profileId employeeName employeeNumber earnings.basicSalary earnings.grossPay deductions.paye deductions.nssf deductions.shif deductions.housingLevy deductions.insuranceRelief")
      .sort({ employeeName: 1 })
      .lean();

    // Fetch profiles for KRA PIN and National ID
    const profileIds = entries.map((e) => e.profileId).filter(Boolean);
    const profiles = await EmployeeProfile.find({ _id: { $in: profileIds } })
      .select("_id personalInfo.kraPin personalInfo.nationalId")
      .lean();
    const profileMap = Object.fromEntries(profiles.map((p) => [p._id.toString(), p]));

    const periodLabel = run.period?.label || `${run.period?.month}/${run.period?.year}`;

    const headers = [
      "Employee Name",
      "Employee No",
      "KRA PIN",
      "National ID",
      "Basic Salary (KES)",
      "Gross Pay (KES)",
      "Taxable Income (KES)",
      "PAYE (KES)",
      "Insurance Relief (KES)",
      "NSSF Employee (KES)",
      "SHIF (KES)",
      "AHL Employee (KES)",
    ];

    const q = (s) => `"${(s || "").toString().replace(/"/g, '""')}"`;
    const n = (v) => (v || 0).toFixed(2);

    // Taxable income = gross pay minus NSSF (NSSF is allowable deduction before PAYE)
    const rows = entries.map((e) => {
      const prof = profileMap[e.profileId?.toString()] || {};
      const kraPin = prof.personalInfo?.kraPin || "";
      const nationalId = prof.personalInfo?.nationalId || "";
      const taxableIncome = (e.earnings?.grossPay || 0) - (e.deductions?.nssf || 0);
      return [
        q(e.employeeName),
        q(e.employeeNumber),
        q(kraPin),
        q(nationalId),
        n(e.earnings?.basicSalary),
        n(e.earnings?.grossPay),
        n(taxableIncome),
        n(e.deductions?.paye),
        n(e.deductions?.insuranceRelief),
        n(e.deductions?.nssf),
        n(e.deductions?.shif),
        n(e.deductions?.housingLevy),
      ].join(",");
    });

    // Totals row
    const totals = entries.reduce(
      (acc, e) => {
        acc.basicSalary += e.earnings?.basicSalary || 0;
        acc.grossPay += e.earnings?.grossPay || 0;
        acc.taxable += (e.earnings?.grossPay || 0) - (e.deductions?.nssf || 0);
        acc.paye += e.deductions?.paye || 0;
        acc.insuranceRelief += e.deductions?.insuranceRelief || 0;
        acc.nssf += e.deductions?.nssf || 0;
        acc.shif += e.deductions?.shif || 0;
        acc.ahl += e.deductions?.housingLevy || 0;
        return acc;
      },
      { basicSalary: 0, grossPay: 0, taxable: 0, paye: 0, insuranceRelief: 0, nssf: 0, shif: 0, ahl: 0 }
    );
    const totalsRow = [
      `"TOTAL (${entries.length} employees)"`,
      `""`,
      `""`,
      `""`,
      n(totals.basicSalary),
      n(totals.grossPay),
      n(totals.taxable),
      n(totals.paye),
      n(totals.insuranceRelief),
      n(totals.nssf),
      n(totals.shif),
      n(totals.ahl),
    ].join(",");

    const csv = [
      `"KRA P10 — Monthly PAYE Return — ${periodLabel}"`,
      headers.join(","),
      ...rows,
      totalsRow,
    ].join("\n");

    const filename = `p10-paye-${run.payrollNumber}-${periodLabel.replace(/\s/g, "-")}.csv`;

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
