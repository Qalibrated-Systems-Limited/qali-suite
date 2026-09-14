/**
 * WHAT EACH ROLE MAY DO — the index, and the only enumeration of it.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * Three bugs in one week had the same shape: a page admitting a role that the
 * action behind it refused.
 *
 *   * Manager was routed to AdminDashboard by DASHBOARD_FOR_ROLE, and its
 *     finance tab called an action gated on INVOICE_WRITE_ROLES, which has no
 *     Manager in it. Every Manager got the error page on login.
 *
 *   * Settings → Payroll listed HR Manager in its own ALLOWED array and set
 *     canEdit = true, while CONFIG_ROLES — which guarded the page's only
 *     loader — did not. HR could not read the page, let alone save it.
 *
 *   * The sidebar defined hasMod() and the modules added from another branch
 *     never called it, so gated features showed for everybody.
 *
 * None of those was caused by hardcoding. All three were caused by the SAME
 * PERMISSION BEING WRITTEN DOWN TWICE and the two copies drifting. At the
 * time of writing there were 47 exported lists in role-gates.js, 23 more
 * declared privately inside action files, and 6 declared inside page files —
 * including four separate copies of the KPI manage list, one per page.
 *
 * Moving the lists into a database would not have prevented a single one of
 * them; it would have made two database-driven lists disagree instead, where
 * neither grep nor the type checker can see them. The fix for duplication is
 * one definition, not a different storage medium.
 *
 * ── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 * A capability is a named thing a person can do: "invoice.write",
 * "payroll.rates.write", "fiscal.close". This file maps every one of them to
 * the roles that hold it, and it is the ONLY place that enumeration exists.
 *
 * A page asks `can(role, "payroll.rates.write")`. The action behind it gates
 * on `rolesFor("payroll.rates.write")`. They cannot disagree, because there is
 * nothing for them to disagree about — and `tests/capabilities.test.mjs`
 * checks the pairs that matter, so a new page that invents its own array
 * fails the build rather than a user's morning.
 *
 * ── WHERE THE ROLES THEMSELVES LIVE ────────────────────────────────────────
 *
 * The long-standing lists stay in `lib/utils/role-gates.js`, with the
 * reasoning that was written alongside each one — why GRN acceptance splits
 * sales from finance, why reopening a fiscal period excludes the Accountant
 * who may close it. That reasoning is the valuable part and it is not moved.
 * This file indexes those arrays by capability name and declares the ones that
 * previously had nowhere better to live than the top of an action file.
 *
 * ── PURE MODULE ────────────────────────────────────────────────────────────
 *
 * No database, no session, no server-only imports — the same contract
 * `lib/plans.js` keeps, so the sidebar, a server component and a server action
 * can all ask the same question. Making the map DATA later (a table, an admin
 * screen) is then a change to where `can()` reads from and nothing else, which
 * is the order those two jobs have to be done in.
 */

import * as gates from "@/lib/utils/role-gates";

/**
 * Roles that exist. Mirrors the `user_role` CHECK in the schema.
 *
 * Here so the test can assert that no capability names a role that cannot be
 * held — a typo in a role string is a silent denial, and a silent denial is
 * the failure mode that took three bugs to notice.
 */
export const ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
  "Manager",
  "Sales Manager",
  "Store Manager",
  "Storekeeper",
  "Procurement Officer",
  "HR Manager",
  "Employee",
  "Viewer",
]);

/**
 * The KPI manage list, which existed in FIVE places: kpi-actions.ts and four
 * separate page files, each with its own copy. One of them is now this.
 */
const KPI_MANAGE = ["SuperAdmin", "Admin", "Manager", "CFO", "HR Manager"];

