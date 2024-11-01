"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

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

export default function UpdateStockForm({ stock }) {
  const initialState = { message: "", errors: {} };

  const updateWithId = updateStock.bind(null, stock._id.toString());
  const [state, dispatch] = useActionState(updateWithId, initialState);

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
          <form action={dispatch} className="flex flex-col gap-4  w-full">
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
                            <SelectItem value="indicator">Indicator</SelectItem>

                            <SelectItem value="loadcell">Load cell</SelectItem>
                            <SelectItem value="platform">Platform</SelectItem>
                            <SelectItem value="cable">cable</SelectItem>
                            <SelectItem value="pos">POS</SelectItem>
                          </SelectGroup>

                          <SelectItem value="other">Other</SelectItem>
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

            <UpdateButton />
          </form>
        </Form>
      </CardContent>
      {/* <CardFooter>
          <small>Contact your admin if new</small>
        </CardFooter> */}
    </Card>
  );
}

function UpdateButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      aria-disabled={pending}
      className={cn("self-end", {
        "bg-pink-200 ": pending,
        "bg-primary": !pending,
      })}
    >
      {pending ? "Submitting.." : "Update Stock"}
    </Button>
  );
}
