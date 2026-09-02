"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * In-module tab strip. Carries the current `?project=` through so the registry
 * and the sheet chooser stay pointed at the same project as you move between
 * them.
 */
const ITEMS = [
  { label: "Dashboard", href: "/dashboard/technical/overview" },
  { label: "New report", href: "/dashboard/technical/new" },
  { label: "Report registry", href: "/dashboard/technical", exact: true },
];

export default function TechnicalNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const project = searchParams.get("project");
  const suffix = project ? `?project=${project}` : "";

  return (
    <nav className="tech-nav">
      {ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link key={item.href} href={`${item.href}${suffix}`} className={active ? "active" : ""}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
