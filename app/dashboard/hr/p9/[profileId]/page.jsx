import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Printer } from "lucide-react";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import EmployeeProfile from "@/app/models/employeeProfile";
import PayrollEntry from "@/app/models/payrollEntry";
import Company from "@/app/models/Company";

export async function generateMetadata({ params, searchParams }) {
  const { profileId } = await params;
  const sp = await searchParams;
  const year = sp.year || new Date().getFullYear();
  return { title: `P9 Certificate ${year} | HR` };
}

// Roles that can view any employee's P9
const HR_ROLES = ["SuperAdmin", "Admin", "HR", "Accountant"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmt(n) {
  if (!n && n !== 0) return "—";
  return new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default async function P9CertificatePage({ params, searchParams }) {
  const { profileId } = await params;
  const sp = await searchParams;
  const year = parseInt(sp.year || new Date().getFullYear());

  const session = await auth();
  if (!session?.user) redirect("/login");

  const isHR = HR_ROLES.includes(session.user.role);
  const isEmployee = session.user.role === "Employee" || !isHR;

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Load profile — HR can view any, employees can only view their own
  const profileQuery = isEmployee
    ? withTenantScope({ _id: profileId, userId: session.user.id }, companyId, isSuperAdmin)
    : withTenantScope({ _id: profileId }, companyId, isSuperAdmin);

  const profile = await EmployeeProfile.findOne(profileQuery)
    .select(
      "personalInfo.firstName personalInfo.lastName personalInfo.kraPin personalInfo.nationalId " +
      "employeeNumber employment.department employment.designation companyId"
    )
    .lean();

  if (!profile) notFound();

  // Load all payroll entries for this employee for the year
  const entries = await PayrollEntry.find(
    withTenantScope(
      { profileId: profile._id, "period.year": year },
      companyId,
      isSuperAdmin
    )
  )
    .select("period.month earnings.basicSalary earnings.grossPay deductions.nssf deductions.paye deductions.housingLevy deductions.shif")
    .sort({ "period.month": 1 })
    .lean();

  // Load company for employer details
  const company = await Company.findById(profile.companyId || companyId)
    .select("name taxPin address")
    .lean();

  // Build month-by-month data (fill gaps with zeros)
  const monthData = MONTHS.map((name, i) => {
    const monthNum = i + 1;
    const entry = entries.find((e) => e.period?.month === monthNum);
    if (!entry) return { name, gross: 0, nssf: 0, taxable: 0, paye: 0, relief: 2400, netTax: 0 };

    const gross = entry.earnings?.grossPay || 0;
    const nssf = entry.deductions?.nssf || 0;
    const taxable = Math.max(0, gross - nssf);
    const paye = entry.deductions?.paye || 0;
    const relief = 2400; // KES 28,800 / 12 months personal relief
    const netTax = Math.max(0, paye); // PAYE already net of relief in calculation

    return { name, gross, nssf, taxable, paye, relief, netTax };
  });

  const totals = monthData.reduce(
    (acc, m) => ({
      gross: acc.gross + m.gross,
      nssf: acc.nssf + m.nssf,
      taxable: acc.taxable + m.taxable,
      paye: acc.paye + m.paye,
      relief: acc.relief + m.relief,
      netTax: acc.netTax + m.netTax,
    }),
    { gross: 0, nssf: 0, taxable: 0, paye: 0, relief: 0, netTax: 0 }
  );

  const employeeName = `${profile.personalInfo?.firstName || ""} ${profile.personalInfo?.lastName || ""}`.trim();
  const backHref = isHR
    ? `/dashboard/hr/employees/${profileId}`
    : `/dashboard/hr/my-payslips`;

  return (
    <div className="min-h-screen bg-background">
      {/* Screen-only toolbar */}
      <div className="print:hidden sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link href={backHref} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            {isHR ? "Employee Profile" : "My Payslips"}
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">P9 Certificate — {year}</span>
            <button
              onClick={undefined}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent print:hidden"
              aria-label="Print P9"
            >
              <Printer className="h-3.5 w-3.5" />
              Print / Save PDF
            </button>
          </div>
        </div>
      </div>

      {/* P9 Document */}
      <div className="mx-auto max-w-4xl px-4 py-8 print:p-0 print:max-w-none">
        <div className="rounded-xl border border-border bg-card shadow-sm print:rounded-none print:border-0 print:shadow-none">

          {/* KRA Header */}
          <div className="border-b border-border px-8 py-6 text-center print:px-6 print:py-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Kenya Revenue Authority</p>
            <h1 className="mt-1 text-xl font-bold text-foreground">P9A — Employee Tax Deduction Card</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Tax Year: {year}</p>
          </div>

          {/* Employer / Employee details */}
          <div className="grid grid-cols-2 gap-6 border-b border-border px-8 py-5 print:px-6 print:py-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Employer Details</p>
              <dl className="space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Name</dt>
                  <dd className="font-medium text-foreground">{company?.name || "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">KRA PIN</dt>
                  <dd className="font-mono text-foreground">{company?.taxPin || "—"}</dd>
                </div>
              </dl>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Employee Details</p>
              <dl className="space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Name</dt>
                  <dd className="font-medium text-foreground">{employeeName}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Employee No.</dt>
                  <dd className="font-mono text-foreground">{profile.employeeNumber || "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">KRA PIN</dt>
                  <dd className="font-mono text-foreground">{profile.personalInfo?.kraPin || "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">National ID</dt>
                  <dd className="font-mono text-foreground">{profile.personalInfo?.nationalId || "—"}</dd>
                </div>
                {profile.employment?.department && (
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Department</dt>
                    <dd className="text-foreground">{profile.employment.department}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          {/* Monthly breakdown table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Month</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gross Pay</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">NSSF</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Taxable Pay</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tax Relief</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">PAYE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {monthData.map((m) => {
                  const hasData = m.gross > 0;
                  return (
                    <tr key={m.name} className={hasData ? "hover:bg-muted/30" : "opacity-40"}>
                      <td className="px-4 py-2.5 font-medium text-foreground">{m.name}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-foreground">{hasData ? fmt(m.gross) : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{hasData ? fmt(m.nssf) : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-foreground">{hasData ? fmt(m.taxable) : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{hasData ? fmt(m.relief) : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-medium text-foreground">{hasData ? fmt(m.paye) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50 font-semibold">
                  <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">Annual Total</td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">{fmt(totals.gross)}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">{fmt(totals.nssf)}</td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">{fmt(totals.taxable)}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">{fmt(totals.relief)}</td>
                  <td className="px-4 py-3 text-right font-mono text-primary">{fmt(totals.paye)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Summary box */}
          <div className="border-t border-border px-8 py-5 print:px-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <p className="text-xs text-muted-foreground">Annual Gross</p>
                <p className="mt-1 font-mono font-bold text-foreground">{fmt(totals.gross)}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <p className="text-xs text-muted-foreground">Annual NSSF</p>
                <p className="mt-1 font-mono font-bold text-muted-foreground">{fmt(totals.nssf)}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <p className="text-xs text-muted-foreground">Annual Taxable</p>
                <p className="mt-1 font-mono font-bold text-foreground">{fmt(totals.taxable)}</p>
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center">
                <p className="text-xs text-muted-foreground">Total PAYE</p>
                <p className="mt-1 font-mono font-bold text-primary">{fmt(totals.paye)}</p>
              </div>
            </div>
          </div>

          {/* Certification */}
          <div className="border-t border-border px-8 py-5 print:px-6">
            <p className="text-xs text-muted-foreground leading-relaxed">
              I certify that the details above are correct and that the PAYE tax shown has been deducted from the
              employee&apos;s emoluments and remitted to the Kenya Revenue Authority for the tax year {year}.
              This certificate should be attached to the employee&apos;s individual tax return (IT1) on iTax.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-8 print:mt-10">
              <div>
                <div className="border-b border-border pb-1" />
                <p className="mt-1 text-xs text-muted-foreground">Authorised Signatory &amp; Stamp</p>
              </div>
              <div>
                <div className="border-b border-border pb-1" />
                <p className="mt-1 text-xs text-muted-foreground">Date</p>
              </div>
            </div>
          </div>

          {/* No data notice */}
          {entries.length === 0 && (
            <div className="border-t border-border bg-amber-500/5 px-8 py-4 text-sm text-amber-700 dark:text-amber-400">
              No payroll entries found for {employeeName} in {year}. Ensure payroll runs for this year have been processed and approved.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
