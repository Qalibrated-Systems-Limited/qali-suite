import { NextResponse } from "next/server";
import { withAuthorizedTenant } from "@/app/db/tenant";
import { checkPlanAccess } from "@/lib/plan-gate";
import { safeErrorMessage } from "@/lib/safe-error";
import * as payroll from "@/app/db/repositories/payroll";

/**
 * Shared scaffolding for the payroll export routes.
 *
 * Nine routes each repeated the same forty lines: authorise, check the plan,
 * load the run, refuse it unless approved, load the entries, build a CSV. One
 * of them got the taxable-income formula wrong (see below) and nobody noticed,
 * because there was nowhere for the formula to live once.
 */

export const PAYROLL_EXPORT_ROLES = [
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "HR Manager",
];

/** CSV quoting: doubles the quotes, wraps the field. */
export const q = (v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
/** Two decimals, which is what every one of these returns asks for. */
export const n = (v) => Number(v ?? 0).toFixed(2);

/**
 * Taxable income for PAYE.
 *
 * NSSF, SHIF and the housing levy are ALL allowable deductions before PAYE
 * under the Tax Laws (Amendment) Act 2024, and the payroll engine computes
 * PAYE that way. The P10 route subtracted NSSF alone — so the return filed
 * with KRA stated a taxable income that did not agree with the PAYE printed
 * next to it. One definition now, used by every export.
 */
export const taxableIncome = (e) =>
  Math.max(0, e.grossPay - e.nssf - e.shif - e.housingLevy);

/**
 * Loads a run and its payslips for export, or returns the response to send.
 *
 * `requireApproved` is the default: an export of a draft run is a document
 * somebody might file, built from figures still being edited.
 */
export async function loadRunForExport(id, { requireApproved = true } = {}) {
  const gate = await checkPlanAccess("hr");
  if (!gate.allowed) {
    return {
      error: NextResponse.json(
        { error: "This feature requires a plan upgrade" },
        { status: 403 },
      ),
    };
  }

  let run;
  let entries;
  try {
    const result = await withAuthorizedTenant(
      PAYROLL_EXPORT_ROLES,
      async (tx) => {
        const found = await payroll.getRun(tx, id);
        if (!found) return null;
        return { run: found, entries: await payroll.listEntriesForExport(tx, id) };
      },
    );
    if (!result) {
      return {
        error: NextResponse.json({ error: "Payroll run not found" }, { status: 404 }),
      };
    }
    run = result.run;
    entries = result.entries;
  } catch (err) {
    const message = safeErrorMessage(err, "Export failed");
    const status = /permission|authenticated/i.test(message) ? 403 : 500;
    return { error: NextResponse.json({ error: message }, { status }) };
  }

  if (requireApproved && !["approved", "paid"].includes(run.status)) {
    return {
      error: NextResponse.json(
        {
          error:
            "This export is only available once the payroll has been approved — a draft's figures are still being edited.",
        },
        { status: 400 },
      ),
    };
  }

  return { run, entries };
}

/** A CSV response, named after the run so downloads do not collide. */
export function csvResponse(lines, { run, name }) {
  const filename = `${name}-${run.payrollNumber}-${run.label.replace(/\s/g, "-")}.csv`;
  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
