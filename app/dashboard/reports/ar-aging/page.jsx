import { auth } from "@/auth";
import { canSeeReportsNav } from "@/lib/permissions";
import { getARAgingReport } from "@/app/mongodb/queries/aging-queries";
import { ARAgingClient } from "./ARAgingClient";

export const metadata = {
  title: "AR Aging Report | Reports",
  description: "View accounts receivable aging by customer",
};

export default async function ARAgingPage({ searchParams }) {
  const session = await auth();
  const { user } = session;

  // Check permission
  // Single source of truth — same gate that shows the Reports nav link
  // (the previous inline allowlist bounced CFO and Finance Manager).
  if (!canSeeReportsNav(user?.role)) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h1>
          <p className="text-muted-foreground">
            You don't have permission to view this report.
          </p>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const asOfDate = params?.asOf || new Date().toISOString().split("T")[0];

  let reportData = null;
  let error = null;

  try {
    reportData = await getARAgingReport(asOfDate);
  } catch (err) {
    console.error("Error fetching AR aging report:", err);
    error = err.message;
  }

  return (
    <ARAgingClient
      initialData={reportData}
      initialAsOfDate={asOfDate}
      error={error}
    />
  );
}
