import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Edit, User, Briefcase, Calendar, Banknote, FileText, History,
} from "lucide-react";
import { getEmployeeForPage } from "@/app/db/actions/hr-employee-actions";
import { getEmployeeLeaveBalances } from "@/app/db/actions/hr-leave-actions";
import { getEmployeePayslips as listPayslips } from "@/app/db/actions/hr-payroll-actions";
import { HR_VIEW_ROLES, HR_COMPENSATION_ROLES, HR_ADMIN_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import { EmployeeActions } from "../../components/EmployeeActions";
import EmployeePhotoUpload from "../../components/EmployeePhotoUpload";
import EmployeeDocuments from "../../components/EmployeeDocuments";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const data = await getEmployeeForPage(id);
  if (!data) return { title: "Employee Not Found" };
  return { title: `${data.employee.fullName} | HR` };
}

const money = (n) => `KES ${(n || 0).toLocaleString("en-KE")}`;
const day = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-KE") : "—");

function StatusBadge({ status }) {
  const map = {
    active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    probation: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    on_leave: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    suspended: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    terminated: "bg-red-500/15 text-red-700 dark:text-red-400",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}>
      {status?.replace("_", " ")}
    </span>
  );
}

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
            <dd className="text-right font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ProfileTab({ e, canSeePay }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <InfoCard
        title="Personal"
        icon={User}
        rows={[
          ["Date of birth", day(e.dateOfBirth)],
          ["Gender", e.gender || "—"],
          ["National ID", e.nationalId || "—"],
          ["KRA PIN", e.kraPin || "—"],
          ["NSSF number", e.nssfNumber || "—"],
          ["SHA number", e.shaNumber || "—"],
          ["Nationality", e.nationality || "—"],
          ["Email", e.email || "—"],
          ["Phone", e.phone || "—"],
        ]}
      />
      <InfoCard
        title="Employment"
        icon={Briefcase}
        rows={[
          ["Employee number", e.employeeNumber],
          ["Department", e.department || "—"],
          ["Designation", e.designation || "—"],
          ["Type", e.employmentType?.replace("_", " ") || "—"],
          ["Hired", day(e.hireDate)],
          ["Confirmed", day(e.confirmationDate)],
          ["Job grade", e.jobGrade || "—"],
          ["Work location", e.workLocation || "—"],
          ["Manager", e.managerName || "—"],
          ["Shift", e.shiftStart ? `${e.shiftStart}–${e.shiftEnd || "—"}` : "Company default"],
          ...(e.contractEnd ? [["Contract ends", day(e.contractEnd)]] : []),
          ...(e.terminationDate
            ? [
                ["Terminated", day(e.terminationDate)],
                ["Reason", e.terminationReason || "—"],
              ]
            : []),
        ]}
      />
      {canSeePay && (
        <InfoCard
          title="Compensation"
          icon={Banknote}
          rows={[
            ["Basic salary", money(e.basicSalary)],
            ["Housing", money(e.allowanceHousing)],
            ["Transport", money(e.allowanceTransport)],
            ["Medical", money(e.allowanceMedical)],
            ["Other", money(e.allowanceOther)],
            ["Gross", money(e.grossSalary)],
            ["Paid by", e.paymentMethod || "—"],
            ["Bank", e.bankName || "—"],
            ["Account", e.bankAccount || "—"],
            ["M-Pesa", e.mpesaNumber || "—"],
            ["Last reviewed", day(e.lastReviewDate)],
          ]}
        />
      )}
      {e.emergencyName && (
        <InfoCard
          title="Emergency contact"
          rows={[
            ["Name", e.emergencyName],
            ["Relationship", e.emergencyRelationship || "—"],
            ["Phone", e.emergencyPhone || "—"],
          ]}
        />
      )}
    </div>
  );
}

