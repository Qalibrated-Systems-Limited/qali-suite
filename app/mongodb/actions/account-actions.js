"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import Account from "../../models/account";
import connectDB from "../../config/dbConnect";
import { accountSubType, accountTypes } from "@/lib/utils";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { CompanyOnboardingService } from "../services/companyOnboardingService";
import { requirePlanAccess } from "@/lib/plan-gate";

// ============================================
// ZOD SCHEMAS
// ============================================

const CreateAccountSchema = z.object({
  accountCode: z
    .string()
    .min(1, "Account code is required")
    .max(20, "Account code too long")
    .regex(/^[0-9]+$/, "Account code must contain only numbers"),
  accountName: z
    .string()
    .min(1, "Account name is required")
    .max(100, "Account name too long"),
  accountType: z.enum(accountTypes, {
    required_error: "Account type is required",
  }),
  subType: z.enum(accountSubType, {
    required_error: "Sub-type is required",
  }),
  parentId: z.string().optional(),
  systemAccount: z.string().optional(),
  normalBalance: z.enum(["debit", "credit"]).optional(),
  description: z.string().optional(),
  canPost: z.boolean().optional(),
});

const UpdateAccountSchema = z.object({
  accountName: z.string().min(1, "Account name is required").max(100),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

// ============================================
// TYPES
// ============================================

// ============================================
// ACCOUNT ACTIONS
// ============================================

/**
 * Create a new account
 */
export async function createAccount(prevState, formData) {
  try {
    await requirePlanAccess("finance");

    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    if (
      !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(
        user.role,
      )
    ) {
      return {
        errors: { _form: ["You don't have permission to manage accounts."] },
      };
    }

    // Validate
    const validatedFields = CreateAccountSchema.safeParse({
      accountCode: formData.get("accountCode"),
      accountName: formData.get("accountName"),
      accountType: formData.get("accountType"),
      subType: formData.get("subType"),
      parentId: formData.get("parentId") || undefined,
      systemAccount: formData.get("systemAccount") || undefined,
      normalBalance: formData.get("normalBalance") || undefined,
      description: formData.get("description") || undefined,
      canPost: formData.get("canPost") === "true",
    });

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
      };
    }

    const data = validatedFields.data;

    await connectDB();

    // Check for duplicate account code (tenant-scoped)
    const existingCode = await Account.findOne(
      withTenantScope({ accountCode: data.accountCode }, tenantCompanyId, isSuperAdmin)
    );
    if (existingCode) {
      return {
        errors: {
          accountCode: ["An account with this code already exists"],
        },
      };
    }

    // Check for duplicate account name (tenant-scoped)
    const existingName = await Account.findOne(
      withTenantScope({ accountName: data.accountName }, tenantCompanyId, isSuperAdmin)
    );
    if (existingName) {
      return {
        errors: {
          accountName: ["An account with this name already exists"],
        },
      };
    }

    // Validate parent account if provided (tenant-scoped)
    if (data.parentId) {
      const parentAccount = await Account.findOne(
        withTenantScope({ _id: data.parentId }, tenantCompanyId, isSuperAdmin)
      );
      if (!parentAccount) {
        return {
          errors: {
            parentId: ["Parent account not found"],
          },
        };
      }

      // Parent must be a header account
      if (parentAccount.subType !== "header") {
        return {
          errors: {
            parentId: [
              "Parent account must be a header account (cannot post to it)",
            ],
          },
        };
      }

      // Parent and child must have same account type
      if (parentAccount.accountType !== data.accountType) {
        return {
          errors: {
            parentId: [
              `Parent account type (${parentAccount.accountType}) must match account type (${data.accountType})`,
            ],
          },
        };
      }
    }

    // Validate systemAccount uniqueness (tenant-scoped)
    if (data.systemAccount) {
      const existingSystem = await Account.findOne(
        withTenantScope({ systemAccount: data.systemAccount }, tenantCompanyId, isSuperAdmin)
      );
      if (existingSystem) {
        return {
          errors: {
            _form: [
              `System account "${data.systemAccount}" is already assigned to another account`,
            ],
          },
        };
      }
    }

    // Set canPost based on subType
    const canPost = data.subType !== "header";

    // Create account (with tenant companyId)
    await Account.create({
      companyId: tenantCompanyId,
      ...data,
      canPost,
      isActive: true,
      createdBy: {
        name: user.name,
        id: user.id,
      },
      lastModifiedBy: {
        name: user.name,
        id: user.id,
      },
    });

    // Revalidate
    revalidatePath("/dashboard/accounts");
    revalidatePath("/dashboard/accounting");

    return {
      success: true,
      message: "Account created successfully",
    };
  } catch (error) {
    console.error("Create account error:", error);
    return {
      errors: {
        _form: [error.message || "Failed to create account"],
      },
    };
  }
}

