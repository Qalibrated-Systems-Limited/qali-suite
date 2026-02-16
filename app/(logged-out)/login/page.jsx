"use client";
import { Suspense, useState } from "react";
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
  TriangleAlert,
  Loader2,
  User,
} from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { cn } from "../../../lib/utils";

const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const oauthError = searchParams.get("error");
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const handleCredentialsLogin = async (data) => {
    setIsPending(true);
    setErrorMessage("");

    const result = await signIn("credentials", {
      email: data.email,
      password: data.password,
      callbackUrl: "/dashboard",
      redirect: false,
    });

    if (result?.error) {
      setErrorMessage("Invalid credentials.");
      setIsPending(false);
    } else if (result?.url) {
      window.location.href = result.url;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo & Branding */}
        <div className="flex flex-col items-center space-y-3">
          <div className="w-16 h-16 bg-yellow-500 rounded-xl flex items-center justify-center shadow-lg shadow-yellow-500/20">
            <span className="text-3xl font-bold text-black">Q</span>
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
              <form onSubmit={form.handleSubmit(handleCredentialsLogin)} className="space-y-4">
                {/* OAuth Error (e.g. uninvited Google sign-in) */}
                {oauthError && (
                  <Alert className="bg-amber-500/10 border-amber-500/20">
                    <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <AlertDescription className="text-amber-600 dark:text-amber-400">
                      No account found for this email. Ask your administrator to
                      send you an invite first.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Credentials Error */}
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

            {/* Divider */}
            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {/* Google Sign In */}
            <GoogleSignInButton />
          </CardContent>

          {/* Footer */}
          <CardFooter className="flex flex-col space-y-4 border-t border-border pt-6">
            <Alert className="bg-blue-500/10 border-blue-500/20">
              <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertDescription className="text-sm text-blue-600 dark:text-blue-400">
                <strong>New users:</strong> Ask your administrator to send you
                an invite to get started.
              </AlertDescription>
            </Alert>
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

function GoogleSignInButton() {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full h-11 border-border text-foreground hover:bg-accent gap-3"
      disabled={loading}
      onClick={() => {
        setLoading(true);
        signIn("google", { callbackUrl: "/dashboard" });
      }}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <svg className="h-5 w-5" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
      )}
      Sign in with Google
    </Button>
  );
}