export const CAPABILITIES = Object.freeze({
  // ── Platform and administration ──────────────────────────────────────────
  "admin.manage": gates.ADMIN_ROLES,
  "integration.manage": ["SuperAdmin", "Admin"],

  // ── Sales and receivables ────────────────────────────────────────────────
  "invoice.write": gates.INVOICE_WRITE_ROLES,
  "quote.write": gates.INVOICE_WRITE_ROLES,
  "salesorder.write": [
    "SuperAdmin", "Admin", "CFO", "Finance Manager",
    "Sales Manager", "Manager", "Accountant",
  ],
  "statement.send": [
    "Admin", "CFO", "Finance Manager", "Accountant", "Manager", "Sales Manager",
  ],
  "crm.write": ["SuperAdmin", "Admin", "CFO", "Sales Manager", "Manager", "Accountant"],
  "party.manage": gates.PARTY_MANAGE_ROLES,

  // ── Purchases and payables ───────────────────────────────────────────────
  "procurement.write": gates.PROCUREMENT_ROLES,
  "bill.write": gates.BILL_WRITE_ROLES,
  "bill.approve": gates.BILL_APPROVE_ROLES,
  "grn.receive": gates.GRN_RECEIVE_ROLES,
  "grn.accept_sales": gates.GRN_ACCEPT_SALES_ROLES,
  "grn.accept_finance": gates.GRN_ACCEPT_FINANCE_ROLES,
  "grn.reject": gates.GRN_REJECT_ROLES,
  "ncr.raise": gates.NCR_RAISE_ROLES,
  "ncr.propose": gates.NCR_PROPOSE_ROLES,
  "ncr.authorize": gates.NCR_AUTHORIZE_ROLES,

  // ── Finance and the ledger ───────────────────────────────────────────────
  "finance.write": gates.FINANCE_WRITE_ROLES,
  "finance.approve": gates.FINANCE_APPROVE_ROLES,
  "bank.reconcile": ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"],
  "fiscal.manage": ["Admin", "CFO", "Finance Manager", "Accountant"],
  "fiscal.reopen": ["Admin", "CFO", "Finance Manager"],
  "fiscal.lock": ["Admin", "CFO"],
  "period.close": gates.PERIOD_CLOSE_ROLES,
  "tax.view": gates.TAX_VIEW_ROLES,

  // ── Expenses, claims and petty cash ──────────────────────────────────────
  "expense.create": gates.EXPENSE_CREATE_ROLES,
  "expense.pay": gates.EXPENSE_PAY_ROLES,
  "expense.delete": gates.EXPENSE_DELETE_ROLES,
  "expense.void": gates.EXPENSE_VOID_ROLES,
  "claim.approve": gates.CLAIM_APPROVE_ROLES,
  "claim.pay": gates.CLAIM_PAY_ROLES,
  "pettycash.custody": gates.PETTY_CASH_CUSTODIAN_ROLES,
  "pettycash.approve": gates.PETTY_CASH_APPROVER_ROLES,

  // ── Inventory ────────────────────────────────────────────────────────────
  "inventory.write": gates.INVENTORY_WRITE_ROLES,
  "category.manage": gates.CATEGORY_MANAGE_ROLES,
  "pricing.edit": gates.PRICING_EDIT_ROLES,
  "pricing.override": gates.PRICING_OVERRIDE_ROLES,
  "adjustment.create": ["Admin", "Manager", "Store Manager", "Storekeeper", "Accountant"],
  "stockcount.count": ["Admin", "Manager", "Store Manager", "Storekeeper", "Accountant"],
  "stockcount.post": ["SuperAdmin", "Admin", "Manager", "Store Manager", "Accountant"],
  "stockrequest.approve": gates.STOCK_REQUEST_APPROVE_ROLES,
  // Same membership as approving today, named apart so they can diverge
  // without somebody having to notice that two lists were one.
  "stockrequest.cancel": gates.STOCK_REQUEST_APPROVE_ROLES,
  // Fulfilment is the store's, and narrower — no Manager.
  "stockrequest.fulfil": ["SuperAdmin", "Admin", "Store Manager"],

  // ── Assets ───────────────────────────────────────────────────────────────
  /**
   * `asset.admin` and `asset.manage` are NOT the same list, and they were both
   * called ADMIN_ROLES — one in assets/page.jsx, one in assets/[id]/page.jsx,
   * sibling files, different memberships. The register page let an Accountant
   * act; the detail page did not. Naming them apart is the point.
   */
  "asset.view": [
    "SuperAdmin", "Admin", "Viewer", "CFO", "Finance Manager",
    "Accountant", "Manager",
  ],
  "asset.admin": ["SuperAdmin", "Admin"],
  "asset.manage": ["SuperAdmin", "Admin", "Accountant"],
  "asset.depreciate": ["SuperAdmin", "Admin", "Accountant"],
  "asset.write": gates.ASSET_WRITE_ROLES,
  "asset.dispose": gates.ASSET_DISPOSE_ROLES,
  "asset.transfer": gates.ASSET_TRANSFER_ROLES,
  /**
   * The asset DETAIL page carried two more inline arrays, each ending in
   * `|| role === "SuperAdmin"` after a list that already began with it — the
   * sort of belt-and-braces that accumulates when a rule has no name. Named,
   * they are two ordinary capabilities.
   */
  "asset.transfer_local": ["SuperAdmin", "Admin", "Accountant", "Manager"],
  "asset.impair": ["SuperAdmin", "Admin", "Accountant"],
  "asset.usage": gates.ASSET_USAGE_ROLES,

  // ── People ───────────────────────────────────────────────────────────────
  "hr.view": gates.HR_VIEW_ROLES,
  "hr.write": gates.HR_WRITE_ROLES,
  "hr.admin": gates.HR_ADMIN_ROLES,
  "hr.compensation": gates.HR_COMPENSATION_ROLES,
  "attendance.mark": ["SuperAdmin", "Admin", "Manager", "HR Manager"],
  "leave.approve": ["SuperAdmin", "Admin", "Manager", "HR Manager"],
  "loan.request": ["SuperAdmin", "Admin", "HR Manager", "Manager"],
  "loan.approve": ["SuperAdmin", "Admin", "CFO", "Finance Manager"],
  "loan.disburse": ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"],

  /**
   * Payroll splits in two, and the split is the point.
   *
   * HR prepares payroll — the statutory rates are the facts of doing the job.
   * Which accounts the payroll journal debits and credits is an accounting
   * decision and stays with the people who answer for the ledger.
   */
  "payroll.prepare": ["SuperAdmin", "Admin", "CFO", "Finance Manager", "HR Manager"],
  "payroll.rates.write": ["SuperAdmin", "Admin", "CFO", "Finance Manager", "HR Manager"],
  "payroll.gl.write": ["SuperAdmin", "Admin", "CFO", "Finance Manager"],
  "payroll.approve": ["SuperAdmin", "Admin", "CFO", "Finance Manager"],
  "payroll.void": ["SuperAdmin", "Admin", "CFO"],

  // ── Projects and reporting ───────────────────────────────────────────────
  "project.manage": gates.PROJECT_MANAGE_ROLES,
  "project.log_signoff": gates.PROJECT_LOG_SIGNOFF_ROLES,
  "workflowreport.write": gates.WORKFLOW_REPORT_WRITE_ROLES,
  "workflowreport.signoff": gates.WORKFLOW_REPORT_SIGNOFF_ROLES,
  "executive.view": gates.EXECUTIVE_VIEW_ROLES,
  "kpi.view": [
    "SuperAdmin", "Admin", "Viewer", "Manager", "CFO",
    "HR Manager", "Accountant", "Finance Manager",
  ],
  "kpi.manage": KPI_MANAGE,
  "kpi.enter": [...KPI_MANAGE, "Accountant"],

  // ── Workflow ─────────────────────────────────────────────────────────────
  "approval.configure": gates.APPROVAL_CONFIG_ROLES,
});

