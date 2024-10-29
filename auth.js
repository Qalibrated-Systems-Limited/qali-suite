import { compare } from "bcrypt";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import User from "./app/models/user";
import { authOptions } from "./auth.config";
import dbConnect from "./app/config/dbConnect";
async function getUser(email) {
  try {
    dbConnect();
    const user = await User.findOne({ email }).select("+password");

    return user;
  } catch (error) {
    console.error("Failed to fetch user:", error);
    throw new Error("Failed to fetch user.");
  }
}
export const { auth, signIn, signOut } = NextAuth({
  ...authOptions,
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const user = await getUser(email);
          if (!user) return null;
          const passwordsMatch = await user.comparePassword(password);

          if (passwordsMatch)
            return {
              ...user,
              id: user._id.toString(),
              name: user.name,
              role: user.role,
            };
        }
        return null;
      },
    }),
  ],
});
