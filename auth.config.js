export const authConfig = {
  pages: {
    signIn: "/",
    signOut: "/",
    error: "/login",
  },
  callbacks: {
    // Authentication only — "is this user logged in?"
    // Authorization (subscription gating, plan checks) lives in proxy.ts
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard");
      const isInvitePage = nextUrl.pathname.startsWith("/invite");

      if (isOnDashboard) {
        if (!isLoggedIn) return false;
        return true;
      }

      if (isInvitePage) return true;

      // The office-only waiting page is for signed-in people who are away;
      // sending them to /dashboard would send them straight back here.
      if (nextUrl.pathname.startsWith("/away")) return isLoggedIn;

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
