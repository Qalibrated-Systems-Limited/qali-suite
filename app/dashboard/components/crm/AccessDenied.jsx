// Role-gate bounce for CRM pages — mirrors the invoices page's inline
// "Access Denied" block so direct-URL access by non-sales roles is refused,
// not just hidden in the nav.
export default function AccessDenied({ resource = "this page" }) {
  return (
    <div className="flex min-h-100 items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-foreground mb-2">
          Access Denied
        </h2>
        <p className="text-muted-foreground">
          You don&apos;t have permission to view {resource}.
        </p>
      </div>
    </div>
  );
}
