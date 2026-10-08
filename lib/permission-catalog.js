// ============================================
// PERMISSION CATALOG — the audit, as data
// ============================================
//
// Roles and permissions in this app live in code, not a table: the canonical
// role list is `userRoles` (lib/utils.js), and authority is a set of frozen
// role arrays in lib/utils/role-gates.js plus the navigation/field predicates
// in lib/permissions.js. That is the right place for them — a gate that is a
// constant cannot be edited into an insecure state at runtime.
//
// What was missing was a place to SEE all of it at once. This module reads the
// same constants the server enforces and turns them into a matrix: every
// permission, every role, and who holds what. Because it imports the live
// constants rather than restating them, the System Settings page it feeds can
// never disagree with what the code actually does — the one failure mode a
// hand-maintained permissions doc always eventually hits.

import * as gates from "@/lib/utils/role-gates";
import * as nav from "@/lib/permissions";
import { userRoles, userRolesMapping } from "@/lib/utils";

/** The canonical roles, with their one-line descriptions, in seniority order. */
export const ROLES = userRoles.map((value) => {
  const m = userRolesMapping.find((r) => r.value === value);
  const [, desc] = (m?.label ?? value).split(" - ");
  return { value, description: desc ?? "" };
});

const ROLE_SET = new Set(userRoles);

/**
 * Human metadata for each exported role-gate constant. The key is the export
 * name in role-gates.js; a gate with no entry here still shows, under "Other",
 * with a humanised name — so a newly added gate is surfaced automatically, it
 * just reads better once it gets a line here.
 */
