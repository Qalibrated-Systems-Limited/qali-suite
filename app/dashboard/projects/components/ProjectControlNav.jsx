"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { PC_GROUPS } from "../lib/control-screens";
import { projectIdFromPath } from "../lib/sections";

/**
 * The Project Control workspace sidebar — the template's seven groups and its
 * 27 screens, in qali-suite's theme. Replaces the old per-section tab strip.
 *
 * The selected project rides `?project=`, so a project-scoped screen opened
 * from here keeps the project you were on. Screens that live in another module
 * are marked with an out-arrow.
 */
export default function ProjectControlNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const project =
    searchParams.get("project") ?? projectIdFromPath(pathname) ?? "";

  const hrefFor = (s) =>
    s.project && project ? `${s.href}?project=${project}` : s.href;

  const isActive = (s) => {
    if (s.external) return false;
    if (s.exact) return pathname === s.href;
    return pathname === s.href || pathname.startsWith(s.href + "/");
  };

  return (
    <nav className="shrink-0 border-b border-border bg-card md:w-60 md:border-b-0 md:border-r">
      <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto px-2 py-3">
        <div className="px-2 pb-2">
          <p className="text-sm font-semibold">Project control</p>
          <p className="text-xs text-muted-foreground">Qalibrated Systems</p>
        </div>
        {PC_GROUPS.map(([group, items]) => (
          <div key={group} className="mb-3">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </p>
            <ul className="space-y-0.5">
              {items.map((s) => {
                const active = isActive(s);
                return (
                  <li key={s.key}>
                    <Link
                      href={hrefFor(s)}
                      className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                        active
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <span className="truncate">{s.label}</span>
                      {s.external && (
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
