import Link from "next/link";
import {
  ListChecks,
  FileText,
  Receipt,
  Calendar,
  LifeBuoy,
  CheckSquare,
} from "lucide-react";

/**
 * Shared services — the things anyone does regardless of department: raise a
 * requisition, claim an expense, book leave, log a ticket, see their tasks and
 * approvals. Rendered on every landing (the role dashboards and each
 * department dashboard) so they are one reach from wherever a person starts.
 *
 * A plain server component — just links. The pages behind them scope what each
 * person sees, so this stays ungated.
 */
const SHARED_SERVICES = [
  { icon: ListChecks, label: "My Tasks", href: "/dashboard/tasks", hint: "What's assigned to me" },
  { icon: FileText, label: "Requisitions", href: "/dashboard/requests", hint: "Request items or stores" },
  { icon: Receipt, label: "My Expenses", href: "/dashboard/my-claims", hint: "Claim a reimbursement" },
  { icon: Calendar, label: "My Leave", href: "/dashboard/hr/my-leave", hint: "Book or track leave" },
  { icon: LifeBuoy, label: "Help Desk", href: "/dashboard/helpdesk", hint: "Log a support ticket" },
  { icon: CheckSquare, label: "Approvals", href: "/dashboard/approvals", hint: "What's waiting on me" },
];

export default function SharedServicesBand({ className = "" }) {
  return (
    <section className={className}>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Shared services
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {SHARED_SERVICES.map((s) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.href}
              href={s.href}
              title={s.hint}
              className="group flex flex-col gap-1.5 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent"
            >
              <Icon className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium leading-tight">{s.label}</span>
              <span className="text-[11px] leading-tight text-muted-foreground">
                {s.hint}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
