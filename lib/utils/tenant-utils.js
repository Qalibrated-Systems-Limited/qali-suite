import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import mongoose from "mongoose";
const ObjectId = mongoose.Types.ObjectId;

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

  return {
    companyId,
    companyCode,
    isSuperAdmin,
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

/**
 * Build base tenant filter for queries (Mongoose `find()` / `count*`).
 * SuperAdmin: returns {} (sees all data).
 * Regular user: returns { companyId } — Mongoose auto-casts the value
 * to ObjectId via the schema for find/count/update operations.
 *
 * For aggregation `$match` stages, use `tenantMatch()` instead — the
 * aggregation framework does NOT auto-cast, so a raw string companyId
 * silently bypasses the (companyId, ...) compound indexes.
 *
 * @param {string} companyId - Company ID from context
 * @param {boolean} isSuperAdmin - Whether user is SuperAdmin
 * @returns {object} Filter object
 */
export function tenantFilter(companyId, isSuperAdmin) {
  if (isSuperAdmin) return {};
  if (!companyId) {
    throw new Error("companyId required for non-SuperAdmin user");
  }
  return { companyId };
}

/**
 * Build tenant match clause for aggregation `$match` stages.
 *
 * Identical to tenantFilter() except the companyId is cast to ObjectId
 * up front. Aggregations don't auto-cast based on the schema, so without
 * this cast the planner can't use the (companyId, ...) compound indexes
 * and falls back to a COLLSCAN.
 *
 * Use this everywhere you'd write
 *   `const tenantMatch = isSuperAdmin ? {} : { companyId };`
 * before piping the value into an aggregation.
 *
 * @param {string} companyId - Company ID from context
 * @param {boolean} isSuperAdmin - Whether user is SuperAdmin
 * @returns {object} `$match`-ready filter with ObjectId-cast companyId
 */
export function buildTenantMatch(companyId, isSuperAdmin) {
  if (isSuperAdmin) return {};
  if (!companyId) {
    throw new Error("companyId required for non-SuperAdmin user");
  }
  return { companyId: new ObjectId(companyId) };
}

/**
 * Merge user query with tenant filter
 * Ensures all queries are scoped to the user's company
 *
 * @param {object} query - User's query filter
 * @param {string} companyId - Company ID from context
 * @param {boolean} isSuperAdmin - Whether user is SuperAdmin
 * @returns {object} Merged query with tenant scope
 */
export function withTenantScope(query, companyId, isSuperAdmin) {
  if (isSuperAdmin) return query;
  if (!companyId) {
    throw new Error("companyId required for non-SuperAdmin user");
  }
  return { ...query, companyId: new ObjectId(companyId) };
}

/**
 * Validate that a document belongs to the user's tenant
 * Use before updates/deletes to prevent cross-tenant access
 *
 * @param {object} document - Document to validate
 * @param {string} companyId - Company ID from context
 * @param {boolean} isSuperAdmin - Whether user is SuperAdmin
 * @returns {boolean} True if access is allowed
 */
export function validateTenantAccess(document, companyId, isSuperAdmin) {
  if (isSuperAdmin) return true;
  if (!document?.companyId) return false;
  const docCompanyId =
    typeof document.companyId === "object"
      ? document.companyId.toString()
      : document.companyId;
  return docCompanyId === companyId;
}

/**
 * Helper to get companyId for creating new documents
 * Returns the user's companyId, or throws if SuperAdmin without explicit companyId
 *
 * @param {string} explicitCompanyId - Optional explicit companyId (for SuperAdmin)
 * @param {string} userCompanyId - User's companyId from context
 * @param {boolean} isSuperAdmin - Whether user is SuperAdmin
 * @returns {string} CompanyId to use for the document
 */
export function getCompanyIdForCreate(
  explicitCompanyId,
  userCompanyId,
  isSuperAdmin,
) {
  if (explicitCompanyId) return explicitCompanyId;
  if (isSuperAdmin) {
    throw new Error(
      "SuperAdmin must specify companyId when creating documents",
    );
  }
  if (!userCompanyId) {
    throw new Error("User must have companyId to create documents");
  }
  return userCompanyId;
}

/**
 * Prepend tenant match stage to aggregation pipeline
 *
 * @param {Array} pipeline - Aggregation pipeline
 * @param {string} companyId - Company ID from context
 * @param {boolean} isSuperAdmin - Whether user is SuperAdmin
 * @returns {Array} Pipeline with tenant match prepended
 */
export function withTenantPipeline(pipeline, companyId, isSuperAdmin) {
  if (isSuperAdmin) return pipeline;
  if (!companyId) {
    throw new Error("companyId required for non-SuperAdmin user");
  }
  // Cast to ObjectId — aggregation $match does NOT auto-cast, so a raw
  // string companyId here would bypass the (companyId, ...) compound
  // indexes and force a COLLSCAN (same reason buildTenantMatch casts).
  return [{ $match: { companyId: new ObjectId(companyId) } }, ...pipeline];
}
