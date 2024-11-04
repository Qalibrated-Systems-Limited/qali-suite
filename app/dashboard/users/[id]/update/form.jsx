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
import { useFormState } from "react-dom";

import { useForm } from "react-hook-form";
import { userUpdateForm } from "../../../../mongodb/validators";

import { updateUser } from "../../../../mongodb/actions";

export default function UpdateUserForm({ account }) {
  const initialState = { message: "", errors: {} };

  const updateWithId = updateUser.bind(null, account._id.toString());
  const [state, dispatch] = useFormState(updateWithId, initialState);

  const form = useForm({
    resolver: zodResolver(userUpdateForm),
    defaultValues: {
      name: account.name,
      email: account.email,
      role: account.role ?? "",
      status: account.status,
    },
  });

  return (
    <>
      <Card className="w-full ">
        <CardHeader>
          <CardTitle>Update user</CardTitle>
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
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        defaultValue={account.email}
                        {...field}
                        type="text"
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
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel> Role</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      name="role"
                      defaultValue={account.role}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Operator">Operator</SelectItem>

                        <SelectItem value="Admin">Admin</SelectItem>
                        <SelectItem value="User">User</SelectItem>
                      </SelectContent>
                    </Select>

                    <div
                      id="accountType-error"
                      aria-live="polite"
                      aria-atomic="true"
                    >
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

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel> Status</FormLabel>
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
                Update user
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
