import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import User from "./app/models/user";
import Company from "./app/models/Company";
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
};

async function getUser(email: string) {
  try {
    await dbConnect();
    const user = await User.findOne({ email }).select("+password");
    return user;
  } catch (error) {
    console.error("Failed to fetch user:", error);
    throw new Error("Failed to fetch user.");
  }
}

export const { auth, signIn, signOut, handlers } = NextAuth({
  ...authConfig,
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

          // Google OAuth users cannot sign in with credentials
          if (user.authProvider === "google") return null;

          const passwordsMatch = await user.comparePassword(password);

          if (passwordsMatch) {
            let companyCode: string | undefined;
            let companyPlan: string = "free";
            let subscriptionStatus: string = "trial";
            let trialEndsAt: string | null = null;
            let maxUsers: number = 5;
            if (user.companyId) {
              const company = await Company.findById(user.companyId)
                .select("code subscription")
                .lean();
              companyCode = (company as any)?.code;
              const sub = (company as any)?.subscription || {};
              companyPlan = sub.plan || "free";
              subscriptionStatus = sub.status || "trial";
              trialEndsAt = sub.trialEndsAt?.toISOString() || null;
              maxUsers = sub.maxUsers || 5;
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
              maxUsers,
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

    async jwt({ token, user, account, trigger }: any) {
      // Manual refresh trigger from client (useSession().update())
      // Re-reads subscription/plan data from DB so the session reflects
      // a recent plan change without forcing a re-login.
      if (trigger === "update" && token?.companyId) {
        try {
          await dbConnect();
          const company = await Company.findById(token.companyId)
            .select("code subscription")
            .lean();
          if (company) {
            const sub = (company as any).subscription || {};
            token.companyCode = (company as any).code;
            token.companyPlan = sub.plan || "free";
            token.subscriptionStatus = sub.status || "trial";
            token.trialEndsAt = sub.trialEndsAt?.toISOString() || null;
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
        token.maxUsers = user.maxUsers;
        token.planRefreshedAt = Date.now();
        token.user = user;
      }

      // For Google OAuth — fetch user data from DB
      if (user && account?.provider === "google") {
        await dbConnect();
        const dbUser = await User.findOne({
          email: user.email?.toLowerCase(),
        });
        if (dbUser) {
          let companyCode: string | undefined;
          let companyPlan: string = "free";
          let subscriptionStatus: string = "trial";
          let trialEndsAt: string | null = null;
          let maxUsers: number = 5;
          if (dbUser.companyId) {
            const company = await Company.findById(dbUser.companyId)
              .select("code subscription")
              .lean();
            companyCode = (company as any)?.code;
            const sub = (company as any)?.subscription || {};
            companyPlan = sub.plan || "free";
            subscriptionStatus = sub.status || "trial";
            trialEndsAt = sub.trialEndsAt?.toISOString() || null;
            maxUsers = sub.maxUsers || 5;
          }
          token.role = dbUser.role;
          token.id = dbUser._id.toString();
          token.avatar = dbUser.avatar || user.image;
          token.companyId = dbUser.companyId?.toString();
          token.companyCode = companyCode;
          token.companyPlan = companyPlan;
          token.subscriptionStatus = subscriptionStatus;
          token.trialEndsAt = trialEndsAt;
          token.maxUsers = maxUsers;
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
          companyCode: token.companyCode,
          companyPlan: token.companyPlan || "free",
          subscriptionStatus: token.subscriptionStatus || "active",
          trialEndsAt: token.trialEndsAt || null,
          maxUsers: token.maxUsers || 5,
        };
      }
      return session;
    },
  },
});