/**
 * Quick-create an expense account from inline dialogs (e.g. budget form).
 * Returns { success, account } or { success: false, error, values }.
 * On error, `values` contains submitted data so the form can persist state.
 */
export async function quickCreateExpenseAccount(formData) {
  const accountCode = (formData.get("accountCode") || "").trim();
  const accountName = (formData.get("accountName") || "").trim();
  const subType = formData.get("subType") || "operating_expense";
  const values = { accountCode, accountName, subType };

  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    if (
      !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(
        user.role,
      )
    ) {
      return { success: false, error: "You don't have permission to manage accounts.", values };
    }

    if (accountCode && !/^[0-9]+$/.test(accountCode)) {
      return { success: false, error: "Account code must be numeric", values };
    }
    if (!accountName) {
      return { success: false, error: "Account name is required", values };
    }

    await connectDB();

    // Cost-of-sales family (COGS, direct costs, inventory adjustments)
    // books to 5xxx; every other expense subtype to 6xxx.
    const { DIRECT_COST_SUBTYPES, COA_RANGES, nextCodeInRange } = await import(
      "@/lib/coa-codes"
    );
    const range = DIRECT_COST_SUBTYPES.has(subType)
      ? COA_RANGES.direct_cost
      : COA_RANGES.expense;

    let finalCode = accountCode;
    if (!finalCode) {
      // Auto-assign the next free code in the range — no guessing.
      const existing = await Account.find(
        withTenantScope({}, tenantCompanyId, isSuperAdmin),
      )
        .select("accountCode")
        .lean();
      finalCode = nextCodeInRange(
        existing.map((a) => a.accountCode),
        range,
      );
      if (!finalCode) {
        return { success: false, error: "No free codes left in this range — enter one manually.", values };
      }
    } else {
      const codeNum = parseInt(finalCode, 10);
      if (codeNum < range[0] || codeNum > range[1]) {
        return {
          success: false,
          error: `${DIRECT_COST_SUBTYPES.has(subType) ? "Direct cost/COGS" : "Expense"} account codes must be between ${range[0]} and ${range[1]}`,
          values,
        };
      }
    }

    // Check uniqueness
    const existingCode = await Account.findOne(
      withTenantScope({ accountCode: finalCode }, tenantCompanyId, isSuperAdmin),
    );
    if (existingCode) {
      return { success: false, error: `Account code ${finalCode} already exists`, values };
    }

    const account = await Account.create({
      companyId: tenantCompanyId,
      accountCode: finalCode,
      accountName,
      accountType: "expense",
      subType,
      canPost: true,
      isActive: true,
      createdBy: { name: user.name, id: user.id },
      lastModifiedBy: { name: user.name, id: user.id },
    });

    revalidatePath("/dashboard/accounts");

    return {
      success: true,
      account: {
        _id: account._id.toString(),
        accountCode: account.accountCode,
        accountName: account.accountName,
        subType: account.subType,
      },
    };
  } catch (error) {
    console.error("Quick create expense account error:", error);
    return { success: false, error: error.message || "Failed to create account", values };
  }
}

