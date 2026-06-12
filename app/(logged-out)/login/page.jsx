"use client";
import { Suspense, useState } from "react";
import { Button } from "../../../components/ui/button";
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
  TriangleAlert,
  Loader2,
  Package,
  Receipt,
  BarChart3,
  Wallet,
  Shield,
  UserCog,
  FolderKanban,
  ArrowRight,
  Check,
} from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { QaliSuiteMark } from "@/components/qalisuite-logo";

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
    defaultValues: { email: "", password: "" },
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
      setErrorMessage("Invalid email or password.");
      setIsPending(false);
    } else if (result?.url) {
      window.location.href = result.url;
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* ── Left panel: brand showcase ── */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] bg-zinc-950 relative overflow-hidden border-r border-border">
        {/* Ambient glow */}
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-yellow-500/6 blur-[120px]" />
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-yellow-500/4 blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-yellow-500/[0.02] blur-[80px]" />

        {/* Subtle grid */}
        <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px]" />

        <div className="relative z-10 flex flex-col justify-between p-10 xl:p-14 w-full">
          {/* Top: Logo */}
          <Link href="/" className="w-fit animate-[fadeInUp_0.5s_ease-out_both]">
            <QaliSuiteMark size="md" light />
          </Link>

          {/* Center: Value prop */}
          <div className="space-y-8 max-w-md">
            <div className="animate-[fadeInUp_0.6s_ease-out_0.1s_both]">
              <h2 className="text-[2.5rem] xl:text-5xl font-bold text-white tracking-tight leading-[1.08]">
                Your business,
                <br />
                <span className="text-yellow-500">simplified.</span>
              </h2>
              <p className="text-zinc-400 mt-4 leading-relaxed text-[15px]">
                Inventory, invoicing, accounting, HR & payroll, and project management — one platform, fully connected.
              </p>
            </div>

            {/* Module pills */}
            <div className="flex flex-wrap gap-2 animate-[fadeInUp_0.6s_ease-out_0.2s_both]">
              {[
                { icon: Package,       label: "Inventory" },
                { icon: Receipt,       label: "Invoicing" },
                { icon: Wallet,        label: "Accounting" },
                { icon: UserCog,       label: "HR & Payroll" },
                { icon: FolderKanban,  label: "Projects" },
                { icon: BarChart3,     label: "Reports" },
                { icon: Shield,        label: "Tax" },
              ].map((f) => (
                <div
                  key={f.label}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-zinc-300 text-xs font-medium hover:bg-white/[0.1] hover:border-white/[0.15] transition-all duration-200"
                >
                  <f.icon className="w-3.5 h-3.5 text-yellow-500/80" />
                  {f.label}
                </div>
              ))}
            </div>

            {/* Highlights */}
            <div className="space-y-3 animate-[fadeInUp_0.6s_ease-out_0.3s_both]">
              {[
                "Stock commits automatically when you invoice",
                "Kenya PAYE, NSSF, SHIF & AHL built in",
                "Every transaction auto-posts to the ledger",
              ].map((text) => (
                <div key={text} className="flex items-center gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-yellow-500/15 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 text-yellow-500" />
                  </div>
                  <span className="text-sm text-zinc-400">{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom: Copyright */}
          <p className="text-zinc-700 text-xs animate-[fadeInUp_0.5s_ease-out_0.4s_both]">
            &copy; {new Date().getFullYear()} Qalibrated Systems Ltd &middot; Nairobi, Kenya
          </p>
        </div>
      </div>

      {/* ── Right panel: login form ── */}
      <div className="flex-1 flex items-center justify-center px-5 py-8">
        <div className="w-full max-w-[380px]">
          {/* Mobile header — centred; left-aligned logo made the page feel
              lopsided on phones (no left panel to balance it there) */}
          <div className="lg:hidden mb-8 flex justify-center animate-[fadeInUp_0.5s_ease-out_both]">
            <Link href="/">
              <QaliSuiteMark size="md" />
            </Link>
          </div>

          {/* Heading — centred on phones, left from lg (matches panel layout) */}
          <div className="mb-6 text-center lg:text-left animate-[fadeInUp_0.5s_ease-out_0.05s_both]">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Welcome back</h1>
            <p className="text-[13px] text-muted-foreground mt-1">
              Sign in to your account to continue
            </p>
          </div>

          {/* Errors */}
          {oauthError && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[13px] text-amber-600 dark:text-amber-400 animate-[fadeInUp_0.3s_ease-out_both]">
              <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
              No account found. Ask your admin for an invite first.
            </div>
          )}
          {errorMessage && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[13px] text-red-600 dark:text-red-400 animate-[fadeInUp_0.3s_ease-out_both]">
              <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
              {errorMessage}
            </div>
          )}

          <div className="animate-[fadeInUp_0.5s_ease-out_0.1s_both]">
            {/* Google */}
            <GoogleSignInButton />

            {/* Divider */}
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-3 text-[11px] text-muted-foreground uppercase tracking-widest">
                  or sign in with email
                </span>
              </div>
            </div>

            {/* Credentials form */}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleCredentialsLogin)} className="space-y-3">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-foreground text-[13px] font-medium">Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="you@company.com"
                          className="h-10 text-sm bg-background border-border rounded-xl focus-visible:ring-yellow-500/30 transition-shadow"
                          disabled={isPending}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-foreground text-[13px] font-medium">Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          className="h-10 text-sm bg-background border-border rounded-xl focus-visible:ring-yellow-500/30 transition-shadow"
                          disabled={isPending}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  disabled={isPending}
                  className="w-full h-10 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold text-sm mt-1 rounded-xl shadow-md shadow-yellow-500/15 hover:shadow-lg hover:shadow-yellow-500/20 transition-all duration-200"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </div>

          {/* Help text */}
          <div className="animate-[fadeInUp_0.5s_ease-out_0.15s_both]">
            <p className="mt-6 text-center text-xs text-muted-foreground leading-relaxed">
              Don&apos;t have an account? Ask your admin for an invite.
            </p>
            <p className="text-center text-[11px] text-muted-foreground/60 mt-3">
              By signing in you agree to our{" "}
              <Link href="/policy" className="underline hover:text-muted-foreground transition-colors">
                Privacy Policy
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleSignInButton() {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full h-10 border-border text-foreground hover:bg-accent gap-2.5 font-medium rounded-xl hover:shadow-sm transition-all duration-200"
      disabled={loading}
      onClick={() => {
        setLoading(true);
        signIn("google", { callbackUrl: "/dashboard" });
      }}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
      )}
      Continue with Google
    </Button>
  );
}
