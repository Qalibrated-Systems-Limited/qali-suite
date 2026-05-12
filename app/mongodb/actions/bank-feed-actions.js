"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { BankStatement, BankFeedLine } from "../../models/bankFeed";
import BankFeedService from "../services/bankFeedService";
import dbConnect from "../../config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";

// ============================================
// BANK FEED SERVER ACTIONS
// Server-side mutations for bank feed operations
// ============================================

/**
 * Create a new bank statement and import lines from CSV
 */
export async function importBankStatement(formData) {
  try {
    await requirePlanAccess("finance");
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const { companyId } = await getTenantContext();

    const bankAccountId = formData.get("bankAccountId");
    const fileName = formData.get("fileName");
    const csvContent = formData.get("csvContent");
    const columnMapping = JSON.parse(formData.get("columnMapping"));
    const dateFormat = formData.get("dateFormat") || "DD/MM/YYYY";

    if (!bankAccountId || !csvContent || !columnMapping) {
      return { success: false, error: "Missing required fields" };
    }

    // Parse CSV
    const parsedLines = BankFeedService.parseCSV(
      csvContent,
      columnMapping,
      dateFormat,
    );

    if (parsedLines.length === 0) {
      // Tell the user which check rejected everything — generic
      // "no transactions" sends people down the column-mapping rabbit hole
      // when the real problem is usually a date-format mismatch.
      const diag = parsedLines.diagnostics || {};
      if (diag.droppedDateInvalid > 0 && diag.droppedDateInvalid === diag.totalDataRows) {
        return {
          success: false,
          error: `Could not parse any dates. Your file uses a date format that doesn't match "${dateFormat}". Sample value: try changing the Date Format on the previous step.`,
        };
      }
      if (diag.droppedZeroAmount > 0 && diag.droppedZeroAmount === diag.totalDataRows) {
        return {
          success: false,
          error:
            "Every row has a zero amount. Check your debit/credit column mapping — they may be pointing at the wrong columns.",
        };
      }
      return {
        success: false,
        error: "No valid transactions found in CSV. Check the date format and column mapping.",
      };
    }

    // Determine statement period from data
    const dates = parsedLines.map((l) => l.date).filter(Boolean);
    const startDate = new Date(Math.min(...dates));
    const endDate = new Date(Math.max(...dates));

    // Create statement
    const statement = await BankFeedService.createStatement({
      companyId,
      bankAccountId,
      fileName: fileName || "bank_statement.csv",
      statementPeriod: { startDate, endDate },
      columnMapping,
      dateFormat,
      uploadedBy: {
        id: session.user.id,
        name: session.user.name,
      },
    });

    // Import lines
    await BankFeedService.importLines(
      statement._id,
      parsedLines,
      companyId,
      bankAccountId,
    );

    revalidatePath("/dashboard/banking");

    return {
      success: true,
      statementId: statement._id.toString(),
      linesImported: parsedLines.length,
    };
  } catch (error) {
    console.error("Error importing bank statement:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Allocate a bank line to an invoice (payment received)
 */
export async function allocateToInvoice(lineId, invoiceId) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const result = await BankFeedService.allocateToInvoice(
      lineId,
      invoiceId,
      session.user.id,
      session.user.name,
    );

    revalidatePath("/dashboard/banking");
    revalidatePath("/dashboard/invoices");

    return result;
  } catch (error) {
    console.error("Error allocating to invoice:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Allocate a bank line to a bill (payment made)
 */
export async function allocateToBill(lineId, billId) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const result = await BankFeedService.allocateToBill(
      lineId,
      billId,
      session.user.id,
      session.user.name,
    );

    revalidatePath("/dashboard/banking");
    revalidatePath("/dashboard/bills");

    return serializeBsonType(result);
  } catch (error) {
    console.error("Error allocating to bill:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Allocate a bank line to an expense account
 */
export async function allocateToExpense(lineId, allocationData) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const result = await BankFeedService.allocateToExpense(
      lineId,
      allocationData,
      session.user.id,
      session.user.name,
    );

    revalidatePath("/dashboard/banking");

    return serializeBsonType(result);
  } catch (error) {
    console.error("Error allocating to expense:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Allocate a bank line to an income account
 */
export async function allocateToIncome(lineId, allocationData) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const result = await BankFeedService.allocateToIncome(
      lineId,
      allocationData,
      session.user.id,
      session.user.name,
    );

    revalidatePath("/dashboard/banking");

    return serializeBsonType(result);
  } catch (error) {
    console.error("Error allocating to income:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Allocate a bank line to a liability account (HELB, PAYE, loans, statutory payments)
 */
export async function allocateToLiability(lineId, allocationData) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const result = await BankFeedService.allocateToLiability(
      lineId,
      allocationData,
      session.user.id,
      session.user.name,
    );

    revalidatePath("/dashboard/banking");

    return serializeBsonType(result);
  } catch (error) {
    console.error("Error allocating to liability:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Exclude a bank line from allocation
 */
export async function excludeBankLine(lineId, reason, note = "") {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const result = await BankFeedService.excludeLine(
      lineId,
      reason,
      note,
      session.user.id,
      session.user.name,
    );

    revalidatePath("/dashboard/banking");

    return result;
  } catch (error) {
    console.error("Error excluding line:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Undo allocation (revert to unallocated)
 */
export async function undoAllocation(lineId) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const result = await BankFeedService.undoAllocation(lineId);

    revalidatePath("/dashboard/banking");

    return result;
  } catch (error) {
    console.error("Error undoing allocation:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete a bank statement and all its lines
 */
export async function deleteBankStatement(statementId) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const { companyId } = await getTenantContext();

    // Verify ownership
    const statement = await BankStatement.findOne({
      _id: statementId,
      companyId,
    });

    if (!statement) {
      return { success: false, error: "Statement not found" };
    }

    // Check if any lines are allocated
    const allocatedCount = await BankFeedLine.countDocuments({
      statementId,
      status: "allocated",
    });

    if (allocatedCount > 0) {
      return {
        success: false,
        error: `Cannot delete: ${allocatedCount} lines are already allocated. Undo allocations first.`,
      };
    }

    // Delete lines
    await BankFeedLine.deleteMany({ statementId });

    // Delete statement
    await BankStatement.findByIdAndDelete(statementId);

    revalidatePath("/dashboard/banking");

    return { success: true };
  } catch (error) {
    console.error("Error deleting statement:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Re-run auto-matching for a statement
 */
export async function rerunAutoMatch(statementId) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const { companyId } = await getTenantContext();

    // Verify ownership
    const statement = await BankStatement.findOne({
      _id: statementId,
      companyId,
    });

    if (!statement) {
      return { success: false, error: "Statement not found" };
    }

    // Run auto-matching
    await BankFeedService.autoMatchLines(statementId, companyId);

    revalidatePath("/dashboard/banking");

    return { success: true };
  } catch (error) {
    console.error("Error running auto-match:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Bulk allocate multiple lines
 */
export async function bulkAllocate(allocations) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const results = [];

    for (const allocation of allocations) {
      try {
        let result;
        switch (allocation.type) {
          case "invoice":
            result = await BankFeedService.allocateToInvoice(
              allocation.lineId,
              allocation.documentId,
              session.user.id,
              session.user.name,
            );
            break;
          case "bill":
            result = await BankFeedService.allocateToBill(
              allocation.lineId,
              allocation.documentId,
              session.user.id,
              session.user.name,
            );
            break;
          case "expense":
            result = await BankFeedService.allocateToExpense(
              allocation.lineId,
              allocation.data,
              session.user.id,
              session.user.name,
            );
            break;
          case "income":
            result = await BankFeedService.allocateToIncome(
              allocation.lineId,
              allocation.data,
              session.user.id,
              session.user.name,
            );
            break;
          case "exclude":
            result = await BankFeedService.excludeLine(
              allocation.lineId,
              allocation.reason,
              allocation.note,
              session.user.id,
              session.user.name,
            );
            break;
          default:
            result = { success: false, error: "Unknown allocation type" };
        }
        results.push({ lineId: allocation.lineId, ...result });
      } catch (error) {
        results.push({
          lineId: allocation.lineId,
          success: false,
          error: error.message,
        });
      }
    }

    revalidatePath("/dashboard/banking");

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return {
      success: failCount === 0,
      results,
      summary: { success: successCount, failed: failCount },
    };
  } catch (error) {
    console.error("Error in bulk allocation:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Allocate a bank line to multiple invoices (combined payment)
 * @param {string} lineId - Bank feed line ID
 * @param {Array} invoiceAllocations - Array of { invoiceId, amount }
 */
export async function allocateToMultipleInvoices(lineId, invoiceAllocations) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const result = await BankFeedService.allocateToMultipleInvoices(
      lineId,
      invoiceAllocations,
      session.user.id,
      session.user.name,
    );

    revalidatePath("/dashboard/banking");
    revalidatePath("/dashboard/invoices");

    return result;
  } catch (error) {
    console.error("Error allocating to multiple invoices:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Allocate a bank line to multiple bills (combined payment)
 * @param {string} lineId - Bank feed line ID
 * @param {Array} billAllocations - Array of { billId, amount }
 */
export async function allocateToMultipleBills(lineId, billAllocations) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const result = await BankFeedService.allocateToMultipleBills(
      lineId,
      billAllocations,
      session.user.id,
      session.user.name,
    );

    revalidatePath("/dashboard/banking");
    revalidatePath("/dashboard/bills");

    return result;
  } catch (error) {
    console.error("Error allocating to multiple bills:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Allocate a bank line as a transfer between accounts
 * @param {string} lineId - Bank feed line ID
 * @param {string} targetAccountId - Target bank/cash account ID
 * @param {string} description - Optional description
 */
export async function allocateAsTransfer(
  lineId,
  targetAccountId,
  description = "",
) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const result = await BankFeedService.allocateAsTransfer(
      lineId,
      targetAccountId,
      description,
      session.user.id,
      session.user.name,
    );

    revalidatePath("/dashboard/banking");

    return result;
  } catch (error) {
    console.error("Error allocating as transfer:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Allocate a bank line with split across multiple accounts
 * @param {string} lineId - Bank feed line ID
 * @param {Array} splits - Array of { accountId, amount, description }
 */
export async function allocateWithSplit(lineId, splits) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const result = await BankFeedService.allocateWithSplit(
      lineId,
      splits,
      session.user.id,
      session.user.name,
    );

    revalidatePath("/dashboard/banking");

    return result;
  } catch (error) {
    console.error("Error allocating with split:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// ACCOUNT QUERY ACTIONS (for client components)
// ============================================

import Account from "../../models/account";
import Invoice from "../../models/invoice";
import Bill from "../../models/bill";
import Party from "../../models/parties";
import { withTenantScope } from "@/lib/utils/tenant-utils";
import { serializeBsonType } from "@/lib/utils";

/**
 * Get expense accounts (for direct expense allocation)
 */
export async function getExpenseAccounts() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find(
    withTenantScope(
      { accountType: "expense", isActive: true, canPost: true },
      companyId,
      isSuperAdmin,
    ),
  )
    .sort({ accountCode: 1 })
    .select("accountCode accountName subType")
    .lean();

  return accounts.map((a) => ({ ...a, _id: a._id.toString() }));
}

/**
 * Get income/revenue accounts (for direct income allocation)
 */
export async function getIncomeAccounts() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find(
    withTenantScope(
      { accountType: "revenue", isActive: true, canPost: true },
      companyId,
      isSuperAdmin,
    ),
  )
    .sort({ accountCode: 1 })
    .select("accountCode accountName subType")
    .lean();

  return accounts.map((a) => ({ ...a, _id: a._id.toString() }));
}

/**
 * Get liability accounts (for statutory payments like HELB, PAYE, NSSF, loans)
 */
export async function getLiabilityAccounts() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find(
    withTenantScope(
      { accountType: "liability", isActive: true, canPost: true },
      companyId,
      isSuperAdmin,
    ),
  )
    .sort({ accountCode: 1 })
    .select("accountCode accountName subType")
    .lean();

  return accounts.map((a) => ({ ...a, _id: a._id.toString() }));
}

/**
 * Get transfer accounts (other bank/cash accounts excluding current)
 */
export async function getTransferAccounts(excludeAccountId) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope(
    {
      subType: { $in: ["bank", "cash", "mpesa"] },
      isActive: true,
      canPost: true,
    },
    companyId,
    isSuperAdmin,
  );

  if (excludeAccountId) {
    query._id = { $ne: excludeAccountId };
  }

  const accounts = await Account.find(query)
    .sort({ accountCode: 1 })
    .select("accountCode accountName subType")
    .lean();

  return accounts.map((a) => ({ ...a, _id: a._id.toString() }));
}

/**
 * Get all postable accounts grouped by type (for split allocations)
 */
export async function getAllPostableAccounts() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find(
    withTenantScope({ isActive: true, canPost: true }, companyId, isSuperAdmin),
  )
    .sort({ accountType: 1, accountCode: 1 })
    .select("accountCode accountName accountType subType")
    .lean();

  const grouped = accounts.reduce((acc, account) => {
    const type = account.accountType;
    if (!acc[type]) acc[type] = [];
    acc[type].push({ ...account, _id: account._id.toString() });
    return acc;
  }, {});

  return grouped;
}

/**
 * Search for matching invoices (for allocation)
 * Finds completed invoices with outstanding balance
 */
export async function searchMatchingInvoices(amount, searchTerm = "") {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Completed invoices with unpaid or partial payment status
  let query = withTenantScope(
    {
      status: "completed",
      paymentStatus: { $in: ["unpaid", "partial"] },
      amountDue: { $gt: 0 },
    },
    companyId,
    isSuperAdmin,
  );

  if (searchTerm) {
    query.$or = [
      { invoiceNumber: { $regex: searchTerm, $options: "i" } },
      { "customer.name": { $regex: searchTerm, $options: "i" } },
    ];
  }

  const invoices = await Invoice.find(query)
    .sort({ dueDate: 1 })
    .limit(20)
    .select(
      "invoiceNumber customer total amountDue amountPaid dueDate status paymentStatus",
    )
    .lean();
  const result = invoices
    .map((inv) => ({
      ...inv,
      _id: inv._id.toString(),
      balanceDue: inv.amountDue, // Map to expected field name for UI
      amountDiff: Math.abs(inv.amountDue - amount),
    }))
    .sort((a, b) => a.amountDiff - b.amountDiff);

  return serializeBsonType(result);
}

/**
 * Search for matching bills (for allocation)
 * Finds approved bills with outstanding balance
 */
export async function searchMatchingBills(amount, searchTerm = "") {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Approved bills with unpaid or partial payment status
  let query = withTenantScope(
    {
      status: "approved",
      paymentStatus: { $in: ["unpaid", "partial"] },
      "amounts.balance": { $gt: 0 },
    },
    companyId,
    isSuperAdmin,
  );

  if (searchTerm) {
    query.$or = [
      { billNumber: { $regex: searchTerm, $options: "i" } },
      { "supplier.name": { $regex: searchTerm, $options: "i" } },
    ];
  }

  const bills = await Bill.find(query)
    .sort({ dueDate: 1 })
    .limit(20)
    .select("billNumber supplier amounts dueDate status paymentStatus")
    .lean();
  const result = bills
    .map((bill) => ({
      ...bill,
      _id: bill._id.toString(),
      total: bill.amounts?.netPayable || 0,
      balanceDue: bill.amounts?.balance || 0, // Map to expected field name for UI
      amountDiff: Math.abs((bill.amounts?.balance || 0) - amount),
    }))
    .sort((a, b) => a.amountDiff - b.amountDiff);

  return serializeBsonType(result);
}

/**
 * Search parties for expense/income allocation
 * For expense: search suppliers
 * For income: search customers
 */
export async function searchPartiesForAllocation(type, searchTerm = "") {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  // For expenses: suppliers, employees, or "both" party types
  // For income: customers or "both" party types
  const partyTypes =
    type === "expense"
      ? ["supplier", "employee", "both"]
      : ["customer", "both"];

  const query = withTenantScope(
    {
      isActive: true,
      type: { $in: partyTypes },
    },
    companyId,
    isSuperAdmin
  );

  if (searchTerm) {
    query.$or = [
      { name: { $regex: searchTerm, $options: "i" } },
      { displayName: { $regex: searchTerm, $options: "i" } },
      { email: { $regex: searchTerm, $options: "i" } },
    ];
  }

  const parties = await Party.find(query)
    .sort({ name: 1 })
    .limit(20)
    .select("name displayName email phone")
    .lean();

  return parties.map((p) => ({
    ...p,
    _id: p._id.toString(),
  }));
}
