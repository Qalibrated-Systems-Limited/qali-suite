import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export const serializeBsonType = (bson) => JSON.parse(JSON.stringify(bson));

// Re-exported from the zero-dependency single source of truth.
export { formatAddress } from "./format-address";

export const userRoles = [
  "SuperAdmin",
  "Admin",
  "CEO",
  "CFO",
  "Finance Manager",
  "Accountant",
  "Sales Manager",
  "Procurement Officer",
  "Manager",
  "Store Manager",
  "Storekeeper",
  "HR",
  "Technician",
  "Employee",
  "User",
  "Viewer",
];

export const userDepartments = [
  "IT",
  "Sales",
  "Marketing",
  "Finance",
  "Technical",
  "Operations",
  "HR",
  "Warehouse",
  "Customer Service",
  "Procurement",
  "Logistics",
];

export const reimbursementCategories = [
  "transport",
  "accommodation",
  "meals",
  "fuel",
  "supplies",
  "telecommunications",
  "office_supplies",
  "stationery",
  "printing",
  "equipment",
  "maintenance",
  "repairs",
  "utilities",
  "software",
  "professional_services",
  "marketing",
  "entertainment",
  "parking",
  "airtime",
  "internet",
  "courier",
  "licenses",
  "subscriptions",
  "training",
  "medical",
  "other",
];

// Expense categories with labels, icons and grouping for combobox
export const EXPENSE_CATEGORIES = {
  // Travel-related
  transport: { label: "Transport", icon: "🚗", group: "Travel" },
  accommodation: { label: "Accommodation", icon: "🏨", group: "Travel" },
  meals: { label: "Meals", icon: "🍽️", group: "Travel" },
  fuel: { label: "Fuel", icon: "⛽", group: "Travel" },
  parking: { label: "Parking", icon: "🅿️", group: "Travel" },

  // Office & Supplies
  office_supplies: { label: "Office Supplies", icon: "🗄️", group: "Office" },
  stationery: { label: "Stationery", icon: "📝", group: "Office" },
  printing: { label: "Printing", icon: "🖨️", group: "Office" },
  supplies: { label: "General Supplies", icon: "📦", group: "Office" },

  // Technology & Communication
  telecommunications: {
    label: "Telecommunications",
    icon: "📱",
    group: "Technology",
  },
  airtime: { label: "Airtime/Mobile", icon: "📞", group: "Technology" },
  internet: { label: "Internet", icon: "🌐", group: "Technology" },
  software: { label: "Software", icon: "💻", group: "Technology" },
  subscriptions: { label: "Subscriptions", icon: "🔄", group: "Technology" },

  // Equipment & Maintenance
  equipment: { label: "Equipment", icon: "🔧", group: "Equipment" },
  maintenance: { label: "Maintenance", icon: "🛠️", group: "Equipment" },
  repairs: { label: "Repairs", icon: "🔩", group: "Equipment" },

  // Services
  professional_services: {
    label: "Professional Services",
    icon: "👔",
    group: "Services",
  },
  courier: { label: "Courier/Delivery", icon: "📬", group: "Services" },
  training: { label: "Training", icon: "🎓", group: "Services" },

  // Utilities & Licenses
  utilities: { label: "Utilities", icon: "💡", group: "Utilities" },
  licenses: { label: "Licenses & Permits", icon: "📄", group: "Utilities" },

  // Other
  marketing: { label: "Marketing", icon: "📢", group: "Other" },
  entertainment: { label: "Entertainment", icon: "🎭", group: "Other" },
  medical: { label: "Medical", icon: "🏥", group: "Other" },
  other: { label: "Other", icon: "📋", group: "Other" },
};

// Get categories grouped for combobox display
export const getGroupedCategories = () => {
  const groups = {};
  Object.entries(EXPENSE_CATEGORIES).forEach(
    ([value, { label, icon, group }]) => {
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push({ value, label, icon });
    },
  );
  return groups;
};

