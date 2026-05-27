/**
 * Test fixtures — builders for the common documents financial tests need.
 *
 * Every builder returns a saved document with sensible defaults; pass an
 * override object for any field you want to set explicitly. Builders are
 * tenant-aware: pass a `companyId` to scope a document, or use
 * `seedTenant()` to get a ready-made `{ company, user, accounts }` bundle.
 *
 * Why builders, not factories: each test runs against an empty DB so
 * factory IDs are predictable; but Mongoose schemas have lots of required
 * fields, and tests get noisy when they spell those out every time.
 */
import mongoose from "mongoose";
import Company from "@/app/models/Company";
import User from "@/app/models/user";
import Account from "@/app/models/account";
import Party from "@/app/models/parties";
import FiscalPeriod from "@/app/models/fiscalPeriod";
// Side-effect imports — registers models that production methods look up
// lazily via mongoose.model("ModelName"). The fixtures helper itself
// doesn't use these; importing them here means any test that imports
// `./helpers/fixtures.mjs` has the full model graph available.
import "@/app/models/product";
import "@/app/models/stockmovement";
import "@/app/models/taxTransactions";
import "@/app/models/JournalEntry";
import "@/app/models/checkouts";

const { ObjectId } = mongoose.Types;

// ============================================
// COMPANY + USER
// ============================================

export async function seedCompany(overrides = {}) {
  const company = await Company.create({
    name: overrides.name || "Test Co",
    code: overrides.code || "TST",
    email: overrides.email || "test@test.co",
    phone: overrides.phone || "+254700000000",
    kraPin: overrides.kraPin || "P051234567A",
    address: overrides.address || "Nairobi",
    industry: overrides.industry || "general",
    plan: overrides.plan || "professional",
    settings: overrides.settings || {},
    ...overrides,
  });
  return company;
}

export async function seedUser(companyId, overrides = {}) {
  const user = await User.create({
    creator: { name: "Seed", id: "seed" },
    name: overrides.name || "Test User",
    username: overrides.username || `tester-${new ObjectId().toString().slice(-6)}`,
    email: overrides.email || `tester-${Date.now()}@test.co`,
    password: overrides.password || "$2a$10$abcdefghijklmnopqrstuv",
    role: overrides.role || "Admin",
    status: overrides.status || "Active",
    companyId,
    authProvider: overrides.authProvider || "credentials",
    ...overrides,
  });
  return user;
}

// ============================================
// SYSTEM ACCOUNTS
// ============================================
// The minimum Chart of Accounts needed for bill/invoice/payment cycles
// to post journal entries. Each is a `canPost: true` leaf account with a
// `systemAccount` tag that `bill.approve()` / `invoice.markCompleted()`
// look up.

const SYSTEM_ACCOUNTS = [
  // Assets
  { code: "1000", name: "Cash", accountType: "asset", systemAccount: "cash" },
  { code: "1010", name: "Bank Main", accountType: "asset", systemAccount: "bank_main" },
  { code: "1100", name: "Accounts Receivable", accountType: "asset", systemAccount: "accounts_receivable" },
  { code: "1200", name: "Inventory", accountType: "asset", systemAccount: "inventory" },
  { code: "1300", name: "VAT Input", accountType: "asset", systemAccount: "vat_input" },
  // Liabilities
  { code: "2000", name: "Accounts Payable", accountType: "liability", systemAccount: "accounts_payable" },
  { code: "2100", name: "VAT Output", accountType: "liability", systemAccount: "vat_output" },
  { code: "2200", name: "WHT Payable", accountType: "liability", systemAccount: "wht_payable" },
  // Revenue
  { code: "4000", name: "Sales Revenue", accountType: "revenue", systemAccount: "sales_revenue" },
  // Expense
  { code: "5000", name: "Cost of Goods Sold", accountType: "expense", systemAccount: "cogs" },
  { code: "5100", name: "Office Expenses", accountType: "expense" }, // no systemAccount — for free-form bill lines
];

export async function seedSystemAccounts(companyId) {
  const docs = SYSTEM_ACCOUNTS.map((a) => ({
    companyId,
    accountCode: a.code,
    accountName: a.name,
    accountType: a.accountType,
    systemAccount: a.systemAccount || null,
    canPost: true,
    isActive: true,
  }));
  const accounts = await Account.insertMany(docs);
  // Return as a lookup map by systemAccount for convenience in tests.
  const bySystem = {};
  for (const a of accounts) {
    if (a.systemAccount) bySystem[a.systemAccount] = a;
  }
  // Also expose the office expense account by code for free-form bill lines.
  bySystem.officeExpense = accounts.find((a) => a.accountCode === "5100");
  return { all: accounts, bySystem };
}

// ============================================
// PARTIES (supplier + customer)
// ============================================

export async function seedSupplier(companyId, overrides = {}) {
  return Party.create({
    companyId,
    type: "supplier",
    name: overrides.name || "Acme Supplies Ltd",
    code: overrides.code || `SUP-${new ObjectId().toString().slice(-6)}`,
    taxPin: overrides.taxPin || "P051111111A",
    email: overrides.email || "supplier@test.co",
    isActive: true,
    ...overrides,
  });
}

export async function seedCustomer(companyId, overrides = {}) {
  return Party.create({
    companyId,
    type: "customer",
    name: overrides.name || "Acme Buyer Ltd",
    code: overrides.code || `CUS-${new ObjectId().toString().slice(-6)}`,
    taxPin: overrides.taxPin || "P052222222A",
    email: overrides.email || "customer@test.co",
    isActive: true,
    ...overrides,
  });
}

// ============================================
// FISCAL PERIOD
// ============================================

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export async function seedFiscalPeriod(companyId, year, month, status = "open") {
  const periodCode = `${year}-${String(month).padStart(2, "0")}`;
  const periodName = `${MONTH_NAMES[month - 1]} ${year}`;
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);
  return FiscalPeriod.create({
    companyId,
    year,
    month,
    periodCode,
    periodName,
    startDate,
    endDate,
    status,
    createdBy: { name: "Seed", id: "seed" },
  });
}

// ============================================
// ONE-SHOT TENANT BUNDLE
// ============================================
// Most tests need the same thing: a company, an admin user, a chart of
// accounts, a supplier, a customer, and the current month's fiscal
// period. `seedTenant()` does it all and returns one bundle.

export async function seedTenant(overrides = {}) {
  const company = await seedCompany(overrides.company);
  const user = await seedUser(company._id, overrides.user);
  const { bySystem, all } = await seedSystemAccounts(company._id);
  const supplier = await seedSupplier(company._id, overrides.supplier);
  const customer = await seedCustomer(company._id, overrides.customer);

  const now = new Date();
  const period = await seedFiscalPeriod(
    company._id,
    now.getFullYear(),
    now.getMonth() + 1,
  );

  return {
    company,
    user,
    accounts: bySystem,
    allAccounts: all,
    supplier,
    customer,
    period,
  };
}
