import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import { getHrLetter } from "@/app/db/actions/hr-records-actions";
import { withAuthorizedTenant } from "@/app/db/tenant";
import { getCompanyForDocuments } from "@/app/db/platform";
import { HrLetterPDF } from "@/lib/pdf/documents/HrLetterPDF";

/**
 * An HR letter as a PDF. Only HR, or the employee the letter was issued to,
 * gets it — getHrLetter returns nothing to anyone else.
 */
export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const letter = await getHrLetter(id);
    if (!letter) return NextResponse.json({ error: "Letter not found" }, { status: 404 });
    const companyId = await withAuthorizedTenant([], async (_tx, ctx) => ctx.companyId);
    const company = await getCompanyForDocuments(String(companyId));
    const buffer = await renderToBuffer(HrLetterPDF({ letter, company }));
    const download = new URL(req.url).searchParams.get("download");
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${letter.letter_number}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "Could not produce the letter") }, { status: 500 });
  }
}
