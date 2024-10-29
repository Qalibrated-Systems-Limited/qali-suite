import { useActionState } from "react";
"use client";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";

import { useForm } from "react-hook-form";
import * as z from "zod";
import { createAccount } from "../../../mongodb/actions";

const formSchema = z.object({
  name: z.string(),
  accountType: z.string(),
});
export function CreateAccountForm() {
  const initialState = { message: "", errors: {} };
  const [state, dispatch] = useActionState(createAccount, initialState);
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      accountType: "",
    },
  });

  return (
    <>
      <Card className="w-full ">
        <CardHeader>
          <CardTitle>Add Account</CardTitle>
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
                        placeholder="Mark Nderitu"
                        {...field}
                        type="text"
                      />
                    </FormControl>
                    <div id="ip-error" aria-live="polite" aria-atomic="true">
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
                    <Select onValueChange={field.onChange} name="accountType">
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

                    <div id="role-error" aria-live="polite" aria-atomic="true">
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

              <Button type="submit" className="max-w-[500px] self-end ">
                Create account
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
