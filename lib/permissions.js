// ============================================
// FIELD-LEVEL PERMISSIONS
// ============================================
// Single source of truth for who can see / edit sensitive inventory fields.
// Used by both server actions (authoritative) and UI components (redaction).
//
// Industry-standard SoD: Storekeeper has physical custody only — they
// receive, count, and issue stock but should never see cost prices,
// selling prices, margins, or markups. That information lives with
// commercial / finance roles.

// Roles authorized to SEE pricing fields (cost, selling, margin, markup,
// inventory value, wholesale, minimum). Anyone not on this list gets a
// redacted view.
const PRICING_VIEW_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
  "Sales Manager",
  "Procurement Officer",
  "Manager",
  "Store Manager", // Store managers oversee margins on the store level
]);

// Roles authorized to EDIT pricing (markup, selling price, minimum floor).
// Stricter than view — Accountant / Procurement / Store Manager can see but
// shouldn't unilaterally change retail pricing.
const PRICING_EDIT_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Sales Manager",
]);

// Roles authorized to override pricing safety guards (below cost, below
// minimum floor). Reserved for senior finance.
const PRICING_OVERRIDE_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
]);

// Roles authorized to see margin / markup percentages specifically. Even
// some non-edit roles benefit from seeing margins for reporting (e.g.,
// Accountant) — keep this list slightly broader than EDIT.
const MARGIN_VIEW_ROLES = PRICING_VIEW_ROLES;

/**
 * Can the user see cost / selling / wholesale / minimum prices and the
 * inventory value (qty × cost)?
 *
 * Storekeeper, Employee, Viewer → false.
 * Everyone else → true.
 */
export function canSeePricing(role) {
  return role ? PRICING_VIEW_ROLES.has(role) : false;
}

/**
 * Can the user edit selling price / markup / minimum floor?
 */
export function canEditPricing(role) {
  return role ? PRICING_EDIT_ROLES.has(role) : false;
}

/**
 * ── PRODUCT MASTER AUTHORITY ────────────────────────────────────────────────
 *
 * Moved here from app/mongodb/actions/stock-actions.js during the Postgres
 * port. It defined its own DEFAULT_PRODUCT_ROLES, COST_ROLES and PRICE_ROLES
 * inline, and PRICE_ROLES had already drifted from PRICING_EDIT_ROLES above:
 * it included Manager, the UI gate did not. The form therefore never rendered
 * a price field for a Manager, so the server's intent to allow them was
 * unreachable — two definitions of one rule, and the stricter one silently
 * won. There is one now, and it is the one the UI was already enforcing.
 */

/**
 * Who may create or edit the product master at all. Store Manager included so
 * they can register items they handle; what they may put in the COST and PRICE
 * fields is gated separately below, which is the standard ERP split.
 */
const PRODUCT_WRITE_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Manager",
  "Store Manager",
]);

/**
 * Who may set purchase COST. It reaches COGS and the general ledger through
 * opening balances and landed cost, so it is a finance/procurement decision.
 *
 * Sales Manager is deliberately absent: the same person must not set both the
 * cost a margin is measured from and the price that realises it.
 */
const COST_SETTER_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Procurement Officer",
]);

/** Can the user create or edit products at all? */
export function canWriteProducts(role) {
  return role ? PRODUCT_WRITE_ROLES.has(role) || role === "SuperAdmin" : false;
}

/** Can the user set a product's purchase cost? */
export function canSetProductCost(role) {
  return role ? COST_SETTER_ROLES.has(role) || role === "SuperAdmin" : false;
}

/**
 * Can the user override safety guards (sell below cost, below floor)?
 */
export function canOverridePricing(role) {
  return role ? PRICING_OVERRIDE_ROLES.has(role) : false;
}

/**
 * Can the user see margin% / markup% values? Same as pricing-view by
 * default; kept as a separate hook in case we want to widen later.
 */
export function canSeeMargins(role) {
  return role ? MARGIN_VIEW_ROLES.has(role) : false;
}

// ============================================
// NAVIGATION-LEVEL PERMISSIONS
// ============================================
// One permission group per nav cluster. Used by the sidebar instead of
// inline role lists so the role taxonomy lives in ONE place. Adding a new
// role only touches this file.
//
// Convention: SuperAdmin sees everything; Admin sees almost everything;
// Manager sees most ops + reports; Accountant sees finance / tax / reports;
// CFO sees finance / approvals / reports + override; Finance Manager same
// as Accountant + approval authority; Sales Manager sees sales + pricing;
// Procurement sees purchases / inventory; Store Manager sees inventory +
// purchases (in/out); Storekeeper sees inventory only (no money); HR sees
// HR only; Employee sees their own tray; Viewer reads across the business.

const all = (...roles) => new Set(roles);

const NAV_CAN_SEE_INVENTORY = all(
  "SuperAdmin",
  "Admin",
  "Viewer",
  "Manager",
  "Accountant",
  "CFO",
  "Finance Manager",
  "Sales Manager",
  "Procurement Officer",
  "Store Manager",
  "Storekeeper",
);

// Sales / commercial workflow — quotes, invoices, customer mgmt
const NAV_CAN_SEE_SALES = all(
  "SuperAdmin",
  "Admin",
  "Viewer",
  "Manager",
  "Accountant",
  "CFO",
  "Finance Manager",
  "Sales Manager",
);

