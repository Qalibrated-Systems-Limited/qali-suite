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

/**
 * How long a role change may take to reach an existing session.
 *
 * A minute: short enough that a demotion is effectively immediate, long enough
 * that this is one indexed read per user per minute rather than per request.
 */
const ROLE_REFRESH_MS = 60_000;

/**
 * The refresh has to be throttled HERE, not on the token.
 *
 * `roleRefreshedAt` on the JWT would be the obvious place, and it is what the
 * first version of this used. It does not work: a Server Component cannot set
 * cookies, so a token mutated during an RSC render is never written back — the
 * stamp resets to 0 on the next request and the "once a minute" read becomes
 * once per `auth()` call, several times per page.
 *
 * So the throttle is an in-process map, which is the same trade
 * `companyUuidCache` in app/db/tenant.ts makes and for the same reason: it is
 * per-instance, rebuilt on cold start, and needs no invalidation because the
 * TTL is the invalidation. A second server instance simply does its own read.
 *
 * The stamp still goes on the token as well, for the paths that CAN persist it
 * (a sign-in, a session update) — it just cannot be relied on alone.
 */
const roleRefreshCache = new Map<string, number>();

function dueForRefresh(userId: string, tokenStamp: unknown) {
  const now = Date.now();
  const last = Math.max(Number(tokenStamp ?? 0), roleRefreshCache.get(userId) ?? 0);
  if (now - last <= ROLE_REFRESH_MS) return false;
  roleRefreshCache.set(userId, now);
  // Unbounded growth is the one failure mode worth guarding: a long-lived
  // instance serving many tenants would otherwise hold a row per user for ever.
  if (roleRefreshCache.size > 10_000) roleRefreshCache.clear();
  return true;
}

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
            // Present from the first switch even if this token predates the
            // claim, so the middleware is never deciding on `undefined`.
            if (typeof token.companyCount !== "number") {
              const { countUsableCompanies } = await import("@/app/db/userAdmin");
              token.companyCount = await countUsableCompanies(String(token.id));
            }
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

      /**
       * PERIODIC RE-READ — role, status and token version.
       *
       * REPORTED: "changed user roles but they are still able to fetch pages."
       * `token.role` was written at sign-in and never again, and the session
       * lives eight hours, so a demotion did not reach `session.user.role` —
       * which is what every nav gate and page guard reads. `adminUpdateUser`
       * bumps `token_version` precisely to kill those sessions, but the only
       * thing that compares it (`requireFreshSession`) is called from two
       * legacy Mongo action files and from nothing on the Postgres path. So
       * the revocation was written and never read.
       *
       * The note that used to sit here said periodic refresh was removed
       * because "edge runtime can't reliably connect to MongoDB". That reason
       * expired with 0036: logins are Postgres, this callback already runs
       * `resolveRoleForCompany` and `findUserForSignIn` against it above, and
       * the middleware keeps its own edge-safe config in auth.config.js.
       *
       * Server ACTIONS were never exposed by this — `withAuthorizedTenant`
       * re-checks the allow-list against the grant's role, so a demoted user
       * could not mutate anything. It is page and nav access that trusted the
       * stale claim, which is exactly what was reported.
       *
       * FAILS OPEN ON A DB ERROR, deliberately. A transient outage must not
       * sign the whole company out; the eight-hour maxAge is still the
       * backstop. Anything the database actually answers is enforced.
       */
      if (token?.id && !user) {
        if (dueForRefresh(String(token.id), token.roleRefreshedAt)) {
          try {
            const {
              getUserStatusAndVersion,
              resolveRoleForCompany,
              countUsableCompanies,
            } = await import("@/app/db/userAdmin");

            const dbUser = await getUserStatusAndVersion(String(token.id));

            // Deleted, deactivated, or revoked since this token was issued.
            // Returning null ends the session on this request.
            if (!dbUser) return null;
            if (dbUser.status !== "active") return null;
            if (
              typeof token.tokenVersion === "number" &&
              token.tokenVersion !== (dbUser.tokenVersion ?? 0)
            ) {
              return null;
            }

            // The role FOR THE COMPANY BEING OPERATED ON — the active company
            // when one has been switched to, otherwise the home company. The
            // same resolution `withAuthorizedTenant` performs, so the page
            // gates and the data gates cannot disagree.
            const scoped = await resolveRoleForCompany(
              String(token.id),
              (token.activeCompanyId ?? token.companyId) ?? null,
            );
            if (scoped && scoped !== token.role) {
              token.role = scoped;
              if (token.user) token.user = { ...token.user, role: scoped };
            }
            /**
             * HOW MANY COMPANIES THIS PERSON MAY ENTER, for proxy.ts.
             *
             * The middleware is the only place that can stop a page rendering,
             * and it cannot ask Postgres. Refreshed here, beside the role, on
             * the same cadence and in the same try — a grant added or revoked
             * shows up within one refresh, and a stale value costs a single
             * hop through /dashboard/select-company, never a lock-out.
             */
            token.companyCount = await countUsableCompanies(String(token.id));
            token.roleRefreshedAt = Date.now();
          } catch {
            // Leave the token as it is and try again on the next request.
          }
        }
      }

      // Note: PLAN data is still set at login only. When SuperAdmin changes a
      // company's plan, the user picks it up on their next sign-in or via
      // useSession().update(). For instant effect use checkPlanAccess() in
      // plan-gate.js.

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
          companyCount: token.companyCount ?? null,
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
