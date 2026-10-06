"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import {
  getNavigationGroups,
  DEPARTMENTS,
  departmentOf,
} from "./sidebar-content-grouped";

/**
 * A department's landing dashboard — every module that department owns, laid
 * out as cards of links. It reads the SAME navigation config the sidebar does
 * (getNavigationGroups), filtered to this department, so a module gated off by
 * plan or role is absent here exactly as it is in the sidebar. Organisation
 * only; nothing here grants access.
 */
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

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5 lg:p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
          <DeptIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">{dept.label}</h1>
          <p className="text-sm text-muted-foreground">{dept.blurb}</p>
        </div>
      </div>

      {cards.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nothing in this department is available on your current plan or role.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => {
            const CardIcon = card.icon;
            return (
              <Card key={card.id} className="flex flex-col p-4">
                <div className="mb-3 flex items-center gap-2">
                  {CardIcon && (
                    <CardIcon className="h-4 w-4 text-muted-foreground" />
                  )}
                  <h2 className="text-sm font-semibold">{card.label}</h2>
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
      )}
    </div>
  );
}
