import mongoose from "mongoose";
import Company from "../../models/Company";
import Account from "../../models/account";
import FiscalPeriod from "../../models/fiscalPeriod";
import dbConnect from "../../config/dbConnect";
import { getPlanLimits } from "../../../lib/plans";

// ============================================
// COMPANY ONBOARDING SERVICE
// Handles company setup, seed data, and initialization
// ============================================

export class CompanyOnboardingService {
  // ============================================
  // STANDARD CHART OF ACCOUNTS (Kenya-focused)
  // ============================================
  static getStandardChartOfAccounts() {
    return [
      // ASSETS (1000-1999)
      {
        accountCode: "1000",
        accountName: "Assets",
        accountType: "asset",
        subType: "header",
        canPost: false,
        systemAccount: null,
        description: "All company assets",
      },
      {
        accountCode: "1100",
        accountName: "Current Assets",
        accountType: "asset",
        subType: "header",
        canPost: false,
        parentCode: "1000",
      },
      {
        accountCode: "1110",
        accountName: "Cash and Cash Equivalents",
        accountType: "asset",
        subType: "header",
        canPost: false,
        parentCode: "1100",
      },
      {
        accountCode: "1111",
        accountName: "Petty Cash",
        accountType: "asset",
        subType: "cash",
        canPost: true,
        parentCode: "1110",
        systemAccount: "petty_cash",
      },
      {
        accountCode: "1112",
        accountName: "Cash at Bank",
        accountType: "asset",
        subType: "bank",
        canPost: true,
        parentCode: "1110",
        systemAccount: "cash_at_bank",
      },
      {
        accountCode: "1113",
        accountName: "M-Pesa",
        accountType: "asset",
        subType: "mpesa",
        canPost: true,
        parentCode: "1110",
        systemAccount: "mpesa",
      },
      {
        accountCode: "1120",
        accountName: "Accounts Receivable",
        accountType: "asset",
        subType: "receivable",
        canPost: true,
        parentCode: "1100",
        systemAccount: "accounts_receivable",
      },
      {
        accountCode: "1130",
        accountName: "Inventory",
        accountType: "asset",
        subType: "inventory",
        canPost: true,
        parentCode: "1100",
        systemAccount: "inventory",
      },
      {
        accountCode: "1135",
        accountName: "Technician Stock",
        accountType: "asset",
        subType: "inventory",
        canPost: true,
        parentCode: "1100",
        systemAccount: "technician_stock",
        description: "Stock issued to technicians for demo, installation, or repair",
      },
      {
        accountCode: "1140",
        accountName: "Prepaid Expenses",
        accountType: "asset",
        subType: "prepaid",
        canPost: true,
        parentCode: "1100",
      },
      {
        accountCode: "1150",
        accountName: "VAT Receivable (Input VAT)",
        accountType: "asset",
        subType: "tax",
        canPost: true,
        parentCode: "1100",
        systemAccount: "vat_input",
      },
      {
        accountCode: "1160",
        accountName: "Employee Advances",
        accountType: "asset",
        subType: "receivable",
        canPost: true,
        parentCode: "1100",
        systemAccount: "employee_advance",
        description: "Cash advances issued to employees (petty cash, salary advances)",
      },
      {
        accountCode: "1170",
        accountName: "Supplier Advance",
        accountType: "asset",
        subType: "prepaid_expense",
        canPost: true,
        parentCode: "1100",
        systemAccount: "supplier_advance",
        description: "Prepayments and overpayments to suppliers",
      },
      {
        accountCode: "1200",
        accountName: "Non-Current Assets",
        accountType: "asset",
        subType: "header",
        canPost: false,
        parentCode: "1000",
      },
      {
        accountCode: "1210",
        accountName: "Property, Plant & Equipment",
        accountType: "asset",
        subType: "fixed_asset",
        canPost: true,
        parentCode: "1200",
      },
      {
        accountCode: "1220",
        accountName: "Accumulated Depreciation",
        accountType: "asset",
        subType: "contra",
        canPost: true,
        parentCode: "1200",
        systemAccount: "accumulated_depreciation",
      },
      {
        accountCode: "1230",
        accountName: "Motor Vehicles",
        accountType: "asset",
        subType: "fixed_asset",
        canPost: true,
        parentCode: "1200",
      },
      {
        accountCode: "1240",
        accountName: "Furniture & Fittings",
        accountType: "asset",
        subType: "fixed_asset",
        canPost: true,
        parentCode: "1200",
      },
      {
        accountCode: "1250",
        accountName: "Computer Equipment",
        accountType: "asset",
        subType: "fixed_asset",
        canPost: true,
        parentCode: "1200",
      },

      // LIABILITIES (2000-2999)
      {
        accountCode: "2000",
        accountName: "Liabilities",
        accountType: "liability",
        subType: "header",
        canPost: false,
      },
      {
        accountCode: "2100",
        accountName: "Current Liabilities",
        accountType: "liability",
        subType: "header",
        canPost: false,
        parentCode: "2000",
      },
      {
        accountCode: "2110",
        accountName: "Accounts Payable",
        accountType: "liability",
        subType: "payable",
        canPost: true,
        parentCode: "2100",
        systemAccount: "accounts_payable",
      },
      {
        accountCode: "2120",
        accountName: "VAT Payable (Output VAT)",
        accountType: "liability",
        subType: "tax",
        canPost: true,
        parentCode: "2100",
        systemAccount: "vat_output",
      },
      {
        accountCode: "2130",
        accountName: "PAYE Payable",
        accountType: "liability",
        subType: "tax",
        canPost: true,
        parentCode: "2100",
        systemAccount: "paye_payable",
      },
      {
        accountCode: "2140",
        accountName: "NSSF Payable",
        accountType: "liability",
        subType: "payroll",
        canPost: true,
        parentCode: "2100",
        systemAccount: "nssf_payable",
      },
      {
        accountCode: "2150",
        accountName: "SHIF Payable",
        accountType: "liability",
        subType: "payroll",
        canPost: true,
        parentCode: "2100",
        systemAccount: "shif_payable",
      },
      {
        accountCode: "2155",
        accountName: "Affordable Housing Levy Payable",
        accountType: "liability",
        subType: "payroll",
        canPost: true,
        parentCode: "2100",
        systemAccount: "ahl_payable",
        description: "Employee + employer AHL — remit to KRA",
      },
      {
        accountCode: "2160",
        accountName: "WHT Payable",
        accountType: "liability",
        subType: "tax",
        canPost: true,
        parentCode: "2100",
        systemAccount: "wht_payable",
      },
      {
        accountCode: "2170",
        accountName: "Accrued Expenses",
        accountType: "liability",
        subType: "accrual",
        canPost: true,
        parentCode: "2100",
      },
      {
        // GR/IR Clearing — required for the three-way match flow.
        // Holds the supplier-billed-but-not-yet-received liability
        // (and the inverse). Cleared by GRN acceptance.
        accountCode: "2175",
        accountName: "GR/IR Clearing",
        accountType: "liability",
        subType: "accrual",
        canPost: true,
        parentCode: "2100",
        systemAccount: "grni",
      },
      {
        // Suspense credit for unscheduled receipts (walk-in deliveries,
        // found stock, samples) — no PO/bill, so cost has no source
        // document. Finance reclasses each period to the right account
        // (Accrued Liabilities / Inventory Gain / Other Income).
        accountCode: "2178",
        accountName: "Inventory Adjustments — Unscheduled Receipts",
        accountType: "liability",
        subType: "accrual",
        canPost: true,
        parentCode: "2100",
        systemAccount: "inventory_suspense",
      },
      {
        accountCode: "2185",
        accountName: "Salaries Payable",
        accountType: "liability",
        subType: "payroll",
        canPost: true,
        parentCode: "2100",
        systemAccount: "salaries_payable",
        description: "Net pay accrued on payroll approve; cleared when bank disbursement posts",
      },
      {
        accountCode: "2180",
        accountName: "Unearned Revenue",
        accountType: "liability",
        subType: "deferred",
        canPost: true,
        parentCode: "2100",
        systemAccount: "unearned_revenue",
      },
      {
        accountCode: "2190",
        accountName: "Customer Advance",
        accountType: "liability",
        subType: "customer_deposit",
        canPost: true,
        parentCode: "2100",
        systemAccount: "customer_advance",
        description: "Customer deposits and overpayments",
      },
      {
        accountCode: "2195",
        accountName: "Employee Payables",
        accountType: "liability",
        subType: "payable",
        canPost: true,
        parentCode: "2100",
        systemAccount: "employee_payables",
        description: "Amounts owed to employees (reimbursements, settlements)",
      },
      {
        accountCode: "2200",
        accountName: "Non-Current Liabilities",
        accountType: "liability",
        subType: "header",
        canPost: false,
        parentCode: "2000",
      },
      {
        accountCode: "2210",
        accountName: "Long-term Loans",
        accountType: "liability",
        subType: "loan",
        canPost: true,
        parentCode: "2200",
      },
      {
        accountCode: "2220",
        accountName: "Director Loans",
        accountType: "liability",
        subType: "loan",
        canPost: true,
        parentCode: "2200",
      },

      // EQUITY (3000-3999)
      {
        accountCode: "3000",
        accountName: "Equity",
        accountType: "equity",
        subType: "header",
        canPost: false,
      },
      {
        accountCode: "3100",
        accountName: "Share Capital",
        accountType: "equity",
        subType: "capital",
        canPost: true,
        parentCode: "3000",
        systemAccount: "share_capital",
      },
      {
        accountCode: "3200",
        accountName: "Retained Earnings",
        accountType: "equity",
        subType: "retained",
        canPost: true,
        parentCode: "3000",
        systemAccount: "retained_earnings",
      },
      {
        accountCode: "3300",
        accountName: "Current Year Earnings",
        accountType: "equity",
        subType: "earnings",
        canPost: true,
        parentCode: "3000",
        systemAccount: "current_year_earnings",
      },
      {
        accountCode: "3400",
        accountName: "Owner Drawings",
        accountType: "equity",
        subType: "drawings",
        canPost: true,
        parentCode: "3000",
        systemAccount: "drawings",
      },

      // REVENUE (4000-4999)
      {
        accountCode: "4000",
        accountName: "Revenue",
        accountType: "revenue",
        subType: "header",
        canPost: false,
      },
      {
        accountCode: "4100",
        accountName: "Sales Revenue",
        accountType: "revenue",
        subType: "sales",
        canPost: true,
        parentCode: "4000",
        systemAccount: "sales_revenue",
      },
      {
        accountCode: "4200",
        accountName: "Service Revenue",
        accountType: "revenue",
        subType: "service",
        canPost: true,
        parentCode: "4000",
        systemAccount: "service_revenue",
      },
      {
        accountCode: "4300",
        accountName: "Interest Income",
        accountType: "revenue",
        subType: "other",
        canPost: true,
        parentCode: "4000",
      },
      {
        accountCode: "4400",
        accountName: "Other Income",
        accountType: "revenue",
        subType: "other",
        canPost: true,
        parentCode: "4000",
        systemAccount: "other_income",
      },
      {
        accountCode: "4500",
        accountName: "Discounts Given",
        accountType: "revenue",
        subType: "contra",
        canPost: true,
        parentCode: "4000",
        systemAccount: "discounts_given",
      },
      {
        accountCode: "4600",
        accountName: "Sales Returns",
        accountType: "revenue",
        subType: "contra",
        canPost: true,
        parentCode: "4000",
        systemAccount: "sales_returns",
      },

      // EXPENSES (5000-5999)
      {
        accountCode: "5000",
        accountName: "Cost of Goods Sold",
        accountType: "expense",
        subType: "header",
        canPost: false,
      },
      {
        accountCode: "5100",
        accountName: "Cost of Sales",
        accountType: "expense",
        subType: "cogs",
        canPost: true,
        parentCode: "5000",
        systemAccount: "cogs",
      },
      {
        accountCode: "5200",
        accountName: "Purchase Returns",
        accountType: "expense",
        subType: "contra",
        canPost: true,
        parentCode: "5000",
        systemAccount: "purchase_returns",
      },
      {
        accountCode: "5300",
        accountName: "Inventory Adjustments",
        accountType: "expense",
        subType: "adjustment",
        canPost: true,
        parentCode: "5000",
        systemAccount: "inventory_adjustments",
      },
      {
        accountCode: "5400",
        accountName: "Direct Project Costs",
        accountType: "expense",
        subType: "header",
        canPost: false,
        parentCode: "5000",
        description: "Costs directly attributable to projects",
      },
      {
        accountCode: "5410",
        accountName: "Project Materials",
        accountType: "expense",
        subType: "direct_cost",
        canPost: true,
        parentCode: "5400",
        description: "Cement, steel, timber, fittings, etc.",
      },
      {
        accountCode: "5420",
        accountName: "Subcontractor Costs",
        accountType: "expense",
        subType: "direct_cost",
        canPost: true,
        parentCode: "5400",
        description: "Labour and services from subcontractors",
      },
      {
        accountCode: "5430",
        accountName: "Equipment Hire",
        accountType: "expense",
        subType: "direct_cost",
        canPost: true,
        parentCode: "5400",
        description: "Hired plant, machinery, tools for projects",
      },
      {
        accountCode: "5440",
        accountName: "Project Transport",
        accountType: "expense",
        subType: "direct_cost",
        canPost: true,
        parentCode: "5400",
        description: "Delivery, haulage, site transport",
      },
      {
        accountCode: "5450",
        accountName: "Site Expenses",
        accountType: "expense",
        subType: "direct_cost",
        canPost: true,
        parentCode: "5400",
        description: "Water, power, security, sanitation at project sites",
      },
      {
        accountCode: "5490",
        accountName: "Other Direct Costs",
        accountType: "expense",
        subType: "direct_cost",
        canPost: true,
        parentCode: "5400",
        description: "Permits, inspections, other project-specific costs",
      },

      // OPERATING EXPENSES (6000-6999)
      {
        accountCode: "6000",
        accountName: "Operating Expenses",
        accountType: "expense",
        subType: "header",
        canPost: false,
      },
      {
        accountCode: "6100",
        accountName: "Salaries & Wages",
        accountType: "expense",
        subType: "payroll",
        canPost: true,
        parentCode: "6000",
        systemAccount: "salaries_expense",
      },
      {
        accountCode: "6110",
        accountName: "Employer NSSF",
        accountType: "expense",
        subType: "payroll",
        canPost: true,
        parentCode: "6000",
        systemAccount: "employer_nssf_expense",
      },
      {
        accountCode: "6115",
        accountName: "Employer AHL",
        accountType: "expense",
        subType: "payroll",
        canPost: true,
        parentCode: "6000",
        systemAccount: "employer_ahl_expense",
        description: "Employer share of Affordable Housing Levy",
      },
      {
        accountCode: "6120",
        accountName: "Staff Benefits",
        accountType: "expense",
        subType: "payroll",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6200",
        accountName: "Rent Expense",
        accountType: "expense",
        subType: "occupancy",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6210",
        accountName: "Utilities",
        accountType: "expense",
        subType: "occupancy",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6300",
        accountName: "Office Supplies",
        accountType: "expense",
        subType: "admin",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6310",
        accountName: "Printing & Stationery",
        accountType: "expense",
        subType: "admin",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6400",
        accountName: "Telephone & Internet",
        accountType: "expense",
        subType: "communication",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6500",
        accountName: "Transport & Fuel",
        accountType: "expense",
        subType: "transport",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6510",
        accountName: "Vehicle Repairs",
        accountType: "expense",
        subType: "transport",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6600",
        accountName: "Insurance",
        accountType: "expense",
        subType: "insurance",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6700",
        accountName: "Depreciation Expense",
        accountType: "expense",
        subType: "depreciation",
        canPost: true,
        parentCode: "6000",
        systemAccount: "depreciation_expense",
      },
      {
        accountCode: "6800",
        accountName: "Professional Fees",
        accountType: "expense",
        subType: "professional",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6810",
        accountName: "Legal Fees",
        accountType: "expense",
        subType: "professional",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6820",
        accountName: "Audit Fees",
        accountType: "expense",
        subType: "professional",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6900",
        accountName: "Bank Charges",
        accountType: "expense",
        subType: "financial",
        canPost: true,
        parentCode: "6000",
        systemAccount: "bank_charges",
      },
      {
        accountCode: "6910",
        accountName: "M-Pesa Charges",
        accountType: "expense",
        subType: "financial",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6950",
        accountName: "Interest Expense",
        accountType: "expense",
        subType: "financial",
        canPost: true,
        parentCode: "6000",
        systemAccount: "interest_expense",
      },
      {
        accountCode: "6520",
        accountName: "Travel & Accommodation",
        accountType: "expense",
        subType: "transport",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6530",
        accountName: "Meals & Entertainment",
        accountType: "expense",
        subType: "transport",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6540",
        accountName: "Parking & Tolls",
        accountType: "expense",
        subType: "transport",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6550",
        accountName: "Training & Development",
        accountType: "expense",
        subType: "admin",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6560",
        accountName: "Marketing & Advertising",
        accountType: "expense",
        subType: "admin",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6570",
        accountName: "Repairs & Maintenance",
        accountType: "expense",
        subType: "occupancy",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6580",
        accountName: "Cleaning & Sanitation",
        accountType: "expense",
        subType: "occupancy",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6590",
        accountName: "Security Services",
        accountType: "expense",
        subType: "occupancy",
        canPost: true,
        parentCode: "6000",
      },
      {
        accountCode: "6990",
        accountName: "Miscellaneous Expenses",
        accountType: "expense",
        subType: "other",
        canPost: true,
        parentCode: "6000",
      },
    ];
  }

