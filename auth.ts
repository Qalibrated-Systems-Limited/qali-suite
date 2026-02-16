import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import User from "./app/models/user";
import Company from "./app/models/Company";
import Invite from "./app/models/invite";
import { authOptions } from "./auth.config";
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
  ...authOptions,
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
            if (user.companyId) {
              const company = await Company.findById(user.companyId)
                .select("code")
                .lean();
              companyCode = (company as any)?.code;
            }
            return {
              id: user._id.toString(),
              name: user.name,
              role: user.role,
              email: user.email,
              image: user.avatar,
              companyId: user.companyId?.toString(),
              companyCode,
            } as UserType;
          }
        }
        return null;
      },
    }),
  ],
  callbacks: {
    ...authOptions.callbacks,
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
        await User.create({
          name: user.name,
          email,
          avatar: user.image,
          role: invite.role,
          companyId: invite.companyId,
          authProvider: "google",
          creator: invite.invitedBy,
        });

        // Mark invite as accepted
        invite.status = "accepted";
        invite.acceptedAt = new Date();
        await invite.save();

        return true;
      }

      return true; // Credentials provider is handled by authorize()
    },

    async jwt({ token, user, account }: any) {
      // For credentials login — user object has all the data we need
      if (user && account?.provider === "credentials") {
        token.role = user.role;
        token.id = user.id;
        token.avatar = user.image;
        token.companyId = user.companyId;
        token.companyCode = user.companyCode;
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
          if (dbUser.companyId) {
            const company = await Company.findById(dbUser.companyId)
              .select("code")
              .lean();
            companyCode = (company as any)?.code;
          }
          token.role = dbUser.role;
          token.id = dbUser._id.toString();
          token.avatar = dbUser.avatar || user.image;
          token.companyId = dbUser.companyId?.toString();
          token.companyCode = companyCode;
          token.user = {
            id: dbUser._id.toString(),
            name: dbUser.name,
            role: dbUser.role,
            email: dbUser.email,
            image: dbUser.avatar || user.image,
            companyId: dbUser.companyId?.toString(),
            companyCode,
          };
        }
      }

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
        };
      }
      return session;
    },
  },
});
