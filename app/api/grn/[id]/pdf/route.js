import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { getGoodsReceiptForDisplayPg } from "@/app/db/actions/grn-actions";
import { GoodsReceiptPDF } from "@/lib/pdf";

// ============================================
// GRN PDF — /api/grn/[id]/pdf
// ============================================
// Renders the GRN as a PDF and streams it inline so the browser shows
// it in-tab (with the option to download via the browser's PDF
// viewer). Auth + tenant-scope checks via the existing query helpers.
// ============================================

export async function GET(_req, { params }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // The same page shape the detail screen renders, so the PDF and the screen
    // cannot disagree about what the receipt says. Tenant-scoped by RLS.
    const grn = await getGoodsReceiptForDisplayPg(id);
    if (!grn) {
      return NextResponse.json({ error: "GRN not found" }, { status: 404 });
    }

    // Company branding for the PDF header.
    const { companyId } = await getTenantContext();
    const { getCompanyForDocuments } = await import("@/app/db/platform");
    const company = await getCompanyForDocuments(String(companyId));

    const buffer = await renderToBuffer(
      GoodsReceiptPDF({ grn, company }),
    );

    const filename = `${grn.grnNumber || "GRN"}.pdf`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // attachment = triggers an actual download dialog instead of
        // opening inline in a new tab.
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("GRN PDF error:", error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "GRN PDF generation failed") },
      { status: 500 },
    );
  }
}
