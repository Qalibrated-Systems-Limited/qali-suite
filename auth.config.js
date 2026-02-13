import { NextResponse } from "next/server";

export const authOptions = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard");
      const isOnLogin = nextUrl.pathname.startsWith("/login");

      if (isOnDashboard) {
        if (isLoggedIn) return true;
        return false; // Redirect unauthenticated users to login page
      }

      // Redirect logged-in users away from login page to dashboard
      if (isLoggedIn) {
        return NextResponse.redirect(new URL("/dashboard", nextUrl));
      }

      return true;
    },
    async jwt({ token, user }) {
      const customUser = user;
      if (user) {
        token.role = customUser.role;
        token.id = customUser.id;
        token.companyId = customUser.companyId;
        token.companyCode = customUser.companyCode;
        token.user = customUser;
      }
      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        const customUser = {
          ...session.user,
          role: token.role,
          emailVerified: new Date(),
          id: token.id,
          companyId: token.companyId,
          companyCode: token.companyCode,
        };
        session.user = customUser;
      }
      return session;
    },
  },
  providers: [],
  trustHost: true,
};
