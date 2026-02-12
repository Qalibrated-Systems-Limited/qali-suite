import { getTrialBalanceData } from "@/app/mongodb/queries/reportQueries";
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

  try {
    reportData = await getTrialBalanceData(asOfDate, showZeroBalances);
  } catch (err) {
    console.error("Error fetching trial balance:", err);
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
