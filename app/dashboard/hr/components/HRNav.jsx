"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { hrNavFor, activeHrSection } from "@/lib/nav/hr-nav";
import { can } from "@/lib/capabilities";

/**
 * The HR module's top bar, built from the same list as the sidebar's HR group
 * (lib/nav/hr-nav.js), so the two always agree.
 *
 * Two tiers: the sections (People, Time & leave, Pay, …) as tabs, and under
 * them the pages of the section you are in. Fifteen pages in one row were a
 * scroll you could not see the end of; now the bar shows where you are and
 * the handful of pages next to it.
 */
export default function HRNav({ user }) {
  const pathname = usePathname();
  // `can(user, …)` honours the company's saved Roles & Permissions.
  const sections = useMemo(() => hrNavFor(user, (cap) => can(user, cap)), [user]);
  const active = activeHrSection(sections, pathname);
  const current = sections.find((s) => s.id === active?.section) || sections[0];
  if (!current) return null;

  return (
    <nav aria-label="Human resources" className="sticky top-14 z-10 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex items-center gap-1 overflow-x-auto px-4 pt-2 sm:px-6 [scrollbar-width:none]">
        <span className="mr-2 hidden shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:inline">
          Human resources
        </span>
        {sections.map((s) => {
          const on = s.id === current.id;
          const Icon = s.icon;
          return (
            <Link
              key={s.id}
              href={s.items[0].href}
              aria-current={on ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm transition-colors ${
                on
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {s.label}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-1 overflow-x-auto bg-muted px-4 py-1.5 sm:px-6 [scrollbar-width:none]">
        {current.items.map((item) => {
          const on = active?.item === item.id;
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={on ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                on
                  ? "bg-card font-semibold text-foreground shadow-sm ring-1 ring-amber-500/70"
                  : "text-muted-foreground hover:bg-card/70 hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
