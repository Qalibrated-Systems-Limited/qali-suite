"use client";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "../../../components/ui/form";

import { addDays, format } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useRef, useState } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "../../../components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { addInvoiceItem } from "../../mongodb/actions";
import { invoiceItemForm } from "../../mongodb/validators";
import { PlusIcon } from "lucide-react";

export function FilterDialog({ products = [], id }) {
  const initialState = { message: "", errors: {} };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <PlusIcon size={30} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-3xl py-4">Add invoice item </DialogTitle>
        </DialogHeader>

        <DialogFooter className="flex items-center justify-between">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              CANCEL
            </Button>
          </DialogClose>
          {/* <DialogClose>
            <Button onClick={submitHandle} type="submit">
              Submit
            </Button>
          </DialogClose> */}
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
