import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { canSeeProjectsNav } from "@/lib/permissions";
import { getWorkflowReport } from "@/app/db/actions/workflow-report-actions";
import { getProjectById } from "@/app/db/actions/project-actions";
import { TechnicalReportPDF } from "@/lib/pdf";
import { STATUS_CONFIG, sheetName, displaySerial } from "@/app/dashboard/technical/lib/meta";
import { templateByCode } from "@/app/dashboard/technical/lib/templates";

// ============================================
// TECHNICAL REPORT PDF — /api/technical/[id]/pdf
// ============================================
// Streams any report as a downloadable PDF, at any workflow status (a draft
// prints with empty sign-off slots). Same auth + RLS-scoped fetch + company
// branding as the GRN / payroll PDF routes; the document shares the house PDF
// theme.
// ============================================

export async function GET(_req, { params }) {
  try {
    const session = await auth();
    if (!session?.user || !canSeeProjectsNav(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // RLS-scoped read — same shape the detail screen renders.
    const report = await getWorkflowReport(id);
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const project = report.projectId ? await getProjectById(report.projectId).catch(() => null) : null;

    // Company branding for the PDF header.
    const { companyId } = await getTenantContext();
    const { getCompanyForDocuments } = await import("@/app/db/platform");
    const company = await getCompanyForDocuments(String(companyId));

    const buffer = await renderToBuffer(
      TechnicalReportPDF({
        report,
        project,
        company,
        template: templateByCode(report.type),
        sheetLabel: sheetName(report.type),
        serial: displaySerial(report.reportNumber),
        statusLabel: (STATUS_CONFIG[report.status] || STATUS_CONFIG.draft).label,
      }),
    );

    const filename = `${displaySerial(report.reportNumber) || "Technical-Report"}.pdf`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Technical report PDF error:", error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Technical report PDF generation failed") },
      { status: 500 },
    );
  }
}
