"use client";
import { useActionState } from "react";
import { useFormStatus, useFormState } from "react-dom";

import { Button } from "../../../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "../../../../components/ui/form";
import { Input } from "../../../../components/ui/input";

import { zodResolver } from "@hookform/resolvers/zod";

import { useForm } from "react-hook-form";

import { createInvoice } from "../../../mongodb/actions";
import { invoiceForm } from "../../../mongodb/validators";
import { cn } from "../../../../lib/utils";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";

export function CreateInvoiceForm({ customers = [] }) {
  const initialState = { message: "", errors: {} };
  const [state, dispatch] = useFormState(createInvoice, initialState);
  const form = useForm({
    resolver: zodResolver(invoiceForm),
    values: {
      description: "",
      customerId: "",
      status: "",
      taxRate: "",
    },
  });

  return (
    <Card className="items-center justify-center  md:w-1/2 mx-auto  ">
      <CardHeader>
        <CardTitle>Add Invoice</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form action={dispatch} className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row w-full gap-4 ">
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
                              <SelectItem
                                key={customer._id}
                                value={customer._id}
                              >
                                {customer.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>

                      <div
                        id="category-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {state.errors?.category &&
                          state.errors.category.map((error) => (
                            <p
                              className="mt-2 text-sm text-red-500"
                              key={error}
                            >
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
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter description"
                          {...field}
                          type="text"
                        />
                      </FormControl>
                      <div
                        id="description-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {state.errors?.description &&
                          state.errors.description.map((error) => (
                            <p
                              className="mt-2 text-sm text-red-500"
                              key={error}
                            >
                              {error}
                            </p>
                          ))}
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="flex flex-col md:flex-row w-full gap-4">
              <div className="flex-1">
                <FormField
                  control={form.control}
                  name="taxRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>VAT</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter tax rate"
                          {...field}
                          type="number"
                        />
                      </FormControl>
                      <div
                        id="taxRate-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {state.errors?.taxRate &&
                          state.errors.taxRate.map((error) => (
                            <p
                              className="mt-2 text-sm text-red-500"
                              key={error}
                            >
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
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel> Status</FormLabel>
                      <Select onValueChange={field.onChange} name="status">
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Change status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Paid">Paid</SelectItem>

                          <SelectItem value="Unpaid">Unpaid</SelectItem>
                        </SelectContent>
                      </Select>

                      <div
                        id="accountType-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {state.errors?.status &&
                          state.errors.status.map((error) => (
                            <p
                              className="mt-2 text-sm text-red-500"
                              key={error}
                            >
                              {error}
                            </p>
                          ))}
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </div>
            <CreateButton />
          </form>
        </Form>
      </CardContent>
      {/* <CardFooter>
          <small>Contact your admin if new</small>
        </CardFooter> */}
    </Card>
  );
}

function CreateButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      aria-disabled={pending}
      className={cn("self-end", {
        "bg-pink-200 ": pending,
        "bg-primary": !pending,
      })}
    >
      {pending ? "Submitting.." : "Create invoice"}
    </Button>
  );
}
