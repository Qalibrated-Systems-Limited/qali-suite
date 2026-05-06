import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import { renderToBuffer } from "@react-pdf/renderer";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import PayrollRun from "@/app/models/payrollRun";
import PayrollEntry from "@/app/models/payrollEntry";
import EmployeeProfile from "@/app/models/employeeProfile";
import Company from "@/app/models/Company";
import { PayslipDocument } from "../../payroll/[id]/payslip/[entryId]/PayslipDocument";

export async function GET(_req, { params }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { entryId } = await params;
    await dbConnect();

    const { companyId, isSuperAdmin } = await getTenantContext();

    // Find the employee's profile to verify ownership
    const profile = await EmployeeProfile.findOne(
      withTenantScope({ userId: session.user.id }, companyId, isSuperAdmin),
      "_id"
    ).lean();

    if (!profile) {
      return NextResponse.json({ error: "No employee profile found" }, { status: 403 });
    }

    // Load the payroll entry — ensure it belongs to this employee
    const entry = await PayrollEntry.findOne(
      withTenantScope({ _id: entryId, profileId: profile._id }, companyId, isSuperAdmin)
    ).lean();

    if (!entry) {
      return NextResponse.json({ error: "Payslip not found" }, { status: 404 });
    }

    // Load the payroll run for context. Scope to the entry's companyId
    // (defense-in-depth — entry is already tenant-scoped, but if a stale
    // payrollRunId ever pointed to another tenant's run we'd silently
    // render their data into this employee's payslip).
    const run = await PayrollRun.findOne({
      _id: entry.payrollRunId,
      companyId: entry.companyId,
    }).lean();

    if (!run) {
      return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
    }

    const company = await Company.findById(entry.companyId)
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
    console.error("Employee payslip generation error:", error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Payslip generation failed") },
      { status: 500 }
    );
  }
}