/**
 * Update existing account
 * Uses bind() to pass accountId
 */
export async function updateAccount(accountId, prevState, formData) {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (
      !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(
        user.role,
      )
    ) {
      return {
        errors: { _form: ["You don't have permission to manage accounts."] },
      };
    }

    // Validate
    const validatedFields = UpdateAccountSchema.safeParse({
      accountName: formData.get("accountName"),
      description: formData.get("description"),
      isActive: formData.get("isActive") === "true",
    });

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
      };
    }

    const data = validatedFields.data;

    await connectDB();

    // Get account (tenant-scoped)
    const account = await Account.findOne(
      withTenantScope({ _id: accountId }, companyId, isSuperAdmin)
    );
    if (!account) {
      return {
        errors: { _form: ["Account not found"] },
      };
    }

    // Prevent editing system accounts (critical accounts)
    if (account.systemAccount) {
      const criticalAccounts = [
        "accounts_receivable",
        "accounts_payable",
        "inventory",
        "cogs",
        "sales_revenue",
        "vat_input",
        "vat_output",
        "wht_payable",
        "employee_advances",
        "employee_payables",
      ];

      if (criticalAccounts.includes(account.systemAccount)) {
        return {
          errors: {
            _form: [
              "Cannot modify critical system accounts. Only description can be updated.",
            ],
          },
        };
      }
    }

    // Check for duplicate account name (excluding current account, tenant-scoped)
    if (data.accountName && data.accountName !== account.accountName) {
      const existingName = await Account.findOne(
        withTenantScope({ accountName: data.accountName, _id: { $ne: accountId } }, account.companyId, isSuperAdmin)
      );
      if (existingName) {
        return {
          errors: {
            accountName: ["An account with this name already exists"],
          },
        };
      }
    }

    // Update only allowed fields
    if (data.accountName) account.accountName = data.accountName;
    if (data.description !== undefined) account.description = data.description;
    if (data.isActive !== undefined) account.isActive = data.isActive;

    account.lastModifiedBy = {
      name: user.name,
      id: user.id,
    };

    await account.save();

    // Revalidate
    revalidatePath("/dashboard/accounts");
    revalidatePath("/dashboard/accounting");
    revalidatePath(`/dashboard/accounts/${accountId}`);

    return {
      success: true,
      message: "Account updated successfully",
    };
  } catch (error) {
    console.error("Update account error:", error);
    return {
      errors: { _form: [error.message || "Failed to update account"] },
    };
  }
}

/**
 * Deactivate account (soft delete)
 * Uses bind() to pass accountId
 */
export async function deactivateAccount(accountId) {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (user.role !== "Admin") {
      return {
        errors: { _form: ["Unauthorized: Admin role required"] },
      };
    }

    await connectDB();

    // Get account (tenant-scoped)
    const account = await Account.findOne(
      withTenantScope({ _id: accountId }, companyId, isSuperAdmin)
    );
    if (!account) {
      return {
        errors: { _form: ["Account not found"] },
      };
    }

    // Prevent deactivating system accounts
    if (account.systemAccount) {
      return {
        errors: {
          _form: [
            "Cannot deactivate system accounts. They are required for operations.",
          ],
        },
      };
    }

    // Check if account has transactions (tenant-scoped)
    const JournalEntry = (await import("../../models/JournalEntry")).default;
    const transactionCount = await JournalEntry.countDocuments(
      withTenantScope({ "lines.accountId": accountId, status: "posted" }, account.companyId, isSuperAdmin)
    );

    if (transactionCount > 0) {
      return {
        errors: {
          _form: [
            `Cannot deactivate account with ${transactionCount} posted transactions. Set as inactive instead.`,
          ],
        },
      };
    }

    // Check if account has child accounts (tenant-scoped)
    const childCount = await Account.countDocuments(
      withTenantScope({ parentId: accountId, isActive: true }, account.companyId, isSuperAdmin)
    );

    if (childCount > 0) {
      return {
        errors: {
          _form: [
            `Cannot deactivate account with ${childCount} active child accounts. Deactivate children first.`,
          ],
        },
      };
    }

    // Soft delete
    account.isActive = false;
    account.lastModifiedBy = {
      name: user.name,
      id: user.id,
    };

    await account.save();

    // Revalidate
    revalidatePath("/dashboard/accounts");
    revalidatePath("/dashboard/accounting");

    return {
      success: true,
      message: "Account deactivated successfully",
    };
  } catch (error) {
    console.error("Deactivate account error:", error);
    return {
      errors: { _form: [error.message || "Failed to deactivate account"] },
    };
  }
}

