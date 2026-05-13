import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { getGRNById } from "@/app/mongodb/queries/grn-queries";
import Company from "@/app/models/Company";
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
    await dbConnect();

    // getGRNById returns a serialised tenant-scoped GRN or null.
    const grn = await getGRNById(id);
    if (!grn) {
      return NextResponse.json({ error: "GRN not found" }, { status: 404 });
    }

    // Company branding for the PDF header.
    const { companyId } = await getTenantContext();
    const company = await Company.findById(companyId)
      .select("name logo email phone address")
      .lean();

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
