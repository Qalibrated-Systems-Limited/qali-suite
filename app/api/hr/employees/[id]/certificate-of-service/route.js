import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCompanyForDocuments } from "@/app/db/platform";
import { safeErrorMessage } from "@/lib/safe-error";
import { withAuthorizedTenant } from "@/app/db/tenant";
import { getCertificateOfService } from "@/app/db/actions/hr-exit-actions";
import { checkPlanAccess } from "@/lib/plan-gate";
import { CertificateOfServiceDocument } from "../../../exits/ExitDocuments";

/**
 * The certificate of service s.51 requires on termination. Issued for any
 * employee whose employment has ended, whether or not they left through an
 * exit — a certificate is owed either way.
 */
export async function GET(_req, { params }) {
  const { id } = await params;
  try {
    const gate = await checkPlanAccess("hr");
    if (!gate.allowed) {
      return NextResponse.json({ error: "This feature requires a plan upgrade" }, { status: 403 });
    }

    const data = await getCertificateOfService(id);
    const companyId = await withAuthorizedTenant([], async (_tx, ctx) => ctx.companyId);
    const company = await getCompanyForDocuments(companyId);
    const issuedOn = new Date().toISOString().slice(0, 10);

    const buffer = await renderToBuffer(CertificateOfServiceDocument({ company, data, issuedOn }));
    const filename = `certificate-of-service-${data.employee.employeeNumber}.pdf`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Certificate of service error:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "The certificate could not be produced") },
      { status: 500 },
    );
  }
}