/**
 * Activate account
 * Uses bind() to pass accountId
 */
export async function activateAccount(accountId) {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (
      !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(
        user.role,
      )
    ) {
      return {
        errors: { _form: ["You don't have permission to manage accounts."] },
      };
    }

    await connectDB();

    // Get account (tenant-scoped)
    const account = await Account.findOne(
      withTenantScope({ _id: accountId }, companyId, isSuperAdmin)
    );
    if (!account) {
      return {
        errors: { _form: ["Account not found"] },
      };
    }

    // Check if parent account is active (tenant-scoped)
    if (account.parentId) {
      const parent = await Account.findOne(
        withTenantScope({ _id: account.parentId }, account.companyId, isSuperAdmin)
      );
      if (parent && !parent.isActive) {
        return {
          errors: {
            _form: ["Cannot activate account. Parent account is inactive."],
          },
        };
      }
    }

    account.isActive = true;
    account.lastModifiedBy = {
      name: user.name,
      id: user.id,
    };

    await account.save();

    // Revalidate
    revalidatePath("/dashboard/accounts");
    revalidatePath("/dashboard/accounting");
    revalidatePath(`/dashboard/accounts/${accountId}`);

    return {
      success: true,
      message: "Account activated successfully",
    };
  } catch (error) {
    console.error("Activate account error:", error);
    return {
      errors: { _form: [error.message || "Failed to activate account"] },
    };
  }
}

/**
 * Calculate account balance
 * Uses bind() to pass accountId
 */
export async function calculateAccountBalance(accountId) {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (
      !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(
        user.role,
      )
    ) {
      return {
        errors: { _form: ["You don't have permission to manage accounts."] },
      };
    }

    await connectDB();

    // Get account (tenant-scoped)
    const account = await Account.findOne(
      withTenantScope({ _id: accountId }, companyId, isSuperAdmin)
    );
    if (!account) {
      return {
        errors: { _form: ["Account not found"] },
      };
    }

    // Calculate balance
    await account.calculateBalance();

    // Revalidate
    revalidatePath("/dashboard/accounts");
    revalidatePath(`/dashboard/accounts/${accountId}`);
    revalidatePath("/dashboard/reports/trial-balance");
    revalidatePath("/dashboard/reports/balance-sheet");

    return {
      success: true,
      message: "Account balance calculated successfully",
    };
  } catch (error) {
    console.error("Calculate balance error:", error);
    return {
      errors: {
        _form: [error.message || "Failed to calculate account balance"],
      },
    };
  }
}

/**
 * Recalculate all account balances
 */
