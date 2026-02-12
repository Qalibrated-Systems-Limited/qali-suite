import { getGeneralLedgerData } from "@/app/mongodb/queries/reportQueries";
import { getPostableAccounts } from "@/app/mongodb/queries/accountQueries";
import { GeneralLedgerClient } from "./GeneralLedgerClient";

export const metadata = {
  title: "General Ledger | Reports",
  description: "View detailed account transactions with running balance",
};

export default async function GeneralLedgerPage({ searchParams }) {
  const params = await searchParams;
  const accountId = params?.account || null;

  // Default to current month
  const now = new Date();
  const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const defaultEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .split("T")[0];

  const startDate = params?.startDate || defaultStartDate;
  const endDate = params?.endDate || defaultEndDate;

  let reportData = null;
  let accounts = [];
  let error = null;

  try {
    // Get list of postable accounts for dropdown
    accounts = await getPostableAccounts();

    // Get report data if account is selected
    if (accountId) {
      reportData = await getGeneralLedgerData(accountId, startDate, endDate);
    }
  } catch (err) {
    console.error("Error fetching general ledger:", err);
    error = err.message;
  }

  return (
    <GeneralLedgerClient
      initialData={reportData}
      accounts={JSON.parse(JSON.stringify(accounts))}
      selectedAccountId={accountId}
      initialStartDate={startDate}
      initialEndDate={endDate}
      error={error}
    />
  );
}
