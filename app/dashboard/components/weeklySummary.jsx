import { weeklyAggregates } from "../../mongodb/queries/queries";
import WeeklyDistributionLine from "./axles/summary-linegraph";
import WeeklyDistrosCardWrapper from "./axles/weeklyDistrosCardWrapper";

async function WeeklySummary() {
  const data = await weeklyAggregates();

  return (
    <>
      <WeeklyDistrosCardWrapper />
      <WeeklyDistributionLine data={data ?? []} />
    </>
  );
}

export default WeeklySummary;
