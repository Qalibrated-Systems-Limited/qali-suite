"use client";

import { cn } from "@/lib/utils";

/**
 * QaliSuite brand components — single source of truth.
 *
 * Usage:
 *   <QaliSuiteIcon />                         — icon only (collapsed sidebar, favicon)
 *   <QaliSuiteMark />                         — icon + "QaliSuite" text (nav, headers)
 *   <QaliSuiteMark subtitle="ERP System" />   — icon + title + subtitle (expanded sidebar)
 *   <QaliSuiteLogo />                         — full SVG logo with embedded subtitle (legacy/print)
 */

// ─── Shared icon SVG (gradient squircle + colleague's Q lettermark) ───
function IconSvg({ className, id = "qs" }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <linearGradient id={`${id}-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="50%" stopColor="#EAB308" />
          <stop offset="100%" stopColor="#CA8A04" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#${id}-grad)`} />
      <g transform="translate(8, 7.5) scale(0.077)">
        <path
          fill="white"
          fillOpacity="0.95"
          d="M207.75 207.22V349.65c-.19 0-.37.01-.56.01-78.54 0-142.45-63.9-142.45-142.44s63.91-142.44 142.45-142.44 142.44 63.9 142.44 142.44c0 25.52-6.75 49.49-18.56 70.22l46.98 46.99c7.87-11.44 14.57-23.65 20.03-36.55 10.82-25.56 16.3-52.7 16.3-80.66s-5.48-55.09-16.3-80.66C390.45 108.67 375.52 86.51 356.5 67.5 337.48 48.48 315.33 33.54 290.65 23.11 265.09 12.29 237.95 6.81 210 6.81s-55.09 5.48-80.66 16.3C103.66 33.54 81.51 48.48 62.49 67.5 43.47 86.51 28.54 108.67 18.1 133.34 7.29 158.91 1.81 186.04 1.81 214s5.48 55.09 18.1 80.66c10.44 24.67 25.37 46.83 44.39 65.85 19.02 19.01 41.17 33.95 65.85 44.39 25.56 10.81 52.7 16.3 80.66 16.3 22.43 0 44.32-3.54 65.31-10.52V370.31l50.88 50.88h91.56L207.75 207.22"
        />
      </g>
    </svg>
  );
}

/**
 * Icon only — for collapsed sidebar, mobile header, favicon-size usage.
 */
export function QaliSuiteIcon({ className = "w-10 h-10" }) {
  return <IconSvg className={className} id="qs-icon" />;
}

/**
 * Icon + text mark — the standard brand lockup.
 * Use everywhere you'd show the logo with its name.
 *
 * Props:
 *   size      — "sm" | "md" | "lg" (default "md")
 *   subtitle  — optional subtitle below "QaliSuite" (e.g. "ERP System")
 *   className — wrapper className override
 *   light     — force white text (for dark backgrounds)
 */
export function QaliSuiteMark({
  size = "md",
  subtitle,
  className,
  light = false,
}) {
  const sizes = {
    sm: { icon: "w-7 h-7", title: "text-base", sub: "text-[10px]", gap: "gap-2" },
    md: { icon: "w-9 h-9", title: "text-lg", sub: "text-[11px]", gap: "gap-2.5" },
    lg: { icon: "w-11 h-11", title: "text-xl", sub: "text-xs", gap: "gap-3" },
  };
  const s = sizes[size] || sizes.md;

  return (
    <div className={cn("flex items-center", s.gap, className)}>
      <IconSvg className={cn(s.icon, "shrink-0")} id={`qs-mark-${size}`} />
      <div className="flex flex-col min-w-0">
        <span className={cn("font-bold tracking-tight leading-tight", s.title, light ? "text-white" : "text-foreground")}>
          Qali<span className="text-yellow-500">Suite</span>
        </span>
        {subtitle && (
          <span className={cn("leading-none mt-0.5", s.sub, light ? "text-white/50" : "text-muted-foreground")}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Full SVG logo — icon + text baked into one SVG.
 * Best for the expanded sidebar where we need a single scalable unit.
 * Includes "ERP SYSTEM" subtitle.
 */
export function QaliSuiteLogo({ className = "h-11" }) {
  return (
    <div className={className}>
      <svg viewBox="0 0 200 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-auto">
        <defs>
          <linearGradient id="qs-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FDE047" />
            <stop offset="50%" stopColor="#EAB308" />
            <stop offset="100%" stopColor="#CA8A04" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="12" fill="url(#qs-logo-grad)" />
        <g transform="translate(8, 7.5) scale(0.077)">
          <path
            fill="white"
            fillOpacity="0.95"
            d="M207.75 207.22V349.65c-.19 0-.37.01-.56.01-78.54 0-142.45-63.9-142.45-142.44s63.91-142.44 142.45-142.44 142.44 63.9 142.44 142.44c0 25.52-6.75 49.49-18.56 70.22l46.98 46.99c7.87-11.44 14.57-23.65 20.03-36.55 10.82-25.56 16.3-52.7 16.3-80.66s-5.48-55.09-16.3-80.66C390.45 108.67 375.52 86.51 356.5 67.5 337.48 48.48 315.33 33.54 290.65 23.11 265.09 12.29 237.95 6.81 210 6.81s-55.09 5.48-80.66 16.3C103.66 33.54 81.51 48.48 62.49 67.5 43.47 86.51 28.54 108.67 18.1 133.34 7.29 158.91 1.81 186.04 1.81 214s5.48 55.09 18.1 80.66c10.44 24.67 25.37 46.83 44.39 65.85 19.02 19.01 41.17 33.95 65.85 44.39 25.56 10.81 52.7 16.3 80.66 16.3 22.43 0 44.32-3.54 65.31-10.52V370.31l50.88 50.88h91.56L207.75 207.22"
          />
        </g>
        <text x="54" y="28" fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif" fontSize="22" fontWeight="700" fill="currentColor" letterSpacing="-0.5">
          <tspan>Qali</tspan>
          <tspan fill="#EAB308">Suite</tspan>
        </text>
        <text x="54" y="42" fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif" fontSize="9" fontWeight="500" className="fill-muted-foreground" letterSpacing="2.5">
          ERP SYSTEM
        </text>
      </svg>
    </div>
  );
}
