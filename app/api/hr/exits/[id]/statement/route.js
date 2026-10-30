import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCompanyForDocuments } from "@/app/db/platform";
import { safeErrorMessage } from "@/lib/safe-error";
import { withAuthorizedTenant } from "@/app/db/tenant";
import { getExitForPage } from "@/app/db/actions/hr-exit-actions";
import { checkPlanAccess } from "@/lib/plan-gate";
import { FinalDuesStatementDocument } from "../../ExitDocuments";

/** The approved final dues, as the statement the employee signs for. */
export async function GET(_req, { params }) {
  const { id } = await params;
  try {
    const gate = await checkPlanAccess("hr");
    if (!gate.allowed) {
      return NextResponse.json({ error: "This feature requires a plan upgrade" }, { status: 403 });
    }

    const data = await getExitForPage(id);
    if (!data) return NextResponse.json({ error: "Exit not found" }, { status: 404 });
    if (!["approved", "paid"].includes(data.exit.status)) {
      return NextResponse.json(
        { error: "The statement is issued once the final dues are approved." },
        { status: 409 },
      );
    }

    const companyId = await withAuthorizedTenant([], async (_tx, ctx) => ctx.companyId);
    const company = await getCompanyForDocuments(companyId);
    const buffer = await renderToBuffer(FinalDuesStatementDocument({ company, data }));
    const filename = `final-dues-${data.exit.exitNumber}.pdf`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Final dues statement error:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "The statement could not be produced") },
      { status: 500 },
    );
  }
}
