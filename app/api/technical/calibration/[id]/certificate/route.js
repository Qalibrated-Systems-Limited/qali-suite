import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { safeErrorMessage } from "@/lib/safe-error";
import { withAuthorizedTenant } from "@/app/db/tenant";
import { getCompanyForDocuments } from "@/app/db/platform";
import { getCalibrationCertificate } from "@/app/db/actions/technical-actions";
import { CalibrationCertificatePDF } from "@/lib/pdf";

/**
 * A calibration certificate, issued once a job is completed and passed. The
 * Certificates tab listed them and offered no way to produce one.
 * Inline for the preview; ?download=1 for the download.
 */
export async function GET(req, { params }) {
  const { id } = await params;
  try {
    const data = await getCalibrationCertificate(id);
    if (!data) return NextResponse.json({ error: "Calibration job not found" }, { status: 404 });
    if (!data.job.certNumber) {
      return NextResponse.json(
        { error: "A certificate is issued once the job is completed and passed." },
        { status: 409 },
      );
    }
    const companyId = await withAuthorizedTenant([], async (_tx, ctx) => ctx.companyId);
    const company = await getCompanyForDocuments(companyId);
    const issuedOn = new Date(data.job.updatedAt).toISOString().slice(0, 10);
    const buffer = await renderToBuffer(
      CalibrationCertificatePDF({ company, job: data.job, standards: data.standards, issuedOn }),
    );
    const download = new URL(req.url).searchParams.get("download");
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${data.job.certNumber}.pdf"`,
      },
    });
  } catch (err) {
    console.error("Calibration certificate error:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "The certificate could not be produced") },
      { status: 500 },
    );
  }
}
