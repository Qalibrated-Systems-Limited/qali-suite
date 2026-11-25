/**
 * The report builder's catalogue: each module, who may report on it, and the
 * activity datasets it offers. A dataset is a table; its columns are read from
 * the database itself (app/db/reportBuilder.ts), so a new column is
 * reportable the day it is added.
 *
 * Shared by the server (which enforces the roles and the table whitelist) and
 * the builder screen (which lists the choices).
 */

const STOCK = ["Manager", "Store Manager", "Storekeeper", "Procurement Officer", "CFO", "Finance Manager", "Accountant"];
const PROCUREMENT = ["Manager", "Procurement Officer", "Store Manager", "CFO", "Finance Manager", "Accountant"];
const SALES = ["Manager", "Sales Manager", "CFO", "Finance Manager", "Accountant"];
const FINANCE = ["CFO", "Finance Manager", "Accountant"];
const HR = ["HR Manager"];
const OPERATIONS = ["Manager", "CFO", "Store Manager", "Procurement Officer", "Sales Manager", "HR Manager", "Finance Manager"];

export const REPORT_MODULES = Object.freeze([
  {
    id: "stock",
    label: "Stock & inventory",
    roles: STOCK,
    datasets: [
      { id: "stock_movements", label: "Stock movements", table: "stock_movements" },
      { id: "products", label: "Products and levels", table: "products" },
      { id: "stock_adjustments", label: "Stock adjustments", table: "stock_adjustments" },
      { id: "stock_adjustment_lines", label: "Adjustment lines", table: "stock_adjustment_lines" },
      { id: "stock_counts", label: "Stock counts", table: "stock_counts" },
      { id: "stock_count_lines", label: "Count lines and variances", table: "stock_count_lines" },
      { id: "stock_requests", label: "Stock requisitions", table: "stock_requests" },
      { id: "nonconformances", label: "NCRs", table: "nonconformances" },
      { id: "item_checkouts", label: "Item checkouts", table: "item_checkouts" },
    ],
  },
  {
    id: "procurement",
    label: "Procurement",
    roles: PROCUREMENT,
    datasets: [
      { id: "purchase_orders", label: "Purchase orders", table: "purchase_orders" },
      { id: "purchase_order_lines", label: "Purchase order lines", table: "purchase_order_lines" },
      { id: "goods_receipts", label: "Goods receipts", table: "goods_receipts" },
      { id: "goods_receipt_lines", label: "Goods receipt lines", table: "goods_receipt_lines" },
      { id: "bills", label: "Supplier bills", table: "bills" },
      { id: "nonconformances", label: "NCRs", table: "nonconformances" },
    ],
  },
  {
    id: "sales",
    label: "Sales & CRM",
    roles: SALES,
    datasets: [
      { id: "invoices", label: "Invoices", table: "invoices" },
      { id: "invoice_lines", label: "Invoice lines", table: "invoice_lines" },
      { id: "quotes", label: "Quotations", table: "quotes" },
      { id: "sales_orders", label: "Sales orders", table: "sales_orders" },
      { id: "credit_notes", label: "Credit notes", table: "credit_notes" },
      { id: "leads", label: "Leads", table: "leads" },
      { id: "opportunities", label: "Opportunities", table: "opportunities" },
      { id: "crm_activities", label: "CRM activities", table: "crm_activities" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    roles: FINANCE,
    datasets: [
      { id: "payments", label: "Payments", table: "payments" },
      { id: "expenses", label: "Expenses", table: "expenses" },
      { id: "journal_entries", label: "Journal entries", table: "journal_entries" },
      { id: "journal_lines", label: "Journal lines", table: "journal_lines" },
      { id: "bills", label: "Bills", table: "bills" },
      { id: "employee_claims", label: "Staff claims and advances", table: "employee_claims" },
      { id: "loans", label: "Loans", table: "loans" },
    ],
  },
  {
    id: "hr",
    label: "Human resources",
    roles: HR,
    datasets: [
      { id: "employees", label: "Employees", table: "employees" },
      { id: "leave_requests", label: "Leave requests", table: "leave_requests" },
      { id: "attendance", label: "Attendance", table: "attendance" },
      { id: "employment_events", label: "Employment events", table: "employment_events" },
      { id: "hr_cases", label: "Disciplinary and grievances", table: "hr_cases" },
      { id: "hr_training_records", label: "Training", table: "hr_training_records" },
      { id: "hr_performance_reviews", label: "Performance reviews", table: "hr_performance_reviews" },
      { id: "hr_candidates", label: "Recruitment candidates", table: "hr_candidates" },
      { id: "employee_exits", label: "Exits", table: "employee_exits" },
      { id: "payroll_runs", label: "Payroll runs", table: "payroll_runs" },
    ],
  },
  {
    id: "technical",
    label: "Technical",
    roles: OPERATIONS,
    datasets: [
      { id: "calibration_jobs", label: "Calibration jobs", table: "calibration_jobs" },
      { id: "inspections", label: "Inspections", table: "inspections" },
      { id: "workflow_reports", label: "Technical reports", table: "workflow_reports" },
      { id: "resource_requests", label: "Resource requests", table: "resource_requests" },
      { id: "calibration_standards", label: "Reference standards", table: "calibration_standards" },
    ],
  },
  {
    id: "helpdesk",
    label: "Help desk",
    roles: OPERATIONS,
    datasets: [
      { id: "helpdesk_tickets", label: "Tickets", table: "helpdesk_tickets" },
      { id: "helpdesk_comments", label: "Replies and notes", table: "helpdesk_comments" },
      { id: "helpdesk_history", label: "Ticket history", table: "helpdesk_history" },
    ],
  },
  {
    id: "projects",
    label: "Projects & tasks",
    roles: OPERATIONS,
    datasets: [
      { id: "projects", label: "Projects", table: "projects" },
      { id: "project_tasks", label: "Project tasks", table: "project_tasks" },
      { id: "tasks", label: "Tasks", table: "tasks" },
      { id: "project_timesheets", label: "Timesheets", table: "project_timesheets" },
      { id: "project_diary_entries", label: "Site diary", table: "project_diary_entries" },
      { id: "project_variations", label: "Variations", table: "project_variations" },
    ],
  },
  {
    id: "fleet",
    label: "Fleet",
    roles: OPERATIONS,
    datasets: [
      { id: "fleet_vehicles", label: "Vehicles", table: "fleet_vehicles" },
      { id: "fleet_trips", label: "Trips", table: "fleet_trips" },
      { id: "fleet_maintenance", label: "Maintenance", table: "fleet_maintenance" },
    ],
  },
  {
    id: "hse",
    label: "Health & safety",
    roles: OPERATIONS,
    datasets: [
      { id: "hse_incidents", label: "Incidents", table: "hse_incidents" },
      { id: "hse_corrective_actions", label: "Corrective actions", table: "hse_corrective_actions" },
      { id: "hse_ppe_issues", label: "PPE issued", table: "hse_ppe_issues" },
      { id: "hse_toolbox_talks", label: "Toolbox talks", table: "hse_toolbox_talks" },
      { id: "hse_statutory_inspections", label: "Statutory inspections", table: "hse_statutory_inspections" },
    ],
  },
  {
    id: "quality",
    label: "Quality",
    roles: OPERATIONS,
    datasets: [
      { id: "qms_nonconformances", label: "Quality nonconformances", table: "qms_nonconformances" },
      { id: "qms_capas", label: "CAPAs", table: "qms_capas" },
      { id: "qms_audits", label: "Audits", table: "qms_audits" },
    ],
  },
  {
    id: "assets",
    label: "Assets",
    roles: [...FINANCE, "Manager"],
    datasets: [
      { id: "assets", label: "Assets", table: "assets" },
      { id: "asset_transfers", label: "Transfers", table: "asset_transfers" },
    ],
  },
  {
    id: "approvals",
    label: "Approvals",
    roles: ["Manager", "CFO", "Finance Manager"],
    datasets: [
      { id: "approval_requests", label: "Approval requests", table: "approval_requests" },
      { id: "approval_step_decisions", label: "Step signatures", table: "approval_step_decisions" },
    ],
  },
]);

export const REPORT_ALWAYS = Object.freeze(["SuperAdmin", "Admin"]);

export const reportModule = (id) => REPORT_MODULES.find((m) => m.id === id) ?? null;

export const canReportOn = (role, moduleId) => {
  const m = reportModule(moduleId);
  return Boolean(m && role && (REPORT_ALWAYS.includes(role) || m.roles.includes(role)));
};

export const reportModulesFor = (role) => REPORT_MODULES.filter((m) => canReportOn(role, m.id));

export const FILTER_OPS = Object.freeze([
  { value: "eq", label: "is" },
  { value: "neq", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
  { value: "empty", label: "is empty" },
  { value: "not_empty", label: "is not empty" },
]);
