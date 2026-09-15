import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

// ============================================
// PROXY (Next.js 16 middleware)
// ============================================
// Layer 1: Authentication — handled by NextAuth's authorized callback (auth.config.js)
// Layer 2: Subscription gating — handled here
// Layer 3: Plan module gating — handled in page layouts and server actions
// ============================================
export default auth((req) => {
  const { nextUrl } = req;
  const user = req.auth?.user as any;

  /**
   * THE PATH, FORWARDED TO THE SERVER COMPONENTS.
   *
   * `app/dashboard/layout.js` has to know which route it is wrapping — the
   * unchosen-company gate below it must not fire on the platform pages, which
   * are deliberately company-less. A layout cannot read its own pathname in
   * the App Router, and the proxy is the one place that has it on every
   * request, so it passes it down as a header rather than each page threading
   * it through props.
   */
  const forwarded = new Headers(req.headers);
  forwarded.set("x-pathname", nextUrl.pathname);
  const pass = () => NextResponse.next({ request: { headers: forwarded } });

  // Not logged in or not on dashboard — NextAuth's authorized callback handles this
  if (!user || !nextUrl.pathname.startsWith("/dashboard")) {
    return pass();
  }

  // ── Subscription expiry enforcement ──
  const status = user.subscriptionStatus;
  const trialEndsAt = user.trialEndsAt;
  const currentPeriodEnd = user.currentPeriodEnd;
  const role = user.role;

  const now = new Date();
  const isExpired =
    status === "expired" ||
    status === "cancelled" ||
    // Trial whose window has passed
    (status === "trial" && trialEndsAt && new Date(trialEndsAt) < now) ||
    // Active subscription whose paid period has lapsed (silent expiry —
    // the auto-expirer flips it to "expired" lazily; until then proxy
    // catches it). Without this, a company can keep operating on a paid
    // plan with stale period dates.
    (status === "active" &&
      currentPeriodEnd &&
      new Date(currentPeriodEnd) < now);

  // Exempt paths: billing (so they can upgrade), expired page, admin
  const isExemptPath =
    nextUrl.pathname.startsWith("/dashboard/company") ||
    nextUrl.pathname.startsWith("/dashboard/subscription-expired") ||
    nextUrl.pathname.startsWith("/dashboard/admin");

  // Note: JWT data may be up to 24h stale (until token expires and user re-logins).
  // The subscription-expired page does a live DB check to handle SuperAdmin trial extensions.
  // This means a user may see the expired redirect briefly until the page's live check redirects them back.
  if (isExpired && role !== "SuperAdmin" && !isExemptPath) {
    return NextResponse.redirect(new URL("/dashboard/subscription-expired", nextUrl));
  }

  /**
   * ── No acting company: stop BEFORE anything renders ─────────────────────
   *
   * Row-level security scopes every read to one company, and
   * `resolveActingCompany` refuses to choose for somebody holding several. The
   * dashboard layout redirects to the chooser when that happens, and that is
   * not early enough: the App Router renders a layout and its page segment
   * CONCURRENTLY, so the page has already run and thrown
   *
   *     Error: No company selected. You have access to 3.
   *       at EditUserPage (app/dashboard/users/[id]/update/page.jsx)
   *
   * before the layout's redirect ends the response. The reader saw the right
   * screen; the server logged a failure on every request, which is how a real
   * failure gets lost. A redirect ends a response — only the middleware runs
   * early enough to end it before the render.
   *
   * DECIDED FROM THE TOKEN, because this runs on the edge and cannot ask
   * Postgres. `companyCount` is refreshed beside the role in auth.ts. A stale
   * count costs one hop: /dashboard/select-company re-reads the grants and
   * bounces straight back when there is nothing to choose. It cannot lock
   * anybody out, which is why a claim is safe to trust for this and not for
   * authorisation — the gate still refuses on every request regardless.
   *
   * The same exemptions the layout keeps: the platform pages are company-less
   * by design, and the chooser cannot redirect to itself.
   */
  const needsCompany =
    !user.activeCompanyId &&
    typeof user.companyCount === "number" &&
    user.companyCount > 1;

  const isCompanyLessPath =
    nextUrl.pathname.startsWith("/dashboard/admin") ||
    nextUrl.pathname.startsWith("/dashboard/select-company") ||
    nextUrl.pathname.startsWith("/dashboard/subscription-expired") ||
    (role === "SuperAdmin" && nextUrl.pathname === "/dashboard");

  if (needsCompany && !isCompanyLessPath) {
    return NextResponse.redirect(new URL("/dashboard/select-company", nextUrl));
  }

  return pass();
});

export const config = {
  // https://nextjs.org/docs/app/api-reference/file-conventions/proxy#matcher
  matcher: ["/((?!api|_next/static|_next/image|.*\\.png$).*)"],
};