// Get suggested categories based on advance type
export const getSuggestedCategories = (advanceType) => {
  const suggestions = {
    travel: [
      "transport",
      "accommodation",
      "meals",
      "fuel",
      "parking",
      "airtime",
    ],
    petty_cash: [
      "office_supplies",
      "stationery",
      "printing",
      "airtime",
      "courier",
      "supplies",
    ],
    project: [
      "equipment",
      "supplies",
      "professional_services",
      "software",
      "transport",
    ],
    operational: [
      "utilities",
      "maintenance",
      "repairs",
      "supplies",
      "telecommunications",
    ],
  };
  return suggestions[advanceType] || suggestions.operational;
};

// Advance request types
// Note: "project" was removed — project linking is now cross-cutting via the project picker on all types
export const ADVANCE_TYPES = {
  travel: { label: "Travel Advance", description: "Business travel expenses" },
  petty_cash: {
    label: "Petty Cash",
    description: "Small recurring office expenses",
  },
  operational: {
    label: "Operational",
    description: "General operational expenses",
  },
};

export const advanceTypesList = Object.keys(ADVANCE_TYPES);
export const userRolesMapping = [
  { value: "SuperAdmin", label: "SuperAdmin - Manage all companies" },
  { value: "Admin", label: "Admin - Full company access" },
  { value: "CEO", label: "CEO - Executive overview, read across the business" },
  { value: "CFO", label: "CFO - Approves write-offs, sets pricing policy" },
  {
    value: "Finance Manager",
    label: "Finance Manager - Mid-tier financial approvals",
  },
  { value: "Accountant", label: "Accountant - Posts JEs, reconciles" },
  {
    value: "Sales Manager",
    label: "Sales Manager - Sets selling prices and markups",
  },
  {
    value: "Procurement Officer",
    label: "Procurement Officer - Raises POs, agrees vendor pricing",
  },
  { value: "Manager", label: "Manager - Manage overall operations" },
  { value: "Store Manager", label: "Store Manager - Authorizes stock moves" },
  {
    value: "Storekeeper",
    label: "Storekeeper - Receive, issue, count (no pricing access)",
  },
  { value: "HR", label: "HR - Human resources management" },
  { value: "Technician", label: "Technician - Technical operations" },
  { value: "Employee", label: "Employee - Standard employee access" },
  { value: "User", label: "User - Legacy generic role" },
  { value: "Viewer", label: "Viewer - Read-only access" },
];

// Company status options
export const companyStatuses = ["active", "inactive", "suspended"];

// Subscription plans — derived from canonical source in lib/plans.js
import { DEFAULT_PLANS } from "./plans";
export const subscriptionPlans = DEFAULT_PLANS.map((p) => ({
  value: p.code,
  label: p.label,
  maxUsers: p.maxUsers,
}));

// Legacy: Item-level purpose (kept for backward compatibility)
export const purposeForItemsRemovalFromStock = [
  "sale",
  "technician_test",
  "customer_demo",
  "internal_use",
  "installation",
  "repair",
  "other",
];

// Request-level type (industry standard approach)
export const stockRequestTypes = [
  "sale", // Direct sale to customer → Draft invoice at fulfillment
  "demo", // Demo/loan to customer → Checkout, may convert to sale
  "installation", // Installation job → Checkout, accountant creates invoice
  "internal", // Internal use (consumed) → No invoice, no return
  "repair", // Repair/service → Checkout, usually returns
  "employee_borrow", // Employee borrows for company use → Must return
];

// Request type labels for UI
export const stockRequestTypeLabels = {
  sale: "Sale to Customer",
  demo: "Demo / Customer Trial",
  installation: "Installation Job",
  internal: "Internal Use",
  repair: "Repair / Service",
  employee_borrow: "Employee Borrow",
};

// Request type configurations.
//
// `allowedRequesterRoles` is the new SoD gate: only these roles can
// CREATE a request of this type. Picks were made per standard ERP
// convention (SAP MM, Odoo, NetSuite):
//   - `sale` / `demo` / `installation` → customer-facing, restricted to
//     sales / finance / management. An Employee shouldn't be able to
//     mint a "sale" worth millions.
//   - `repair` → service path, technicians + store + management.
//   - `internal` / `employee_borrow` → open to any employee. These are
//     routine workplace requests and the approval gate catches abuse.
// Viewer is excluded from everything (read-only role).
const CUSTOMER_FACING_ROLES = [
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Sales Manager",
  "Accountant",
  "Manager",
];

