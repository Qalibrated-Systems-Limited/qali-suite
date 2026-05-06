// ============================================
// DASHBOARD LOADING UI
// ============================================
// Renders instantly while the server component below resolves.
// Mirrors the skeleton geometry of the role-specific dashboards so the
// transition to real content has minimal layout shift.

export default function DashboardLoading() {
  return (
    <div className="space-y-5">
      {/* Header skeleton */}
      <div className="space-y-1.5">
        <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
        <div className="h-7 w-64 animate-pulse rounded bg-muted" />
        <div className="h-3 w-48 animate-pulse rounded bg-muted/60" />
      </div>

      {/* Alerts strip skeleton */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={`alert-${i}`}
            className="h-16 animate-pulse rounded-lg border border-border bg-muted"
          />
        ))}
      </div>

      {/* Metric cards skeleton */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={`m-${i}`}
            className="h-24 animate-pulse rounded-lg border border-border bg-muted"
          />
        ))}
      </div>

      {/* Two-column block skeleton */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" />
      </div>

      {/* Single full-width block skeleton */}
      <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" />
    </div>
  );
}
