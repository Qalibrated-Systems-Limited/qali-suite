import { getGeneralLedgerDataPg } from "@/app/db/actions/report-actions";
import { getPostableAccountsPg } from "@/app/db/actions/journal-actions";
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
    // The dropdown and the report now come from the same store. They did not:
    // the list was Mongo while `?source=pg` read the ledger from Postgres, and
    // an account id from one store selects nothing in the other — so the pg
    // path could not actually be exercised from this page.
    accounts = await getPostableAccountsPg();

    if (accountId) {
      reportData = await getGeneralLedgerDataPg(accountId, startDate, endDate);
    }
  } catch (err) {
    console.error("Error fetching general ledger:", err);
    error = err.message;
  }

  return (
    <GeneralLedgerClient
      initialData={reportData}
      accounts={accounts}
      selectedAccountId={accountId}
      initialStartDate={startDate}
      initialEndDate={endDate}
      error={error}
    />
  );
}
