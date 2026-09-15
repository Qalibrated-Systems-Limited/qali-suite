import Link from "next/link";
import { AlertCircle, Building2, Plus } from "lucide-react";

import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { getSwitchableCompanies } from "@/app/db/actions/company-switch-actions";
import { ChooseCompany } from "@/components/choose-company";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Choose a company" };

/**
 * A ROUTE, not a branch inside the dashboard layout.
 *
 * ── WHY THE LAYOUT SWAP WAS NOT ENOUGH ─────────────────────────────────────
 *
 * The layout used to render this chooser INSTEAD OF `children` when no company
 * was active. The reader saw the right thing, and the page underneath ran
 * anyway: the App Router renders a layout and its page segment concurrently,
 * so declining to include `children` in the returned tree does not stop the
 * page from being evaluated. Every such request still logged
 *
 *     Error: No company selected. You have access to 3.
 *       at EditUserPage (app/dashboard/users/[id]/update/page.jsx)
 *
 * — a page that had already thrown before the layout could decide anything.
 * A `redirect()` is the only thing that ends a request; a different render
 * does not.
 *
 * So the layout redirects HERE, and this page is the one place the chooser
 * lives. It is outside the gate's own condition, or the redirect would chase
 * its own tail.
 *
 * It re-reads the grants rather than trusting whatever sent the reader here:
 * a session whose company count is stale must cost one extra hop, never a
 * lock-out. With one company to choose from the gate picks it automatically,
 * so there is nothing here to ask and this bounces straight back.
 */
export default async function SelectCompanyPage() {
  const session = await auth();
  const role = session?.user?.role;

  /**
   * Can this person FIX the empty case, rather than only be told about it?
   *
   * A SuperAdmin arriving here with nothing to open is usually looking at a
   * platform with no tenants yet — a first install, or one whose companies
   * were all deactivated. Telling them to "contact your administrator" is
   * telling them to contact themselves.
   */
  const mayCreate = can(role, "company.create");

  let grants = null;
  try {
    grants = await getSwitchableCompanies();
  } catch {
    grants = null;
  }

  const choosable = (grants?.companies ?? []).filter((c) => c.isActive);

  /**
   * THIS PAGE NEVER REDIRECTS, AND THAT IS THE WHOLE POINT.
   *
   * It is reached because the token says the reader holds more than one
   * company. The token can be wrong — a grant revoked since it was issued —
   * and the obvious response, `redirect("/dashboard")`, is a LOOP: the proxy
   * reads the same stale claim and sends them straight back here, for ever.
   *
   * So every branch below ends in something to read or something to click. The
   * one-company case renders the chooser with its single entry: clicking it
   * writes `activeCompanyId`, which is exactly the claim the proxy tests, so
   * the loop cannot form and the stale token heals itself.
   */
  if (choosable.length === 0) {
    /**
     * THE PERSON WHO CAN FIX IT GETS THE BUTTON, not the apology.
     *
     * This used to be one message for everybody — "contact your
     * administrator" — which for platform staff is advice to contact
     * themselves. `resolveActingCompany` already knew the difference and said
     * so in its own error text ("No company has been set up yet. Create one
     * under Admin → Companies"); it just said it inside a thrown Error, on an
     * error page, with no link.
     */
    if (mayCreate) {
      return (
        <div className="mx-auto w-full max-w-md py-10">
          <div className="rounded-md border border-border bg-card p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted">
              <Building2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <h1 className="mt-4 text-base font-semibold text-foreground">
              No companies yet
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Nothing has been set up on this platform, or every company has
              been deactivated. Create one and it becomes yours to open.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Button asChild size="sm">
                <Link href="/dashboard/admin/companies/create">
                  <Plus className="h-4 w-4" />
                  Create a company
                </Link>
              </Button>
              <Link
                href="/dashboard/admin/companies"
                className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
              >
                All companies
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto w-full max-w-md py-10">
        <div className="flex items-start gap-3 rounded-md border border-border bg-card p-5">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="space-y-2">
            <h1 className="text-base font-semibold text-foreground">
              No company to open
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Your access has been removed, or every company you belonged to has
              been deactivated. Your administrator can restore it.
            </p>
            <Link
              href="/dashboard/profile"
              className="inline-block text-sm text-foreground underline underline-offset-4"
            >
              Your profile
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <ChooseCompany companies={choosable} />

      {/* Somebody who may create a tenant is usually here to enter one, but
          not always — a SuperAdmin standing up a new client should not have
          to go looking for Admin → Companies. */}
      {mayCreate && (
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-5">
          <Link
            href="/dashboard/admin/companies/create"
            className="inline-flex items-center gap-1.5 text-sm text-foreground underline underline-offset-4"
          >
            <Plus className="h-3.5 w-3.5" />
            Create a company
          </Link>
          <Link
            href="/dashboard/admin/companies"
            className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
          >
            Manage all companies
          </Link>
        </div>
      )}
    </div>
  );
}
