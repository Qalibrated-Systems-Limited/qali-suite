import React from "react";
import MatDistorsPieChart from "./mat-distros-piechart";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import Link from "next/link";
import { fetchTodaySummary } from "../../../mongodb/queries/queries";
import {
  Calendar1Icon,
  CheckIcon,
  ListIcon,
  PieChartIcon,
  ScaleIcon,
  TimerIcon,
  WeightIcon,
} from "lucide-react";

async function WeeklyDistrosCardWrapper() {
  const weeklyDistros = await fetchTodaySummary();
  let matSummary = [];
  let thisWeek = 0;
  let thisWeekCount = 0;
  let thisWeekList = [];
  let todayList = [];
  let todayCount = 0;
  let today = 0;
  if (weeklyDistros && weeklyDistros[0]) {
    matSummary = weeklyDistros[0].matSummaryThisWeek ?? [];
    thisWeekList = weeklyDistros[0].thisWeek ?? [];

    todayList = weeklyDistros[0].today ?? [];
    if (todayList.length > 0) {
      today = todayList[0].totalNetWeight ?? 0;
      todayCount = todayList[0].totalRecords ?? 0;
    }
    if (thisWeekList.length > 0) {
      thisWeek = thisWeekList[0].totalNetWeight ?? 0;
      thisWeekCount = thisWeekList[0].totalRecords ?? 0;
    }
  }

  return (
    <div className=" grid  lg:grid-cols-3 gap-4 ">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Today</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-between items-center">
          <div className="flex gap-2">
            <WeightIcon />
            <span className="text-3xl font-bold">{today} Kg</span>
          </div>
          <div>
            <Button asChild size={"xs"}>
              <Link href={"/"}>View All </Link>
            </Button>
          </div>
        </CardContent>
        <CardFooter>
          <span className="text-xs flex gap-1 items-center">
            <TimerIcon />
            <span className="font-bold ">{todayCount}</span> transactions
            recorded today
          </span>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">This week net</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-2 ">
            <ScaleIcon />
            <span className="text-3xl font-bold">{thisWeek} Kg</span>
          </div>
        </CardContent>

        <CardFooter>
          <span className="text-xs flex gap-1 items-center">
            <ListIcon />
            {thisWeekCount} transactions recorded this week
          </span>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex justify-between items-center">
            Material
            <PieChartIcon />
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-0">
          <MatDistorsPieChart data={matSummary} />
        </CardContent>
        <CardFooter>
          <span className="text-xs flex gap-1 items-center">
            <CheckIcon />
            Matrials net weight distro this week
          </span>
        </CardFooter>
      </Card>
    </div>
  );
}

export default WeeklyDistrosCardWrapper;