  // ============================================
  // SEED CHART OF ACCOUNTS
  // ============================================
  static async seedChartOfAccounts(companyId, user, session = null) {
    await dbConnect();

    const accounts = this.getStandardChartOfAccounts();
    const createdAccounts = [];
    const accountMap = new Map();

    // First pass: Create accounts without parent references
    for (const accountData of accounts) {
      const { parentCode, ...data } = accountData;

      const accountDoc = {
        ...data,
        companyId,
        isActive: true,
        balance: 0,
        createdBy: { name: user.name, id: user.id },
      };

      let account;
      if (session) {
        [account] = await Account.create([accountDoc], { session });
      } else {
        account = await Account.create(accountDoc);
      }

      accountMap.set(data.accountCode, account);
      createdAccounts.push(account);
    }

    // Second pass: Update parent references and hierarchy
    for (const accountData of accounts) {
      if (accountData.parentCode) {
        const parent = accountMap.get(accountData.parentCode);
        const child = accountMap.get(accountData.accountCode);

        if (parent && child) {
          child.parentAccount = parent._id;
          child.ancestors = [...(parent.ancestors || []), parent._id];
          child.level = (parent.level || 0) + 1;
          child.path = parent.path
            ? `${parent.path}/${child.accountCode}`
            : child.accountCode;

          if (session) {
            await child.save({ session });
          } else {
            await child.save();
          }

          // Update parent canPost if needed
          if (parent.canPost) {
            parent.canPost = false;
            if (session) {
              await parent.save({ session });
            } else {
              await parent.save();
            }
          }
        }
      }
    }

    return {
      success: true,
      count: createdAccounts.length,
      accounts: createdAccounts.map((a) => ({
        accountCode: a.accountCode,
        accountName: a.accountName,
      })),
    };
  }

