import Link from "next/link";
import { AlertCircle, LogOut } from "lucide-react";
import { auth } from "../../auth";

import { AppSidebar } from "./components/app-sidebar";
import { CommandPaletteProvider } from "@/components/command-palette-provider";
import MobileBottomNav from "./components/MobileBottomNav";

export const metadata = {
  title: "QaliSuite Dashboard",
  description: "Enterprise Resource Planning",
};

async function DashboardLayout({ children }) {
  const session = await auth();
  const user = session?.user;

  // Tenant-context guard. A non-SuperAdmin user must have a companyId to
  // access any dashboard page — without it, every tenant-scoped query
  // (and there are dozens) will throw "companyId required for non-SuperAdmin
  // user". Rather than letting that bubble up as a 500 with a stack trace,
  // render a friendly recovery screen. This commonly happens with stale
  // sessions after a user's account was reassigned, or with half-completed
  // invite acceptances.
  if (user && user.role !== "SuperAdmin" && !user.companyId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-5 w-5" />
            <h1 className="text-lg font-semibold">
              Account not linked to a company
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Your user account isn&apos;t associated with a tenant, so we
            can&apos;t load any dashboard data for you. This usually means
            an invite didn&apos;t fully complete, your session is stale, or
            the company assignment was removed.
          </p>
          <p className="text-sm text-muted-foreground">
            Try signing out and back in. If the problem persists, contact
            your administrator to confirm your account is assigned to a
            company.
          </p>
          <Link
            href="/api/auth/signout"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Link>
        </div>
      </div>
    );
  }

  return (
    <CommandPaletteProvider>
      <AppSidebar
        user={user}
        children={
          <div className="p-4 pb-20 md:p-6 md:pb-6">
            {children}
            {/* Mobile bottom nav — fixed, sm:hidden. Extra pb-20 above
                so content isn't hidden behind it on small screens. */}
            <MobileBottomNav role={user?.role} />
          </div>
        }
      />
    </CommandPaletteProvider>
  );
}

export default DashboardLayout;
