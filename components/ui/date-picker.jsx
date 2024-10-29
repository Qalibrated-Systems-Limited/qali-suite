"use client";

import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import * as React from "react";

import { Button } from "./button";
import { Calendar } from "./calendar";
import { Label } from "./label";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "../../lib/utils";

export function DatePickerWithRange({
  className,
  handlePickStartDate,
  handlePickEndDate,
}) {
  const [startDate, setStartDate] = React.useState(new Date());

  const [endDate, setEndDate] = React.useState(new Date());

  React.useEffect(() => {
    if (endDate) {
      handlePickEndDate(endDate);
    }
  }, [endDate, handlePickEndDate]);
  React.useEffect(() => {
    if (startDate) {
      handlePickStartDate(startDate);
    }
  }, [startDate, handlePickStartDate]);

  return (
    <div className={cn("  flex flex-col  gap-8", className)}>
      <div className="flex flex-col gap-4 w-full">
        <Label>Start Date</Label>
        <DatePicker
          selected={startDate}
          onChange={(date) => setStartDate(date)}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-500 dark:focus:ring-pink-500 focus:border-pink-500 dark:focus:border-pink-500"
        />
      </div>
      <div className="flex flex-col gap-4  w-full">
        <Label>End Date</Label>
        <DatePicker
          selected={endDate}
          onChange={(date) => setEndDate(date)}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-500 dark:focus:ring-pink-500 focus:border-pink-500 dark:focus:border-pink-500"
        />
      </div>
    </div>
  );
}
