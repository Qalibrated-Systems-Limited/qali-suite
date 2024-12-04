"use client";

import { useActionState } from "react";
import { Button } from "../../../../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../../../components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "../../../../../components/ui/form";
import { Input } from "../../../../../components/ui/input";

import { zodResolver } from "@hookform/resolvers/zod";

import { useForm } from "react-hook-form";

import { deliveryNoteZodSchema } from "../../../../mongodb/validators";
import { cn } from "../../../../../lib/utils";
import NextForm from "next/form";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../../components/ui/select";
import { updateDnote } from "../../../../mongodb/actions";

export function UpdateDNoteForm({ customers = [], dNote }) {
  const initialState = { message: "", errors: {} };

  const updateDNoteWithId = updateDnote.bind(null, dNote._id.toString());
  const [state, dispatch, isPending] = useActionState(
    updateDNoteWithId,
    initialState
  );
  const form = useForm({
    resolver: zodResolver(deliveryNoteZodSchema),
    defaultValues: {
      notes: dNote ? dNote.notes : "",
      customerId: dNote ? dNote.customer.id : "",
    },
  });

  return (
    <Card className="items-center justify-center  md:w-1/2 mx-auto  ">
      <CardHeader>
        <CardTitle>Update Delivery Note</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <NextForm action={dispatch} className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row w-full gap-4 ">
              <div className="flex-1">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel> Customer</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        name="customerId"
                        defaultValue={dNote ? dNote.customer.id : ""}
                      >
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
                      <div
                        id="notes-error"
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

            {state.message && (
              <p className="text-center text-red-500">{state.message}</p>
            )}
            <CreateButton isPending={isPending} />
          </NextForm>
        </Form>
      </CardContent>
      {/* <CardFooter>
          <small>Contact your admin if new</small>
        </CardFooter> */}
    </Card>
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
      {isPending ? "Submitting.." : "Update Dnote"}
    </Button>
  );
}
