import { getBalanceSheetDataPg } from "@/app/db/actions/report-actions";
import { today } from "@/lib/utils/report-dates";
import { BalanceSheetClient } from "./BalanceSheetClient";

export const metadata = {
  title: "Balance Sheet | Reports",
  description: "View balance sheet showing assets, liabilities, and equity",
};

export default async function BalanceSheetPage({ searchParams }) {
  const params = await searchParams;
  const asOfDate = params?.asOf || today();

  let reportData = null;
  let error = null;

  try {
    reportData = await getBalanceSheetDataPg(asOfDate);
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