async function LeaveTab({ employeeId }) {
  const { balances } = await getEmployeeLeaveBalances(employeeId);
  const year = new Date().getFullYear();

  if (!balances?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No leave types are set up yet.{" "}
        <Link href="/dashboard/hr/leave-types" className="text-primary hover:underline">
          Configure them
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Balances for {year}</p>
        <Link
          href={`/dashboard/hr/employees/${employeeId}/leave-balances`}
          className="text-sm text-primary hover:underline"
        >
          Adjust entitlements
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
              <th className="px-4 py-3">Leave type</th>
              <th className="px-4 py-3 text-right">Entitled</th>
              <th className="px-4 py-3 text-right">Brought forward</th>
              <th className="px-4 py-3 text-right">Taken</th>
              <th className="px-4 py-3 text-right">Pending</th>
              <th className="px-4 py-3 text-right">Encashed</th>
              <th className="px-4 py-3 text-right">Available</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {balances.map((b) => (
              <tr key={b.leaveTypeId} className="hover:bg-muted/30">
                <td className="px-4 py-3 font-medium text-foreground">
                  {b.name}
                  {!b.affectsBalance && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      no entitlement
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-foreground">{b.entitledDays}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{b.carryOverDays}</td>
                <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{b.takenDays}</td>
                <td className="px-4 py-3 text-right text-yellow-600 dark:text-yellow-400">{b.pendingDays}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{b.encashedDays}</td>
                <td
                  className={`px-4 py-3 text-right font-semibold ${
                    b.availableDays <= 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-700 dark:text-emerald-400"
                  }`}
                >
                  {b.availableDays}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Available is what a new request is checked against: entitled plus brought
        forward, less taken, encashed and anything still awaiting a decision.
      </p>
    </div>
  );
}

async function PayrollTab({ employeeId }) {
  const payslips = await listPayslips(employeeId);
  if (!payslips.length) {
    return <p className="text-sm text-muted-foreground">No payslips yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
            <th className="px-4 py-3">Period</th>
            <th className="px-4 py-3 text-right">Gross</th>
            <th className="px-4 py-3 text-right">Deductions</th>
            <th className="px-4 py-3 text-right">Net</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {payslips.map((p) => (
            <tr key={p.id} className="hover:bg-muted/30">
              <td className="px-4 py-3 text-foreground">{p.label}</td>
              <td className="px-4 py-3 text-right text-foreground">
                {p.grossPay.toLocaleString("en-KE")}
              </td>
              <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">
                ({p.totalDeductions.toLocaleString("en-KE")})
              </td>
              <td className="px-4 py-3 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                {p.netPay.toLocaleString("en-KE")}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    p.paymentStatus === "paid"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                  }`}
                >
                  {p.paymentStatus}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/dashboard/hr/payroll/${p.runId}`}
                  className="text-xs text-primary hover:underline"
                >
                  Open run
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Employment events and pay changes, together.
 *
 * The source records history for confirmations and terminations only, and
 * shows it nowhere — so a promotion or a transfer left no trace anybody could
 * read.
 */
function HistoryTab({ events, salary, canSeePay }) {
  const items = [
    ...events.map((e) => ({
      key: `e-${e.id}`,
      date: e.effectiveDate,
      title: e.eventType.replace(/_/g, " "),
      detail:
        e.previousValue || e.newValue
          ? `${e.previousValue || "—"} → ${e.newValue || "—"}`
          : null,
      reason: e.reason,
      by: e.changedByName,
    })),
    ...(canSeePay
      ? salary.map((s) => ({
          key: `s-${s.id}`,
          date: s.effectiveDate,
          title: "pay change",
          detail: `${money(s.previousGross)} → ${money(s.newGross)} (${s.grossChange >= 0 ? "+" : ""}${s.grossChange.toLocaleString("en-KE")})`,
          reason: s.reason,
          by: s.changedByName,
        }))
      : []),
  ].sort((a, b) => b.date.localeCompare(a.date));

  if (!items.length) {
    return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {items.map((i) => (
        <li
          key={i.key}
          className="rounded-lg border border-border bg-card p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium capitalize text-foreground">{i.title}</p>
            <p className="text-xs text-muted-foreground">{day(i.date)}</p>
          </div>
          {i.detail && <p className="mt-1 text-sm text-muted-foreground">{i.detail}</p>}
          {i.reason && <p className="mt-1 text-sm text-muted-foreground">{i.reason}</p>}
          {i.by && <p className="mt-1 text-xs text-muted-foreground">by {i.by}</p>}
        </li>
      ))}
    </ol>
  );
}

export default async function EmployeeDetailPage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const activeTab = sp.tab || "profile";

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_VIEW_ROLES)) redirect("/dashboard/hr");

  const data = await getEmployeeForPage(id);
  if (!data) notFound();

  const { employee, documents, events, salary } = data;
  const initials = (employee.firstName?.[0] || "") + (employee.lastName?.[0] || "");
  const canSeePay = roleAllowed(session.user.role, HR_COMPENSATION_ROLES);
  const canManageLeave = roleAllowed(session.user.role, HR_ADMIN_ROLES);

  const tabs = [
    { key: "profile", label: "Profile", icon: User },
    { key: "leave", label: "Leave", icon: Calendar },
    { key: "payroll", label: "Payroll", icon: Banknote },
    { key: "history", label: "History", icon: History },
    { key: "documents", label: "Documents", icon: FileText },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/employees" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Employees
        </Link>
        <span>/</span>
        <span className="text-foreground">{employee.fullName}</span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <EmployeePhotoUpload
            employeeId={employee.id}
            currentPhotoUrl={employee.photoUrl}
            initials={initials}
          />
          <div>
            <h1 className="text-lg font-bold text-foreground sm:text-2xl">{employee.fullName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono">{employee.employeeNumber}</span>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">{employee.designation || "No designation"}</span>
              <span className="hidden sm:inline">·</span>
              <span>{employee.department || "No department"}</span>
              <StatusBadge status={employee.status} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <EmployeeActions
            employeeId={employee.id}
            status={employee.status}
            hasLogin={Boolean(employee.userId)}
            userRole={session.user.role}
            email={employee.email}
          />
          {canSeePay && (
            <Link
              href={`/dashboard/hr/employees/${employee.id}/compensation`}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <Banknote className="h-4 w-4" />
              <span className="hidden sm:inline">Compensation</span>
            </Link>
          )}
          {canManageLeave && (
            <Link
              href={`/dashboard/hr/employees/${employee.id}/leave-balances`}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <Calendar className="h-4 w-4" />
              <span className="hidden sm:inline">Leave</span>
            </Link>
          )}
          <Link
            href={`/dashboard/hr/employees/${employee.id}/attendance`}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Calendar className="h-4 w-4" />
            <span className="hidden sm:inline">Attendance</span>
          </Link>
          <Link
            href={`/dashboard/hr/p9/${employee.id}?year=${new Date().getFullYear()}`}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">P9</span>
          </Link>
          <Link
            href={`/dashboard/hr/employees/${employee.id}/edit`}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Edit className="h-4 w-4" />
            Edit
          </Link>
        </div>
      </div>

      <div className="flex w-fit gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`?tab=${tab.key}`}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
              activeTab === tab.key
                ? "bg-card font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </Link>
        ))}
      </div>

      {activeTab === "profile" && <ProfileTab e={employee} canSeePay={canSeePay} />}

      {activeTab === "leave" && (
        <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
          <LeaveTab employeeId={employee.id} />
        </Suspense>
      )}

      {activeTab === "payroll" && (
        <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
          <PayrollTab employeeId={employee.id} />
        </Suspense>
      )}

      {activeTab === "history" && (
        <HistoryTab events={events} salary={salary} canSeePay={canSeePay} />
      )}

      {activeTab === "documents" && (
        <EmployeeDocuments
          employeeId={employee.id}
          documents={documents}
          userRole={session.user.role}
        />
      )}
    </div>
  );
}
