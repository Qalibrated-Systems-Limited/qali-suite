// ============================================
// CANONICAL ROLE GROUPS
// ============================================
// Centralised role groupings for permission gates. Use these in actions /
// pages instead of hand-rolled `["Admin", "Accountant"]` lists. Adding a
// new role to a group here updates every gate that uses the group.
//
// Source of truth for the canonical role list: lib/utils.js → userRoles
// Source of truth for approval authority: app/models/approvalRequest.js → APPROVER_MATRIX
// ============================================

// Universal escalation — always passes role checks. Mostly redundant
// because most gates already include both, but exposed as a constant so
// future authorization layers (e.g. MFA-required) can reference it.
export const ADMIN_ROLES = Object.freeze(["SuperAdmin", "Admin"]);

// Finance-write authority: invoices, payments, credit notes, fiscal periods,
// chart of accounts, etc. Anyone here can sign off finance-side mutations.
export const FINANCE_WRITE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
]);

// Finance-approve authority — narrower than write. CFO/Finance Manager
// approve credit notes, bill payments, large discounts, write-offs.
// Mirrors the approval matrix in approvalRequest.js.
// Invoice creation/editing — sales-side and finance-side writers. One
// source of truth; the previous inline ["SuperAdmin","Admin","Accountant"]
// on the invoice pages locked out CFO, Finance Manager and Sales Manager.
export const INVOICE_WRITE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
  "Sales Manager",
]);

export const FINANCE_APPROVE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
]);

// Manage-categories: dual-purpose taxonomy (product hierarchy + accounting),
// so both finance leadership and operations leadership are eligible.
export const CATEGORY_MANAGE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Manager",
  "Store Manager",
]);

// Inventory write — physical custody movements (receipts, transfers,
// adjustments). Procurement and Stockroom roles, not Finance.
export const INVENTORY_WRITE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "Manager",
  "Store Manager",
  "Storekeeper",
  "Procurement Officer",
]);

// Pricing override — who can change selling prices without an approval
// request being raised. Mirrors stock-actions.js PRICING_OVERRIDE_ROLES.
export const PRICING_OVERRIDE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
]);

// Pricing edit — who can SUBMIT a pricing change (via approval if not in
// PRICING_OVERRIDE_ROLES). Includes the sales side.
export const PRICING_EDIT_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Sales Manager",
]);

// Procurement — bills, POs, vendor management.
export const PROCUREMENT_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Manager",
  "Procurement Officer",
]);

// Party (customers + suppliers) management.
export const PARTY_MANAGE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Sales Manager",
  "Procurement Officer",
  "Accountant",
]);

// Stock requests — approver list. Managers approve their teams'
// requisitions; SuperAdmin and Admin override.
export const STOCK_REQUEST_APPROVE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "Manager",
  "Store Manager",
]);

// Project create/edit. CFO included because they approve project budgets.
export const PROJECT_MANAGE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Manager",
  "Accountant",
]);

// Fiscal period close/lock — strictly Finance leadership.
export const PERIOD_CLOSE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
]);

// Approval-engine config (thresholds, who-approves-what).
export const APPROVAL_CONFIG_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
]);

// Predicate helper — `hasRole(user, ROLES)` is more readable than
// `ROLES.includes(user?.role)` at every call site.
export function hasRole(user, allowedRoles) {
  if (!user?.role) return false;
  return allowedRoles.includes(user.role);
}
