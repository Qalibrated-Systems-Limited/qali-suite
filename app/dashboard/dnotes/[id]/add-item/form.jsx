"use client";
import { useActionState, useState } from "react";

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
import { dnoteItemForm } from "../../../../mongodb/validators";

import { addDnoteItem, addInvoiceItem } from "../../../../mongodb/actions";
import { cn } from "../../../../../lib/utils";

import NextForm from "next/form";

export default function AddItemForm({ id }) {
  const initialState = { message: "", errors: {} };

  const addItem = addDnoteItem.bind(null, id);
  const [state, dispatch, isPending] = useActionState(addItem, initialState);

  const form = useForm({
    resolver: zodResolver(dnoteItemForm),
    values: {
      description: "",
      unitPrice: "",
      unit: "",

      quantity: "",
    },
  });

  return (
    <Card className="items-center justify-center  md:w-1/2 mx-auto  ">
      <CardHeader>
        <CardTitle>Add Item</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <NextForm action={dispatch} className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row w-full gap-4">
              <div className="flex-1">
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Enter description</FormLabel>

                      <FormControl key={"Input"}>
                        <Input
                          placeholder="Description"
                          {...field}
                          type="text"
                        />
                      </FormControl>

                      <div
                        id="category-error"
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
                  name="unitPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price per unit</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter price per unit"
                          {...field}
                          type="number"
                        />
                      </FormControl>
                      <div
                        id="email-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {state.errors?.unitPrice &&
                          state.errors.unitPrice.map((error) => (
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
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter quantity"
                          {...field}
                          type="number"
                        />
                      </FormControl>
                      <div
                        id="quantity-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {state.errors?.quantity &&
                          state.errors.quantity.map((error) => (
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
                  name="unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Enter unit</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter units like hours ,pcs ,lot, days"
                          {...field}
                          type="text"
                        />
                      </FormControl>
                      <div
                        id="phone-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {state.errors?.unit &&
                          state.errors.unit.map((error) => (
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
              <p className="my-2 text-center text-red-600 font-semibold">
                {state.message}
              </p>
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
      })}
    >
      {isPending ? "Submitting" : "Add item"}
    </Button>
  );
}
