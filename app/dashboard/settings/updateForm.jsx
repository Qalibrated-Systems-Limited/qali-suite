"use client";

import { useActionState } from "react";
import NextForm from "next/form";

import { useForm } from "react-hook-form";
import { settingsForm } from "../../mongodb/validators";
import { zodResolver } from "@hookform/resolvers/zod";
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

import { updateSettings } from "../../mongodb/actions";

export default function UpdateSettingsForm({ settings }) {
  const initialState = { message: "", errors: {} };

  const updateWithId = updateSettings.bind(null, settings.weigherId);
  const [state, dispatch, isPending] = useActionState(
    updateWithId,
    initialState
  );

  const form = useForm({
    resolver: zodResolver(settingsForm),
    defaultValues: {
      isLocked: settings.isLocked,
      maxCapacity: settings.maxCapacity ?? "",
      minCapacity: settings.minCapacity,
    },
  });

  return (
    <>
      <Card className="w-full ">
        <CardHeader>
          <CardTitle>Update Weighbridge Configurations</CardTitle>
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
                      <Input
                        defaultValue={settings.maxCapacity}
                        {...field}
                        type="number"
                      />
                    </FormControl>
                    <div id="max-error" aria-live="polite" aria-atomic="true">
                      {state?.errors?.maxCapacity &&
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
                      <Input
                        defaultValue={settings.minCapacity}
                        {...field}
                        type="number"
                      />
                    </FormControl>
                    <div id="min-error" aria-live="polite" aria-atomic="true">
                      {state?.errors?.minCapacity &&
                        state.errors.minCapacity.map((error) => (
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
                      <Input
                        defaultValue={settings.division}
                        {...field}
                        type="number"
                      />
                    </FormControl>
                    <div
                      id="division-error"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {state?.errors?.division &&
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
                      <Input
                        defaultValue={settings.division}
                        {...field}
                        type="text"
                      />
                    </FormControl>
                    <div id="id-error" aria-live="polite" aria-atomic="true">
                      {state?.errors?.weigherId &&
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
                      defaultValue={settings.isLocked.toString()}
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
                      {state?.errors?.isLocked &&
                        state.errors.isLocked.map((error) => (
                          <p className="mt-2 text-sm text-red-500" key={error}>
                            {error}
                          </p>
                        ))}
                    </div>
                  </FormItem>
                )}
              />

              <UpdateButton isPending={isPending} />
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

function UpdateButton({ isPending }) {
  return (
    <Button
      aria-disabled={isPending}
      className={clsx({
        "bg-pink-200 ": isPending,
        "bg-primary": !isPending,
      })}
    >
      {isPending ? "Submitting" : "Update Settings"}
    </Button>
  );
}
