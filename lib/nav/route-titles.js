// Route → human title, used by the mobile header (current page context)
// and anywhere else that needs a label for a pathname. Client-safe, no
// imports. LONGEST-prefix match wins, so specific routes go above their
// parents only for readability — matching sorts by prefix length.

const ROUTE_TITLES = {
  "/dashboard": "Dashboard",
  "/dashboard/executive": "Executive Overview",
  "/dashboard/approvals": "Approvals",
  "/dashboard/kpis": "KPIs",

  // CRM
  "/dashboard/leads": "Leads",
  "/dashboard/opportunities": "Pipeline",

  // Sales
  "/dashboard/quotes": "Quotes",
  "/dashboard/sales-orders": "Sales Orders",
  "/dashboard/invoices": "Invoices",
  "/dashboard/credit-notes": "Credit Notes",
  "/dashboard/customers": "Customers",
  "/dashboard/statements": "Statements",

  // Inventory
  "/dashboard/stocks": "Products",
  "/dashboard/categories": "Categories",
  "/dashboard/movements": "Stock Movements",
  "/dashboard/grn": "Goods Receipts",
  "/dashboard/ncr": "Nonconformance",
  "/dashboard/adjustments": "Adjustments",
  "/dashboard/checkout": "Checkouts",
  "/dashboard/requests": "Stock Requests",

  // Purchases
  "/dashboard/purchase-orders": "Purchase Orders",
  "/dashboard/bills": "Bills",
  "/dashboard/suppliers": "Suppliers",
  "/dashboard/supplier-statements": "Supplier Statements",

  // Finance
  "/dashboard/payments": "Payments",
  "/dashboard/payments/received": "Payments Received",
  "/dashboard/payments/made": "Payments Made",
  "/dashboard/journal": "Journal",
  "/dashboard/accounts": "Chart of Accounts",
  "/dashboard/banking": "Banking",
  "/dashboard/assets": "Fixed Assets",
  "/dashboard/parties": "Parties",

  // Expenses / projects
  "/dashboard/claims": "Employee Expenses",
  "/dashboard/my-claims": "My Expenses",
  "/dashboard/expenses": "Operating Expenses",
  "/dashboard/projects": "Projects",
  // Project sub-screens, so the mobile header names the actual page rather
  // than falling back to "Projects". Match the nav labels exactly.
  "/dashboard/projects/create": "New Project",
  "/dashboard/projects/boq": "Bill of Quantities",
  "/dashboard/projects/methodology": "Methodology",
  "/dashboard/projects/milestones": "Milestones",
  "/dashboard/projects/programme": "Programme",
  "/dashboard/projects/instructions": "Engineer's Instructions",
  "/dashboard/projects/diary": "Site Diary",
  "/dashboard/projects/timesheets": "Timesheets",
  "/dashboard/projects/ipc": "IPC & Payments",
  "/dashboard/projects/variations": "Variations",
  "/dashboard/projects/contract": "Contract",
  "/dashboard/projects/costs": "Cost Lines",
  "/dashboard/projects/cash-requisitions": "Cash Requisitions",
  "/dashboard/projects/sealed-budgets": "Sealed Budgets",
  "/dashboard/projects/archive": "Completed Work",
  "/dashboard/projects/findings": "Findings",
  "/dashboard/projects/cost-codes": "Cost Codes",
  "/dashboard/technical": "Technical",
  "/dashboard/technical/overview": "Technical Dashboard",
  "/dashboard/technical/new": "Choose the sheet",
  "/dashboard/technical/create": "New report",

  // Help Desk & HSE (ported from Lante ERP)
  "/dashboard/helpdesk": "Help Desk",
  "/dashboard/hse": "HSE",

  // Tax / reports
  "/dashboard/tax": "Tax",
  "/dashboard/tax/vat": "VAT",
  "/dashboard/tax/wht": "WHT",
  "/dashboard/tax/kra": "KRA Filings",
  "/dashboard/reports": "Reports",
  "/dashboard/reports/profit-loss": "Profit & Loss",
  "/dashboard/reports/balance-sheet": "Balance Sheet",
  "/dashboard/reports/cash-flow": "Cash Flow",
  "/dashboard/reports/trial-balance": "Trial Balance",
  "/dashboard/reports/general-ledger": "General Ledger",
  "/dashboard/reports/sales": "Sales Report",
  "/dashboard/reports/sales-by-rep": "Sales by Rep",
  "/dashboard/reports/ar-aging": "AR Aging",
  "/dashboard/reports/ap-aging": "AP Aging",

  // HR
  "/dashboard/hr": "HR",
  "/dashboard/hr/employees": "Employees",
  "/dashboard/hr/payroll": "Payroll",
  "/dashboard/hr/my-payslips": "My Payslips",
  "/dashboard/hr/leave": "Leave",
  "/dashboard/hr/my-leave": "My Leave",
  "/dashboard/hr/attendance": "Attendance",
  "/dashboard/hr/my-attendance": "My Attendance",
  "/dashboard/hr/loans": "Loans",

  // Admin
  "/dashboard/users": "Users",
  "/dashboard/company": "Company",
  "/dashboard/settings": "Settings",
  "/dashboard/integrations": "Integrations",
  "/dashboard/licensing": "Licensing",
  "/dashboard/admin/companies": "Companies",
};

// Pre-sorted longest-first so the most specific prefix wins.
const PREFIXES = Object.keys(ROUTE_TITLES).sort((a, b) => b.length - a.length);

export function titleForPath(pathname) {
  if (!pathname) return "";
  for (const p of PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return ROUTE_TITLES[p];
  }
  return "";
}
