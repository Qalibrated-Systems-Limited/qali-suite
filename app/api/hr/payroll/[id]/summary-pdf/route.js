import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import { renderToBuffer } from "@react-pdf/renderer";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import PayrollRun from "@/app/models/payrollRun";
import PayrollEntry from "@/app/models/payrollEntry";
import Company from "@/app/models/Company";
import { PayrollSummaryDocument } from "./PayrollSummaryDocument";
import { checkPlanAccess } from "@/lib/plan-gate";

const ALLOWED = ["SuperAdmin", "Admin", "HR", "Accountant"];

export async function GET(_req, { params }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!ALLOWED.includes(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const gate = await checkPlanAccess("hr");
    if (!gate.allowed) {
      return NextResponse.json({ error: "This feature requires a plan upgrade" }, { status: 403 });
    }

    const { id } = await params;
    await dbConnect();

    const { companyId, isSuperAdmin } = await getTenantContext();

    const run = await PayrollRun.findOne(
      withTenantScope({ _id: id }, companyId, isSuperAdmin)
    ).lean();
    if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });

    if (!["approved", "paid"].includes(run.status)) {
      return NextResponse.json(
        { error: "Summary PDF is only available for approved or paid payroll runs" },
        { status: 400 }
      );
    }

    const entries = await PayrollEntry.find({
      payrollRunId: run._id,
      companyId: run.companyId,
    })
      .select("employeeName employeeNumber department earnings deductions employerContributions netPay paymentStatus")
      .sort({ employeeName: 1 })
      .lean();

    const company = await Company.findById(run.companyId)
      .select("name email phone address")
      .lean();

    const buffer = await renderToBuffer(
      PayrollSummaryDocument({ run, entries, company })
    );

    const periodLabel = run.period?.label || `${run.period?.month}-${run.period?.year}`;
    const filename = `payroll-summary-${run.payrollNumber}-${periodLabel.replace(/\s/g, "-")}.pdf`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Summary PDF error:", error);
    return NextResponse.json({ error: safeErrorMessage(error, "PDF generation failed") }, { status: 500 });
  }
}
