// ============================================
// PLAN CONFIGURATION
// ============================================
// Pure module — no DB imports. Safe for client and edge.
// DB-driven plans are loaded via plans-server.js and injected
// into the cache via setPlanCache().
// ============================================

// ── Core modules — always available regardless of plan ──
const CORE_MODULES = [
  "dashboard",
  "company",
  "settings",
  "users",
  "companies",
  "people",
  "profile",
];

// ── Default plans (used as seed + fallback) ──
const PLAN_HIERARCHY = ["free", "starter", "professional", "enterprise"];

const DEFAULT_PLANS = [
  {
    code: "free",
    label: "Free",
    price: 0,
    currency: "KES",
    maxUsers: 2,
    sortOrder: 0,
    description: "Basic inventory and sales",
    modules: [
      "inventory", "products", "categories", "movements", "adjustments", "checkout", "requests",
      "sales", "quotes", "invoices", "credit-notes", "customers", "payments-received", "statements",
      "expenses", "my-claims",
      "reports", "inventory-reports", "sales-reports",
    ],
  },
  {
    code: "starter",
    label: "Starter",
    price: 1500,
    currency: "KES",
    maxUsers: 5,
    sortOrder: 1,
    description: "Full accounting, purchases, and tax compliance",
    modules: [
      "purchases", "purchase-orders", "bills", "suppliers", "payments-made", "supplier-statements",
      "all-claims", "expenses-pending", "reimbursements",
      "finance", "parties", "accounts", "journal", "bank-feed", "fiscal-periods",
      "assets", "asset-depreciation", "asset-disposal",
      "tax", "vat-returns", "wht-reports", "tax-transactions", "kra-filings",
      "profit-loss", "balance-sheet", "cash-flow", "trial-balance", "general-ledger",
      "ar-aging", "ap-aging", "purchase-reports", "customer-reports",
    ],
  },
  {
    code: "professional",
    label: "Professional",
    price: 3500,
    currency: "KES",
    maxUsers: 20,
    sortOrder: 2,
    description: "HR, payroll, and project management",
    modules: [
      "hr", "hr-overview", "hr-employees", "hr-departments",
      "hr-leave", "hr-attendance", "hr-payroll",
      "hr-my-leave", "hr-my-attendance", "hr-my-payslips", "hr-users",
      "hr-loans",
      "projects",
    ],
  },
  {
    code: "enterprise",
    label: "Enterprise",
    price: 8000,
    currency: "KES",
    maxUsers: -1,
    sortOrder: 3,
    description: "Multi-company, API access, unlimited users",
    modules: [
      "integration",
      "integration:weighbridge",
      "integration:coffee_coop",
      "integration:logistics",
      "integration:miller",
    ],
  },
];

// ── Cache using globalThis (survives across requests in PM2/Node) ──
const CACHE_KEY = "__qalisuite_plan_cache__";
const CUMULATIVE_KEY = "__qalisuite_cumulative_cache__";

/**
 * Set plan cache from server-side DB load.
 * Uses globalThis so it persists across requests in long-running Node processes.
 */
export function setPlanCache(plans) {
  globalThis[CACHE_KEY] = plans;
  globalThis[CUMULATIVE_KEY] = null; // invalidate cumulative cache so it rebuilds
}

function getPlans() {
  return globalThis[CACHE_KEY] || DEFAULT_PLANS;
}

/**
 * Build cumulative module sets from plan configs.
 */
function buildCumulativeFromConfigs(plans) {
  const cumulative = {};
  let accumulated = [...CORE_MODULES];

  for (const planCode of PLAN_HIERARCHY) {
    const config = plans.find((p) => p.code === planCode);
    if (config) {
      accumulated = [...accumulated, ...config.modules];
    }
    cumulative[planCode] = new Set(accumulated);
  }

  return cumulative;
}

function getCumulativeModules() {
  if (globalThis[CUMULATIVE_KEY]) return globalThis[CUMULATIVE_KEY];
  const result = buildCumulativeFromConfigs(getPlans());
  globalThis[CUMULATIVE_KEY] = result;
  return result;
}

/**
 * Check if a module is available on a given plan.
 */
export function planIncludes(plan, moduleId) {
  const cumulative = getCumulativeModules();
  const modules = cumulative[plan];
  if (!modules) return false;
  return modules.has(moduleId);
}

/**
 * Get all allowed module IDs for a plan (as an array).
 */
export function getAllowedModules(plan) {
  const cumulative = getCumulativeModules();
  const modules = cumulative[plan];
  return modules ? [...modules] : [...CORE_MODULES];
}

/**
 * Get plan metadata (label, price, limits).
 */
export function getPlanLimits(plan) {
  const plans = getPlans();
  const config = plans.find((p) => p.code === plan);
  if (!config) return { maxUsers: 2, label: "Free", price: 0, currency: "KES" };
  return {
    maxUsers: config.maxUsers,
    label: config.label,
    price: config.price,
    currency: config.currency || "KES",
  };
}

/**
 * Get the minimum plan required for a module.
 */
export function getRequiredPlan(moduleId) {
  const cumulative = getCumulativeModules();
  for (const plan of PLAN_HIERARCHY) {
    if (cumulative[plan]?.has(moduleId)) return plan;
  }
  return "enterprise";
}

// Dynamic PLAN_LIMITS — reads from cache so it reflects DB-driven plan configs
const PLAN_LIMITS = new Proxy({}, {
  get(_, code) {
    if (typeof code !== "string") return undefined;
    const plans = getPlans();
    const config = plans.find((p) => p.code === code);
    if (!config) return { maxUsers: 2, label: "Free", price: 0, currency: "KES" };
    return { maxUsers: config.maxUsers, label: config.label, price: config.price, currency: config.currency || "KES" };
  },
});

export { PLAN_HIERARCHY, PLAN_LIMITS, DEFAULT_PLANS, CORE_MODULES };
