"use client";

import { useActionState } from "react";
import NextForm from "next/form";

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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../../components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";

import { useForm } from "react-hook-form";
import { stockForm } from "../../../../mongodb/validators";

import { updateStock } from "../../../../mongodb/actions";
import { cn } from "../../../../../lib/utils";
import { CATEGORIES } from "../../../../utils/productCategories";

export default function UpdateStockForm({ stock }) {
  const initialState = { message: "", errors: {} };

  const updateWithId = updateStock.bind(null, stock._id.toString());
  const [state, dispatch, isPending] = useActionState(
    updateWithId,
    initialState
  );

  const form = useForm({
    resolver: zodResolver(stockForm),
    defaultValues: {
      SKU: stock.SKU,
      price: stock.price,
      description: stock.description,
      stock: stock.stock,
      category: stock.category,

      name: stock.name,
    },
  });

  return (
    <Card className=" items-center justify-center  md:w-1/2 mx-auto ">
      <CardHeader>
        <CardTitle>Update Stock</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <NextForm action={dispatch} className="flex flex-col gap-4  w-full">
            <div className="flex flex-col md:flex-row w-full gap-4">
              <div className="flex-1">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} type="text" />
                      </FormControl>
                      <div id="ip-error" aria-live="polite" aria-atomic="true">
                        {state.errors?.name &&
                          state.errors.name.map((error) => (
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
                  name="SKU"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SKU</FormLabel>
                      <FormControl>
                        <Input {...field} type="text" />
                      </FormControl>
                      <div id="SKU-error" aria-live="polite" aria-atomic="true">
                        {state.errors?.SKU &&
                          state.errors.SKU.map((error) => (
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

            <div className="flex flex-col md:flex-row gap-4 w-full">
              <div className="flex-1">
                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price</FormLabel>
                      <FormControl>
                        <Input placeholder="" {...field} type="number" />
                      </FormControl>
                      <div
                        id="price-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {state.errors?.price &&
                          state.errors.price.map((error) => (
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
                  name="stock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stock</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" />
                      </FormControl>
                      <div
                        id="stock-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {state.errors?.stock &&
                          state.errors.stock.map((error) => (
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

            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel> Category</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        name="category"
                        defaultValue={stock.category}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectGroup>
                            {CATEGORIES.map((cat) => (
                              <SelectItem value={cat.value} key={cat.value}>
                                {cat.name}
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
                          placeholder="Description"
                          {...field}
                          type="text"
                        />
                      </FormControl>
                      <div
                        id="stock-error"
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

            <UpdateButton isPending={isPending} />
          </NextForm>
        </Form>
      </CardContent>
      {/* <CardFooter>
          <small>Contact your admin if new</small>
        </CardFooter> */}
    </Card>
  );
}

function UpdateButton({ isPending }) {
  return (
    <Button
      aria-disabled={isPending}
      className={cn("self-end", {
        "bg-pink-200 ": isPending,
        "bg-primary": !isPending,
      })}
    >
      {isPending ? "Submitting.." : "Update Stock"}
    </Button>
  );
}
