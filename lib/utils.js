import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export const serializeBsonType = (bson) => JSON.parse(JSON.stringify(bson));

export const userRoles = [
  "SuperAdmin", // System-wide admin (manages all companies)
  "Admin", // Company-level admin
  "Store Manager",
  "User",
  "Viewer",
  "Manager",
  "Accountant",
  "Employee",
  "Technician",
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
  "other",
];
export const userRolesMapping = [
  { value: "SuperAdmin", label: "SuperAdmin - Manage all companies" },
  { value: "Admin", label: "Admin - Full company access" },
  { value: "Manager", label: "Manager - Manage overall operations" },
  { value: "Employee", label: "Employee - Standard employee access" },
  { value: "Technician", label: "Technician - Technical operations" },
  { value: "Store Manager", label: "Store Manager - Manage inventory" },
  { value: "Accountant", label: "Accountant - Financial management" },
  { value: "User", label: "User - Limited access" },
  { value: "Viewer", label: "Viewer - Read-only access" },
];

// Company status options
export const companyStatuses = ["active", "inactive", "suspended"];

// Subscription plans
export const subscriptionPlans = [
  { value: "free", label: "Free", maxUsers: 2 },
  { value: "starter", label: "Starter", maxUsers: 5 },
  { value: "professional", label: "Professional", maxUsers: 20 },
  { value: "enterprise", label: "Enterprise", maxUsers: 999 },
];

export const purposeForItemsRemovalFromStock = [
  "sale",
  "technician_test",
  "customer_demo",
  "internal_use",
  "installation",
  "repair",
  "other",
];

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
  "bank_main",
  "mpesa",
  "accounts_receivable",
  "employee_advance",
  "inventory", // ← Make sure this exists
  "vat_input", // ← Add this (VAT paid on purchases)

  // Liabilities
  "accounts_payable",
  "employee_payables",

  "vat_output", // ← Add this (VAT collected on sales)
  "wht_payable", // ← Add this (WHT to remit to KRA)
  "vat_payable", // ← For net VAT payable

  // Revenue
  "sales_revenue",
  "service_revenue",

  // Expenses
  "cogs", // ← Cost of Goods Sold

  // Equity
  "retained_earnings",
];
export const accountSubType = [
  // Assets
  "cash",
  "bank",
  "header",
  "accounts_receivable",

  "inventory", // ← Make sure this exists
  "prepaid_expense",
  "vat_input", // ← Add this
  "fixed_asset",
  "accumulated_depreciation",
  "employee_advance",
  "current_asset",
  "other_asset",

  // Liabilities
  "accounts_payable",
  "loan",
  "tax_payable",
  "vat_payable", // ← Add this
  "wht_payable", // ← Add this
  "other_current_liability",
  "employee_payables",
  "long_term_liability",
  "other_liability",

  // Equity
  "owner_equity",
  "retained_earnings",
  "drawings",

  // Revenue
  "sales",
  "service_revenue",
  "other_income",

  // Expenses
  "cogs", // ← Make sure this exists
  "operating_expense",
  "depreciation",
  "employee_expense",
  "employee_payables",
  "meals_expense",
  "travel_expense",
  "utilities_expense",
  "transport_expense",
  "operating_expense",
  "incidentals_expense",
  "accommodation_expense",
  "fuel_expense",
  "inventory_adjustment", // ← Add this
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
export const formatCurrency = (amount) => {
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
