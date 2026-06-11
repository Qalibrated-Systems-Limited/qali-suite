"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Loader2,
  Mail,
  Lock,
  User,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { acceptInviteWithPassword } from "@/app/mongodb/actions/invite-actions";

export default function AcceptInviteClient({ token, email, companyName }) {
  const router = useRouter();
  const [mode, setMode] = useState(null); // null | "google" | "password"
  const [googleLoading, setGoogleLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setError("");
    try {
      await signIn("google", { callbackUrl: "/dashboard" });
    } catch {
      setError("Failed to sign in with Google. Please try again.");
      setGoogleLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordLoading(true);
    setError("");

    const formData = new FormData(e.target);
    const result = await acceptInviteWithPassword(token, formData);

    if (result.success) {
      setSuccess(result.message);
      setTimeout(() => router.push("/login"), 2000);
    } else {
      setError(result.error);
      setPasswordLoading(false);
    }
  };

  if (success) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-emerald-500" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              Account Created!
            </h3>
            <p className="text-sm text-muted-foreground">{success}</p>
            <p className="text-xs text-muted-foreground">
              Redirecting to login...
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="space-y-1 p-4 text-center sm:p-6">
        <CardTitle className="text-xl text-foreground">
          Accept Invitation
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Choose how you'd like to set up your account
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
        {/* Error */}
        {error && (
          <Alert variant="destructive" className="bg-red-500/10 border-red-500/20">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <AlertDescription className="text-red-600 dark:text-red-400">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {/* Invited email display */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-foreground">{email}</span>
        </div>

        {/* Google Sign-in Option */}
        {mode !== "password" && (
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 border-border text-foreground hover:bg-accent gap-3"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
            >
              {googleLoading ? (
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

            {mode !== "google" && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    or
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Password Setup Option */}
        {mode !== "google" && (
          <>
            {mode !== "password" ? (
              <Button
                type="button"
                variant="ghost"
                className="w-full text-muted-foreground hover:text-foreground"
                onClick={() => setMode("password")}
              >
                <Lock className="h-4 w-4 mr-2" />
                Set up with email & password
              </Button>
            ) : (
              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      name="name"
                      placeholder="Your full name"
                      required
                      maxLength={50}
                      className="pl-10 bg-background border-border"
                      disabled={passwordLoading}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      name="password"
                      type="password"
                      placeholder="Min 6 characters"
                      required
                      minLength={6}
                      className="pl-10 bg-background border-border"
                      disabled={passwordLoading}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      name="confirmPassword"
                      type="password"
                      placeholder="Confirm your password"
                      required
                      minLength={6}
                      className="pl-10 bg-background border-border"
                      disabled={passwordLoading}
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-border"
                    onClick={() => setMode(null)}
                    disabled={passwordLoading}
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
                    disabled={passwordLoading}
                  >
                    {passwordLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating account...
                      </>
                    ) : (
                      "Create Account"
                    )}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground pt-2">
          Already have an account?{" "}
          <a href="/login" className="text-yellow-600 hover:underline">
            Sign in
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
