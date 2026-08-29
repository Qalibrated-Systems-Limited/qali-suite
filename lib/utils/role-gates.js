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

// Bills — create/submit/edit. Mirrors BILL_ROLES.CREATE in
// the Mongo bill layer, deleted with the assets port. Note this is
// PROCUREMENT_ROLES plus
// Accountant: an accountant enters supplier invoices but does not run
// procurement, so the two lists are genuinely different rather than a drift.
export const BILL_WRITE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Manager",
  "Accountant",
  "Procurement Officer",
]);

// Bills — approve, reject, cancel and delete drafts. Narrower than write:
// approving posts to the ledger and admits stock.
export const BILL_APPROVE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Manager",
]);

// ── Goods receipt (SOP §10.1) ────────────────────────────────────────────────
//
// Procurement raises the order; Stores receives against it. The same person
// doing both is the classic order-and-receive fraud that SAP, NetSuite and
// Dynamics all block by default, so Procurement Officer is deliberately ABSENT
// from GRN_RECEIVE_ROLES even though it is in PROCUREMENT_ROLES. They can read
// the receipt and check it against the order; they cannot author it.
//
// The schema enforces the rest — the receiver cannot sign for acceptance, and
// one person cannot sign both halves — because a role gate says what KIND of
// person may act, and only the row knows WHICH person already did.
export const GRN_RECEIVE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "Manager",
  "Store Manager",
  "Storekeeper",
]);

// The SOP requires written confirmation from BOTH Sales and Finance, so the
// two sign-offs have two different lists.
export const GRN_ACCEPT_SALES_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "Sales Manager",
  "Manager",
]);

export const GRN_ACCEPT_FINANCE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
]);

// Reject a submitted receipt, or void a draft.
export const GRN_REJECT_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Manager",
  "Store Manager",
]);

// ── Nonconformance (SOP §10.6) ───────────────────────────────────────────────
//
// Wide to raise, narrower to propose, narrowest to authorise: the SOP wants a
// discrepancy logged the moment anyone sees it, and the decision about it taken
// by the Managing Director.
export const NCR_RAISE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "Manager",
  "Store Manager",
  "Storekeeper",
  "Procurement Officer",
  "CFO",
  "Finance Manager",
  "Accountant",
]);

export const NCR_PROPOSE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "Manager",
  "Store Manager",
  "CFO",
  "Finance Manager",
]);

// SOP §10.6: "All decisions shall be authorized by the Managing Director and
// recorded in the NCR Register." MD-equivalent here is SuperAdmin/Admin/CFO.
export const NCR_AUTHORIZE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
]);

// Claims: who may approve or reject an employee's advance or reimbursement.
// Transcribed from claim-action.js, which compares against a lowercased inline
// list in approveEmployeeClaim and rejectEmployeeClaim. Manager is in here and
// not in FINANCE_WRITE_ROLES, which is the point: a line manager signs off
// their own people's claims, and finance pays them.
export const CLAIM_APPROVE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Manager",
]);

// Paying a claim, settling one, and recording cash back: the same list the
// five money-moving claim actions each carry inline, which is FINANCE_WRITE.
export const CLAIM_PAY_ROLES = FINANCE_WRITE_ROLES;

// Fixed assets. Transcribed from the ASSET_ROLES map in asset-actions.js,
// which is one object literal doing seven different jobs. They are not the
// same list, and the differences are the point: an Accountant may register an
// asset and post its depreciation, but only finance leadership may DISPOSE of
// one — that books a gain or loss and takes it off the balance sheet — or
// cancel a posting that is already in the ledger.
export const ASSET_WRITE_ROLES = FINANCE_WRITE_ROLES;

export const ASSET_DISPOSE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
]);

export const ASSET_TRANSFER_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
  "Manager",
]);

// Anyone who might be holding the thing can read its odometer.
export const ASSET_USAGE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
  "Manager",
  "Employee",
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
// CEO retired (0039) — it was a read-across-the-business role, and this is a
// write gate, so it is dropped here rather than widened to Viewer.
/**
 * Who may read the executive overview.
 *
 * NOT FINANCE_ROLES, and the difference matters: `Viewer` is what CEO became
 * (0039), the executive dashboard is that role's HOME, and Viewer holds no
 * finance-write authority at all. Gating the snapshot on a finance list locks
 * the one person the screen exists for out of it.
 *
 * One constant so `app/dashboard/executive/page.jsx` and the action behind it
 * cannot drift — the page's inline list was the only copy until the snapshot
 * moved to Postgres and needed a gate of its own.
 */
export const EXECUTIVE_VIEW_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Viewer",
]);

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

// ── HR ────────────────────────────────────────────────────────────────────
// The HR module had no entry here at all: twelve action files each carried
// their own inline array, and the same authority was spelled four different
// ways ("HR Manager" appears with Manager in some gates and without it in
// others, with no rule behind the difference). These are the four levels HR
// actually has.

// Read the staff list, the org chart, an employee's record. A Manager sees
// their people; anyone who can act on HR at all can look.
export const HR_VIEW_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "Manager",
  "HR Manager",
]);

// Hire, edit, upload a photo or a document, run the org chart.
export const HR_WRITE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "Manager",
  "HR Manager",
]);

// Terminate, delete a document, edit leave entitlement, manage the holiday
// calendar and leave types. Narrower than write: these are irreversible or
// affect everybody.
export const HR_ADMIN_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "HR Manager",
]);

// Pay. Finance leadership as well as HR, because compensation is a financial
// commitment and payroll posts to the ledger.
export const HR_COMPENSATION_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "HR Manager",
]);

// Approval-engine config (thresholds, who-approves-what).
export const APPROVAL_CONFIG_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
]);

// ── Expenses (0059) ─────────────────────────────────────────────────────────
// Lifted verbatim from the inline EXPENSE_ROLES object in
// app/mongodb/actions/expense-actions.js so the port does not quietly narrow
// who may record a cost. Note that CREATE is WIDER than FINANCE_WRITE_ROLES:
// a Manager or an Employee books their own expenses, which is the point of
// the module. PAY drops Employee; DELETE is admin-and-CFO only.
export const EXPENSE_CREATE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
  "Manager",
  "Employee",
]);

export const EXPENSE_PAY_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
  "Manager",
]);

// Deleting a DRAFT. A posted expense is voided, never deleted — see
// voidExpense in app/db/repositories/expenses.ts.
export const EXPENSE_DELETE_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
]);

// Reversing a POSTED expense. Narrower than paying one: a void writes two
// reversing entries into a closed-off part of the ledger, which is a
// finance-controller act, not an operational one.
export const EXPENSE_VOID_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
]);

// ── Petty cash (0060) ───────────────────────────────────────────────────────
// Lifted from the inline Sets the Mongo petty-cash actions carried, so
// the port does not narrow who may run a tin. CUSTODIAN is the same set as
// FINANCE_WRITE_ROLES today; kept separate because they answer different
// questions and will drift — a custodian is an operational role, not a
// finance-write authority.
export const PETTY_CASH_CUSTODIAN_ROLES = Object.freeze([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
]);

// The MD signs off. CEO retired in 0039 and was dropped rather than mapped,
// per the note on the original Set.
export const PETTY_CASH_APPROVER_ROLES = Object.freeze([
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
