import { NextResponse } from "next/server";
import { withAuthorizedTenant } from "@/app/db/tenant";
import { checkPlanAccess } from "@/lib/plan-gate";
import { safeErrorMessage } from "@/lib/safe-error";
import {
  PAYROLL_EXPORT_ROLES,
  taxableIncome,
  q,
  n,
} from "@/lib/hr/payroll-exports";
import * as payroll from "@/app/db/repositories/payroll";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const EMPTY_MONTH = {
  grossPay: 0,
  nssf: 0,
  shif: 0,
  housingLevy: 0,
  paye: 0,
  insuranceRelief: 0,
  netPay: 0,
};

/**
 * P9A — the annual PAYE certificate, for every employee at once.
 *
 * Two corrections carried from the shared export module:
 *
 *   - taxable income is gross less NSSF, SHIF AND the housing levy, which is
 *     how the PAYE beside it was computed;
 *   - voided runs are left out, because a payroll reversed out of the books
 *     is not income anybody received.
 */
export async function GET(req) {
  try {
    const gate = await checkPlanAccess("hr");
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "This feature requires a plan upgrade" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(req.url);
    const year = parseInt(searchParams.get("year") || `${new Date().getFullYear()}`, 10);

    const employees = await withAuthorizedTenant(PAYROLL_EXPORT_ROLES, (tx) =>
      payroll.getAnnualPayrollByEmployee(tx, year),
    );

    if (!employees.length) {
      return NextResponse.json({ error: `No payroll data for ${year}.` }, { status: 404 });
    }

    const headers = [
      "Employee Name",
      "Employee No",
      "KRA PIN",
      "National ID",
      "Department",
      ...MONTH_NAMES.flatMap((m) => [
        `${m} Gross`,
        `${m} Taxable`,
        `${m} PAYE`,
        `${m} Ins Relief`,
      ]),
      "Annual Gross",
      "Annual NSSF",
      "Annual SHIF",
      "Annual AHL",
      "Annual Taxable",
      "Annual PAYE",
      "Annual Ins Relief",
    ];

    const rows = employees.map((emp) => {
      const totals = {
        gross: 0, nssf: 0, shif: 0, ahl: 0, taxable: 0, paye: 0, relief: 0,
      };
      const monthCols = [];

      for (let m = 1; m <= 12; m++) {
        const mo = emp.months[m] ?? EMPTY_MONTH;
        const taxable = taxableIncome(mo);
        monthCols.push(n(mo.grossPay), n(taxable), n(mo.paye), n(mo.insuranceRelief));
        totals.gross += mo.grossPay;
        totals.nssf += mo.nssf;
        totals.shif += mo.shif;
        totals.ahl += mo.housingLevy;
        totals.taxable += taxable;
        totals.paye += mo.paye;
        totals.relief += mo.insuranceRelief;
      }

      return [
        q(emp.employeeName),
        q(emp.employeeNumber),
        q(emp.kraPin),
        q(emp.nationalId),
        q(emp.department),
        ...monthCols,
        n(totals.gross),
        n(totals.nssf),
        n(totals.shif),
        n(totals.ahl),
        n(totals.taxable),
        n(totals.paye),
        n(totals.relief),
      ].join(",");
    });

    const csv = [
      q(`P9A Annual PAYE Certificate — Year ${year}`),
      headers.join(","),
      ...rows,
    ].join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="p9a-annual-paye-${year}.csv"`,
      },
    });
  } catch (error) {
    const message = safeErrorMessage(error, "The P9A could not be produced");
    const status = /permission|authenticated/i.test(message) ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
