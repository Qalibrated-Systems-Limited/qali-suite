import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import PayrollRun from "@/app/models/payrollRun";
import PayrollEntry from "@/app/models/payrollEntry";
import { checkPlanAccess } from "@/lib/plan-gate";

const ALLOWED = ["SuperAdmin", "Admin", "HR"];

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
        { error: "Bank export is only available for approved or paid payroll runs" },
        { status: 400 }
      );
    }

    const entries = await PayrollEntry.find({
      payrollRunId: run._id,
      companyId: run.companyId,
      paymentMethod: "bank",
    })
      .select("employeeName employeeNumber department bankName bankBranch bankAccount netPay currency paymentStatus")
      .sort({ employeeName: 1 })
      .lean();

    if (entries.length === 0) {
      return NextResponse.json({ error: "No bank payment entries found for this run" }, { status: 404 });
    }

    // Build CSV — generic format compatible with most Kenyan bank bulk upload portals
    const periodLabel = run.period?.label || `${run.period?.month}/${run.period?.year}`;
    const reference = `SAL-${run.payrollNumber}`;

    const headers = [
      "Employee Name",
      "Employee No",
      "Department",
      "Bank Name",
      "Branch",
      "Account Number",
      "Amount (KES)",
      "Narrative",
      "Payment Status",
    ];

    const rows = entries.map((e) => [
      `"${(e.employeeName || "").replace(/"/g, '""')}"`,
      `"${e.employeeNumber || ""}"`,
      `"${(e.department || "").replace(/"/g, '""')}"`,
      `"${(e.bankName || "").replace(/"/g, '""')}"`,
      `"${(e.bankBranch || "").replace(/"/g, '""')}"`,
      `"${e.bankAccount || ""}"`,
      e.netPay?.toFixed(2) || "0.00",
      `"${periodLabel} Salary - ${reference}"`,
      `"${e.paymentStatus || "pending"}"`,
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    const filename = `bank-payroll-${run.payrollNumber}-${periodLabel.replace(/\s/g, "-")}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "Export failed") }, { status: 500 });
  }
}
