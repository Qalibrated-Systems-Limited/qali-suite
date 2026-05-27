import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import { renderToBuffer } from "@react-pdf/renderer";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import PayrollRun from "@/app/models/payrollRun";
import PayrollEntry from "@/app/models/payrollEntry";
import Company from "@/app/models/Company";
import { PayslipDocument } from "./PayslipDocument";
import { checkPlanAccess } from "@/lib/plan-gate";

const ALLOWED = ["SuperAdmin", "Admin", "HR", "Manager"];

export async function GET(_req, { params }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!ALLOWED.includes(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const gate = await checkPlanAccess("hr");
    if (!gate.allowed) {
      return NextResponse.json({ error: "This feature requires a plan upgrade" }, { status: 403 });
    }

    const { id, entryId } = await params;
    await dbConnect();

    const { companyId, isSuperAdmin } = await getTenantContext();

    const run = await PayrollRun.findOne(
      withTenantScope({ _id: id }, companyId, isSuperAdmin)
    ).lean();
    if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });

    const entry = await PayrollEntry.findOne({
      _id: entryId,
      payrollRunId: run._id,
      companyId: run.companyId,
    }).lean();
    if (!entry) return NextResponse.json({ error: "Payroll entry not found" }, { status: 404 });

    const company = await Company.findById(run.companyId)
      .select("name logo email phone address")
      .lean();

    const buffer = await renderToBuffer(
      PayslipDocument({ run, entry, company })
    );

    const filename = `payslip-${entry.employeeNumber || entry.employeeName}-${run.payrollNumber}.pdf`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Payslip generation error:", error);
    return NextResponse.json({ error: safeErrorMessage(error, "Payslip generation failed") }, { status: 500 });
  }
}
