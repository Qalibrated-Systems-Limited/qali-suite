import { getProfitLossData } from "@/app/mongodb/queries/reportQueries";
import { ProfitLossClient } from "./ProfitLossClient";

export const metadata = {
  title: "Profit & Loss | Reports",
  description: "View income statement showing revenue, expenses, and net income",
};

function getDateRange(preset) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarter = Math.floor(month / 3);

  switch (preset) {
    case "last-month":
      return {
        startDate: new Date(year, month - 1, 1),
        endDate: new Date(year, month, 0),
      };
    case "this-quarter":
      return {
        startDate: new Date(year, quarter * 3, 1),
        endDate: new Date(year, quarter * 3 + 3, 0),
      };
    case "last-quarter":
      return {
        startDate: new Date(year, (quarter - 1) * 3, 1),
        endDate: new Date(year, quarter * 3, 0),
      };
    case "this-year":
      return {
        startDate: new Date(year, 0, 1),
        endDate: new Date(year, 11, 31),
      };
    case "last-year":
      return {
        startDate: new Date(year - 1, 0, 1),
        endDate: new Date(year - 1, 11, 31),
      };
    case "this-month":
    default:
      return {
        startDate: new Date(year, month, 1),
        endDate: new Date(year, month + 1, 0),
      };
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
    reportData = await getProfitLossData(startDate, endDate, comparison);
  } catch (err) {
    console.error("Error fetching profit & loss:", err);
    error = err.message;
  }

  return (
    <ProfitLossClient
      initialData={reportData}
      initialPeriod={preset}
      initialComparison={comparison}
      startDate={startDate.toISOString()}
      endDate={endDate.toISOString()}
      error={error}
    />
  );
}
