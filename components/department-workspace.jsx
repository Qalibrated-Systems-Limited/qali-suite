"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
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
import {
  getNavigationGroups,
  DEPARTMENTS,
  departmentOf,
} from "./sidebar-content-grouped";
import SharedServicesBand from "./shared-services-band";

/**
 * A department's landing dashboard — the modern, consistent home for everyone
 * who works in it. Four bands, top to bottom:
 *   1. a hero naming the department and what it is for;
 *   2. quick actions — the two or three things people start here to do;
 *   3. shared services — reachable from every department (SharedServicesBand);
 *   4. the department's modules, as cards of links.
 *
 * The module list reads the SAME navigation config the sidebar does
 * (getNavigationGroups), filtered to this department, so a module gated off by
 * plan or role is absent here exactly as it is in the sidebar. Organisation
 * only — nothing here grants access.
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

export default function DepartmentWorkspace({ user, slug }) {
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

      {/* Shared services — reachable from every department */}
      <SharedServicesBand />

      {/* The department's own modules */}
      {cards.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nothing in this department is available on your current plan or role.
        </Card>
      ) : (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {dept.label} modules
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => {
              const CardIcon = card.icon;
              return (
                <Card key={card.id} className="flex flex-col p-4">
                  <div className="mb-3 flex items-center gap-2">
                    {CardIcon && (
                      <CardIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                    <h3 className="text-sm font-semibold">{card.label}</h3>
                  </div>
                  <ul className="space-y-0.5">
                    {card.links.map((l) => {
                      const LinkIcon = l.icon;
                      return (
                        <li key={l.href}>
                          <Link
                            href={l.href}
                            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            {LinkIcon && (
                              <LinkIcon className="h-4 w-4 shrink-0" />
                            )}
                            <span className="min-w-0 truncate">{l.label}</span>
                            <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
