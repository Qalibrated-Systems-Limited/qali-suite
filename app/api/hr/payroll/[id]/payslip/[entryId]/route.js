import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCompanyForDocuments } from "@/app/db/platform";
import { safeErrorMessage } from "@/lib/safe-error";
import { withAuthorizedTenant } from "@/app/db/tenant";
import { getPayslipForPage } from "@/app/db/actions/hr-payroll-actions";
import { checkPlanAccess } from "@/lib/plan-gate";
import { PayslipDocument } from "./PayslipDocument";

/**
 * One payslip, as a PDF.
 *
 * Ownership is the action's rule: HR and finance may open any payslip, and an
 * employee may open their own. The source gated on a role list alone, so an
 * employee could not download the payslip they were shown — and a Manager
 * could download anyone's.
 *
 * A payslip is available for a run still being prepared, deliberately: HR
 * checks the figures before approval, and that is what the file is for.
 */
export async function GET(_req, { params }) {
  const { entryId } = await params;

  try {
    const gate = await checkPlanAccess("hr");
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "This feature requires a plan upgrade" },
        { status: 403 },
      );
    }

    const data = await getPayslipForPage(entryId);
    if (!data) {
      return NextResponse.json({ error: "Payslip not found" }, { status: 404 });
    }

    const { entry } = data;
    const companyId = await withAuthorizedTenant([], async (_tx, ctx) => ctx.companyId);
    const company = await getCompanyForDocuments(companyId);

    const run = {
      label: entry.label,
      payrollNumber: entry.payrollNumber,
      periodFrom: entry.periodFrom,
      periodTo: entry.periodTo,
    };

    const buffer = await renderToBuffer(PayslipDocument({ run, entry, company }));
    const filename = `payslip-${entry.employeeNumber}-${entry.payrollNumber}.pdf`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Payslip generation error:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "The payslip could not be produced") },
      { status: 500 },
    );
  }
}
