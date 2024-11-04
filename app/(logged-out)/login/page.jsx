"use client";
import { useActionState } from "react";
import { useFormState } from "react-dom";

import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../../components/ui/form";
import { Input } from "../../../components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ComputerIcon,
  ScaleIcon,
  StoreIcon,
  TriangleAlert,
  WeightIcon,
} from "lucide-react";
import { useFormStatus } from "react-dom";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { authenticate } from "../../mongodb/actions";

const formSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  role: z.enum(["Admin", "Analyst", "User"]),
  name: z.string().max(200).min(8),
});
export default function Page() {
  const [errorMessage, dispatch] = useFormState(authenticate, undefined);
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  return (
    <>
      <ComputerIcon size={50} className="text-pink-500" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Login</CardTitle>
          <CardDescription>Login to your vms account</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form action={dispatch} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="wanjikuflorance@gmail.com"
                        {...field}
                      />
                    </FormControl>

                    <FormMessage />
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
                      <Input
                        type="password"
                        placeholder="Password"
                        {...field}
                      />
                    </FormControl>

                    <div
                      className="flex h-8 items-end space-x-1"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {errorMessage && (
                        <>
                          <TriangleAlert className="h-5 w-5 text-red-500" />
                          <p className="text-sm text-red-500">{errorMessage}</p>
                        </>
                      )}
                    </div>
                  </FormItem>
                )}
              />
              <LoginButton />
            </form>
          </Form>
        </CardContent>
        <CardFooter className=" flex justify-between">
          <small>Not registered?</small>
          <Button variant={"outline"}>Call Admin</Button>
        </CardFooter>
      </Card>
    </>
  );
}

function LoginButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      Login
    </Button>
  );
}