  // ============================================
  // INITIALIZE FISCAL PERIODS
  // ============================================
  static async initializeFiscalPeriods(
    companyId,
    fiscalYearStart,
    user,
    session = null
  ) {
    await dbConnect();

    const startDate = new Date(fiscalYearStart);
    const year = startDate.getFullYear();
    const periods = [];

    // Month names for periodName
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    // Create 12 monthly periods
    for (let i = 0; i < 12; i++) {
      const periodStart = new Date(year, startDate.getMonth() + i, 1);
      const periodEnd = new Date(year, startDate.getMonth() + i + 1, 0);

      const periodYear = periodStart.getFullYear();
      const periodMonth = periodStart.getMonth() + 1; // 1-12
      const periodCode = `${periodYear}-${String(periodMonth).padStart(2, "0")}`;
      const periodName = `${monthNames[periodStart.getMonth()]} ${periodYear}`;

      const periodData = {
        companyId,
        periodCode,
        periodName,
        year: periodYear,
        month: periodMonth,
        startDate: periodStart,
        endDate: periodEnd,
        status: i === 0 ? "open" : "future",
        createdBy: { name: user.name, id: user.id },
      };

      let period;
      if (session) {
        [period] = await FiscalPeriod.create([periodData], { session });
      } else {
        period = await FiscalPeriod.create(periodData);
      }

      periods.push(period);
    }

    return {
      success: true,
      fiscalYear: year,
      periods: periods.map((p) => ({
        periodCode: p.periodCode,
        status: p.status,
      })),
    };
  }

