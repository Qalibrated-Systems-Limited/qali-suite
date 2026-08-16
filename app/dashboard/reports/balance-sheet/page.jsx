import { getBalanceSheetData } from "@/app/mongodb/queries/reportQueries";
import { getBalanceSheetDataPg } from "@/app/db/actions/report-actions";
import { BalanceSheetClient } from "./BalanceSheetClient";

export const metadata = {
  title: "Balance Sheet | Reports",
  description: "View balance sheet showing assets, liabilities, and equity",
};

export default async function BalanceSheetPage({ searchParams }) {
  const params = await searchParams;
  const asOfDate = params?.asOf || new Date().toISOString().split("T")[0];

  let reportData = null;
  let error = null;

  try {
    // `?source=pg` reads the same statement from Postgres for side-by-side
    // comparison during the migration; MongoDB stays the default.
    reportData =
      params?.source === "pg"
        ? await getBalanceSheetDataPg(asOfDate)
        : await getBalanceSheetData(asOfDate);
  } catch (err) {
    console.error("Error fetching balance sheet:", err);
    error = err.message;
  }

  return (
    <BalanceSheetClient
      initialData={reportData}
      initialAsOfDate={asOfDate}
      error={error}
    />
  );
}
