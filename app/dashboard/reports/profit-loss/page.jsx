import { getProfitLossDataPg } from "@/app/db/actions/report-actions";
import { toDayString } from "@/lib/utils/report-dates";
import { ProfitLossClient } from "./ProfitLossClient";

export const metadata = {
  title: "Profit & Loss | Reports",
  description: "View income statement showing revenue, expenses, and net income",
};

function getDateRange(preset) {
  // Day strings, not Dates. The report boundary is a `date`, and a Date handed
  // to a `::date` parameter fails inside the driver rather than at the call —
  // see lib/utils/report-dates.js.
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarter = Math.floor(month / 3);

  const range = (from, to) => ({
    startDate: toDayString(from),
    endDate: toDayString(to),
  });

  switch (preset) {
    case "last-month":
      return range(new Date(year, month - 1, 1), new Date(year, month, 0));
    case "this-quarter":
      return range(
        new Date(year, quarter * 3, 1),
        new Date(year, quarter * 3 + 3, 0),
      );
    case "last-quarter":
      return range(
        new Date(year, (quarter - 1) * 3, 1),
        new Date(year, quarter * 3, 0),
      );
    case "this-year":
      return range(new Date(year, 0, 1), new Date(year, 11, 31));
    case "last-year":
      return range(new Date(year - 1, 0, 1), new Date(year - 1, 11, 31));
    case "this-month":
    default:
      return range(new Date(year, month, 1), new Date(year, month + 1, 0));
  }
}

export default async function ProfitLossPage({ searchParams }) {
  const params = await searchParams;
  const preset = params?.period || "this-month";
  const comparison = params?.compare || null;
  const { startDate, endDate } = getDateRange(preset);

  let reportData = null;
  let error = null;

  try {
    reportData = await getProfitLossDataPg(startDate, endDate, comparison);
  } catch (err) {
    console.error("Error fetching profit & loss:", err);
    error = err.message;
  }

  return (
    <ProfitLossClient
      initialData={reportData}
      initialPeriod={preset}
      initialComparison={comparison}
      startDate={startDate}
      endDate={endDate}
      error={error}
    />
  );
}
