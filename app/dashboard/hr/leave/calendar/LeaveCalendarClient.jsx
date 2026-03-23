"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

const LEAVE_COLORS = {
  annual:       "bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-400/40",
  sick:         "bg-red-500/20 text-red-700 dark:text-red-300 border-red-400/40",
  maternity:    "bg-pink-500/20 text-pink-700 dark:text-pink-300 border-pink-400/40",
  paternity:    "bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-400/40",
  compassionate:"bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-400/40",
  study:        "bg-teal-500/20 text-teal-700 dark:text-teal-300 border-teal-400/40",
  unpaid:       "bg-muted/60 text-muted-foreground border-border",
};
const DEFAULT_COLOR = "bg-muted/60 text-muted-foreground border-border";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function LeaveCalendarClient({ events, month, year }) {
  const router = useRouter();

  function navigate(dir) {
    let m = month + dir;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    router.push(`?month=${m}&year=${y}`);
  }

  // Build day grid for the month
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();

  // Map events to a Set of covered dates: dayNum → [events]
  const dayMap = {};
  for (const ev of events) {
    if (!ev.from || !ev.to) continue;
    const from = new Date(ev.from);
    const to = new Date(ev.to);
    const cur = new Date(from);
    while (cur <= to) {
      if (cur.getMonth() + 1 === month && cur.getFullYear() === year) {
        const d = cur.getDate();
        if (!dayMap[d]) dayMap[d] = [];
        dayMap[d].push(ev);
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Grid cells: leading blanks + day cells
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const today = new Date();
  const isCurrentMonth = today.getMonth() + 1 === month && today.getFullYear() === year;

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="rounded-md border border-border p-2 hover:bg-accent transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-semibold text-foreground">
          {MONTHS[month - 1]} {year}
        </h2>
        <button
          onClick={() => navigate(1)}
          className="rounded-md border border-border p-2 hover:bg-accent transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 text-xs">
        {Object.entries(LEAVE_COLORS).map(([type, cls]) => (
          <span key={type} className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 capitalize ${cls}`}>
            {type}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 rounded border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 text-amber-700 dark:text-amber-300">
          pending approval
        </span>
      </div>

      {/* Calendar grid */}
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {DAYS.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 auto-rows-min divide-x divide-y divide-border/50">
          {cells.map((day, idx) => {
            if (!day) return <div key={`blank-${idx}`} className="min-h-[80px] bg-muted/20" />;

            const eventsToday = dayMap[day] || [];
            const isToday = isCurrentMonth && today.getDate() === day;
            const isWeekend = ((firstDay + day - 1) % 7 === 0) || ((firstDay + day - 1) % 7 === 6);

            return (
              <div
                key={day}
                className={`min-h-[80px] p-1.5 ${isWeekend ? "bg-muted/30" : ""}`}
              >
                <span className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground"
                }`}>
                  {day}
                </span>
                <div className="space-y-0.5">
                  {eventsToday.slice(0, 3).map((ev, i) => (
                    <div
                      key={`${ev._id}-${i}`}
                      className={`truncate rounded border px-1 py-0.5 text-[10px] leading-tight ${
                        ev.status === "submitted"
                          ? "border-amber-400/40 bg-amber-500/20 text-amber-700 dark:text-amber-300"
                          : (LEAVE_COLORS[ev.leaveType] || DEFAULT_COLOR)
                      }`}
                      title={`${ev.employeeName} — ${ev.leaveType} (${ev.status})`}
                    >
                      {ev.employeeName.split(" ")[0]}
                    </div>
                  ))}
                  {eventsToday.length > 3 && (
                    <div className="text-[10px] text-muted-foreground pl-1">
                      +{eventsToday.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Events list for the month */}
      {events.length > 0 && (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium text-foreground">{events.length} leave {events.length === 1 ? "request" : "requests"} this month</p>
          </div>
          <div className="divide-y divide-border">
            {events.map((ev) => (
              <div key={ev._id} className="flex items-center gap-3 px-4 py-3">
                <div className={`h-2 w-2 shrink-0 rounded-full ${ev.status === "submitted" ? "bg-amber-500" : "bg-emerald-500"}`} />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{ev.employeeName}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {ev.leaveType} · {ev.totalDays} {ev.totalDays === 1 ? "day" : "days"}
                    {ev.department && ` · ${ev.department}`}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  <p>{new Date(ev.from).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}</p>
                  <p>{new Date(ev.to).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}</p>
                </div>
                <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                  ev.status === "approved"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                }`}>
                  {ev.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {events.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          No approved or pending leave in {MONTHS[month - 1]} {year}.
        </div>
      )}
    </div>
  );
}
