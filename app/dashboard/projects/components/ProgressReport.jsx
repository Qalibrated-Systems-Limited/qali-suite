import { Card } from "@/components/ui/card";
import { CalendarClock, TrendingUp } from "lucide-react";

/**
 * Programme & progress report — the QSL Project Control view.
 *
 * Per activity: the BASELINE dates (what was planned) beside the CURRENT dates
 * (what is actually happening), the SLIP between the two finishes in days, the
 * weight, and the percent complete. Overall progress is WEIGHTED by each
 * activity's weight, so a big activity at 10% counts for more than a small one
 * at 90% — the number a progress claim is actually built on.
 *
 * A three-week look-ahead lists what starts or finishes in the next 21 days.
 */

const fmt = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "2-digit" });
};

const daysBetween = (a, b) => {
  if (!a || !b) return null;
  const da = new Date(a), db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.round((db - da) / 86400000);
};

export default function ProgressReport({ tasks = [] }) {
  // Leaf activities carry the schedule; parents roll up.
  const activities = tasks.filter((t) => (t.childCount ?? 0) === 0);
  if (!activities.length) return null;

  const totalWeight = activities.reduce((s, t) => s + (Number(t.effectiveWeight) || 0), 0);
  const weightedProgress =
    totalWeight > 0
      ? Math.round(
          activities.reduce(
            (s, t) => s + (Number(t.effectiveWeight) || 0) * (Number(t.progressPercent) || 0),
            0,
          ) / totalWeight,
        )
      : 0;

  // Current finish = actual end if set, else planned end (the expectation).
  const withSlip = activities.map((t) => {
    const currentFinish = t.actualEnd || t.plannedEnd;
    const slip = daysBetween(t.plannedEnd, currentFinish);
    return { ...t, currentFinish, slip };
  });
  const slipped = withSlip.filter((t) => (t.slip ?? 0) > 0);

  // Three-week look-ahead — activities starting or finishing in the next 21 days.
  const now = new Date();
  const horizon = new Date(now.getTime() + 21 * 86400000);
  const inWindow = (d) => {
    if (!d) return false;
    const dt = new Date(d);
    return dt >= now && dt <= horizon;
  };
  const lookAhead = withSlip.filter(
    (t) => inWindow(t.actualStart || t.plannedStart) || inWindow(t.currentFinish),
  );

  return (
    <div className="space-y-4">
      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Progress (weighted)</p>
          <p className="text-lg font-bold">{weightedProgress}%</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Activities</p>
          <p className="text-lg font-bold">{activities.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Slipping</p>
          <p className={`text-lg font-bold ${slipped.length ? "text-red-600" : "text-emerald-600"}`}>
            {slipped.length}
          </p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Starting/finishing ≤3wk</p>
          <p className="text-lg font-bold">{lookAhead.length}</p>
        </Card>
      </div>

      {/* Progress report table */}
      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Programme &amp; progress report</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Activity</th>
                <th className="pb-2 px-2 font-medium">Baseline start</th>
                <th className="pb-2 px-2 font-medium">Baseline finish</th>
                <th className="pb-2 px-2 font-medium">Current start</th>
                <th className="pb-2 px-2 font-medium">Current finish</th>
                <th className="pb-2 px-2 text-right font-medium">Slip</th>
                <th className="pb-2 px-2 text-right font-medium">Weight</th>
                <th className="pb-2 pl-2 text-right font-medium">Done</th>
              </tr>
            </thead>
            <tbody>
              {withSlip.map((t) => (
                <tr key={t._id || t.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{t.title}</td>
                  <td className="py-2 px-2 text-muted-foreground">{fmt(t.plannedStart)}</td>
                  <td className="py-2 px-2 text-muted-foreground">{fmt(t.plannedEnd)}</td>
                  <td className="py-2 px-2">{fmt(t.actualStart || t.plannedStart)}</td>
                  <td className="py-2 px-2">{fmt(t.currentFinish)}</td>
                  <td
                    className={`py-2 px-2 text-right ${
                      (t.slip ?? 0) > 0 ? "font-medium text-red-600" : "text-muted-foreground"
                    }`}
                  >
                    {t.slip == null ? "—" : t.slip > 0 ? `+${t.slip}d` : `${t.slip}d`}
                  </td>
                  <td className="py-2 px-2 text-right text-muted-foreground">
                    {t.weight != null ? Number(t.weight).toFixed(t.weight % 1 ? 2 : 0) : "—"}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-muted sm:inline-block">
                        <span
                          className={`block h-full rounded-full ${
                            (t.progressPercent ?? 0) >= 100 ? "bg-emerald-500" : "bg-primary"
                          }`}
                          style={{ width: `${Math.min(100, Number(t.progressPercent) || 0)}%` }}
                        />
                      </span>
                      {Number(t.progressPercent) || 0}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Slip is current finish against baseline finish; a positive figure is
          days behind programme. Progress is weighted by each activity&apos;s
          weight.
        </p>
      </Card>

      {/* Three-week look-ahead */}
      {lookAhead.length > 0 && (
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Three-week look-ahead</h2>
          </div>
          <ul className="space-y-1.5 text-sm">
            {lookAhead.map((t) => (
              <li key={t._id || t.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{t.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {fmt(t.actualStart || t.plannedStart)} → {fmt(t.currentFinish)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