  // ============================================
  // COMPLETE COMPANY ONBOARDING
  // ============================================
  static async completeOnboarding(companyId, options = {}, user) {
    await dbConnect();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const company = await Company.findById(companyId).session(session);
      if (!company) {
        throw new Error("Company not found");
      }

      const results = {
        company: company.name,
        steps: [],
      };

      // Step 1: Seed Chart of Accounts (if enabled)
      if (options.seedAccounts !== false) {
        const accountResult = await this.seedChartOfAccounts(
          companyId,
          user,
          session
        );
        results.steps.push({
          step: "Chart of Accounts",
          success: accountResult.success,
          count: accountResult.count,
        });
      }

      // Step 2: Initialize Fiscal Periods (if enabled)
      if (options.initFiscalPeriods !== false) {
        const fiscalStart =
          options.fiscalYearStart ||
          company.settings?.fiscalYearStart ||
          new Date(new Date().getFullYear(), 0, 1);

        const fiscalResult = await this.initializeFiscalPeriods(
          companyId,
          fiscalStart,
          user,
          session
        );
        results.steps.push({
          step: "Fiscal Periods",
          success: fiscalResult.success,
          fiscalYear: fiscalResult.fiscalYear,
        });
      }

      // Step 3: Update company setup status
      company.settings = company.settings || {};
      company.settings.setupCompleted = true;
      company.settings.setupCompletedAt = new Date();
      company.settings.setupCompletedBy = { name: user.name, id: user.id };

      // Track what was setup
      company.settings.onboardingSteps = {
        chartOfAccounts: options.seedAccounts !== false,
        fiscalPeriods: options.initFiscalPeriods !== false,
        completedAt: new Date(),
      };

      await company.save({ session });

      await session.commitTransaction();

      return {
        success: true,
        message: "Company onboarding completed successfully",
        ...results,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ============================================
  // CREATE COMPANY WITH FULL SETUP
  // ============================================
  static async createCompanyWithSetup(companyData, adminUser, options = {}) {
    await dbConnect();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Validate required fields
      if (!companyData.name) {
        throw new Error("Company name is required");
      }

      // Generate slug if not provided
      const slug =
        companyData.slug ||
        companyData.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

      // Check for existing company with same slug
      const existing = await Company.findOne({ slug }).session(session);
      if (existing) {
        throw new Error("A company with this slug already exists");
      }

      // Create the company
      const [company] = await Company.create(
        [
          {
            name: companyData.name,
            slug,
            legalName: companyData.legalName || companyData.name,
            industry: companyData.industry || "general",
            taxPin: companyData.taxPin,
            vatNumber: companyData.vatNumber,
            registrationNumber: companyData.registrationNumber,
            contactEmail: companyData.contactEmail,
            contactPhone: companyData.contactPhone,
            website: companyData.website,
            address: companyData.address || {},
            settings: {
              currency: companyData.currency || "KES",
              timezone: companyData.timezone || "Africa/Nairobi",
              dateFormat: companyData.dateFormat || "DD/MM/YYYY",
              fiscalYearStart:
                companyData.fiscalYearStart ||
                new Date(new Date().getFullYear(), 0, 1),
              vatRate: companyData.vatRate ?? 16,
              documentNumbering: {
                invoicePrefix: companyData.invoicePrefix || "INV",
                billPrefix: companyData.billPrefix || "BILL",
                paymentPrefix: companyData.paymentPrefix || "PAY",
                quotePrefix: companyData.quotePrefix || "QT",
              },
            },
            subscription: {
              plan: companyData.subscriptionPlan || "free",
              status: "active",
              maxUsers: this.getMaxUsersForPlan(
                companyData.subscriptionPlan || "free"
              ),
              startDate: new Date(),
            },
            features: this.getDefaultFeatures(
              companyData.subscriptionPlan || "free"
            ),
            status: "active",
            createdBy: { name: adminUser.name, id: adminUser.id },
          },
        ],
        { session }
      );

      const results = {
        company: {
          id: company._id,
          name: company.name,
          slug: company.slug,
        },
        setup: [],
      };

      // Run onboarding steps if requested
      if (options.seedAccounts !== false) {
        const accountResult = await this.seedChartOfAccounts(
          company._id,
          adminUser,
          session
        );
        results.setup.push({
          step: "Chart of Accounts",
          count: accountResult.count,
        });
      }

      if (options.initFiscalPeriods !== false) {
        const fiscalResult = await this.initializeFiscalPeriods(
          company._id,
          company.settings.fiscalYearStart,
          adminUser,
          session
        );
        results.setup.push({
          step: "Fiscal Periods",
          year: fiscalResult.fiscalYear,
        });
      }

      // Mark setup as complete
      company.settings.setupCompleted = true;
      company.settings.setupCompletedAt = new Date();
      await company.save({ session });

      await session.commitTransaction();

      return {
        success: true,
        message: "Company created and setup completed",
        ...results,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================
  static getMaxUsersForPlan(plan) {
    return getPlanLimits(plan).maxUsers;
  }

  static getDefaultFeatures(plan) {
    const baseFeatures = {
      inventory: true,
      sales: true,
      purchases: true,
      accounting: false,
      reports: true,
      multiCurrency: false,
      budgeting: false,
      payroll: false,
      projects: false,
      apiAccess: false,
    };

    switch (plan) {
      case "starter":
        return { ...baseFeatures, accounting: true };
      case "professional":
        return {
          ...baseFeatures,
          accounting: true,
          multiCurrency: true,
          budgeting: true,
        };
      case "enterprise":
        return {
          inventory: true,
          sales: true,
          purchases: true,
          accounting: true,
          reports: true,
          multiCurrency: true,
          budgeting: true,
          payroll: true,
          projects: true,
          apiAccess: true,
        };
      default:
        return baseFeatures;
    }
  }

  // ============================================
  // SETUP VERIFICATION
  // ============================================
  static async verifySetup(companyId) {
    await dbConnect();

    const company = await Company.findById(companyId).lean();
    if (!company) {
      throw new Error("Company not found");
    }

    const [accountCount, fiscalPeriodCount] = await Promise.all([
      Account.countDocuments({ companyId, isActive: true }),
      FiscalPeriod.countDocuments({ companyId }),
    ]);

    const systemAccounts = await Account.find({
      companyId,
      systemAccount: { $ne: null },
    })
      .select("systemAccount accountName")
      .lean();

    const requiredSystemAccounts = [
      "accounts_receivable",
      "accounts_payable",
      "inventory",
      "technician_stock",
      "sales_revenue",
      "cogs",
      "vat_input",
      "vat_output",
      "cash_at_bank",
    ];

    const missingSystemAccounts = requiredSystemAccounts.filter(
      (sa) => !systemAccounts.find((a) => a.systemAccount === sa)
    );

    return {
      company: company.name,
      setupCompleted: company.settings?.setupCompleted || false,
      accounts: {
        total: accountCount,
        systemAccountsConfigured: systemAccounts.length,
        missingSystemAccounts,
      },
      fiscalPeriods: {
        total: fiscalPeriodCount,
        hasCurrentPeriod: fiscalPeriodCount > 0,
      },
      isReady:
        accountCount >= 30 &&
        fiscalPeriodCount >= 12 &&
        missingSystemAccounts.length === 0,
    };
  }

  // ============================================
  // GET ONBOARDING STATUS
  // ============================================
  static async getOnboardingStatus(companyId) {
    await dbConnect();

    const company = await Company.findById(companyId).lean();
    if (!company) {
      throw new Error("Company not found");
    }

    const verification = await this.verifySetup(companyId);

    return {
      company: {
        name: company.name,
        status: company.status,
        subscription: company.subscription?.plan,
      },
      setupCompleted: company.settings?.setupCompleted || false,
      steps: {
        companyCreated: true,
        chartOfAccountsSeeded: verification.accounts.total >= 30,
        fiscalPeriodsCreated: verification.fiscalPeriods.total >= 12,
        systemAccountsConfigured:
          verification.accounts.missingSystemAccounts.length === 0,
      },
      verification,
      isFullyOnboarded: verification.isReady,
    };
  }
}

export default CompanyOnboardingService;
