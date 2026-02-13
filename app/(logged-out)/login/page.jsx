"use client";
import { useActionState } from "react";
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
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Package,
  TriangleAlert,
  Loader2,
  Mail,
  Phone,
  User,
} from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { authenticate } from "../../mongodb/actions";
import { cn } from "../../../lib/utils";

const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export default function LoginPage() {
  const [errorMessage, dispatch, isPending] = useActionState(
    authenticate,
    undefined
  );

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo & Branding */}
        <div className="flex flex-col items-center space-y-3">
          <div className="w-16 h-16 bg-yellow-500 rounded-lg flex items-center justify-center">
            <Package className="w-10 h-10 text-black" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">QaliSuite</h1>
            <p className="text-sm text-muted-foreground">
              Enterprise Resource Planning
            </p>
          </div>
        </div>

        {/* Login Card */}
        <Card className="bg-card border-border">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-foreground">Sign in</CardTitle>
            <CardDescription className="text-muted-foreground">
              Enter your credentials to access your account
            </CardDescription>
          </CardHeader>

          <CardContent>
            <Form {...form}>
              <form action={dispatch} className="space-y-4">
                {/* Error Message Alert */}
                {errorMessage && (
                  <Alert
                    variant="destructive"
                    className="bg-red-500/10 border-red-500/20"
                  >
                    <TriangleAlert className="h-4 w-4 text-red-600 dark:text-red-400" />
                    <AlertDescription className="text-red-600 dark:text-red-400">
                      {errorMessage}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Email Field */}
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground">
                        Email address
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="you@example.com"
                          className="bg-background border-border text-foreground placeholder:text-muted-foreground"
                          disabled={isPending}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Password Field */}
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground">
                        Password
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          className="bg-background border-border text-foreground placeholder:text-muted-foreground"
                          disabled={isPending}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Login Button */}
                <LoginButton isPending={isPending} />
              </form>
            </Form>
          </CardContent>

          {/* Footer - Not Registered */}
          <CardFooter className="flex flex-col space-y-4 border-t border-border pt-6">
            <div className="w-full space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Don't have an account?
              </p>

              <Alert className="bg-blue-500/10 border-blue-500/20">
                <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <AlertDescription className="text-sm text-blue-600 dark:text-blue-400">
                  <strong>New users:</strong> Contact your system administrator
                  to create an account for you.
                </AlertDescription>
              </Alert>

              {/* Admin Contact Info */}
              <div className="space-y-2 p-4 rounded-lg bg-muted/50 border border-border">
                <p className="text-xs font-semibold text-foreground mb-2">
                  Administrator Contact:
                </p>
                <div className="space-y-1.5">
                  <a
                    href="mailto:admin@stockvault.com"
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    <span>admin@stockvault.com</span>
                  </a>
                  <a
                    href="tel:+254700000000"
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    <span>+254 700 000 000</span>
                  </a>
                </div>
              </div>
            </div>
          </CardFooter>
        </Card>

        {/* Footer Info */}
        <p className="text-center text-xs text-muted-foreground">
          By signing in, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}

function LoginButton({ isPending }) {
  return (
    <Button
      type="submit"
      disabled={isPending}
      className={cn(
        "w-full font-medium",
        isPending
          ? "bg-yellow-500/50 cursor-not-allowed"
          : "bg-yellow-500 hover:bg-yellow-600 text-black"
      )}
    >
      {isPending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Signing in...
        </>
      ) : (
        "Sign in"
      )}
    </Button>
  );
}
