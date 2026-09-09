import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import {
  loadLegacyCompanyIds,
  translateCompanyId,
} from "./legacy-company-id";

/**
 * Tenant Utilities for Multi-Tenancy
 *
 * Core utilities for company-scoped data access.
 * All queries and mutations should use these to prevent data leaks.
 *
 * `getTenantContext()` is wrapped in React's `cache()` so it deduplicates
 * within a single request — every server component, query, and action
 * that calls it shares one `auth()` round-trip per request instead of
 * hammering the session each time. Some dashboard render paths were
 * calling it 40+ times.
 */

/**
 * THE SESSION'S companyId IS A POSTGRES UUID. MONGO DOCUMENTS ARE KEYED BY THE
 * ObjectId THEY WERE WRITTEN WITH.
 *
 * Every helper below scopes a Mongo query by `companyId`, and since companies
 * moved to Postgres (0035) `session.user.companyId` is the uuid. Three of them
 * called `new ObjectId(uuid)`, which throws BSONError; the other two compared
 * a uuid against an ObjectId and quietly matched nothing.
 *
 * IT SURVIVED BECAUSE EVERY HELPER RETURNS EARLY FOR SuperAdmin. Developing
 * and testing as a SuperAdmin, nothing is scoped and nothing breaks. Every
 * other role got a dashboard of zeros — most callers catch and return 0 or []
 * — or a BSONError in the console.
 *
 * The translation lives in `legacy-company-id.js` because these five helpers
 * are NOT the only place it is needed: about 85 call sites across 25 files
 * build the same filter inline instead of calling them, and some are models
 * that must not import `@/auth` to cast an id. Fixing only this file fixed
 * only this file — the dashboard went on throwing from
 * `erp-dashboard-queries.ts`, which has its own copy.
 */
export { translateCompanyId } from "./legacy-company-id";

/**
 * Get tenant context from current session
 * @returns {{ companyId: string|null, companyCode: string|null, isSuperAdmin: boolean, user: object }}
 * @throws Error if no session
 */
export const getTenantContext = cache(async function _getTenantContext() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized: No session");
  }

  const companyId = session.user.companyId || null;
  const companyCode = session.user.companyCode || null;
  // SuperAdmin is a role-based privilege: they have cross-tenant access
  // regardless of whether their user record carries a "home" companyId.
  // The companyId on a SuperAdmin is a UX hint (default dashboard tenant),
  // not a scope restriction.
  const isSuperAdmin = session.user.role === "SuperAdmin";

  // Populate the uuid -> legacy ObjectId map while we are already async. Every
  // caller of the synchronous helpers below awaits this function first.
  await loadLegacyCompanyIds();

  return {
    companyId,
    companyCode,
    isSuperAdmin,
    /**
     * The company this request operates on, when the user has chosen one.
     *
     * Distinct from `companyId`, which is the user's home company: a user may
     * be authorised for several and is on exactly one at a time. The Postgres
     * gate verifies it against their grants before scoping anything to it.
     */
    activeCompanyId: session.user.activeCompanyId || null,
    user: session.user,
  };
});

/**
 * Get tenant context, returns null instead of throwing if no session.
 * Wrapped in cache() so callers can use it freely without extra auth
 * hits. Same per-request scope as getTenantContext.
 */
export const getTenantContextSafe = cache(async function _getTenantContextSafe() {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
});

/*
 * THE MONGOOSE TENANT HELPERS ARE GONE — 0102.
 *
 * `tenantFilter`, `buildTenantMatch`, `withTenantScope`, `withTenantPipeline`,
 * `validateTenantAccess` and `getCompanyIdForCreate` built `$match` filters
 * with a `new ObjectId(...)` companyId. Every one of them had ZERO call sites
 * by the time this ran — two files still IMPORTED `withTenantScope` without
 * ever calling it, which is why a grep for the name looked alive.
 *
 * They are not replaced, because their job no longer exists. Tenant scope is
 * row-level security now: `withTenant()` sets `app.company_id` for the
 * transaction and the policies do the filtering, so a query cannot forget its
 * filter — which is the failure this family of helpers existed to mitigate and
 * could only ever mitigate by being remembered.
 *
 * Their removal is what takes `mongoose` out of this module, and out of every
 * live request path with it.
 */
