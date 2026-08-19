import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import User from "./app/models/user";
import Invite from "./app/models/invite";
import { authConfig } from "./auth.config";
import dbConnect from "./app/config/dbConnect";

type UserType = {
  id: string;
  name: string;
  role: string;
  email: string;
  avatar?: string;
  companyId?: string;
  companyCode?: string;
  tokenVersion?: number;
};

async function getUser(email: string) {
  try {
    await dbConnect();
    // `tokenVersion` is `select: false` on the schema; explicitly pull
    // it so we can mint the JWT with the current version stamp.
    const user = await User.findOne({ email }).select(
      "+password +tokenVersion",
    );
    return user;
  } catch (error) {
    console.error("Failed to fetch user:", error);
    throw new Error("Failed to fetch user.");
  }
}

export const { auth, signIn, signOut, handlers, unstable_update } = NextAuth({
  ...authConfig,
  // Session lifetime (was NextAuth's 30-day default).
  // - maxAge: absolute upper bound. 8h matches a typical work session,
  //   so role / status changes by an admin take effect within at most
  //   8h even without active revocation. Combined with the tokenVersion
  //   check below, effective stale window drops to "next privileged
  //   request" (seconds) — the audit-grade behaviour.
  // - updateAge: how often NextAuth re-issues the session cookie when
  //   the user is active. 1h gives a rolling 8h window without
  //   over-issuing cookies.
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
    updateAge: 60 * 60,
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const user = await getUser(email);
          if (!user) return null;

          // Deactivated users cannot start a new session. (The Google
          // OAuth path also enforces this in the signIn callback.)
          if (user.status === "Inactive") return null;

          // Note: we used to early-reject `authProvider === "google"`
          // here. Removed because (a) it forced Google-signed-up users
          // to stay locked to Google even from a kiosk PC without their
          // Google account, and (b) comparePassword now safely returns
          // false when no password is set — so the result is the same
          // ("invalid credentials") without leaking the auth method.
          const passwordsMatch = await user.comparePassword(password);

          if (passwordsMatch) {
            let companyCode: string | undefined;
            let companyPlan: string = "free";
            let subscriptionStatus: string = "trial";
            let trialEndsAt: string | null = null;
            let currentPeriodEnd: string | null = null;
            let maxUsers: number = 5;
            if (user.companyId) {
              // The company record lives in Postgres since 0035. Loaded here
              // so the session carries the plan the books were actually
              // configured with, not a copy that stopped being updated.
              const { getCompanySubscription } = await import(
                "@/app/db/platform"
              );
              const company = await getCompanySubscription(
                String(user.companyId),
              );
              companyCode = company?.code ?? undefined;
              const sub = company?.subscription;
              companyPlan = sub?.plan || "free";
              subscriptionStatus = sub?.status || "trial";
              trialEndsAt = sub?.trialEndsAt?.toISOString() || null;
              currentPeriodEnd = sub?.currentPeriodEnd?.toISOString() || null;
              maxUsers = sub?.maxUsers ?? 5;
            }
            return {
              id: user._id.toString(),
              name: user.name,
              role: user.role,
              email: user.email,
              image: user.avatar,
              companyId: user.companyId?.toString(),
              companyCode,
              companyPlan,
              subscriptionStatus,
              trialEndsAt,
              currentPeriodEnd,
              maxUsers,
              tokenVersion: user.tokenVersion ?? 0,
            } as UserType;
          }
        }
        return null;
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        await dbConnect();

        const email = user.email?.toLowerCase();
        if (!email) return false;

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
          // Check user status
          if (existingUser.status === "Inactive") return false;

          // Update avatar if changed
          if (user.image && existingUser.avatar !== user.image) {
            existingUser.avatar = user.image;
            await existingUser.save();
          }

          // Check for pending invites — apply role and link employee profile
          const pendingInvite = await Invite.findOne({
            email,
            status: "pending",
            expiresAt: { $gt: new Date() },
          });

          if (pendingInvite) {
            // Only set role if user doesn't already have a meaningful one
            const hasExistingRole = existingUser.role && existingUser.role !== "User" && existingUser.role !== "Viewer";
            if (!hasExistingRole) existingUser.role = pendingInvite.role;
            if (!existingUser.companyId && pendingInvite.companyId) existingUser.companyId = pendingInvite.companyId;
            await existingUser.save();

            // Link employee profile if this is an employee invite
            if (pendingInvite.partyId) {
              const Party = (await import("@/app/models/parties")).default;
              const EmployeeProfile = (await import("@/app/models/employeeProfile")).default;
              await Promise.all([
                Party.findByIdAndUpdate(pendingInvite.partyId, { userId: existingUser._id }),
                EmployeeProfile.findOneAndUpdate(
                  { partyId: pendingInvite.partyId },
                  { userId: existingUser._id },
                ),
              ]);
            }

            // Mark all pending invites for this email as accepted
            await Invite.updateMany(
              { email, status: "pending" },
              { $set: { status: "accepted", acceptedAt: new Date() } },
            );
          }

          return true;
        }

        // No existing user — check for a pending invite
        const invite = await Invite.findOne({
          email,
          status: "pending",
          expiresAt: { $gt: new Date() },
        });

        if (!invite) {
          // No invite = deny sign-in (invite-only system)
          return false;
        }

        // Create new user from Google profile + invite data
        const newUser = await User.create({
          name: user.name,
          email,
          avatar: user.image,
          role: invite.role,
          companyId: invite.companyId,
          authProvider: "google",
          creator: invite.invitedBy,
        });

        // Link to employee profile if this is an employee invite
        if (invite.partyId) {
          const Party = (await import("@/app/models/parties")).default;
          const EmployeeProfile = (await import("@/app/models/employeeProfile")).default;
          await Promise.all([
            Party.findByIdAndUpdate(invite.partyId, { userId: newUser._id }),
            EmployeeProfile.findOneAndUpdate(
              { partyId: invite.partyId },
              { userId: newUser._id },
            ),
          ]);
        }

        // Mark invite as accepted
        invite.status = "accepted";
        invite.acceptedAt = new Date();
        await invite.save();

        return true;
      }

      // Credentials provider — mark any pending invites as accepted
      if (account?.provider === "credentials" && user?.email) {
        await dbConnect();
        await Invite.updateMany(
          { email: user.email.toLowerCase(), status: "pending" },
          { $set: { status: "accepted", acceptedAt: new Date() } },
        );
      }

      return true;
    },

    async jwt({ token, user, account, trigger, session }: any) {
      // Manual refresh trigger from client (useSession().update())
      // Re-reads subscription/plan data from DB so the session reflects
      // a recent plan change without forcing a re-login.
      // Switching the active company. Validated against the user's grants
      // before it is written, so a crafted update cannot select a company the
      // user does not hold — the Postgres gate re-checks too, but the token
      // should not carry a claim that was never true.
      if (trigger === "update" && session?.activeCompanyId !== undefined) {
        const requested = session.activeCompanyId;
        if (requested === null) {
          token.activeCompanyId = null;
          return token;
        }
        try {
          const { assertUserMayEnterCompany } = await import(
            "@/lib/company-switch"
          );
          const ok = await assertUserMayEnterCompany(
            String(token.id),
            String(requested),
          );
          if (ok) token.activeCompanyId = String(requested);
        } catch {
          // Leave the token unchanged rather than granting on an error.
        }
        return token;
      }

      if (trigger === "update" && token?.companyId) {
        try {
          const { getCompanySubscription } = await import("@/app/db/platform");
          const company = await getCompanySubscription(String(token.companyId));
          if (company) {
            const sub = company.subscription;
            token.companyCode = company.code;
            token.companyPlan = sub.plan || "free";
            token.subscriptionStatus = sub.status || "trial";
            token.trialEndsAt = sub.trialEndsAt?.toISOString() || null;
            token.currentPeriodEnd =
              sub.currentPeriodEnd?.toISOString() || null;
            token.maxUsers = sub.maxUsers ?? 2;
            token.planRefreshedAt = Date.now();
          }
        } catch {
          // If DB unreachable in edge runtime, leave token unchanged
        }
        return token;
      }


      // For credentials login — user object has all the data we need
      if (user && account?.provider === "credentials") {
        token.role = user.role;
        token.id = user.id;
        token.avatar = user.image;
        token.companyId = user.companyId;
        token.companyCode = user.companyCode;
        token.companyPlan = user.companyPlan;
        token.subscriptionStatus = user.subscriptionStatus;
        token.trialEndsAt = user.trialEndsAt;
        token.currentPeriodEnd = user.currentPeriodEnd;
        token.maxUsers = user.maxUsers;
        token.tokenVersion = user.tokenVersion ?? 0;
        token.planRefreshedAt = Date.now();
        token.user = user;
      }

      // For Google OAuth — fetch user data from DB
      if (user && account?.provider === "google") {
        await dbConnect();
        const dbUser = await User.findOne({
          email: user.email?.toLowerCase(),
        }).select("+tokenVersion");
        if (dbUser) {
          let companyCode: string | undefined;
          let companyPlan: string = "free";
          let subscriptionStatus: string = "trial";
          let trialEndsAt: string | null = null;
          let currentPeriodEnd: string | null = null;
          let maxUsers: number = 5;
          if (dbUser.companyId) {
            const { getCompanySubscription } = await import("@/app/db/platform");
            const company = await getCompanySubscription(
              String(dbUser.companyId),
            );
            companyCode = company?.code ?? undefined;
            const sub = company?.subscription;
            companyPlan = sub?.plan || "free";
            subscriptionStatus = sub?.status || "trial";
            trialEndsAt = sub?.trialEndsAt?.toISOString() || null;
            currentPeriodEnd = sub?.currentPeriodEnd?.toISOString() || null;
            maxUsers = sub?.maxUsers ?? 5;
          }
          token.role = dbUser.role;
          token.id = dbUser._id.toString();
          token.avatar = dbUser.avatar || user.image;
          token.companyId = dbUser.companyId?.toString();
          token.companyCode = companyCode;
          token.companyPlan = companyPlan;
          token.subscriptionStatus = subscriptionStatus;
          token.trialEndsAt = trialEndsAt;
          token.currentPeriodEnd = currentPeriodEnd;
          token.maxUsers = maxUsers;
          token.tokenVersion = (dbUser as any).tokenVersion ?? 0;
          token.planRefreshedAt = Date.now();
          token.user = {
            id: dbUser._id.toString(),
            name: dbUser.name,
            role: dbUser.role,
            email: dbUser.email,
            image: dbUser.avatar || user.image,
            companyId: dbUser.companyId?.toString(),
            companyCode,
            companyPlan,
          };
        }
      }

      // Note: Periodic DB refresh removed — edge runtime can't reliably
      // connect to MongoDB. Plan data is set at login. When SuperAdmin
      // changes a company's plan, the user must re-login to pick it up.
      // For instant effect, use the server-side checkPlanAccess() in
      // plan-gate.js which reads the session (set at login time).

      return token;
    },

    async session({ session, token }: any) {
      if (session?.user) {
        session.user = {
          ...session.user,
          role: token.role,
          emailVerified: new Date(),
          id: token.id,
          avatar: token.avatar,
          companyId: token.companyId,
          /** The company being operated on; distinct from the home company. */
          activeCompanyId: token.activeCompanyId ?? null,
          companyCode: token.companyCode,
          companyPlan: token.companyPlan || "free",
          subscriptionStatus: token.subscriptionStatus || "active",
          trialEndsAt: token.trialEndsAt || null,
          currentPeriodEnd: token.currentPeriodEnd || null,
          maxUsers: token.maxUsers || 5,
          // Carried through so the freshness check (requireFreshSession)
          // can compare against the User document's current value.
          tokenVersion: token.tokenVersion ?? 0,
        };
      }
      return session;
    },
  },
});
