import { getTrialBalanceData } from "@/app/mongodb/queries/reportQueries";
import { getTrialBalanceDataPg } from "@/app/db/actions/report-actions";
import { TrialBalanceClient } from "./TrialBalanceClient";

export const metadata = {
  title: "Trial Balance | Reports",
  description: "View trial balance report showing all account balances",
};

export default async function TrialBalancePage({ searchParams }) {
  const params = await searchParams;
  const asOfDate = params?.asOf || new Date().toISOString().split("T")[0];
  const showZeroBalances = params?.showZero === "true";

  let reportData = null;
  let error = null;

  // Migration parity switch. `?source=pg` reads the same report out of
  // Postgres so the two can be compared side by side during the slice; anything
  // else keeps the existing MongoDB path, which stays the default until the
  // trial balances reconcile exactly (docs/POSTGRES-MIGRATION-PLAN.md §6.3).
  const source = params?.source === "pg" ? "pg" : "mongo";

  try {
    reportData =
      source === "pg"
        ? await getTrialBalanceDataPg(asOfDate, showZeroBalances)
        : await getTrialBalanceData(asOfDate, showZeroBalances);
  } catch (err) {
    console.error(`Error fetching trial balance (${source}):`, err);
    error = err.message;
  }

  return (
    <TrialBalanceClient
      initialData={reportData}
      initialAsOfDate={asOfDate}
      initialShowZero={showZeroBalances}
      error={error}
    />
  );
}
