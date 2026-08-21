import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCompanyForDocuments } from "@/app/db/platform";
import { safeErrorMessage } from "@/lib/safe-error";
import { loadRunForExport } from "@/lib/hr/payroll-exports";
import { withAuthorizedTenant } from "@/app/db/tenant";
import { PayrollSummaryDocument } from "./PayrollSummaryDocument";

/** The whole run on one page, for the file. */
export async function GET(_req, { params }) {
  const { id } = await params;
  const { run, entries, error } = await loadRunForExport(id);
  if (error) return error;

  try {
    const companyId = await withAuthorizedTenant([], async (_tx, ctx) => ctx.companyId);
    const company = await getCompanyForDocuments(companyId);

    const buffer = await renderToBuffer(
      PayrollSummaryDocument({ run, entries, company }),
    );

    const filename = `payroll-summary-${run.payrollNumber}-${run.label.replace(/\s/g, "-")}.pdf`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Summary PDF error:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "The summary could not be produced") },
      { status: 500 },
    );
  }
}
