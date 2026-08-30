// Same block the projects list page renders — "single source of truth —
// same gate the sidebar uses" (app/dashboard/projects/(projects)/page.jsx).
// Repeated per-page rather than gated in the layout because the layout
// only confirms a session exists; the *role* check is per-module, same as
// the list page already does on its own.
export default function AccessDenied() {
  return (
    <div className="flex min-h-[400px] items-center justify-center p-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-foreground mb-2">Access Denied</h2>
        <p className="text-muted-foreground">
          You don&apos;t have permission to access projects.
        </p>
      </div>
    </div>
  );
}
