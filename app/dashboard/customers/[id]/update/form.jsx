"use client";
import { useActionState } from "react";
import { useFormStatus, useFormState } from "react-dom";

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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../../components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";

import { useForm } from "react-hook-form";
import { updateAccountForm } from "../../../../mongodb/validators";

import { updateAccount } from "../../../../mongodb/actions";
import { cn } from "../../../../../lib/utils";

export default function UpdateAccountForm({ account }) {
  const initialState = { message: "", errors: {} };

  const updateWithId = updateAccount.bind(null, account._id.toString());
  const [state, dispatch] = useFormState(updateWithId, initialState);

  const form = useForm({
    resolver: zodResolver(updateAccountForm),
    defaultValues: {
      name: account.name,
      address: account.address,
      email: account.email,
      phoneNumber: account.phoneNumber,
      status: account.status,
    },
  });

  return (
    <Card className="items-center justify-center  md:w-1/2 mx-auto  ">
      <CardHeader>
        <CardTitle>Add Account</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form action={dispatch} className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row w-full gap-4">
              <div className="flex-1">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Imenti Tea Factory"
                          {...field}
                          type="text"
                        />
                      </FormControl>
                      <div
                        id="name-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
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
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Input placeholder="Meru" {...field} type="text" />
                      </FormControl>
                      <div
                        id="address-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {state.errors?.address &&
                          state.errors.address.map((error) => (
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
                  name="phoneNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter phone number"
                          {...field}
                          type="tel"
                        />
                      </FormControl>
                      <div
                        id="phone-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {state.errors?.phoneNumber &&
                          state.errors.phoneNumber.map((error) => (
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

              <div className="flex-3">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter email address"
                          {...field}
                          type="email"
                        />
                      </FormControl>
                      <div
                        id="email-error"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {state.errors?.email &&
                          state.errors.email.map((error) => (
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
                      <FormLabel> Account status</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        name="status"
                        defaultValue={account.status}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Change status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Active">Active</SelectItem>

                          <SelectItem value="Inactive">Inactive</SelectItem>
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
      })}
    >
      {pending ? "Submitting" : "Update Account"}
    </Button>
  );
}