const INTERNAL_ROLES = [
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
  "Sales Manager",
  "Procurement Officer",
  "Manager",
  "Store Manager",
  "Storekeeper",
  "HR",
  "Technician",
  "Employee",
  "User",
  // "Viewer" intentionally excluded — read-only role
];

export const stockRequestTypeConfig = {
  sale: {
    label: "Sale to Customer",
    description:
      "Items will be sold to customer. Draft invoice created at fulfillment.",
    requiresCustomer: true,
    createsInvoice: true,
    requiresReturn: false,
    createsCheckout: true, // Track items with technician until invoice posts
    allowedRequesterRoles: CUSTOMER_FACING_ROLES,
  },
  demo: {
    label: "Demo / Customer Trial",
    description: "Items loaned for demo. Can be converted to sale or returned.",
    requiresCustomer: true,
    createsInvoice: false,
    requiresReturn: true,
    createsCheckout: true,
    allowedRequesterRoles: [...CUSTOMER_FACING_ROLES, "Technician"],
  },
  installation: {
    label: "Installation Job",
    description:
      "Items for installation. Accountant creates invoice after job completion.",
    requiresCustomer: true,
    createsInvoice: false, // Accountant creates later
    requiresReturn: false,
    createsCheckout: true,
    allowedRequesterRoles: [...CUSTOMER_FACING_ROLES, "Technician"],
  },
  internal: {
    label: "Internal Use",
    description: "Items for internal company use. No customer billing.",
    requiresCustomer: false,
    createsInvoice: false,
    requiresReturn: false,
    createsCheckout: true, // Track items for expensing or return
    allowedRequesterRoles: INTERNAL_ROLES,
  },
  repair: {
    label: "Repair / Service",
    description: "Items for repair work. Usually returned after service.",
    requiresCustomer: true,
    createsInvoice: false,
    requiresReturn: true,
    createsCheckout: true,
    allowedRequesterRoles: [
      "SuperAdmin",
      "Admin",
      "Manager",
      "Store Manager",
      "Sales Manager",
      "Technician",
    ],
  },
  employee_borrow: {
    label: "Employee Borrow",
    description:
      "Employee borrows an item for company use (e.g., a tool, laptop, projector). Must be returned. No invoice. Approval required.",
    requiresCustomer: false,
    createsInvoice: false,
    requiresReturn: true,
    createsCheckout: true,
    allowedRequesterRoles: INTERNAL_ROLES,
  },
};