const GATE_META = {
  // Platform & administration
  ADMIN_ROLES: ["Administration", "Full administrative access", "The universal escalation — always passes a role check."],
  LICENSING_WRITE_ROLES: ["Administration", "Manage customer licenses", "Issue, renew and revoke product license keys."],
  APPROVAL_CONFIG_ROLES: ["Administration", "Configure approvals", "Set approval thresholds and who-approves-what."],
  INTERCOMPANY_WRITE_ROLES: ["Administration", "Inter-company", "Sister-company contracts, fees and eliminations."],

  // Finance
  FINANCE_WRITE_ROLES: ["Finance", "Finance write", "Invoices, payments, credit notes, the chart of accounts."],
  FINANCE_APPROVE_ROLES: ["Finance", "Finance approve", "Sign off credit notes, bill payments, write-offs."],
  INVOICE_WRITE_ROLES: ["Finance", "Invoice write", "Raise and edit customer invoices (sales + finance side)."],
  PERIOD_CLOSE_ROLES: ["Finance", "Close fiscal periods", "Close and lock accounting periods."],
  TAX_VIEW_ROLES: ["Finance", "View tax", "Read returns and filing status (read-only)."],
  PETTY_CASH_CUSTODIAN_ROLES: ["Finance", "Petty cash — custody", "Run a petty-cash float."],
  PETTY_CASH_APPROVER_ROLES: ["Finance", "Petty cash — approve", "Sign off petty-cash replenishment."],
  EXPENSE_CREATE_ROLES: ["Finance", "Expenses — record", "Book an expense (incl. own, for Manager/Employee)."],
  EXPENSE_PAY_ROLES: ["Finance", "Expenses — pay", "Pay a recorded expense."],
  EXPENSE_VOID_ROLES: ["Finance", "Expenses — void", "Reverse a posted expense."],
  EXPENSE_DELETE_ROLES: ["Finance", "Expenses — delete draft", "Delete an unposted expense draft."],
  CLAIM_APPROVE_ROLES: ["Finance", "Claims — approve", "Approve an employee advance or reimbursement."],
  CLAIM_PAY_ROLES: ["Finance", "Claims — pay", "Pay, settle and record cash back on a claim."],

  // Sales & pricing
  PRICING_EDIT_ROLES: ["Sales & Pricing", "Edit pricing", "Submit a selling-price / markup change."],
  PRICING_OVERRIDE_ROLES: ["Sales & Pricing", "Override pricing", "Change price without raising an approval."],
  SHOP_WRITE_ROLES: ["Sales & Pricing", "Online shop", "Storefront listings and orders."],
  BID_WRITE_ROLES: ["Sales & Pricing", "Bids & pre-sales", "Tenders and the pre-sales pipeline."],
  PARTY_MANAGE_ROLES: ["Sales & Pricing", "Customers & suppliers", "Create and edit parties."],

  // Inventory & procurement
  INVENTORY_WRITE_ROLES: ["Inventory & Procurement", "Inventory write", "Receipts, transfers and adjustments."],
  STOCK_REQUEST_APPROVE_ROLES: ["Inventory & Procurement", "Stock requests — approve", "Approve a stock requisition."],
  CATEGORY_MANAGE_ROLES: ["Inventory & Procurement", "Manage categories", "Product hierarchy and accounting categories."],
  PROCUREMENT_ROLES: ["Inventory & Procurement", "Procurement", "Bills, purchase orders, vendor management."],
  BILL_WRITE_ROLES: ["Inventory & Procurement", "Bills — write", "Create, submit and edit supplier bills."],
  BILL_APPROVE_ROLES: ["Inventory & Procurement", "Bills — approve", "Approve a bill (posts to the ledger, admits stock)."],
  GRN_RECEIVE_ROLES: ["Inventory & Procurement", "Goods receipt — receive", "Receive stock against an order."],
  GRN_ACCEPT_SALES_ROLES: ["Inventory & Procurement", "Goods receipt — sales sign-off", "Sales-side acceptance of a receipt."],
  GRN_ACCEPT_FINANCE_ROLES: ["Inventory & Procurement", "Goods receipt — finance sign-off", "Finance-side acceptance of a receipt."],
  GRN_REJECT_ROLES: ["Inventory & Procurement", "Goods receipt — reject", "Reject a submitted receipt or void a draft."],

  // Assets & fleet
  ASSET_WRITE_ROLES: ["Assets & Fleet", "Assets — write", "Register an asset and post depreciation."],
  ASSET_TRANSFER_ROLES: ["Assets & Fleet", "Assets — transfer", "Move an asset between locations / custodians."],
  ASSET_DISPOSE_ROLES: ["Assets & Fleet", "Assets — dispose", "Dispose of an asset (books a gain or loss)."],
  ASSET_USAGE_ROLES: ["Assets & Fleet", "Assets — usage", "Record an asset's odometer / usage."],
  FLEET_WRITE_ROLES: ["Assets & Fleet", "Fleet", "Vehicles, trips and maintenance."],

  // Projects & technical
  PROJECT_MANAGE_ROLES: ["Projects & Technical", "Projects — manage", "Create and edit projects, build budgets."],
  PROJECT_LOG_SIGNOFF_ROLES: ["Projects & Technical", "Projects — sign off", "Countersign instructions and diary entries."],
  WORKFLOW_REPORT_WRITE_ROLES: ["Projects & Technical", "Workflow reports — write", "Draft and submit workflow reports."],
  WORKFLOW_REPORT_SIGNOFF_ROLES: ["Projects & Technical", "Workflow reports — sign off", "Review and approve a report."],
  TECHNICAL_WRITE_ROLES: ["Projects & Technical", "Technical", "Calibration (17025) and inspection (17020) work."],
  EXECUTIVE_VIEW_ROLES: ["Projects & Technical", "Executive overview", "Read the executive / portfolio snapshot."],

  // Quality, compliance & safety
  QMS_WRITE_ROLES: ["Quality, Compliance & Safety", "Quality (QMS)", "Non-conformances, CAPA, internal audit."],
  SOP_WRITE_ROLES: ["Quality, Compliance & Safety", "SOP library", "Author and review controlled documents."],
  COMPLIANCE_WRITE_ROLES: ["Quality, Compliance & Safety", "Compliance", "Certificates and statutory obligations."],
  NCR_RAISE_ROLES: ["Quality, Compliance & Safety", "Nonconformance — raise", "Log a discrepancy."],
  NCR_PROPOSE_ROLES: ["Quality, Compliance & Safety", "Nonconformance — propose", "Propose a disposition."],
  NCR_AUTHORIZE_ROLES: ["Quality, Compliance & Safety", "Nonconformance — authorise", "Authorise a disposition (MD-level)."],
  HSE_WRITE_ROLES: ["Quality, Compliance & Safety", "HSE", "Incidents, RAMS, PPE, toolbox talks, training."],

  // Cross-department & people
  HELPDESK_WRITE_ROLES: ["Cross-department & People", "Help desk", "Raise, assign, escalate and close tickets."],
  TASK_WRITE_ROLES: ["Cross-department & People", "Tasks", "Create and assign work across departments."],
  HR_VIEW_ROLES: ["Cross-department & People", "HR — view", "Read the staff list, org chart, records."],
  HR_WRITE_ROLES: ["Cross-department & People", "HR — write", "Hire, edit, upload documents."],
  HR_ADMIN_ROLES: ["Cross-department & People", "HR — admin", "Terminate, edit entitlements, manage the calendar."],
  HR_COMPENSATION_ROLES: ["Cross-department & People", "HR — compensation", "Run payroll (posts to the ledger)."],
};

