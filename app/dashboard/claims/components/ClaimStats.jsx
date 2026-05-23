import { getClaimStats } from "@/app/mongodb/queries/claimQueries";
import { formatCurrency } from "@/lib/utils";

function Stat({ label, value, sub, accent }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`text-base font-semibold ${accent || "text-foreground"}`}>
        {value}
      </p>
      {sub !== undefined && sub !== null && (
        <p className="text-[11px] text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

async function ClaimStats({ userId = null, userRole = null }) {
  const stats = await getClaimStats(userId, userRole);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat
        label="Total"
        value={stats.total}
        sub={formatCurrency(
          (stats.totalPendingAmount || 0) +
            (stats.totalApprovedAmount || 0) +
            (stats.totalPaidAmount || 0)
        )}
      />
      <Stat
        label="Pending"
        value={stats.pending}
        sub={formatCurrency(stats.totalPendingAmount || 0)}
        accent="text-yellow-700 dark:text-yellow-400"
      />
      <Stat
        label="Approved"
        value={stats.approved}
        sub={formatCurrency(stats.totalApprovedAmount || 0)}
        accent="text-blue-700 dark:text-blue-400"
      />
      <Stat
        label="Paid"
        value={stats.paid}
        sub={formatCurrency(stats.totalPaidAmount || 0)}
        accent="text-purple-700 dark:text-purple-400"
      />
    </div>
  );
}

export default ClaimStats;