export async function recalculateAllBalances() {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (user.role !== "Admin") {
      return {
        errors: { _form: ["Unauthorized: Admin role required"] },
      };
    }

    await connectDB();

    // Get all postable accounts (tenant-scoped)
    const accounts = await Account.find(
      withTenantScope({ canPost: true, isActive: true }, companyId, isSuperAdmin)
    );

    let successCount = 0;
    let errorCount = 0;

    for (const account of accounts) {
      try {
        await account.calculateBalance();
        successCount++;
      } catch (error) {
        console.error(
          `Failed to calculate balance for ${account.accountName}:`,
          error
        );
        errorCount++;
      }
    }

    // Revalidate
    revalidatePath("/dashboard/accounts");
    revalidatePath("/dashboard/reports/trial-balance");
    revalidatePath("/dashboard/reports/balance-sheet");
    revalidatePath("/dashboard/reports/income-statement");

    return {
      success: true,
      message: `Recalculated ${successCount} account balances${
        errorCount > 0 ? ` (${errorCount} errors)` : ""
      }`,
    };
  } catch (error) {
    console.error("Recalculate all balances error:", error);
    return {
      errors: {
        _form: [error.message || "Failed to recalculate account balances"],
      },
    };
  }
}

/**
 * Reorder accounts (update display order)
 * Uses complex data via JSON in FormData
 */
export async function reorderAccounts(prevState, formData) {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (
      !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(
        user.role,
      )
    ) {
      return {
        errors: { _form: ["You don't have permission to manage accounts."] },
      };
    }

    await connectDB();

    // Parse order data from FormData
    const orderDataStr = formData.get("orderData");
    if (!orderDataStr) {
      return {
        errors: { _form: ["Order data is required"] },
      };
    }

    const orderData = JSON.parse(orderDataStr);

    // Validate order data
    if (!Array.isArray(orderData) || orderData.length === 0) {
      return {
        errors: { _form: ["Invalid order data format"] },
      };
    }

    // Update display order for each account (tenant-scoped)
    let successCount = 0;
    let errorCount = 0;

    for (const item of orderData) {
      try {
        const { accountId, displayOrder } = item;

        // Only update if account belongs to tenant
        await Account.findOneAndUpdate(
          withTenantScope({ _id: accountId }, companyId, isSuperAdmin),
          {
            displayOrder,
            lastModifiedBy: {
              name: user.name,
              id: user.id,
            },
          }
        );

        successCount++;
      } catch (error) {
        console.error(`Failed to reorder account ${item.accountId}:`, error);
        errorCount++;
      }
    }

    // Revalidate
    revalidatePath("/dashboard/accounts");
    revalidatePath("/dashboard/accounting");

    return {
      success: true,
      message: `Reordered ${successCount} accounts${
        errorCount > 0 ? ` (${errorCount} errors)` : ""
      }`,
    };
  } catch (error) {
    console.error("Reorder accounts error:", error);
    return {
      errors: { _form: [error.message || "Failed to reorder accounts"] },
    };
  }
}

/**
 * Get account hierarchy for dropdown
 * Returns simplified data for client-side use
 */
export async function getAccountHierarchy() {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin } = await getTenantContext();

    await connectDB();

    // Get accounts (tenant-scoped)
    const accounts = await Account.find(
      withTenantScope({ isActive: true }, companyId, isSuperAdmin)
    )
      .sort({ accountCode: 1 })
      .select(
        "_id accountCode accountName accountType subType parentId canPost"
      )
      .lean();

    // Build hierarchy
    const accountMap = new Map();
    const rootAccounts = [];

    // First pass: create map
    accounts.forEach((account) => {
      accountMap.set(account._id.toString(), {
        ...account,
        children: [],
      });
    });

    // Second pass: build hierarchy
    accounts.forEach((account) => {
      const node = accountMap.get(account._id.toString());
      if (account.parentId) {
        const parent = accountMap.get(account.parentId.toString());
        if (parent) {
          parent.children.push(node);
        } else {
          rootAccounts.push(node);
        }
      } else {
        rootAccounts.push(node);
      }
    });

    return {
      success: true,
      accounts: rootAccounts,
    };
  } catch (error) {
    console.error("Get account hierarchy error:", error);
    return {
      success: false,
      error: error.message || "Failed to get account hierarchy",
    };
  }
}

