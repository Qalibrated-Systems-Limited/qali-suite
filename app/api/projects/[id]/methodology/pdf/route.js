import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { canSeeProjectsNav } from "@/lib/permissions";
import { getMethodologyData } from "@/app/db/actions/methodology-actions";
import {
  getProjectById,
  getProjectBoq,
  getProjectMilestones,
  getProjectTasks,
} from "@/app/db/actions/project-actions";
import { MethodologyPDF } from "@/lib/pdf/documents/MethodologyPDF";

// ============================================
// METHODOLOGY PDF — /api/projects/[id]/methodology/pdf
// ============================================
// Streams the implementation method statement as a PDF (house theme). Auth +
// RLS-scoped reads; refused until the project's budget is approved, the same
// gate the page enforces.
// ============================================

export async function GET(_req, { params }) {
  try {
    const session = await auth();
    if (!session?.user || !canSeeProjectsNav(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const data = await getMethodologyData(id);
    if (!data?.budgetApproved) {
      return NextResponse.json(
        { error: "The project's budget must be approved before a methodology PDF is available." },
        { status: 409 },
      );
    }

    const [project, boqData, milestoneData, tasks] = await Promise.all([
      getProjectById(id).catch(() => null),
      getProjectBoq(id).catch(() => null),
      getProjectMilestones(id).catch(() => null),
      getProjectTasks(id).catch(() => []),
    ]);

    const links = {
      boqTotal: boqData?.summary?.billed ?? 0,
      boqItems: boqData?.summary?.itemCount ?? 0,
      milestoneCount: (milestoneData?.milestones ?? []).length,
      milestoneValue: (milestoneData?.milestones ?? []).reduce((s, mm) => s + Number(mm.value || 0), 0),
      taskCount: (tasks ?? []).length,
    };

    const { companyId } = await getTenantContext();
    const { getCompanyForDocuments } = await import("@/app/db/platform");
    const company = await getCompanyForDocuments(String(companyId));

    const buffer = await renderToBuffer(
      MethodologyPDF({ methodology: data.methodology, project, company: company || {}, links }),
    );

    const filename = `Methodology-${project?.projectNumber || "project"}.pdf`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Methodology PDF error:", error);
    const detail =
      process.env.NODE_ENV !== "production" && error instanceof Error ? `: ${error.message}` : "";
    return NextResponse.json(
      { error: safeErrorMessage(error, `Methodology PDF generation failed${detail}`) },
      { status: 500 },
    );
  }
}
