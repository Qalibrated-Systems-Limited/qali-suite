import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { getSwitchableCompanies } from "@/app/db/actions/company-switch-actions";
import { ChooseCompany } from "@/components/choose-company";

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
    </div>
  );
}
