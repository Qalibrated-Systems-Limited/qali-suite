import { NextResponse } from "next/server";

export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard");
      const isInvitePage = nextUrl.pathname.startsWith("/invite");

      if (isOnDashboard) {
        if (isLoggedIn) return true;
        return false; // Redirect unauthenticated users to login page
      }

      // Allow invite pages for everyone (don't redirect logged-in users)
      if (isInvitePage) return true;

      // Redirect logged-in users away from login page to dashboard
      if (isLoggedIn) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }

      return true;
    },
    // jwt and session callbacks are defined in auth.ts to support Google OAuth
  },
  providers: [],
  trustHost: true,
};
