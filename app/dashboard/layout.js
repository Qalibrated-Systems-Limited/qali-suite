import { AlertCircle, LogOut } from "lucide-react";
import { auth } from "../../auth";
import { logout } from "../mongodb/actions/auth-actions";

import { AppSidebar } from "./components/app-sidebar";
import { CommandPaletteProvider } from "@/components/command-palette-provider";
import MobileBottomNav from "./components/MobileBottomNav";
import { cMyNotifications } from "@/app/mongodb/queries/notification-queries";

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

  // Bell data — request-scoped (cache()), index-backed, capped. Safe-noop
  // when there's no session.
  const notifications = await cMyNotifications();

  return (
    <CommandPaletteProvider>
      <AppSidebar
        user={user}
        notifications={notifications}
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
