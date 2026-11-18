import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { safeErrorMessage } from "@/lib/safe-error";
import { withAuthorizedTenant } from "@/app/db/tenant";
import { getCompanyForDocuments } from "@/app/db/platform";
import { getInspectionForReport } from "@/app/db/actions/technical-actions";
import { InspectionReportPDF } from "@/lib/pdf";

/** An inspection report. Inline for the preview; ?download=1 for the download. */
export async function GET(req, { params }) {
  const { id } = await params;
  try {
    const inspection = await getInspectionForReport(id);
    if (!inspection) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
    const companyId = await withAuthorizedTenant([], async (_tx, ctx) => ctx.companyId);
    const company = await getCompanyForDocuments(companyId);
    const issuedOn = new Date(inspection.updatedAt).toISOString().slice(0, 10);
    const buffer = await renderToBuffer(InspectionReportPDF({ company, inspection, issuedOn }));
    const download = new URL(req.url).searchParams.get("download");
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${inspection.inspectionNumber}.pdf"`,
      },
    });
  } catch (err) {
    console.error("Inspection report error:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "The inspection report could not be produced") },
      { status: 500 },
    );
  }
}
