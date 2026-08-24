import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";
import {
  findUserForSignIn,
  updateAvatar,
  createUserFromInvite,
  syncUser,
  resolveRoleForCompany,
} from "./app/db/userAdmin";
import { findOpenInviteForEmail, acceptInvite } from "./app/db/inviteAdmin";
import { linkUserToPartyDirect } from "./app/db/userAdmin";

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

/**
 * The sign-in lookup, on Postgres (0043).
 *
 * Privileged, because signing in happens before a company is chosen: there is
 * no app.company_id to scope by, and the users policy would correctly return
 * nothing. Identity is proved by the password, compared below against the hash
 * this returns.
 */
async function getUser(email: string) {
  try {
    return await findUserForSignIn(email);
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
          // Postgres stores this lowercase, with a CHECK — 0036.
          if (user.status !== "active") return null;

          // Note: we used to early-reject `authProvider === "google"`
          // here. Removed because (a) it forced Google-signed-up users
          // to stay locked to Google even from a kiosk PC without their
          // Google account, and (b) comparePassword now safely returns
          // false when no password is set — so the result is the same
          // ("invalid credentials") without leaking the auth method.
          /**
           * A NULL HASH IS NOT AN EMPTY PASSWORD. A Google user never had one
           * (0043), and bcrypt.compare against null would throw. Refusing here
           * returns the same "invalid credentials" as a wrong password, so the
           * response still does not leak which accounts use Google.
           */
          const passwordsMatch = user.passwordHash
            ? await bcrypt.compare(password, user.passwordHash)
            : false;

          if (passwordsMatch) {
            let companyCode: string | undefined;
            let companyPlan: string = "free";
            let subscriptionStatus: string = "trial";
            let trialEndsAt: string | null = null;
            let currentPeriodEnd: string | null = null;
            let maxUsers: number = 5;
            if (user.homeCompanyId) {
              // The company record lives in Postgres since 0035. Loaded here
              // so the session carries the plan the books were actually
              // configured with, not a copy that stopped being updated.
              const { getCompanySubscription } = await import(
                "@/app/db/platform"
              );
              const company = await getCompanySubscription(
                String(user.homeCompanyId),
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
              id: user.id,
              name: user.name,
              role: user.role,
              email: user.email,
              image: user.avatar,
              // The tenant's Postgres uuid now, not a Mongo id.
              // resolveCompanyUuid accepts it directly.
              companyId: user.homeCompanyId ?? undefined,
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
        const email = user.email?.toLowerCase();
        if (!email) return false;

        const existing = await findUserForSignIn(email);

        if (existing) {
          // Deactivated users cannot start a session, by either provider.
          if (existing.status !== "active") return false;

          if (user.image && existing.avatar !== user.image) {
            await updateAvatar(existing.id, user.image);
          }

          /**
           * A pending invitation for someone who already has a login.
           *
           * Read privileged: the person has no tenant context yet, so every
           * policy would correctly return nothing (inviteAdmin.ts).
           */
          const invite = await findOpenInviteForEmail(email);
          if (invite) {
            // Only promote a role that says nothing. The source used the same
            // rule, spelled against roles 0039 retired.
            // Not roleAllowed(): this is not a permission gate. It asks
            // whether the role already says something, and roleAllowed would
            // answer true for a SuperAdmin by design — which is the opposite
            // of what is being decided here.
            const hasRealRole =
              !!existing.role &&
              existing.role !== "Employee" &&
              existing.role !== "Viewer";

            await syncUser({
              id: existing.id,
              role: hasRealRole ? existing.role : invite.role,
              // Only fill a home company if they have none; an existing member
              // of one company does not get moved by being invited to another.
              companyId: existing.homeCompanyId ? undefined : invite.companyId,
            });

            /**
             * The invite names an employee: say which party this login is.
             *
             * On the GRANT, not on the user — a party is company-scoped, so a
             * person who is an employee here and a supplier elsewhere has two
             * party rows (0036). The source wrote Party.userId in Mongo, which
             * has been the wrong store since parties moved.
             */
            if (invite.partyId) {
              await linkUserToPartyDirect({
                userId: existing.id,
                companyId: invite.companyId,
                partyId: invite.partyId,
              });
            }

            // Consume it. The UPDATE carries status='pending' in its WHERE, so
            // a second click matches nothing rather than accepting twice.
            await acceptInvite(invite.id, existing.id);
          }

          return true;
        }

        // No login yet. This is an invite-only system: without one, no account
        // is created and sign-in is refused.
        const invite = await findOpenInviteForEmail(email);
        if (!invite) return false;

        // The id is generated here — there is no Mongo document to mirror, and
        // Postgres is now the first store to know about this person.
        const newUserId = crypto.randomUUID();
        await createUserFromInvite({
          id: newUserId,
          name: user.name ?? email,
          email,
          role: invite.role,
          companyId: invite.companyId,
          authProvider: "google",
          avatar: user.image ?? null,
          invitedById: invite.id,
          invitedByName: invite.invitedByName,
        });

        if (invite.partyId) {
          await linkUserToPartyDirect({
            userId: newUserId,
            companyId: invite.companyId,
            partyId: invite.partyId,
          });
        }

        await acceptInvite(invite.id, newUserId);
        return true;
      }

      // Credentials sign-in also consumes a pending invitation, so an invited
      // person who sets a password is not left with the invite still open.
      if (account?.provider === "credentials" && user?.email) {
        const invite = await findOpenInviteForEmail(user.email.toLowerCase());
        if (invite && user.id) {
          if (invite.partyId) {
            await linkUserToPartyDirect({
              userId: String(user.id),
              companyId: invite.companyId,
              partyId: invite.partyId,
            });
          }
          await acceptInvite(invite.id, String(user.id));
        }
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
          if (ok) {
            token.activeCompanyId = String(requested);
            // THE ROLE FOLLOWS THE COMPANY. It is per-membership since 0064, so
            // somebody who is an Accountant here and a Store Manager there must
            // not carry the first role into the second company's nav.
            const { resolveRoleForCompany } = await import(
              "@/app/db/userAdmin"
            );
            const role = await resolveRoleForCompany(
              String(token.id),
              String(requested),
            );
            if (role) {
              token.role = role;
              if (token.user) token.user = { ...token.user, role };
            }
          }
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
        // Except the role, which is per-company since 0064. `authorize` read
        // the identity's global role; the session needs the one held in the
        // company being entered.
        token.role = user.role;
        try {
          const { resolveRoleForCompany } = await import("@/app/db/userAdmin");
          const scoped = await resolveRoleForCompany(
            String(user.id),
            user.companyId ? String(user.companyId) : null,
          );
          if (scoped) token.role = scoped;
        } catch {
          // The global role is the documented fallback; keep it.
        }
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
        // The scoped role, not `user.role` — `session.user.role` is read from
        // here by every nav gate.
        token.user = { ...user, role: token.role };
      }

      // For Google OAuth — read the login back, now from Postgres. The signIn
      // callback has just created it or updated it, so this sees the role the
      // invitation granted rather than what Google sent.
      if (user && account?.provider === "google") {
        const dbUser = await findUserForSignIn(String(user.email ?? "").toLowerCase());
        if (dbUser) {
          let companyCode: string | undefined;
          let companyPlan: string = "free";
          let subscriptionStatus: string = "trial";
          let trialEndsAt: string | null = null;
          let currentPeriodEnd: string | null = null;
          let maxUsers: number = 5;
          if (dbUser.homeCompanyId) {
            const { getCompanySubscription } = await import("@/app/db/platform");
            const company = await getCompanySubscription(
              String(dbUser.homeCompanyId),
            );
            companyCode = company?.code ?? undefined;
            const sub = company?.subscription;
            companyPlan = sub?.plan || "free";
            subscriptionStatus = sub?.status || "trial";
            trialEndsAt = sub?.trialEndsAt?.toISOString() || null;
            currentPeriodEnd = sub?.currentPeriodEnd?.toISOString() || null;
            maxUsers = sub?.maxUsers ?? 5;
          }
          // Per-company since 0064, same as the credentials path above.
          token.role =
            (await resolveRoleForCompany(
              dbUser.id,
              dbUser.homeCompanyId ?? null,
            ).catch(() => null)) ?? dbUser.role;
          token.id = dbUser.id;
          token.avatar = dbUser.avatar || user.image;
          token.companyId = dbUser.homeCompanyId ?? undefined;
          token.companyCode = companyCode;
          token.companyPlan = companyPlan;
          token.subscriptionStatus = subscriptionStatus;
          token.trialEndsAt = trialEndsAt;
          token.currentPeriodEnd = currentPeriodEnd;
          token.maxUsers = maxUsers;
          token.tokenVersion = dbUser.tokenVersion ?? 0;
          token.planRefreshedAt = Date.now();
          token.user = {
            id: dbUser.id,
            name: dbUser.name,
            role: token.role,
            email: dbUser.email,
            image: dbUser.avatar || user.image,
            companyId: dbUser.homeCompanyId ?? undefined,
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