/**
 * Create missing advance system accounts
 * This function ensures supplier_advance and customer_advance accounts exist
 * Call this if you get errors about missing advance accounts during bank allocation
 */
export async function ensureAdvanceAccountsExist() {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (
      !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(
        user.role,
      )
    ) {
      return {
        success: false,
        error: "You don't have permission to manage accounts.",
      };
    }

    await connectDB();

    const results = [];

    // Check/create Supplier Advance (Asset - code 1170)
    // Check by systemAccount OR accountCode to avoid duplicates
    let supplierAdvance = await Account.findOne(
      withTenantScope({ systemAccount: "supplier_advance" }, companyId, isSuperAdmin)
    );

    if (!supplierAdvance) {
      // Also check by accountCode in case it exists without systemAccount
      supplierAdvance = await Account.findOne(
        withTenantScope({ accountCode: "1170" }, companyId, isSuperAdmin)
      );
    }

    if (!supplierAdvance) {
      // Find Current Assets parent for proper hierarchy
      const currentAssets = await Account.findOne(
        withTenantScope({ accountCode: "1100" }, companyId, isSuperAdmin)
      );

      const newSupplierAdvance = await Account.create({
        companyId,
        accountCode: "1170",
        accountName: "Supplier Advance",
        accountType: "asset",
        subType: "prepaid_expense",
        systemAccount: "supplier_advance",
        parentAccount: currentAssets?._id || null,
        ancestors: currentAssets ? [currentAssets.parentAccount, currentAssets._id].filter(Boolean) : [],
        path: currentAssets ? `${currentAssets.path}/1170` : "1170",
        level: 2,
        canPost: true,
        isActive: true,
        description: "Prepayments to suppliers (overpayments on bills)",
        createdBy: { name: user.name, id: user.id },
      });
      results.push({ account: "Supplier Advance", action: "created", code: "1170" });
    } else if (!supplierAdvance.systemAccount) {
      // Account exists but without systemAccount - update it
      await Account.findByIdAndUpdate(supplierAdvance._id, {
        $set: { systemAccount: "supplier_advance" },
      });
      results.push({ account: "Supplier Advance", action: "updated", code: supplierAdvance.accountCode });
    } else {
      results.push({ account: "Supplier Advance", action: "exists", code: supplierAdvance.accountCode });
    }

    // Check/create Customer Advance (Liability - code 2190)
    // Check by systemAccount OR accountCode to avoid duplicates
    let customerAdvance = await Account.findOne(
      withTenantScope({ systemAccount: "customer_advance" }, companyId, isSuperAdmin)
    );

    if (!customerAdvance) {
      // Also check by accountCode in case it exists without systemAccount
      customerAdvance = await Account.findOne(
        withTenantScope({ accountCode: "2190" }, companyId, isSuperAdmin)
      );
    }

    if (!customerAdvance) {
      // Find Current Liabilities parent for proper hierarchy
      const currentLiabilities = await Account.findOne(
        withTenantScope({ accountCode: "2100" }, companyId, isSuperAdmin)
      );

      const newCustomerAdvance = await Account.create({
        companyId,
        accountCode: "2190",
        accountName: "Customer Advance",
        accountType: "liability",
        subType: "customer_deposit",
        systemAccount: "customer_advance",
        parentAccount: currentLiabilities?._id || null,
        ancestors: currentLiabilities ? [currentLiabilities.parentAccount, currentLiabilities._id].filter(Boolean) : [],
        path: currentLiabilities ? `${currentLiabilities.path}/2190` : "2190",
        level: 2,
        canPost: true,
        isActive: true,
        description: "Customer deposits and overpayments",
        createdBy: { name: user.name, id: user.id },
      });
      results.push({ account: "Customer Advance", action: "created", code: "2190" });
    } else if (!customerAdvance.systemAccount) {
      // Account exists but without systemAccount - update it
      await Account.findByIdAndUpdate(customerAdvance._id, {
        $set: { systemAccount: "customer_advance" },
      });
      results.push({ account: "Customer Advance", action: "updated", code: customerAdvance.accountCode });
    } else {
      results.push({ account: "Customer Advance", action: "exists", code: customerAdvance.accountCode });
    }

    // Revalidate
    revalidatePath("/dashboard/accounts");
    revalidatePath("/dashboard/banking");

    return {
      success: true,
      message: "Advance accounts checked/created successfully",
      results,
    };
  } catch (error) {
    console.error("Ensure advance accounts error:", error);
    return {
      success: false,
      error: error.message || "Failed to ensure advance accounts exist",
    };
  }
}