const NAV_CAN_SEE_PURCHASES = all(
  "SuperAdmin",
  "Admin",
  "Viewer",
  "Manager",
  "Accountant",
  "CFO",
  "Finance Manager",
  "Procurement Officer",
  "Store Manager",
);

const NAV_CAN_SEE_FINANCE = all(
  "SuperAdmin",
  "Admin",
  "Viewer",
  "Accountant",
  "CFO",
  "Finance Manager",
);

const NAV_CAN_SEE_TAX = NAV_CAN_SEE_FINANCE;

const NAV_CAN_SEE_REPORTS = all(
  "SuperAdmin",
  "Admin",
  "Viewer",
  "Manager",
  "Accountant",
  "CFO",
  "Finance Manager",
  "Sales Manager", // sales reports for their own KPIs
);

const NAV_CAN_SEE_PROJECTS = all(
  "SuperAdmin",
  "Admin",
  "Viewer",
  "Manager",
  "Accountant",
  "CFO",
  "Finance Manager",
);

// Claims (employee reimbursement). Everyone can submit "My claims";
// only finance roles see the "All claims" admin views. Caller decides which.
const NAV_CAN_REVIEW_CLAIMS = all(
  "SuperAdmin",
  "Admin",
  "Accountant",
  "CFO",
  "Finance Manager",
);

// No Viewer here. CEO used to sit in this set and CEO became Viewer (0039),
// but "read-only across the business" should not mean reading everyone's
// salary — HR data is the one place where a general read role is too wide.
const NAV_CAN_SEE_HR = all("SuperAdmin", "Admin", "HR Manager", "Manager");

// Approvals queue — high-tier roles that decide on flagged transactions
// (price changes, write-offs, large bills, etc.).
const NAV_CAN_SEE_APPROVALS = all(
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Manager",
  "Store Manager",
  "Sales Manager",
);

// Settings / company config — admin-only by default.
const NAV_CAN_SEE_SETTINGS = all("SuperAdmin", "Admin", "CFO", "Accountant");

const has = (set, role) =>
  role ? set.has(role) || role === "SuperAdmin" : false;

export const canSeeInventoryNav = (role) => has(NAV_CAN_SEE_INVENTORY, role);
export const canSeeSalesNav = (role) => has(NAV_CAN_SEE_SALES, role);
export const canSeePurchasesNav = (role) => has(NAV_CAN_SEE_PURCHASES, role);
export const canSeeFinanceNav = (role) => has(NAV_CAN_SEE_FINANCE, role);
export const canSeeTaxNav = (role) => has(NAV_CAN_SEE_TAX, role);
export const canSeeReportsNav = (role) => has(NAV_CAN_SEE_REPORTS, role);
export const canSeeProjectsNav = (role) => has(NAV_CAN_SEE_PROJECTS, role);
export const canReviewClaims = (role) => has(NAV_CAN_REVIEW_CLAIMS, role);
export const canSeeHRNav = (role) => has(NAV_CAN_SEE_HR, role);
export const canSeeApprovalsNav = (role) => has(NAV_CAN_SEE_APPROVALS, role);
export const canSeeSettingsNav = (role) => has(NAV_CAN_SEE_SETTINGS, role);

/**
 * General-purpose role gate — use this anywhere you'd otherwise write
 *   `if (!["Admin", "Accountant"].includes(user.role)) redirect(...)`
 *
 * Auto-grants SuperAdmin without forcing every call site to remember to
 * include it. Same semantics as the internal `has()` helper but takes a
 * plain array so it's drop-in for inline allowlists.
 *
 * @example
 *   // Bad — silently excludes SuperAdmin:
 *   if (!["Admin", "HR Manager"].includes(user.role)) redirect("/dashboard");
 *
 *   // Good — SuperAdmin always allowed:
 *   if (!roleAllowed(user.role, ["Admin", "HR Manager"])) redirect("/dashboard");
 *
 *   // Even better — central named helper if the gate is shared:
 *   if (!canSeeHRNav(user.role)) redirect("/dashboard");
 *
 * The third form is preferred for any gate that also appears in the
 * sidebar — keeps page and sidebar in sync automatically.
 *
 * @param {string|undefined} role - user role from session
 * @param {string[]} allowList - roles explicitly allowed
 * @returns {boolean}
 */
export const roleAllowed = (role, allowList) => {
  if (!role) return false;
  if (role === "SuperAdmin") return true;
  return Array.isArray(allowList) && allowList.includes(role);
};

// ============================================
// DASHBOARD ROUTING
// ============================================
// Maps each role to its dashboard component name. Keeping it data-driven
// (vs a switch statement) makes adding a role a one-line change.
export const DASHBOARD_FOR_ROLE = {
  SuperAdmin: "SuperAdminDashboard",
  Admin: "AdminDashboard",
  CFO: "CFODashboard",
  "Finance Manager": "CFODashboard",
  Accountant: "AccountantDashboard",
  "Sales Manager": "SalesManagerDashboard",
  "Procurement Officer": "ProcurementDashboard",
  Manager: "AdminDashboard",
  "Store Manager": "StoreManagerDashboard",
  Storekeeper: "StorekeeperDashboard",
  "HR Manager": "HRDashboard",
  Employee: "EmployeeDashboard",
  // CEO retired into Viewer (0039), and the executive dashboard is the read
  // -across-the-business view, which is exactly what Viewer means.
  Viewer: "ExecutiveDashboard",
};
