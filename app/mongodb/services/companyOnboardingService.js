import mongoose from "mongoose";
import { getStandardChartOfAccounts } from "@/lib/chart-of-accounts";
import { provisionCompany } from "@/app/db/provisioning";
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
  /**
   * Moved to lib/chart-of-accounts.js so Postgres provisioning seeds the same
   * 93 accounts from the same definition. A second copy of this list is a
   * guarantee that the two stores drift.
   */
  static getStandardChartOfAccounts() {
    return getStandardChartOfAccounts();
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

      // Provision the tenant in Postgres before committing here.
      //
      // A company that exists in one store and not the other is a tenant whose
      // ledger pages fail for reasons nobody in the business can act on, so
      // this is part of creating a company rather than something to catch up
      // on later. It runs BEFORE the commit deliberately: if provisioning
      // fails the Mongo transaction aborts and the company is not created at
      // all, which is recoverable, where a half-created tenant is not.
      //
      // The reverse window — Postgres committed, Mongo aborted — leaves an
      // unreferenced tenant with no users and no data. Harmless, and
      // provisionCompany is keyed on the source id, so a retry adopts it
      // rather than creating a second one.
      await provisionCompany({
        sourceCompanyId: company._id.toString(),
        name: company.name,
        slug: company.slug,
        baseCurrency: companyData.currency,
        fiscalYearStart: company.settings.fiscalYearStart,
        seedAccounts: options.seedAccounts !== false,
        initFiscalPeriods: options.initFiscalPeriods !== false,
        // Whoever ran onboarding gets the first grant — a company nobody may
        // enter is not a usable company.
        ownerUserId: adminUser?.id ?? null,
        ownerName: adminUser?.name ?? null,
        ownerRole: adminUser?.role ?? null,
      });

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
