"use client";

import { cn } from "@/lib/utils";

/**
 * QaliSuite brand components — single source of truth.
 * Matches the SVGs in /public/brand/
 *
 * Usage:
 *   <QaliSuiteIcon />                         — icon only (collapsed sidebar, favicon)
 *   <QaliSuiteMark />                         — icon + "QaliSuite" text (nav, headers)
 *   <QaliSuiteMark subtitle="ERP System" />   — icon + title + subtitle (expanded sidebar)
 *   <QaliSuiteLogo />                         — full SVG logo with embedded subtitle (legacy/print)
 */

// ─── Shared icon SVG (matches /public/brand/qalisuite-icon.svg) ───
function IconSvg({ className, id = "qs" }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <linearGradient id={`${id}-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="50%" stopColor="#EAB308" />
          <stop offset="100%" stopColor="#A16207" />
        </linearGradient>
        <filter id={`${id}-shadow`}>
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.15" />
        </filter>
      </defs>
      <rect x="3" y="3" width="42" height="42" rx="14" ry="14" fill={`url(#${id}-grad)`} filter={`url(#${id}-shadow)`} />
      <circle cx="24" cy="21" r="10" fill="none" stroke="white" strokeWidth="4" opacity="0.95" />
      <line x1="30" y1="27" x2="37" y2="34" stroke="white" strokeWidth="4" strokeLinecap="round" opacity="0.95" />
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
 * Matches /public/brand/qalisuite-logo-light.svg (dark mode uses currentColor)
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
            <stop offset="100%" stopColor="#A16207" />
          </linearGradient>
          <filter id="qs-logo-shadow">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.15" />
          </filter>
        </defs>
        {/* Icon */}
        <rect x="2" y="2" width="44" height="44" rx="14" ry="14" fill="url(#qs-logo-grad)" filter="url(#qs-logo-shadow)" />
        <circle cx="24" cy="22" r="10" fill="none" stroke="white" strokeWidth="4" opacity="0.95" />
        <line x1="30" y1="28" x2="37" y2="35" stroke="white" strokeWidth="4" strokeLinecap="round" opacity="0.95" />
        {/* Text */}
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