// ============================================
// SYNC CHART OF ACCOUNTS (create missing seed accounts)
// ============================================
export async function syncChartOfAccounts() {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (
      !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(
        user.role,
      )
    ) {
      return {
        success: false,
        error: "You don't have permission to manage accounts.",
      };
    }

    await connectDB();

    // Get seed accounts and existing accounts
    const seedAccounts =
      CompanyOnboardingService.getStandardChartOfAccounts();
    const existingAccounts = await Account.find(
      withTenantScope({}, companyId, isSuperAdmin)
    )
      .select("accountCode")
      .lean();

    const existingCodes = new Set(
      existingAccounts.map((a) => a.accountCode)
    );

    // Find missing accounts
    const missing = seedAccounts.filter(
      (a) => !existingCodes.has(a.accountCode)
    );

    if (missing.length === 0) {
      return {
        success: true,
        created: 0,
        message: "All accounts are up to date",
        accounts: [],
      };
    }

    // Create missing accounts in two passes (same as seed logic)
    const accountMap = new Map();

    // Populate map with existing accounts for parent lookups
    const existingFull = await Account.find(
      withTenantScope({}, companyId, isSuperAdmin)
    )
      .select("accountCode _id parentAccount ancestors path level")
      .lean();

    for (const acc of existingFull) {
      accountMap.set(acc.accountCode, acc);
    }

    // First pass: create missing accounts without parent references
    const created = [];
    for (const seedAccount of missing) {
      const { parentCode, ...data } = seedAccount;

      const account = await Account.create({
        ...data,
        companyId,
        isActive: true,
        balance: 0,
        createdBy: { name: user.name, id: user.id },
      });

      accountMap.set(data.accountCode, account);
      created.push(account);
    }

    // Second pass: update parent references for newly created accounts
    for (const seedAccount of missing) {
      if (seedAccount.parentCode) {
        const parent = accountMap.get(seedAccount.parentCode);
        const child = accountMap.get(seedAccount.accountCode);

        if (parent && child) {
          const parentId = parent._id;
          const parentAncestors = parent.ancestors || [];
          const parentPath = parent.path || parent.accountCode;
          const parentLevel = parent.level || 0;

          await Account.findByIdAndUpdate(child._id, {
            $set: {
              parentAccount: parentId,
              ancestors: [...parentAncestors, parentId],
              level: parentLevel + 1,
              path: `${parentPath}/${child.accountCode}`,
            },
          });

          // Ensure parent is a header (canPost: false) if it has children
          if (parent.canPost !== false) {
            await Account.findByIdAndUpdate(parentId, {
              $set: { canPost: false },
            });
          }
        }
      }
    }

    revalidatePath("/dashboard/accounts");
    revalidatePath("/dashboard/settings");

    return {
      success: true,
      created: created.length,
      message: `Created ${created.length} missing account${created.length === 1 ? "" : "s"}`,
      accounts: created.map((a) => ({
        accountCode: a.accountCode,
        accountName: a.accountName,
      })),
    };
  } catch (error) {
    console.error("Sync chart of accounts error:", error);
    return {
      success: false,
      error: error.message || "Failed to sync chart of accounts",
    };
  }
}
