import { headers } from "next/headers";
import { AlertCircle, LogOut } from "lucide-react";
import { auth } from "../../auth";
import { logout } from "../db/actions/auth-actions";
import { getSwitchableCompanies } from "@/app/db/actions/company-switch-actions";
import { ChooseCompany } from "@/components/choose-company";

import { AppSidebar } from "./components/app-sidebar";
import { CommandPaletteProvider } from "@/components/command-palette-provider";
import MobileBottomNav from "./components/MobileBottomNav";
import { getMyNotifications } from "@/app/db/actions/notification-actions";
import { CompanySwitcher } from "@/components/company-switcher-server";

export const metadata = {
  title: "QaliSuite Dashboard",
  description: "Enterprise Resource Planning",
};

async function DashboardLayout({ children }) {
  const session = await auth();
  const user = session?.user;

  // Tenant-context guard. SuperAdmin is intentionally cross-tenant and
  // may have a null companyId; everyone else needs one to fetch any
  // dashboard data. We don't surface *why* — just give the recovery
  // action (sign out and back in) and let support handle edge cases
  // via internal logs. Avoids leaking session/invite internals.
  if (user && user.role !== "SuperAdmin" && !user.companyId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-5 w-5" />
            <h1 className="text-lg font-semibold">Access unavailable</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Please sign in again to continue. If this keeps happening,
            contact your administrator.
          </p>
          {/* `signOut` requires POST + CSRF; a plain <a> GET is a no-op.
              Using the existing `logout` server action wired through a
              form gives both. */}
          <form action={logout}>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    );
  }

  /**
   * THE UNCHOSEN-COMPANY GATE.
   *
   * Row-level security scopes every read to ONE company, so a user authorised
   * for several has no acting company until they pick one — `withAuthorizedTenant`
   * throws rather than choosing for them (app/db/tenant.ts), and that throw
   * reached the reader as app/dashboard/error.jsx's "Oops! Something went
   * wrong", which names neither the cause nor the fix. Asking the question
   * HERE, once, is the difference between fifty pages that crash and one that
   * asks.
   *
   * The condition is "more than one to choose from", not "is a SuperAdmin":
   * the gate auto-selects when there is exactly one company on offer, so a
   * single-company user never sees this, and an Admin of two hits the same
   * wall a SuperAdmin does.
   *
   * EXEMPT: the platform pages, which are company-less by design. Admin →
   * Companies reads across tenants on the privileged connection (app/db/platform.ts),
   * and /dashboard renders the platform dashboard FOR A SuperAdmin — for
   * everyone else /dashboard is that company's books and belongs behind the
   * gate. Sending platform staff to a chooser before they can reach the screen
   * that lists the companies would be a loop with no way out.
   *
   * Degrades to letting the request through: a Postgres that cannot be reached
   * must fail where the failure can be described, not behind a chooser with
   * nothing in it.
   */
  const pathname = (await headers()).get("x-pathname") || "";
  const isPlatformPath =
    pathname.startsWith("/dashboard/admin") ||
    pathname.startsWith("/dashboard/subscription-expired") ||
    (user?.role === "SuperAdmin" &&
      (pathname === "/dashboard" || pathname === "/dashboard/"));

  let grants = null;
  try {
    grants = await getSwitchableCompanies();
  } catch {
    grants = null;
  }

  const choosable = (grants?.companies ?? []).filter((c) => c.isActive);
  const mustChooseCompany =
    !isPlatformPath && !grants?.activeCompanyId && choosable.length > 1;

  // Bell data — one query, index-backed, capped. Called once per render here,
  // which is where the deduplication belongs: the Mongo version wrapped itself
  // in React cache(), and caching a transaction-scoped read across a request is
  // how one company's rows get served inside another's after a switch.
  // Degrades to an empty bell rather than throwing; the layout wraps every page.
  const notifications = await getMyNotifications();

  return (
    <CommandPaletteProvider
      companyPlan={user?.companyPlan}
      role={user?.role}
    >
      <AppSidebar
        user={user}
        notifications={notifications}
        /* Rendered on the server and passed down: the grants are a Postgres
           read scoped to the user, and the active company lives in the session
           cookie — neither is reachable from the client sidebar. */
        companySwitcher={<CompanySwitcher grants={grants} />}
        children={
          <div className="p-4 pb-20 md:p-6 md:pb-6">
            {mustChooseCompany ? (
              <ChooseCompany companies={choosable} />
            ) : (
              children
            )}
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
