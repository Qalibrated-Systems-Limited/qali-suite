import Link from "next/link";
import {
  Wallet,
  Banknote,
  GitPullRequestArrow,
  FileText,
  BookOpen,
  Clock,
  Receipt,
  Flag,
  CalendarX,
  OctagonAlert,
  ArrowRight,
} from "lucide-react";
import { getProjectsOverview } from "@/app/db/actions/project-actions";

/**
 * The first thing the Projects module shows: everything that is waiting on
 * somebody, across every section, and the latest movement. A card with
 * nothing in it says so quietly; one with work in it is the one you click.
 */

const kes = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

const KIND = {
  requisition: { label: "Cash requisition", href: (r) => `/dashboard/projects/cash-requisitions?project=${r.projectId}` },
  certificate: { label: "Payment certificate", href: (r) => `/dashboard/projects/ipc?project=${r.projectId}` },
  variation: { label: "Variation", href: (r) => `/dashboard/projects/variations?project=${r.projectId}` },
  instruction: { label: "Engineer's instruction", href: (r) => `/dashboard/projects/instructions?project=${r.projectId}` },
  diary: { label: "Site diary", href: (r) => `/dashboard/projects/diary?project=${r.projectId}` },
  project: { label: "Project", href: (r) => `/dashboard/projects/${r.projectId}` },
};

function AttentionCard({ icon: Icon, count, label, sub, href }) {
  const hot = count > 0;
  return (
    <Link
      href={href}
      className={`group flex items-start gap-3 rounded-lg border p-4 shadow-sm transition-colors hover:bg-accent ${
        hot ? "border-amber-300 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20" : "border-border bg-card"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
          hot ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-2xl font-semibold leading-none ${hot ? "text-foreground" : "text-muted-foreground"}`}>
          {count}
        </span>
        <span className="mt-1 block text-sm text-foreground">{label}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

export default async function ProjectsOverview() {
  const { summary: s, recent } = await getProjectsOverview();

  const cards = [
    {
      icon: Wallet,
      count: s.requisitions.awaiting,
      label: "Cash requisitions awaiting approval",
      sub: s.requisitions.awaiting ? kes(s.requisitions.awaitingAmount) : null,
      href: "/dashboard/projects/cash-requisitions",
    },
    {
      icon: Banknote,
      count: s.requisitions.toFund,
      label: "Approved requisitions to fund",
      sub: s.requisitions.toFund ? kes(s.requisitions.toFundAmount) : null,
      href: "/dashboard/projects/cash-requisitions",
    },
    { icon: GitPullRequestArrow, count: s.variationsAwaiting, label: "Variations awaiting a decision", href: "/dashboard/projects/variations" },
    { icon: FileText, count: s.instructionsPending, label: "Engineer's instructions pending", href: "/dashboard/projects/instructions" },
    {
      icon: BookOpen,
      count: s.diaryAwaiting,
      label: "Diary entries to countersign",
      sub: `${s.diaryThisWeek} written this week`,
      href: "/dashboard/projects/diary",
    },
    { icon: Clock, count: s.timesheetsAwaiting, label: "Timesheets awaiting approval", href: "/dashboard/projects/timesheets" },
    { icon: Receipt, count: s.certificatesDraft, label: "Payment certificates in draft", href: "/dashboard/projects/ipc" },
    {
      icon: Flag,
      count: s.milestonesOverdue,
      label: "Milestones overdue",
      sub: s.milestonesDueSoon ? `${s.milestonesDueSoon} due in the next 14 days` : null,
      href: "/dashboard/projects/milestones",
    },
    {
      icon: CalendarX,
      count: s.projects.pastEnd,
      label: "Active projects past their end date",
      sub: s.projects.endingSoon ? `${s.projects.endingSoon} ending within 30 days` : null,
      href: "/dashboard/projects/programme",
    },
    { icon: OctagonAlert, count: s.tasksBlocked, label: "Blocked tasks", href: "/dashboard/projects/programme" },
  ];
  const waiting = cards.reduce((n, c) => n + c.count, 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Needs attention</h2>
        <p className="text-xs text-muted-foreground">
          {s.projects.active} active · {s.projects.planning} in planning · {s.projects.onHold} on hold ·{" "}
          {s.projects.finished} completed
        </p>
      </div>
      {waiting === 0 && (
        <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          Nothing is waiting on anyone across the projects right now.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <AttentionCard key={c.label} {...c} />
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">Recent activity</h2>
        </div>
        {recent.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No activity yet. Start a project to begin.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => {
              const k = KIND[r.kind] || KIND.project;
              return (
                <li key={`${r.kind}-${r.id}`}>
                  <Link href={k.href(r)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {k.label}
                        {r.ref ? <span className="ml-1 font-mono text-xs text-muted-foreground">{r.ref}</span> : null}
                        {r.label && r.kind !== "project" ? ` — ${r.label}` : ""}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.projectNumber} · {r.projectName}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                      {r.status.replace(/_/g, " ")}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export function ProjectsOverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}