/** Every capability name, sorted — for the tests and for an audit screen. */
export const ALL_CAPABILITIES = Object.freeze(Object.keys(CAPABILITIES).sort());

/**
 * May this role do this?
 *
 * SuperAdmin passes everything, exactly as `roleAllowed` has always done —
 * platform staff who have entered a company act with full authority inside it,
 * on that company's rows only (app/db/tenant.ts).
 *
 * An UNKNOWN CAPABILITY THROWS rather than quietly denying. A typo in a
 * capability name is a bug, and a bug that denies silently is the one that
 * takes three incidents to find. This runs in server components and server
 * actions, where a throw is visible in development and caught by the tests.
 */
export function can(role, capability) {
  const allowed = CAPABILITIES[capability];
  if (!allowed) {
    throw new Error(
      `Unknown capability "${capability}". Add it to lib/capabilities.js.`,
    );
  }
  if (!role) return false;
  if (role === "SuperAdmin") return true;
  return allowed.includes(role);
}

/**
 * The role list for a capability, for `withAuthorizedTenant(rolesFor(...))`.
 *
 * A copy, so a caller that spreads or sorts it cannot mutate the map — the
 * old constants were `Object.freeze`d for the same reason, and this keeps that
 * property without every entry having to remember it.
 */
export function rolesFor(capability) {
  const allowed = CAPABILITIES[capability];
  if (!allowed) {
    throw new Error(
      `Unknown capability "${capability}". Add it to lib/capabilities.js.`,
    );
  }
  return [...allowed];
}

/**
 * Everything a role may do — for a "Roles & permissions" screen, and for
 * answering "what changes if we move this person to Store Manager".
 */
export function capabilitiesOf(role) {
  if (role === "SuperAdmin") return [...ALL_CAPABILITIES];
  return ALL_CAPABILITIES.filter((c) => CAPABILITIES[c].includes(role));
}
