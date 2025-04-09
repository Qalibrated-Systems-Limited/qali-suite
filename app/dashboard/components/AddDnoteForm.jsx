"use client";

import { useActionState } from "react";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "../../../components/ui/form";
import { Input } from "../../../components/ui/input";

import { zodResolver } from "@hookform/resolvers/zod";

import { useForm } from "react-hook-form";

import { addDNote, createInvoice } from "../../mongodb/actions";
import { deliveryNoteZodSchema } from "../../mongodb/validators";
import { cn } from "../../../lib/utils";
import NextForm from "next/form";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";

const reasons = ["Selling", "Borrrowing", "Giving out for tests "];

export function CreateDNoteForm({ customers = [], technicians = [] }) {
  const initialState = { message: "", errors: {} };
  const [state, dispatch, isPending] = useActionState(addDNote, initialState);
  const form = useForm({
    resolver: zodResolver(deliveryNoteZodSchema),
    values: {
      notes: "",
      customerId: "",
    },
  });

  return (
    <Form {...form}>
      <NextForm action={dispatch} className="flex flex-col gap-4">
        <div className="flex-1">
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel> Reason </FormLabel>
                <Select onValueChange={field.onChange} name="reason">
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Enter reason for the removal" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectGroup>
                      {reasons.map((reason) => (
                        <SelectItem key={reason} value={reason}>
                          {reason}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <div id="reason-error" aria-live="polite" aria-atomic="true">
                  {state.errors?.reason &&
                    state.errors.reason.map((error) => (
                      <p className="mt-2 text-sm text-red-500" key={error}>
                        {error}
                      </p>
                    ))}
                </div>
              </FormItem>
            )}
          />
        </div>

        <div className="flex-1">
          <FormField
            control={form.control}
            name="techId"
            render={({ field }) => (
              <FormItem>
                <FormLabel> Technician </FormLabel>
                <Select onValueChange={field.onChange} name="techId">
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select the employee responsible" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectGroup>
                      {technicians.map((tech) => (
                        <SelectItem key={tech._id} value={tech._id}>
                          {tech.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <div id="reason-error" aria-live="polite" aria-atomic="true">
                  {state.errors?.techId &&
                    state.errors.techId.map((error) => (
                      <p className="mt-2 text-sm text-red-500" key={error}>
                        {error}
                      </p>
                    ))}
                </div>
              </FormItem>
            )}
          />
        </div>
        <div className="flex-1">
          <FormField
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel> Customer</FormLabel>
                <Select onValueChange={field.onChange} name="customerId">
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectGroup>
                      {customers.map((customer) => (
                        <SelectItem key={customer._id} value={customer._id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <div id="category-error" aria-live="polite" aria-atomic="true">
                  {state.errors?.category &&
                    state.errors.category.map((error) => (
                      <p className="mt-2 text-sm text-red-500" key={error}>
                        {error}
                      </p>
                    ))}
                </div>
              </FormItem>
            )}
          />
        </div>

        <div className="flex-1">
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Enter the purpose or terms of this dnote"
                    {...field}
                    type="text"
                  />
                </FormControl>
                <div id="notes-error" aria-live="polite" aria-atomic="true">
                  {state.errors?.description &&
                    state.errors.description.map((error) => (
                      <p className="mt-2 text-sm text-red-500" key={error}>
                        {error}
                      </p>
                    ))}
                </div>
              </FormItem>
            )}
          />
        </div>

        {state.message && (
          <p className="text-center text-red-500">{state.message}</p>
        )}
        <CreateButton isPending={isPending} />
      </NextForm>
    </Form>
  );
}

function CreateButton({ isPending }) {
  return (
    <Button
      aria-disabled={isPending}
      className={cn("self-end", {
        "bg-pink-200 ": isPending,
        "bg-primary": !isPending,
      })}
    >
      {isPending ? "Submitting.." : "Create Dnote"}
    </Button>
  );
}
