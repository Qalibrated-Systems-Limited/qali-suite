import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import PayrollEntry from "@/app/models/payrollEntry";
import EmployeeProfile from "@/app/models/employeeProfile";
import { checkPlanAccess } from "@/lib/plan-gate";

const ALLOWED = ["SuperAdmin", "Admin", "HR", "Accountant"];

// ============================================
// P9A ANNUAL PAYE CERTIFICATE — CSV
// GET /api/hr/p9a?year=2026
//
// Per-employee annual summary:
//   Month-by-month breakdown of gross pay, taxable income, PAYE.
//   Required by KRA iTax for employer filing (due end of February).
//   Each employee gets one row with 12 monthly breakdowns.
//
// Format: wide CSV — one row per employee, columns for each month.
// ============================================
export async function GET(req) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!ALLOWED.includes(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const gate = await checkPlanAccess("hr");
    if (!gate.allowed) {
      return NextResponse.json({ error: "This feature requires a plan upgrade" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const year = parseInt(searchParams.get("year") || new Date().getFullYear());

    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Fetch all payroll entries for the year (across all runs)
    const entries = await PayrollEntry.find(
      withTenantScope(
        { "period.year": year },
        companyId,
        isSuperAdmin
      )
    )
      .select("partyId profileId employeeName employeeNumber department period.month earnings.grossPay deductions.paye deductions.nssf deductions.shif deductions.housingLevy deductions.insuranceRelief")
      .sort({ "period.month": 1 })
      .lean();

    if (entries.length === 0) {
      return NextResponse.json({ error: `No payroll data found for ${year}` }, { status: 404 });
    }

    // Fetch KRA PINs from profiles
    const profileIds = [...new Set(entries.map((e) => e.profileId?.toString()).filter(Boolean))];
    const profiles = await EmployeeProfile.find({ _id: { $in: profileIds } })
      .select("_id personalInfo.kraPin personalInfo.nationalId")
      .lean();
    const profileMap = Object.fromEntries(profiles.map((p) => [p._id.toString(), p]));

    // Group entries by employee (partyId)
    const employeeMap = {};
    for (const entry of entries) {
      const pid = entry.partyId?.toString();
      if (!pid) continue;
      if (!employeeMap[pid]) {
        employeeMap[pid] = {
          employeeName: entry.employeeName,
          employeeNumber: entry.employeeNumber,
          department: entry.department,
          profileId: entry.profileId?.toString(),
          months: {},
        };
      }
      const m = entry.period?.month;
      if (m) {
        employeeMap[pid].months[m] = {
          grossPay: entry.earnings?.grossPay || 0,
          nssf: entry.deductions?.nssf || 0,
          paye: entry.deductions?.paye || 0,
          shif: entry.deductions?.shif || 0,
          ahl: entry.deductions?.housingLevy || 0,
          insuranceRelief: entry.deductions?.insuranceRelief || 0,
        };
      }
    }

    const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    // Build headers: Employee info + per-month gross + taxable + paye, then annual totals
    const headers = [
      "Employee Name", "Employee No", "KRA PIN", "National ID", "Department",
      ...MONTH_NAMES.flatMap((m) => [`${m} Gross`, `${m} Taxable`, `${m} PAYE`, `${m} Ins Relief`]),
      "Annual Gross", "Annual NSSF", "Annual Taxable", "Annual PAYE", "Annual Ins Relief",
    ];

    const q = (s) => `"${(s || "").toString().replace(/"/g, '""')}"`;
    const n = (v) => (v || 0).toFixed(2);

    const rows = Object.values(employeeMap).map((emp) => {
      const prof = profileMap[emp.profileId] || {};
      const kraPin = prof.personalInfo?.kraPin || "";
      const nationalId = prof.personalInfo?.nationalId || "";

      let annualGross = 0, annualNSSF = 0, annualPAYE = 0, annualInsRelief = 0;
      const monthCols = [];

      for (let m = 1; m <= 12; m++) {
        const mo = emp.months[m] || { grossPay: 0, nssf: 0, paye: 0, insuranceRelief: 0 };
        const taxable = Math.max(0, mo.grossPay - mo.nssf);
        monthCols.push(n(mo.grossPay), n(taxable), n(mo.paye), n(mo.insuranceRelief));
        annualGross += mo.grossPay;
        annualNSSF += mo.nssf;
        annualPAYE += mo.paye;
        annualInsRelief += mo.insuranceRelief;
      }

      const annualTaxable = Math.max(0, annualGross - annualNSSF);

      return [
        q(emp.employeeName),
        q(emp.employeeNumber),
        q(kraPin),
        q(nationalId),
        q(emp.department),
        ...monthCols,
        n(annualGross),
        n(annualNSSF),
        n(annualTaxable),
        n(annualPAYE),
        n(annualInsRelief),
      ].join(",");
    });

    const csv = [
      `"P9A Annual PAYE Certificate — Year ${year}"`,
      headers.join(","),
      ...rows,
    ].join("\n");

    const filename = `p9a-annual-paye-${year}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "P9A generation failed") }, { status: 500 });
  }
}
