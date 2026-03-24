import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Printer, Download } from "lucide-react";
import { getMyEmployeeProfile } from "@/app/mongodb/queries/hr-queries";
import dbConnect from "@/app/config/dbConnect";
import PayrollEntry from "@/app/models/payrollEntry";
import EmployeeProfile from "@/app/models/employeeProfile";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import PayslipActions from "./PayslipActions";

export const metadata = { title: "Payslip | HR" };

function fmt(n) {
  if (!n && n !== 0) return "—";
  return new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function Row({ label, value, bold, muted }) {
  return (
    <div className={`flex justify-between py-1.5 text-sm ${bold ? "font-semibold" : ""}`}>
      <span className={muted ? "text-muted-foreground" : "text-foreground"}>{label}</span>
      <span className={`font-mono ${muted ? "text-muted-foreground" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border my-2" />;
}

export default async function PayslipDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Find the employee's profile to verify ownership
  const profile = await EmployeeProfile.findOne(
    withTenantScope({ userId: session.user.id }, companyId, isSuperAdmin),
    "_id"
  ).lean();

  if (!profile) notFound();

  // Load the payroll entry — ensure it belongs to this employee
  const entry = await PayrollEntry.findOne(
    withTenantScope({ _id: id, profileId: profile._id }, companyId, isSuperAdmin)
  ).lean();

  if (!entry) notFound();

  const allowances =
    (entry.earnings?.housingAllowance || 0) +
    (entry.earnings?.transportAllowance || 0) +
    (entry.earnings?.medicalAllowance || 0) +
    (entry.earnings?.overtime || 0) +
    (entry.earnings?.bonus || 0) +
    (entry.earnings?.commission || 0);

  const currency = entry.currency || "KES";
  const periodLabel = entry.period?.label || `${entry.period?.month}/${entry.period?.year}`;

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/dashboard/hr/my-payslips" className="flex items-center gap-1 hover:text-foreground">
            <ChevronLeft className="h-4 w-4" /> My Payslips
          </Link>
          <span>/</span>
          <span className="text-foreground">{periodLabel}</span>
        </div>
        <PayslipActions entryId={id} />
      </div>

      {/* Payslip card */}
      <div className="rounded-lg border border-border bg-card shadow-sm print:shadow-none print:border-0">
        {/* Header */}
        <div className="border-b border-border px-6 py-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-lg font-bold text-foreground">Payslip</h1>
              <p className="text-sm text-muted-foreground">{periodLabel}</p>
            </div>
            <div className="text-right">
              {entry.paymentStatus === "paid" ? (
                <span className="inline-flex rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  Paid
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-amber-500/15 px-3 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                  Pending
                </span>
              )}
              {entry.paidAt && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(entry.paidAt).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Employee details */}
        <div className="border-b border-border px-6 py-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Employee</p>
            <p className="font-medium text-foreground">{entry.employeeName}</p>
            <p className="text-muted-foreground">{entry.employeeNumber}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Position</p>
            <p className="font-medium text-foreground">{entry.designation || "—"}</p>
            <p className="text-muted-foreground">{entry.department || "—"}</p>
          </div>
          {entry.workingDays?.total > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Working Days</p>
              <p className="text-foreground">{entry.workingDays.worked} / {entry.workingDays.total} days</p>
            </div>
          )}
        </div>

        {/* Earnings */}
        <div className="px-6 py-4 border-b border-border">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earnings</p>
          <Row label="Basic Salary" value={`${currency} ${fmt(entry.earnings?.basicSalary)}`} />
          {(entry.earnings?.housingAllowance || 0) > 0 && (
            <Row label="Housing Allowance" value={`${currency} ${fmt(entry.earnings.housingAllowance)}`} muted />
          )}
          {(entry.earnings?.transportAllowance || 0) > 0 && (
            <Row label="Transport Allowance" value={`${currency} ${fmt(entry.earnings.transportAllowance)}`} muted />
          )}
          {(entry.earnings?.medicalAllowance || 0) > 0 && (
            <Row label="Medical Allowance" value={`${currency} ${fmt(entry.earnings.medicalAllowance)}`} muted />
          )}
          {(entry.earnings?.overtime || 0) > 0 && (
            <Row label="Overtime" value={`${currency} ${fmt(entry.earnings.overtime)}`} muted />
          )}
          {(entry.earnings?.bonus || 0) > 0 && (
            <Row label="Bonus" value={`${currency} ${fmt(entry.earnings.bonus)}`} muted />
          )}
          {(entry.earnings?.commission || 0) > 0 && (
            <Row label="Commission" value={`${currency} ${fmt(entry.earnings.commission)}`} muted />
          )}
          <Divider />
          <Row label="Gross Pay" value={`${currency} ${fmt(entry.earnings?.grossPay)}`} bold />
        </div>

        {/* Deductions */}
        <div className="px-6 py-4 border-b border-border">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deductions</p>
          <Row label="PAYE (Income Tax)" value={`${currency} ${fmt(entry.deductions?.paye)}`} muted />
          <Row label="NSSF" value={`${currency} ${fmt(entry.deductions?.nssf)}`} muted />
          <Row label="SHIF" value={`${currency} ${fmt(entry.deductions?.shif)}`} muted />
          <Row label="Affordable Housing Levy" value={`${currency} ${fmt(entry.deductions?.housingLevy)}`} muted />
          {(entry.deductions?.loanRepayment || 0) > 0 && (
            <Row label="Loan Repayment" value={`${currency} ${fmt(entry.deductions.loanRepayment)}`} muted />
          )}
          {(entry.deductions?.saccoDeduction || 0) > 0 && (
            <Row label="SACCO Deduction" value={`${currency} ${fmt(entry.deductions.saccoDeduction)}`} muted />
          )}
          <Divider />
          <Row label="Total Deductions" value={`${currency} ${fmt(entry.deductions?.totalDeductions)}`} bold />
        </div>

        {/* Net Pay */}
        <div className="px-6 py-5 bg-muted/30 rounded-b-lg">
          <div className="flex justify-between items-center">
            <p className="text-base font-semibold text-foreground">Net Pay</p>
            <p className="text-2xl font-bold text-primary font-mono">{currency} {fmt(entry.netPay)}</p>
          </div>
          {entry.paymentMethod && (
            <p className="mt-1 text-xs text-muted-foreground capitalize">
              Payment method: {entry.paymentMethod.replace("_", " ")}
            </p>
          )}
        </div>
      </div>

      {entry.notes && (
        <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">{entry.notes}</p>
      )}
    </div>
  );
}
