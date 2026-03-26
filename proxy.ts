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

  // Not logged in or not on dashboard — NextAuth's authorized callback handles this
  if (!user || !nextUrl.pathname.startsWith("/dashboard")) {
    return NextResponse.next();
  }

  // ── Subscription expiry enforcement ──
  const status = user.subscriptionStatus;
  const trialEndsAt = user.trialEndsAt;
  const role = user.role;

  const isExpired =
    status === "expired" ||
    status === "cancelled" ||
    (status === "trial" && trialEndsAt && new Date(trialEndsAt) < new Date());

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

  return NextResponse.next();
});

export const config = {
  // https://nextjs.org/docs/app/api-reference/file-conventions/proxy#matcher
  matcher: ["/((?!api|_next/static|_next/image|.*\\.png$).*)"],
};