export const departments = [
  "Technical",
  "Sales",
  "Service",
  "Installation",
  "Admin",
  "Finance",
  "Other",
];
export const accountTypes = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
];
export const accountSystemTypes = [
  null,
  // Assets
  "cash",
  "petty_cash",
  "bank_main",
  "cash_at_bank",
  "mpesa",
  "accounts_receivable",
  "technician_stock",
  "goods_in_transit",  // Inter-location transfer clearing — DR on transfer_out, CR on transfer_in
  "employee_advance",
  "supplier_advance",
  "inventory",
  "vat_input",
  "fixed_asset",
  "accumulated_depreciation",

  // Liabilities
  "accounts_payable",
  "employee_payables",
  "customer_advance",
  "vat_output",
  "vat_payable",
  "wht_payable",
  "paye_payable",
  "nssf_payable",
  "shif_payable",
  "nhif_payable", // Legacy alias — kept so existing seeded data with this systemAccount still validates
  "ahl_payable",
  "salaries_payable", // Net pay accrual — Cr on payroll approve, Dr on mark-paid
  "unearned_revenue",

  // Equity
  "share_capital",
  "retained_earnings",
  "current_year_earnings",
  "drawings",

  // Revenue
  "sales_revenue",
  "service_revenue",
  "other_income",
  "discounts_given",
  "sales_returns",     // Customer returns — DR on customer_return WB ticket
  "gain_on_disposal",  // Gain when asset sold above book value — CR on disposal JE

  // Liabilities (clearing)
  "grni",             // Goods Received Not Invoiced — WB inbound clearing account
                      // DR Inventory when goods arrive, CR GRNI
                      // DR GRNI when supplier bill posted, CR Accounts Payable
                      // Nets to zero when GR and invoice are matched
  "accrued_expenses", // Unpaid expense accrual — DR Expense / CR Accrued Expenses
                      // Clears when payment recorded: DR Accrued Expenses / CR Cash|Bank
  "farmer_payable",   // Coffee coop — amount owed to farmer/member on intake
                      // DR Inventory when coffee received, CR Farmer Payable
                      // DR Farmer Payable when farmer paid, CR Cash/Bank/Mpesa

  // Expenses (Cost of Sales)
  "cogs",
  "cost_of_sales",
  "purchase_returns",
  "inventory_adjustments",
  "stock_variance",   // Standalone outbound with no invoice — unplanned dispatch

  // Expenses (Operating)
  "salaries_expense",
  "employer_nssf_expense",
  "employer_ahl_expense",
  "depreciation_expense",
  "bank_charges",
  "interest_expense",
  "loss_on_disposal",  // Loss when asset sold below book value — DR on disposal JE

  // Loan-related
  "staff_loans_receivable",
  "interest_income",
];
export const accountSubType = [
  // General
  "header",

  // Assets
  "cash",
  "bank",
  "mobile_money",
  "mpesa",
  "receivable",
  "accounts_receivable",
  "inventory",
  "prepaid",
  "prepaid_expense",
  "tax",
  "vat_input",
  "fixed_asset",
  "contra",
  "accumulated_depreciation",
  "employee_advance",
  "current_asset",
  "other_asset",

  // Liabilities
  "payable",
  "accounts_payable",
  "loan",
  "payroll",
  "accrual",
  "deferred",
  "tax_payable",
  "vat_payable",
  "wht_payable",
  "customer_deposit",
  "other_current_liability",
  "employee_payables",
  "long_term_liability",
  "other_liability",

  // Equity
  "capital",
  "owner_equity",
  "retained",
  "retained_earnings",
  "earnings",
  "drawings",

  // Revenue
  "sales",
  "service",
  "service_revenue",
  "other",
  "other_income",

  // Expenses (Cost of Sales / Direct Costs)
  "cogs",
  "direct_cost",
  "adjustment",
  "inventory_adjustment",

  // Expenses (Operating)
  "occupancy",
  "admin",
  "communication",
  "transport",
  "transport_expense",
  "insurance",
  "depreciation",
  "professional",
  "financial",
  "operating_expense",
  "employee_expense",
  "meals_expense",
  "travel_expense",
  "utilities_expense",
  "incidentals_expense",
  "accommodation_expense",
  "fuel_expense",
  "other_expense",
];
export const priority = ["low", "normal", "high", "urgent"];
export function getInitials(name) {
  if (!name || typeof name !== "string") return "";

  const parts = name.trim().split(/\s+/); // Split name by whitespace
  const firstInitial = parts[0]?.[0] || "";
  const secondInitial = parts[1]?.[0] || "";

  return (firstInitial + secondInitial).toUpperCase();
}

export function formatCompactNumber(value) {
  if (value === null || value === undefined) return "0";

  const num = typeof value === "string" ? Number(value) : value;

  if (isNaN(num)) return "0";

  const abs = Math.abs(num);

  if (abs >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  }

  if (abs >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }

  if (abs >= 1_000) {
    return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }

  return num.toString();
}
export const formatCurrency = (amount, compact = false) => {
  if (amount === null || amount === undefined) return "0";

  const num = Number(amount);
  if (isNaN(num)) return "0";

  const abs = Math.abs(num);

  if (abs >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  }

  if (abs >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }

  if (abs >= 1_000) {
    return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }

  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
  }).format(num);
};

export const generatePagination = (currentPage, totalPages) => {
  // If the total number of pages is 7 or less,
  // display all pages without any ellipsis.
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  // If the current page is among the first 3 pages,
  // show the first 3, an ellipsis, and the last 2 pages.
  if (currentPage <= 3) {
    return [1, 2, 3, "...", totalPages - 1, totalPages];
  }

  // If the current page is among the last 3 pages,
  // show the first 2, an ellipsis, and the last 3 pages.
  if (currentPage >= totalPages - 2) {
    return [1, 2, "...", totalPages - 2, totalPages - 1, totalPages];
  }

  // If the current page is somewhere in the middle,
  // show the first page, an ellipsis, the current page and its neighbors,
  // another ellipsis, and the last page.
  return [
    1,
    "...",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "...",
    totalPages,
  ];
};