const humanize = (name) =>
  name
    .replace(/_ROLES$/, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

/**
 * Every exported role-gate array, as a matrix row.
 *
 * SuperAdmin is granted everywhere by the `roleAllowed` / `has` helpers even
 * where a gate array omits it, so the matrix marks it held for every
 * permission — showing what the code actually enforces, not just what each
 * array literally lists.
 */
export const PERMISSION_GROUPS = Object.entries(gates)
  .filter(([, value]) => Array.isArray(value))
  .map(([name, roles]) => {
    const [module, label, description] = GATE_META[name] ?? [
      "Other",
      humanize(name),
      "",
    ];
    const held = new Set(roles);
    return {
      key: name,
      module,
      label,
      description,
      roles: userRoles.filter((r) => r === "SuperAdmin" || held.has(r)),
    };
  });

/** The nav / field-level predicates in lib/permissions.js, evaluated per role. */
const NAV_PREDICATES = [
  ["Navigation", "See Inventory", nav.canSeeInventoryNav],
  ["Navigation", "See Sales", nav.canSeeSalesNav],
  ["Navigation", "See Purchases", nav.canSeePurchasesNav],
  ["Navigation", "See Finance", nav.canSeeFinanceNav],
  ["Navigation", "See Tax", nav.canSeeTaxNav],
  ["Navigation", "See Reports", nav.canSeeReportsNav],
  ["Navigation", "See Projects", nav.canSeeProjectsNav],
  ["Navigation", "See HR", nav.canSeeHRNav],
  ["Navigation", "See Approvals", nav.canSeeApprovalsNav],
  ["Navigation", "See Settings", nav.canSeeSettingsNav],
  ["Navigation", "Review claims", nav.canReviewClaims],
  ["Field access", "See pricing & cost", nav.canSeePricing],
  ["Field access", "Edit pricing", nav.canEditPricing],
  ["Field access", "Override pricing", nav.canOverridePricing],
  ["Field access", "See margins", nav.canSeeMargins],
  ["Field access", "Write products", nav.canWriteProducts],
  ["Field access", "Set product cost", nav.canSetProductCost],
];

export const NAV_PERMISSIONS = NAV_PREDICATES.map(([module, label, fn]) => ({
  key: label,
  module,
  label,
  description: "",
  roles: userRoles.filter((r) => fn(r)),
}));

/** Everything, grouped by module, for rendering. */
export function permissionsByModule() {
  const all = [...PERMISSION_GROUPS, ...NAV_PERMISSIONS];
  const map = new Map();
  for (const p of all) {
    if (!map.has(p.module)) map.set(p.module, []);
    map.get(p.module).push(p);
  }
  return [...map.entries()].map(([module, permissions]) => ({
    module,
    permissions,
  }));
}

/**
 * AUDIT FINDING — roles referenced by a gate that are NOT in the canonical
 * `userRoles`. "Quality Manager" and "Technical Manager" appear in the QMS, SOP
 * and Compliance write gates but cannot be assigned to a user, so those gates
 * grant nobody through those names today. Surfaced so it is a decision (add the
 * roles, or map them to existing ones) rather than a silent dead grant.
 */
export const NON_CANONICAL_ROLES = (() => {
  const seen = new Map(); // role -> Set(gate keys)
  for (const [name, value] of Object.entries(gates)) {
    if (!Array.isArray(value)) continue;
    for (const r of value) {
      if (ROLE_SET.has(r)) continue;
      if (!seen.has(r)) seen.set(r, new Set());
      seen.get(r).add(GATE_META[name]?.[1] ?? humanize(name));
    }
  }
  return [...seen.entries()].map(([role, gateSet]) => ({
    role,
    gates: [...gateSet],
  }));
})();

/**
 * Every permission as one flat list — the selectable catalog (0121). Each has a
 * stable `key` used to store an assignment: the gate's export name for a module
 * permission, the label for a nav/field one (both unique).
 */
export const ALL_PERMISSIONS = [...PERMISSION_GROUPS, ...NAV_PERMISSIONS].map(
  (p) => ({ key: p.key, module: p.module, label: p.label, description: p.description }),
);

const KEY_SET = new Set(ALL_PERMISSIONS.map((p) => p.key));

/** Is this a real permission key? Guards writes against stale/typo'd keys. */
export function isPermissionKey(key) {
  return KEY_SET.has(key);
}

/** The permission keys a role holds by CODE DEFAULT (before any DB override). */
export function defaultKeysForRole(role) {
  if (!role) return [];
  // p.roles is already computed WITH SuperAdmin, so a plain membership test is
  // correct here — this is not a gate, so roleAllowed would double-count.
  return [...PERMISSION_GROUPS, ...NAV_PERMISSIONS]
    .filter((p) => p.roles.includes(role)) // eslint-disable-line local/no-role-includes
    .map((p) => p.key);
}

/** A per-role summary: how many permissions each role holds. */
export function roleSummary() {
  const all = [...PERMISSION_GROUPS, ...NAV_PERMISSIONS];
  return ROLES.map((role) => ({
    ...role,
    count: all.filter((p) => p.roles.includes(role.value)).length,
    total: all.length,
  }));
}
