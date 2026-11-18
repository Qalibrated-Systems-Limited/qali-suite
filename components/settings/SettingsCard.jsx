import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * One tile on a settings page: system settings, HR settings and finance
 * settings all use it, so the three read as one family.
 */
export function SettingsCard({ href, icon: Icon, iconColor, iconBg, title, description }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50 sm:gap-4 sm:p-4"
    >
      <div className={`shrink-0 rounded-lg p-2 sm:p-3 ${iconBg}`}>
        <Icon className={`h-5 w-5 ${iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium sm:text-base">{title}</h3>
        <p className="truncate text-xs text-muted-foreground sm:text-sm">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground sm:h-5 sm:w-5" />
    </Link>
  );
}

export function SettingsSection({ title, children }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </div>
  );
}
