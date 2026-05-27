import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Edit, User, Briefcase, Calendar, Banknote, FileText } from "lucide-react";
import { getEmployeeById } from "@/app/mongodb/queries/hr-queries";
import PayrollEntry from "@/app/models/payrollEntry";
import dbConnect from "@/app/config/dbConnect";
import { EmployeeActions } from "../../components/EmployeeActions";
import EmployeePhotoUpload from "../../components/EmployeePhotoUpload";
import EmployeeDocuments from "../../components/EmployeeDocuments";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const { employee } = await getEmployeeById(id);
  if (!employee) return { title: "Employee Not Found" };
  return { title: `${employee.personalInfo?.firstName} ${employee.personalInfo?.lastName} | HR` };
}

const HR_ROLES = ["SuperAdmin", "Admin", "Manager", "HR"];

// ─── Status badge ───
function StatusBadge({ status }) {
  const map = {
    active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    probation: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    on_leave: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    suspended: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    terminated: "bg-red-500/15 text-red-700 dark:text-red-400",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${map[status] || "bg-muted text-muted-foreground"}`}>
      {status?.replace("_", " ")}
    </span>
  );
}

// ─── Info card ───
function InfoCard({ title, icon: Icon, rows }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        {title}
      </h3>
      <dl className="space-y-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium text-foreground text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ─── Profile tab ───
function ProfileTab({ employee }) {
  const p = employee.personalInfo;
  const e = employee.employment;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <InfoCard
        title="Personal"
        icon={User}
        rows={[
          ["Date of Birth", p?.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString("en-KE") : "—"],
          ["Gender", p?.gender || "—"],
          ["National ID", p?.nationalId || "—"],
          ["KRA PIN", p?.kraPin || "—"],
          ["NSSF Number", p?.nssfNumber || "—"],
          ["SHA Number", p?.shaNumber || "—"],
          ["Nationality", p?.nationality || "—"],
        ]}
      />
      <InfoCard
        title="Employment"
        icon={Briefcase}
        rows={[
          ["Employee Number", employee.employeeNumber || "—"],
          ["Department", e?.department || "—"],
          ["Designation", e?.designation || "—"],
          ["Type", e?.employmentType?.replace("_", " ") || "—"],
          ["Hire Date", e?.hireDate ? new Date(e.hireDate).toLocaleDateString("en-KE") : "—"],
          ["Confirmation Date", e?.confirmationDate ? new Date(e.confirmationDate).toLocaleDateString("en-KE") : "—"],
          ["Job Grade", e?.jobGrade || "—"],
          ["Work Location", e?.workLocation || "—"],
          ["Manager", e?.managerName || "—"],
        ]}
      />
      <InfoCard
        title="Compensation"
        icon={Banknote}
        rows={[
          ["Basic Salary", `KES ${(employee.compensation?.basicSalary || 0).toLocaleString()}`],
          ["Housing Allowance", `KES ${(employee.compensation?.allowances?.housing || 0).toLocaleString()}`],
          ["Transport Allowance", `KES ${(employee.compensation?.allowances?.transport || 0).toLocaleString()}`],
          ["Medical Allowance", `KES ${(employee.compensation?.allowances?.medical || 0).toLocaleString()}`],
          ["Payment Method", employee.compensation?.paymentMethod || "—"],
          ["Bank", employee.compensation?.bankName || "—"],
          ["Account", employee.compensation?.bankAccount || "—"],
          ["M-Pesa", employee.compensation?.mpesaNumber || "—"],
        ]}
      />
      {employee.emergencyContact?.name && (
        <InfoCard
          title="Emergency Contact"
          rows={[
            ["Name", employee.emergencyContact.name],
            ["Relationship", employee.emergencyContact.relationship || "—"],
            ["Phone", employee.emergencyContact.phone || "—"],
          ]}
        />
      )}
    </div>
  );
}

// ─── Leave tab ───
function LeaveTab({ leaveBalances }) {
  if (!leaveBalances?.length) {
    return <p className="text-sm text-muted-foreground">No leave balances configured.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
            <th className="px-4 py-3">Leave Type</th>
            <th className="px-4 py-3 text-right">Entitled</th>
            <th className="px-4 py-3 text-right">Used</th>
            <th className="px-4 py-3 text-right">Pending</th>
            <th className="px-4 py-3 text-right">Balance</th>
            <th className="px-4 py-3 text-right">Carry Over</th>
            <th className="px-4 py-3 text-right">Year</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {leaveBalances.map((b) => (
            <tr key={b.leaveType} className="hover:bg-muted/30">
              <td className="px-4 py-3 font-medium capitalize text-foreground">{b.label || b.leaveType}</td>
              <td className="px-4 py-3 text-right text-foreground">{b.entitledDays}</td>
              <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{b.usedDays}</td>
              <td className="px-4 py-3 text-right text-yellow-600 dark:text-yellow-400">{b.pendingDays}</td>
              <td className={`px-4 py-3 text-right font-semibold ${b.balanceDays <= 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                {b.balanceDays}
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">{b.carryOver}</td>
              <td className="px-4 py-3 text-right text-muted-foreground">{b.year}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Payroll History tab (async) ───
async function PayrollHistoryTab({ partyId }) {
  await dbConnect();
  const history = await PayrollEntry.getEmployeeHistory(null, partyId, 12);

  if (!history.length) {
    return <p className="text-sm text-muted-foreground">No payroll history yet.</p>;
  }

  const fmt = (n) => (n || 0).toLocaleString("en-KE");
  const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
            <th className="px-4 py-3">Period</th>
            <th className="px-4 py-3 text-right">Gross Pay</th>
            <th className="px-4 py-3 text-right">Deductions</th>
            <th className="px-4 py-3 text-right">Net Pay</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {history.map((entry) => (
            <tr key={entry._id?.toString()} className="hover:bg-muted/30">
              <td className="px-4 py-3 text-foreground">
                {monthNames[entry.period?.month]} {entry.period?.year}
              </td>
              <td className="px-4 py-3 text-right text-foreground">{fmt(entry.earnings?.grossPay)}</td>
              <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">
                ({fmt(entry.deductions?.totalDeductions)})
              </td>
              <td className="px-4 py-3 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                {fmt(entry.netPay)}
              </td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  entry.paymentStatus === "paid"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                }`}>
                  {entry.paymentStatus}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================
// PAGE
// ============================================
export default async function EmployeeDetailPage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const activeTab = sp.tab || "profile";

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!HR_ROLES.includes(session.user.role)) redirect("/dashboard/hr");

  const { employee, error } = await getEmployeeById(id);
  if (error || !employee) notFound();

  const fullName = `${employee.personalInfo?.firstName} ${employee.personalInfo?.lastName}`;
  const initials = (employee.personalInfo?.firstName?.[0] || "") + (employee.personalInfo?.lastName?.[0] || "");

  const tabs = [
    { key: "profile", label: "Profile", icon: User },
    { key: "leave", label: "Leave", icon: Calendar },
    { key: "payroll", label: "Payroll", icon: Banknote },
    { key: "documents", label: "Documents", icon: FileText },
  ];

  const canEditCompensation = ["SuperAdmin", "Admin", "HR"].includes(session.user.role);
  const canManageLeave = ["SuperAdmin", "Admin", "HR"].includes(session.user.role);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/employees" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Employees
        </Link>
        <span>/</span>
        <span className="text-foreground">{fullName}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <EmployeePhotoUpload
            profileId={employee._id}
            currentPhotoUrl={employee.personalInfo?.photo?.url}
            initials={initials}
          />
          <div>
            <h1 className="text-lg font-bold text-foreground sm:text-2xl">{fullName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono">{employee.employeeNumber}</span>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">{employee.employment?.designation || "No designation"}</span>
              <span className="hidden sm:inline">·</span>
              <span>{employee.employment?.department || "No department"}</span>
              <StatusBadge status={employee.employment?.status} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <EmployeeActions
            profileId={employee._id}
            status={employee.employment?.status}
            hasLogin={!!employee.userId}
            userRole={session.user.role}
            email={employee.contactEmail}
          />
          {canEditCompensation && (
            <Link
              href={`/dashboard/hr/employees/${employee._id}/compensation`}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <Banknote className="h-4 w-4" />
              <span className="hidden sm:inline">Compensation</span>
            </Link>
          )}
          {canManageLeave && (
            <Link
              href={`/dashboard/hr/employees/${employee._id}/leave-balances`}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <Calendar className="h-4 w-4" />
              <span className="hidden sm:inline">Leave</span>
            </Link>
          )}
          <Link
            href={`/dashboard/hr/p9/${employee._id}?year=${new Date().getFullYear()}`}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">P9</span>
          </Link>
          <Link
            href={`/dashboard/hr/employees/${employee._id}/edit`}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Edit className="h-4 w-4" />
            Edit
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`?tab=${tab.key}`}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
              activeTab === tab.key
                ? "bg-card text-foreground font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </Link>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "profile" && <ProfileTab employee={employee} />}

      {activeTab === "leave" && (
        <LeaveTab leaveBalances={employee.leaveBalances} />
      )}

      {activeTab === "payroll" && (
        <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
          <PayrollHistoryTab partyId={employee.partyId} />
        </Suspense>
      )}

      {activeTab === "documents" && (
        <EmployeeDocuments
          profileId={employee._id}
          documents={employee.documents || []}
          userRole={session.user.role}
        />
      )}
    </div>
  );
}
