"use client";

import { useActionState } from "react";
import NextForm from "next/form";
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
import { createUser } from "../../../mongodb/actions";
import { cn } from "../../../../lib/utils";

const formSchema = z.object({
  name: z.string(),
  accountType: z.string(),
});
export function CreateUserForm() {
  const initialState = { message: "", errors: {} };
  const [state, dispatch, isPending] = useActionState(createUser, initialState);
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      role: "",
      email: "",
      password: "",
    },
  });

  return (
    <>
      <Card className="w-full ">
        <CardHeader>
          <CardTitle>Add User</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <NextForm action={dispatch} className="flex flex-col gap-4">
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
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Mark Nderitu"
                        {...field}
                        type="email"
                      />
                    </FormControl>
                    <div id="email-error" aria-live="polite" aria-atomic="true">
                      {state.errors?.email &&
                        state.errors.email.map((error) => (
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
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" />
                    </FormControl>
                    <div
                      id="password-error"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {state.errors?.password &&
                        state.errors.password.map((error) => (
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
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} name="role">
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Operator">Operator</SelectItem>
                        <SelectItem value="Admin">Admin</SelectItem>
                        <SelectItem value="User">User</SelectItem>
                      </SelectContent>
                    </Select>

                    <div id="role-error" aria-live="polite" aria-atomic="true">
                      {state.errors?.role &&
                        state.errors.role.map((error) => (
                          <p className="mt-2 text-sm text-red-500" key={error}>
                            {error}
                          </p>
                        ))}
                    </div>
                  </FormItem>
                )}
              />
              <CreateButton isPending={isPending} />
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
      type="submit"
      className={cn("max-w-[500px] self-end ", { "bg-pink-200": isPending })}
      aria-disabled={isPending}
    >
      {isPending ? "Creating.." : "Create user"}
    </Button>
  );
}
