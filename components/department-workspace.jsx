"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Plus,
  ShieldCheck,
  FileText,
  Receipt,
  BookOpen,
  Users,
  Boxes,
  Target,
  FlaskConical,
  Briefcase,
} from "lucide-react";
import { getNavigationGroups } from "./sidebar-content-grouped";
import { DEPARTMENTS, departmentOf } from "./departments-config";
import SharedServicesBand from "./shared-services-band";

/**
 * A department's landing dashboard — the modern, consistent home for everyone
 * who works in it. Three bands, top to bottom:
 *   1. a hero naming the department and what it is for;
 *   2. quick actions — the two or three things people start here to do;
 *   3. shared services — reachable from every department (SharedServicesBand).
 *
 * It deliberately does NOT list the department's modules as link cards: that
 * only repeated the left sidebar's own submenu in the page body — a second
 * navbar. Navigation stays the sidebar's job. The navigation config is still
 * read (getNavigationGroups) to learn which modules this role/plan can reach,
 * so a quick action is never offered for a module that is hidden.
 */

// The two or three primary actions each department starts with. Every href is
// an existing route; they mirror what the department's people reach for first.
const QUICK_ACTIONS = {
  projects: [
    { label: "New project", href: "/dashboard/projects/create", icon: Plus },
    { label: "Sealed budgets", href: "/dashboard/projects/sealed-budgets", icon: ShieldCheck },
    { label: "Findings", href: "/dashboard/projects/findings", icon: FileText },
  ],
  finance: [
    { label: "Invoices", href: "/dashboard/invoices", icon: Receipt },
    { label: "Journal", href: "/dashboard/journal", icon: BookOpen },
    { label: "Reports", href: "/dashboard/reports/profit-loss", icon: FileText },
  ],
  technical: [
    { label: "New report", href: "/dashboard/technical/new", icon: Plus },
    { label: "Report registry", href: "/dashboard/technical", icon: FlaskConical },
  ],
  "business-dev": [
    { label: "New lead", href: "/dashboard/leads", icon: Plus },
    { label: "Quotes", href: "/dashboard/quotes", icon: FileText },
    { label: "Bids & tenders", href: "/dashboard/bids", icon: Briefcase },
  ],
  "ict-quality": [
    { label: "Quality (QMS)", href: "/dashboard/qms", icon: Target },
    { label: "Compliance", href: "/dashboard/compliance", icon: ShieldCheck },
    { label: "SOP Library", href: "/dashboard/sops", icon: BookOpen },
  ],
  "general-ops": [
    { label: "Purchase order", href: "/dashboard/purchase-orders", icon: Plus },
    { label: "Products", href: "/dashboard/stocks", icon: Boxes },
  ],
  "hr-admin": [
    { label: "Employees", href: "/dashboard/hr/employees", icon: Users },
    { label: "Payroll", href: "/dashboard/hr/payroll", icon: Receipt },
  ],
};

const TONE_CLASSES = {
  default: "text-foreground",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
};

function KpiTile({ kpi }) {
  const toneClass = TONE_CLASSES[kpi.tone || "default"];
  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {kpi.value}
      </p>
      {kpi.sub && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{kpi.sub}</p>
      )}
    </>
  );
  return kpi.href ? (
    <Link
      href={kpi.href}
      className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-border bg-card p-4">{body}</div>
  );
}

export default function DepartmentWorkspace({ user, slug, kpis = [] }) {
  const dept = DEPARTMENTS.find((d) => d.slug === slug);
  if (!dept) return null;
  const DeptIcon = dept.icon;

  const entries = getNavigationGroups(user).filter(
    (g) => departmentOf(g.id) === slug,
  );

  const cards = entries
    .map((entry) => {
      if (entry.hidden) return null;
      if (entry.type === "single") {
        return {
          id: entry.id,
          label: entry.label,
          icon: entry.icon,
          links: [{ label: entry.label, href: entry.href, icon: entry.icon }],
        };
      }
      const links = (entry.items || []).filter((i) => !i.hidden);
      if (links.length === 0) return null;
      return { id: entry.id, label: entry.label, icon: entry.icon, links };
    })
    .filter(Boolean);

  // Quick actions, kept to the ones whose target the user can actually reach:
  // an action is shown only if its href appears among this department's visible
  // module links (so a role without that module is not offered it).
  const reachable = new Set(cards.flatMap((c) => c.links.map((l) => l.href)));
  const quickActions = (QUICK_ACTIONS[slug] || []).filter((a) =>
    reachable.has(a.href),
  );

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-5 lg:p-6">
      {/* Hero */}
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
          <DeptIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold sm:text-2xl">{dept.label}</h1>
          <p className="text-sm text-muted-foreground">{dept.blurb}</p>
        </div>
        {quickActions.length > 0 && (
          <div className="hidden shrink-0 gap-2 sm:flex">
            {quickActions.map((a, i) => {
              const AIcon = a.icon;
              return (
                <Button
                  key={a.href}
                  asChild
                  size="sm"
                  variant={i === 0 ? "default" : "outline"}
                >
                  <Link href={a.href}>
                    <AIcon className="mr-1.5 h-4 w-4" />
                    {a.label}
                  </Link>
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick actions on phones (the hero row is hidden there) */}
      {quickActions.length > 0 && (
        <div className="flex flex-wrap gap-2 sm:hidden">
          {quickActions.map((a, i) => {
            const AIcon = a.icon;
            return (
              <Button
                key={a.href}
                asChild
                size="sm"
                variant={i === 0 ? "default" : "outline"}
              >
                <Link href={a.href}>
                  <AIcon className="mr-1.5 h-4 w-4" />
                  {a.label}
                </Link>
              </Button>
            );
          })}
        </div>
      )}

      {/* Live KPIs — composed from the department's own modules (empty for a
          department with no live figures, e.g. Technical). */}
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiTile key={kpi.key} kpi={kpi} />
          ))}
        </div>
      )}

      {/* Shared services — reachable from every department */}
      <SharedServicesBand />

      {/* The per-module link cards used to live here, but they simply repeated
          this department's entries from the left sidebar — a second navbar in
          the page body. Navigation is the sidebar's job; this dashboard is for
          the hero, the actions people start with, the live KPIs and shared
          services. (QUICK_ACTIONS is still gated against the department's
          visible modules below, so an action is never offered for a module the
          role or plan hides.) */}
    </div>
  );
}
