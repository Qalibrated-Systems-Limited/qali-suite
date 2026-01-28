export const authOptions = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard");
      if (isOnDashboard) {
        if (isLoggedIn) return true;
        return false; // Redirect unauthenticated users to login page
      } else if (isLoggedIn) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }
      return true;
    },
    async jwt({ token, user }) {
      const customUser = user;
      if (user) {
        token.role = customUser.role;
        token.id = customUser.id;
        token.companyId = customUser.companyId;
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
        };
        session.user = customUser;
      }
      return session;
    },
  },
  providers: [],
  trustHost: true,
};
