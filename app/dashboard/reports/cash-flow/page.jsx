import { getCashFlowData } from "@/app/mongodb/queries/reportQueries";
import { CashFlowClient } from "./CashFlowClient";

export const metadata = {
  title: "Cash Flow Statement | Reports",
  description: "View cash flow statement showing operating, investing, and financing activities",
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

export default async function CashFlowPage({ searchParams }) {
  const params = await searchParams;
  const preset = params?.period || "this-month";
  const { startDate, endDate } = getDateRange(preset);

  let reportData = null;
  let error = null;

  try {
    reportData = await getCashFlowData(startDate, endDate);
  } catch (err) {
    console.error("Error fetching cash flow:", err);
    error = err.message;
  }

  return (
    <CashFlowClient
      initialData={reportData}
      initialPeriod={preset}
      startDate={startDate.toISOString()}
      endDate={endDate.toISOString()}
      error={error}
    />
  );
}
