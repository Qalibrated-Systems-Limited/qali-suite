import React from "react";
import { monthlyAggregates } from "../mongodb/queries/queries";
import { Cardwrapper } from "./components/cardwrapper";
import { MonthlyAggregatesStats } from "./components/monthlycharts";

async function AnnualSummary() {
  const data = await monthlyAggregates();
  return (
    <>
      <Cardwrapper />
      <MonthlyAggregatesStats data={data} />
    </>
  );
}

export default AnnualSummary;
