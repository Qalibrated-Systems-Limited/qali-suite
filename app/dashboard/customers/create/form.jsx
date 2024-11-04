"use client";

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

import { createAccount } from "../../../mongodb/actions";
import { accountForm } from "../../../mongodb/validators";
import { cn } from "../../../../lib/utils";

export function CreateAccountForm() {
  const initialState = { message: "", errors: {} };
  const [state, dispatch] = useFormState(createAccount, initialState);
  const form = useForm({
    resolver: zodResolver(accountForm),
    defaultValues: {
      name: "",
      address: "",
      email: "",
      phoneNumber: "",
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

              <div className="flex-1">
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
      {pending ? "Submitting.." : "Create customer"}
    </Button>
  );
}
