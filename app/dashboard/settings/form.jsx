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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";

import { useForm } from "react-hook-form";
import * as z from "zod";
import { settingsForm } from "../../mongodb/validators";
import { createSettings } from "../../mongodb/actions";
import NextForm from "next/form";
import { cn } from "../../../lib/utils";

export function SettingsForm() {
  const initialState = { message: "", errors: {} };
  const [state, dispatch, isPending] = useActionState(
    createSettings,
    initialState
  );
  const form = useForm({
    resolver: zodResolver(settingsForm),
    defaultValues: {
      isLocked: "",
      maxCapacity: "",
      minCapacity: "",
      weigherId: "",
      division: "",
    },
  });

  return (
    <>
      <Card className="w-full ">
        <CardHeader>
          <CardTitle>Configure Weighbridge</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <NextForm action={dispatch} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="maxCapacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max capacity </FormLabel>
                    <FormControl>
                      <Input placeholder="80000" {...field} type="number" />
                    </FormControl>
                    <div id="max-error" aria-live="polite" aria-atomic="true">
                      {state.errors?.maxCapacity &&
                        state.errors.maxCapacity.map((error) => (
                          <p className="mt-2 text-sm text-red-500" key={error}>
                            {error}
                          </p>
                        ))}
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="minCapacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min capacity </FormLabel>
                    <FormControl>
                      <Input placeholder="400" {...field} type="number" />
                    </FormControl>
                    <div id="min-error" aria-live="polite" aria-atomic="true">
                      {state.errors?.mixCapacity &&
                        state.errors.mixCapacity.map((error) => (
                          <p className="mt-2 text-sm text-red-500" key={error}>
                            {error}
                          </p>
                        ))}
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="division"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Division </FormLabel>
                    <FormControl>
                      <Input placeholder="20" {...field} type="number" />
                    </FormControl>
                    <div
                      id="division-error"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {state.errors?.division &&
                        state.errors.division.map((error) => (
                          <p className="mt-2 text-sm text-red-500" key={error}>
                            {error}
                          </p>
                        ))}
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="weigherId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weigher id </FormLabel>
                    <FormControl>
                      <Input placeholder="WB/001" {...field} type="text" />
                    </FormControl>
                    <div id="id-error" aria-live="polite" aria-atomic="true">
                      {state.errors?.weigherId &&
                        state.errors.weigherId.map((error) => (
                          <p className="mt-2 text-sm text-red-500" key={error}>
                            {error}
                          </p>
                        ))}
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isLocked"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel> Status</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      name="isLocked"
                      placeholder="choose off or on"
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Change status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="1">Off</SelectItem>

                        <SelectItem value="0">On</SelectItem>
                      </SelectContent>
                    </Select>

                    <div
                      id="accountType-error"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {state.errors?.isLocked &&
                        state.errors.isLocked.map((error) => (
                          <p className="mt-2 text-sm text-red-500" key={error}>
                            {error}
                          </p>
                        ))}
                    </div>
                  </FormItem>
                )}
              />
            </NextForm>
          </Form>
        </CardContent>
        {/* <CardFooter>
          <small>Contact your admin if new</small>
        </CardFooter> */}
      </Card>
    </>
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
      {isPending ? "Submitting.." : "Add Settings"}
    </Button>
  );
}
