"use client";
import { Button } from "./button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

import { Label } from "./label";

import { addDays, format } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { DatePickerWithRange } from "./date-picker";
import { ItemSelect } from "./select-items";

export function FilterDialog({ customers }) {
  let startDate = new Date();
  let vehicle = "";
  let customer = "";
  let commodity = "";
  let endDate = addDays(new Date(), 1);

  const searchParams = useSearchParams();

  const { replace } = useRouter();
  const pathname = usePathname();

  const handleSelectCustomer = (_customer) => {
    customer = _customer;
  };

  const handlePickStartDate = (date) => {
    startDate = date;
  };

  const handlePickEndDate = (date) => {
    endDate = date;
  };

  const submitHandle = () => {
    const params = new URLSearchParams(searchParams);

    if (startDate) {
      params.set("startDate", startDate);
    } else {
      params.delete("startDate");
    }

    if (customer) {
      params.set("customer", customer);
    } else {
      params.delete("customer");
    }

    if (endDate) {
      params.set("endDate", endDate);
    } else {
      params.delete("endDate");
    }

    replace(`${pathname}?${params.toString()}`);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">EXTRACT</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-3xl py-4">Begin filtering </DialogTitle>
          <DialogDescription>
            Specify filtering criteria for your reports.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-8 py-4">
          <DatePickerWithRange
            handlePickStartDate={handlePickStartDate}
            handlePickEndDate={handlePickEndDate}
          />
          <div className="flex flex-col  gap-4 items-center ">
            <div className=" flex flex-col w-full  gap-4">
              <Label htmlFor="Customer" className="">
                Select customer
              </Label>
              <ItemSelect
                handleSelectType={handleSelectCustomer}
                items={customers ?? []}
                name={"customer"}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="flex items-center justify-between">
          <DialogClose onClick={submitHandle}>Submit</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SummaryDialog() {
  const searchParams = useSearchParams();

  const { replace } = useRouter();
  const pathname = usePathname();

  let startDate = new Date();
  let station = "";
  let endDate = addDays(new Date(), 1);
  const overloadValueRef = useRef < HTMLInputElement > null;

  const handlePickEndDate = (date) => {
    endDate = date;
  };

  const handleSubmit = () => {
    const params = new URLSearchParams(searchParams);

    if (startDate) {
      params.set("startDate", format(startDate, "yyyy-MM-dd"));
    } else {
      params.delete("startDate");
    }

    if (endDate) {
      params.set("endDate", format(endDate, "yyyy-MM-dd"));
    } else {
      params.delete("endDate");
    }

    replace(`${pathname}?${params.toString()}`);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Change dates</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-3xl py-4">Change date range</DialogTitle>
          <DialogDescription>
            End date must be greater than start date
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-8 py-4">
          <DatePickerWithRange
            handlePickStartDate={handlePickStartDate}
            handlePickEndDate={handlePickEndDate}
            className="col-span-3"
          />
        </div>
        <DialogFooter className="flex items-center justify-between">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              CANCEL
            </Button>
          </DialogClose>
          <DialogClose>
            <Button onClick={handleSubmit} type="submit">
              Submit
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
