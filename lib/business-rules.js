/**
 * Business rules — single source of truth.
 *
 * Domain predicates and approver matrices that previously lived in
 * multiple files (the approvals page AND the dashboard tile query, the
 * dashboard low-stock alert AND the stocks page filter, etc.) and kept
 * drifting apart. Every consumer should import from here so that
 * changing a rule is a one-line edit.
 *
 * Rules of thumb:
 * - This module has zero runtime dependencies on Mongo, auth, or React.
 *   It exports plain values and pure functions only.
 * - Anything that needs the database (e.g. tenant scoping) wraps these
 *   predicates at the query layer.
 */

// ============================================
// APPROVER MATRICES
// ============================================
// Each Set lists the roles that can DECIDE on the corresponding
// document type. Mirrors the per-domain server actions that enforce
// the same gates — sidebar/page/query/action should ALL use these sets,
// not their own inline copies.

export const STOCK_REQUEST_APPROVER_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "Manager",
  "Store Manager",
]);

export const BILL_APPROVER_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Manager",
]);

export const LEAVE_APPROVER_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "Manager",
  "HR",
]);

export const LOAN_APPROVER_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "HR",
  "CFO",
  "Finance Manager",
]);

export const CLAIM_APPROVER_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
  "Manager",
]);

export const NCR_AUTHORIZER_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
]);

export const OPERATING_EXPENSE_APPROVER_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
  "Manager",
]);

/**
 * Convenience helpers — accept a role string, return a boolean.
 * Use these in pages/components when the call site reads more naturally
 * as a predicate than as a Set membership test.
 */
export const canApproveStockRequest = (role) =>
  STOCK_REQUEST_APPROVER_ROLES.has(role);
export const canApproveBill = (role) => BILL_APPROVER_ROLES.has(role);
export const canApproveLeave = (role) => LEAVE_APPROVER_ROLES.has(role);
export const canApproveLoan = (role) => LOAN_APPROVER_ROLES.has(role);
export const canApproveClaim = (role) => CLAIM_APPROVER_ROLES.has(role);
export const canAuthorizeNCR = (role) => NCR_AUTHORIZER_ROLES.has(role);
export const canApproveOperatingExpense = (role) =>
  OPERATING_EXPENSE_APPROVER_ROLES.has(role);

// ============================================
// STOCK LEVEL PREDICATES
// ============================================
// Industry-standard definition: a product is "low stock" when it's
// active, has at least one unit on hand, has a reorder level configured,
// and the on-hand quantity is at or below that reorder level.
//
// "Out of stock" = qty ≤ 0 (separate tier, regardless of reorder level).
//
// Both the dashboard alert and the stocks-page filter must agree on
// this definition — when they diverged, dashboard showed 4 while the
// list showed 1. Now both use these helpers.

/**
 * Match clause for use inside Product `find()` / aggregate `$match`.
 * Combines field selectors with `$expr` for the cross-field comparison.
 *
 * Note: pair with the index
 *   `(companyId, status, inventory.reorderLevel, inventory.quantityOnHand)`
 * on the Product schema for fast filtering.
 */
export const LOW_STOCK_MATCH = {
  status: "active",
  "inventory.quantityOnHand": { $gt: 0 },
  "inventory.reorderLevel": { $gt: 0 },
  $expr: {
    $lte: ["$inventory.quantityOnHand", "$inventory.reorderLevel"],
  },
};

/**
 * Aggregation-friendly expression that returns 1 when the current doc
 * satisfies the low-stock predicate, 0 otherwise. Use inside `$sum` /
 * `$cond` blocks where `LOW_STOCK_MATCH` (with `$expr`) can't be
 * composed because the surrounding stage is already a `$group`.
 */
export const lowStockCondExpr = (qty = "$inventory.quantityOnHand", reorder = "$inventory.reorderLevel") => ({
  $and: [
    { $eq: ["$status", "active"] },
    { $gt: [{ $ifNull: [qty, 0] }, 0] },
    { $gt: [{ $ifNull: [reorder, 0] }, 0] },
    { $lte: [{ $ifNull: [qty, 0] }, { $ifNull: [reorder, 0] }] },
  ],
});

/**
 * In-stock = active, has stock, AND either has no reorder level set
 * or is above it.
 */
export const inStockCondExpr = (qty = "$inventory.quantityOnHand", reorder = "$inventory.reorderLevel") => ({
  $and: [
    { $eq: ["$status", "active"] },
    { $gt: [{ $ifNull: [qty, 0] }, 0] },
    {
      $or: [
        { $lte: [{ $ifNull: [reorder, 0] }, 0] },
        { $gt: [{ $ifNull: [qty, 0] }, { $ifNull: [reorder, 0] }] },
      ],
    },
  ],
});

/**
 * Out of stock = qty ≤ 0. Independent of `status` so that a soft-
 * disabled SKU that's still flagged "out" surfaces correctly.
 */
export const outOfStockCondExpr = (qty = "$inventory.quantityOnHand") => ({
  $lte: [{ $ifNull: [qty, 0] }, 0],
});

/**
 * In-stock match clause (mirror of LOW_STOCK_MATCH for filter callers).
 */
export const IN_STOCK_MATCH = {
  status: "active",
  "inventory.quantityOnHand": { $gt: 0 },
  $expr: {
    $or: [
      { $lte: [{ $ifNull: ["$inventory.reorderLevel", 0] }, 0] },
      {
        $gt: [
          { $ifNull: ["$inventory.quantityOnHand", 0] },
          { $ifNull: ["$inventory.reorderLevel", 0] },
        ],
      },
    ],
  },
};

/**
 * Out of stock match clause.
 */
export const OUT_OF_STOCK_MATCH = {
  "inventory.quantityOnHand": { $lte: 0 },
};
