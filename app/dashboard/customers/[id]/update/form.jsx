import { useActionState } from "react";
"use client";
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

export default function UpdateAccountForm({ account }) {
  const initialState = { message: "", errors: {} };

  const updateWithId = updateAccount.bind(null, account._id.toString());
  const [state, dispatch] = useActionState(updateWithId, initialState);

  const form = useForm({
    resolver: zodResolver(updateAccountForm),
    defaultValues: {
      name: account.name,
      accountType: account.accountType ?? "",
      status: account.status,
    },
  });

  return (
    <>
      <Card className="w-full ">
        <CardHeader>
          <CardTitle>Update Account</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form action={dispatch} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        defaultValue={account.name}
                        {...field}
                        type="text"
                      />
                    </FormControl>
                    <div id="name-error" aria-live="polite" aria-atomic="true">
                      {state.errors?.name &&
                        state.errors.name.map((error) => (
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
                name="accountType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel> Account type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      name="accountType"
                      defaultValue={account.accountType}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Driver">Driver</SelectItem>

                        <SelectItem value="Customer">Customer</SelectItem>
                      </SelectContent>
                    </Select>

                    <div
                      id="accountType-error"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {state.errors?.accountType &&
                        state.errors.accountType.map((error) => (
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
                          <p className="mt-2 text-sm text-red-500" key={error}>
                            {error}
                          </p>
                        ))}
                    </div>
                  </FormItem>
                )}
              />

              <Button type="submit" className="max-w-[500px] self-end ">
                Update Account
              </Button>
            </form>
          </Form>
        </CardContent>
        {/* <CardFooter>
          <small>Contact your admin if new</small>
        </CardFooter> */}
      </Card>
    </>
  );
}

function CreateButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      aria-disabled={pending}
      className={clsx({
        "bg-yellow-200 ": pending,
        "bg-primary": !pending,
      })}
    >
      {pending ? "Submitting" : "Update Account"}
    </Button>
  );
}
