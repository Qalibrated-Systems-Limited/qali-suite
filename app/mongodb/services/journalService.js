import JournalEntry from "../../models/JournalEntry";
import Account from "../../models/account";
import FiscalPeriod from "../../models/fiscalPeriod";
import dbConnect from "../../config/dbConnect";
import { auth } from "@/auth";

// Helper to get tenant context for service methods
async function getServiceTenantContext() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized: No session");
  }
  const companyId = session.user.companyId || null;
  const isSuperAdmin = session.user.role === "SuperAdmin" && !companyId;
  return { companyId, isSuperAdmin };
}

function withTenantQuery(query, companyId, isSuperAdmin) {
  if (isSuperAdmin) return query;
  if (!companyId) throw new Error("companyId required");
  return { ...query, companyId };
}

// ============================================
// JOURNAL ENTRY SERVICE - USES SCHEMA METHODS
// ============================================

export class JournalEntryService {
  /**
   * Create journal entry (draft) - Orchestrates schema logic
   */
  static async createJournalEntry(data, user, session = null, companyId = null) {
    await dbConnect();

    // If companyId not passed, get from context
    let tenantCompanyId = companyId;
    if (!tenantCompanyId) {
      const context = await getServiceTenantContext();
      tenantCompanyId = context.companyId;
    }

    const entryNumber = await this.generateEntryNumber(data.entryType, tenantCompanyId, session);
    const fiscalPeriod = await this.determineFiscalPeriod(data.entryDate, tenantCompanyId);

    const entryData = {
      ...data,
      entryNumber,
      fiscalPeriodId: fiscalPeriod?._id,
      fiscalYear: new Date(data.entryDate).getFullYear(),
      fiscalMonth: new Date(data.entryDate).getMonth() + 1,
      status: "draft",
      createdBy: { name: user.name, id: user.id },
      companyId: tenantCompanyId, // Tenant isolation
    };

    const entry = session
      ? (await JournalEntry.create([entryData], { session }))[0]
      : await JournalEntry.create(entryData);

    return entry;
  }

  /**
   * Post journal entry - USES SCHEMA METHOD
   */
  static async postJournalEntry(entryId, user, session = null) {
    await dbConnect();

    const entry = session
      ? await JournalEntry.findById(entryId).session(session)
      : await JournalEntry.findById(entryId);

    if (!entry) throw new Error("Journal entry not found");
    if (entry.status === "posted") throw new Error("Already posted");
    if (entry.status === "reversed") throw new Error("Cannot post reversed entry");

    // USE SCHEMA METHODS for validation
    if (typeof entry.validateBalance === 'function') {
      await entry.validateBalance();
    }
    if (typeof entry.validateLines === 'function') {
      await entry.validateLines();
    }
    if (typeof entry.validateAccounts === 'function') {
      await entry.validateAccounts();
    }
    if (typeof entry.validateFiscalPeriod === 'function') {
      await entry.validateFiscalPeriod();
    }

    // USE SCHEMA METHOD for posting if available
    if (typeof entry.post === 'function') {
      return await entry.post(user, session);
    }

    // Fallback posting logic
    entry.status = "posted";
    entry.postedAt = new Date();
    entry.postedBy = { name: user.name, id: user.id };
    await entry.save({ session });

    // Update account balances
    if (!session && typeof entry.updateAccountBalances === 'function') {
      await entry.updateAccountBalances();
    }

    return entry;
  }

  /**
   * Reverse journal entry - USES SCHEMA METHOD
   */
  static async reverseJournalEntry(entryId, user, reason, session = null) {
    await dbConnect();

    const entry = session
      ? await JournalEntry.findById(entryId).session(session)
      : await JournalEntry.findById(entryId);

    if (!entry) throw new Error("Journal entry not found");
    
    // USE SCHEMA METHOD if available
    if (typeof entry.reverse === 'function') {
      return await entry.reverse(user, reason, session);
    }

    // Fallback reversal logic
    if (entry.status !== "posted") {
      throw new Error("Can only reverse posted entries");
    }
    if (entry.reversedAt) {
      throw new Error("Entry already reversed");
    }

    // Create reversal lines
    const reversalLines = entry.lines.map(line => ({
      accountId: line.accountId,
      accountCode: line.accountCode,
      accountName: line.accountName,
      accountType: line.accountType,
      debit: line.credit,
      credit: line.debit,
      description: `Reversal: ${line.description || ""}`,
    }));

    const reversalNumber = await this.generateReversalNumber(entry.companyId, session);

    const reversalData = {
      companyId: entry.companyId,
      entryNumber: reversalNumber,
      entryDate: new Date(),
      entryType: "adjustment",
      description: `Reversal of ${entry.entryNumber}: ${reason || "No reason"}`,
      lines: reversalLines,
      originalEntryId: entry._id,
      status: "draft",
      createdBy: { name: user.name, id: user.id },
    };

    const reversalEntry = session
      ? (await JournalEntry.create([reversalData], { session }))[0]
      : await JournalEntry.create(reversalData);

    await this.postJournalEntry(reversalEntry._id, user, session);

    entry.status = "reversed";
    entry.reversedAt = new Date();
    entry.reversedBy = { name: user.name, id: user.id };
    entry.reversalEntryId = reversalEntry._id;
    await entry.save({ session });

    return reversalEntry;
  }

  /**
   * Get journal entries with filters
   */
  static async getJournalEntries(filters = {}) {
    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getServiceTenantContext();

    const query = {};

    if (filters.status) query.status = filters.status;
    if (filters.entryType) query.entryType = filters.entryType;
    if (filters.fiscalPeriodId) query.fiscalPeriodId = filters.fiscalPeriodId;
    if (filters.accountId) query["lines.accountId"] = filters.accountId;

    if (filters.startDate || filters.endDate) {
      query.entryDate = {};
      if (filters.startDate) query.entryDate.$gte = new Date(filters.startDate);
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setDate(endDate.getDate() + 1);
        query.entryDate.$lt = endDate;
      }
    }

    // Apply tenant scoping
    const scopedQuery = withTenantQuery(query, companyId, isSuperAdmin);

    return await JournalEntry.find(scopedQuery)
      .sort({ entryDate: -1, entryNumber: -1 })
      .lean();
  }

  /**
   * Get journal entry by ID
   */
  static async getJournalEntryById(entryId) {
    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getServiceTenantContext();

    const entry = await JournalEntry.findById(entryId).lean();
    if (!entry) throw new Error("Journal entry not found");

    // Validate tenant access
    if (!isSuperAdmin && entry.companyId?.toString() !== companyId?.toString()) {
      throw new Error("Access denied to this journal entry");
    }

    return entry;
  }

  /**
   * Update journal entry (draft only)
   */
  static async updateJournalEntry(entryId, data, user, session = null) {
    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getServiceTenantContext();

    const entry = session
      ? await JournalEntry.findById(entryId).session(session)
      : await JournalEntry.findById(entryId);

    if (!entry) throw new Error("Journal entry not found");

    // Validate tenant access
    if (!isSuperAdmin && entry.companyId?.toString() !== companyId?.toString()) {
      throw new Error("Access denied to this journal entry");
    }

    if (entry.status !== "draft") {
      throw new Error("Can only update draft entries");
    }

    // Validate if lines are updated
    if (data.lines) {
      if (typeof entry.validateLines === 'function') {
        await entry.validateLines();
      }
      if (typeof entry.validateBalance === 'function') {
        await entry.validateBalance();
      }
    }

    Object.keys(data).forEach(key => {
      if (key !== "entryNumber" && key !== "status") {
        entry[key] = data[key];
      }
    });

    entry.lastModifiedBy = { name: user.name, id: user.id };
    await entry.save({ session });

    return entry;
  }

  /**
   * Delete journal entry (draft only)
   */
  static async deleteJournalEntry(entryId, user, session = null) {
    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getServiceTenantContext();

    const entry = session
      ? await JournalEntry.findById(entryId).session(session)
      : await JournalEntry.findById(entryId);

    if (!entry) throw new Error("Journal entry not found");

    // Validate tenant access
    if (!isSuperAdmin && entry.companyId?.toString() !== companyId?.toString()) {
      throw new Error("Access denied to this journal entry");
    }

    if (entry.status !== "draft") {
      throw new Error("Can only delete draft entries");
    }

    await entry.deleteOne({ session });

    return { success: true, message: "Journal entry deleted" };
  }

  /**
   * Get general ledger - USES SCHEMA STATIC if available
   */
  static async getGeneralLedger(accountId, startDate, endDate) {
    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getServiceTenantContext();

    const account = await Account.findById(accountId);
    if (!account) throw new Error("Account not found");

    // Validate tenant access on account
    if (!isSuperAdmin && account.companyId?.toString() !== companyId?.toString()) {
      throw new Error("Access denied to this account");
    }

    const query = {
      status: "posted",
      "lines.accountId": accountId,
    };

    if (startDate || endDate) {
      query.entryDate = {};
      if (startDate) query.entryDate.$gte = new Date(startDate);
      if (endDate) query.entryDate.$lte = new Date(endDate);
    }

    // Apply tenant scoping
    const scopedQuery = withTenantQuery(query, companyId, isSuperAdmin);

    const entries = await JournalEntry.find(scopedQuery)
      .sort({ entryDate: 1, entryNumber: 1 })
      .lean();

    let runningBalance = 0;
    const normalSide = ["asset", "expense"].includes(account.accountType)
      ? "debit"
      : "credit";

    const ledger = [];

    for (const entry of entries) {
      const line = entry.lines.find(l => l.accountId.toString() === accountId.toString());
      if (!line) continue;

      const debit = line.debit || 0;
      const credit = line.credit || 0;

      if (normalSide === "debit") {
        runningBalance += debit - credit;
      } else {
        runningBalance += credit - debit;
      }

      ledger.push({
        date: entry.entryDate,
        entryNumber: entry.entryNumber,
        description: entry.description,
        reference: entry.reference,
        debit,
        credit,
        balance: runningBalance,
      });
    }

    return {
      account: {
        accountCode: account.accountCode,
        accountName: account.accountName,
        accountType: account.accountType,
        normalBalanceSide: normalSide,
      },
      period: { startDate, endDate },
      transactions: ledger,
      openingBalance: 0,
      closingBalance: runningBalance,
    };
  }

  /**
   * Get AR Aging Report - USES SCHEMA STATIC if available
   */
  static async getARAgingReport() {
    await dbConnect();

    if (typeof JournalEntry.getARAgingReport === 'function') {
      return await JournalEntry.getARAgingReport();
    }

    // Fallback - basic aging
    return { message: "AR Aging not available in schema" };
  }

  /**
   * Get AP Aging Report - USES SCHEMA STATIC if available
   */
  static async getAPAgingReport() {
    await dbConnect();

    if (typeof JournalEntry.getAPAgingReport === 'function') {
      return await JournalEntry.getAPAgingReport();
    }

    // Fallback - basic aging
    return { message: "AP Aging not available in schema" };
  }

  /**
   * Get statement of account - USES SCHEMA STATIC if available
   */
  static async getStatementOfAccount(partyId) {
    await dbConnect();

    if (typeof JournalEntry.getStatementOfAccount === 'function') {
      return await JournalEntry.getStatementOfAccount(partyId);
    }

    // Fallback
    return { message: "Statement not available in schema" };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  static async generateEntryNumber(entryType, companyId = null, session = null) {
    const { generateUniqueEntryNumber } = await import("@/lib/utils/server-utils");
    // Map entryType to prefix
    const prefixMap = {
      sale: "SALE",
      purchase: "BILL",
      payment_received: "REC",
      payment_made: "PAY",
      expense: "EXP",
      adjustment: "ADJ",
      opening_balance: "OB",
      closing: "CLOSE",
      transfer: "TRF",
    };
    const prefix = prefixMap[entryType] || "MANUAL";
    return generateUniqueEntryNumber(prefix, companyId, session);
  }

  static async generateReversalNumber(companyId = null, session = null) {
    const { generateUniqueEntryNumber } = await import("@/lib/utils/server-utils");
    return generateUniqueEntryNumber("REV", companyId, session);
  }

  static getEntryPrefix(entryType) {
    const prefixes = {
      sale: "JE-SALE",
      purchase: "JE-BILL",
      payment_received: "JE-PAY-REC",
      payment_made: "JE-PAY-MADE",
      expense: "JE-EXP",
      adjustment: "JE-ADJ",
      opening_balance: "JE-OB",
      closing: "JE-CLOSE",
      transfer: "JE-TRF",
    };

    return prefixes[entryType] || "JE-MANUAL";
  }

  static async determineFiscalPeriod(entryDate, companyId = null) {
    await dbConnect();

    const date = new Date(entryDate);

    const filter = {
      startDate: { $lte: date },
      endDate: { $gte: date },
    };

    // Add companyId filter for tenant isolation
    if (companyId) {
      filter.companyId = companyId;
    }

    const fiscalPeriod = await FiscalPeriod.findOne(filter).lean();

    return fiscalPeriod;
  }

  static async getEntryStatistics(filters = {}) {
    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getServiceTenantContext();

    const query = { status: "posted" };

    if (filters.startDate || filters.endDate) {
      query.entryDate = {};
      if (filters.startDate) query.entryDate.$gte = new Date(filters.startDate);
      if (filters.endDate) query.entryDate.$lte = new Date(filters.endDate);
    }

    // Apply tenant scoping
    const scopedQuery = withTenantQuery(query, companyId, isSuperAdmin);

    const result = await JournalEntry.aggregate([
      { $match: scopedQuery },
      { $group: { _id: "$entryType", count: { $sum: 1 } } },
    ]);

    const stats = { total: 0, byType: {} };

    result.forEach(item => {
      stats.byType[item._id] = item.count;
      stats.total += item.count;
    });

    return stats;
  }

  // ============================================
  // PAYMENT JOURNAL ENTRIES
  // ============================================

  /**
   * Create journal entry for payment received (customer paying invoice)
   * Debit: Bank Account (asset increases)
   * Credit: Accounts Receivable (asset decreases)
   *
   * Overpayment handling (industry standard):
   * If amount > documentBalance, excess goes to Customer Advance (liability)
   * - Debit: Bank (full amount)
   * - Credit: Accounts Receivable (document balance only)
   * - Credit: Customer Advance (excess amount)
   */
  static async createPaymentReceivedEntry(data, dbSession = null) {
    await dbConnect();

    const {
      companyId,
      invoiceId,
      customerId, // Required for tracking advances per customer
      customerName,
      amount,
      documentBalance, // Optional: if provided, handles overpayment
      paymentDate,
      paymentMethod,
      reference,
      bankAccountId,
    } = data;

    // Calculate overpayment
    const hasOverpayment = documentBalance !== undefined && amount > documentBalance;
    const applyToDocument = hasOverpayment ? documentBalance : amount;
    const overpaymentAmount = hasOverpayment ? amount - documentBalance : 0;

    // Get required accounts
    const accountQueries = [
      Account.findById(bankAccountId),
      Account.findOne({ companyId, systemAccount: "accounts_receivable" }),
    ];

    // Only fetch customer advance account if there's an overpayment
    if (hasOverpayment) {
      accountQueries.push(
        Account.findOne({ companyId, systemAccount: "customer_advance" })
      );
    }

    const [bankAccount, arAccount, customerAdvanceAccount] = await Promise.all(accountQueries);

    if (!bankAccount) throw new Error("Bank account not found");
    if (!arAccount) throw new Error("Accounts Receivable account not found");
    if (hasOverpayment && !customerAdvanceAccount) {
      throw new Error("Customer Advance account not found. Please create a system account with systemAccount='customer_advance' to handle overpayments.");
    }

    // Build journal entry lines
    const lines = [
      {
        accountId: bankAccount._id,
        accountCode: bankAccount.accountCode,
        accountName: bankAccount.accountName,
        description: `Payment received via ${paymentMethod}`,
        debit: amount,
        credit: 0,
      },
      {
        accountId: arAccount._id,
        accountCode: arAccount.accountCode,
        accountName: arAccount.accountName,
        description: `Payment received - Invoice`,
        debit: 0,
        credit: applyToDocument,
      },
    ];

    // Add customer advance line for overpayment
    if (hasOverpayment) {
      lines.push({
        accountId: customerAdvanceAccount._id,
        accountCode: customerAdvanceAccount.accountCode,
        accountName: customerAdvanceAccount.accountName,
        description: `Customer advance - ${customerName || "Overpayment received"}`,
        debit: 0,
        credit: overpaymentAmount,
      });
    }

    // Create journal entry
    const entryData = {
      companyId,
      entryType: "payment_received",
      entryDate: paymentDate,
      description: hasOverpayment
        ? `Payment received (includes ${overpaymentAmount.toFixed(2)} advance) - ${reference || "Bank transfer"}`
        : `Payment received - ${reference || "Bank transfer"}`,
      reference,
      sourceDocument: {
        type: "invoice",
        id: invoiceId,
      },
      // Track party for advance reconciliation
      party: customerId ? { type: "customer", id: customerId, name: customerName } : null,
      lines,
    };

    const user = { name: "System", id: "system" };
    const entry = await this.createJournalEntry(entryData, user, dbSession, companyId);

    // Auto-post the entry
    await this.postJournalEntry(entry._id, user, dbSession);

    // Return entry with overpayment info
    return {
      ...entry.toObject(),
      overpaymentAmount,
      appliedToDocument: applyToDocument,
    };
  }

  /**
   * Create journal entry for payment made (paying supplier bill)
   * Debit: Accounts Payable (liability decreases)
   * Credit: Bank Account (asset decreases)
   *
   * Overpayment handling (industry standard):
   * If amount > documentBalance, excess goes to Supplier Advance (asset)
   * - Debit: Accounts Payable (document balance only)
   * - Debit: Supplier Advance (excess amount - prepaid to supplier)
   * - Credit: Bank (full amount)
   *
   * The supplier advance can later be applied to clear future bills.
   */
  static async createPaymentMadeEntry(data, dbSession = null) {
    await dbConnect();

    const {
      companyId,
      billId,
      supplierId, // Required for tracking advances per supplier
      supplierName,
      amount,
      documentBalance, // Optional: if provided, handles overpayment
      paymentDate,
      paymentMethod,
      reference,
      bankAccountId,
    } = data;

    // Calculate overpayment
    const hasOverpayment = documentBalance !== undefined && amount > documentBalance;
    const applyToDocument = hasOverpayment ? documentBalance : amount;
    const overpaymentAmount = hasOverpayment ? amount - documentBalance : 0;

    // Get required accounts
    const accountQueries = [
      Account.findById(bankAccountId),
      Account.findOne({ companyId, systemAccount: "accounts_payable" }),
    ];

    // Only fetch supplier advance account if there's an overpayment
    if (hasOverpayment) {
      accountQueries.push(
        Account.findOne({ companyId, systemAccount: "supplier_advance" })
      );
    }

    const [bankAccount, apAccount, supplierAdvanceAccount] = await Promise.all(accountQueries);

    if (!bankAccount) throw new Error("Bank account not found");
    if (!apAccount) throw new Error("Accounts Payable account not found");
    if (hasOverpayment && !supplierAdvanceAccount) {
      throw new Error("Supplier Advance account not found. Please create a system account with systemAccount='supplier_advance' to handle overpayments.");
    }

    // Build journal entry lines
    const lines = [
      {
        accountId: apAccount._id,
        accountCode: apAccount.accountCode,
        accountName: apAccount.accountName,
        description: `Payment to supplier - Bill`,
        debit: applyToDocument,
        credit: 0,
      },
    ];

    // Add supplier advance line for overpayment (asset - prepayment to supplier)
    if (hasOverpayment) {
      lines.push({
        accountId: supplierAdvanceAccount._id,
        accountCode: supplierAdvanceAccount.accountCode,
        accountName: supplierAdvanceAccount.accountName,
        description: `Supplier advance - ${supplierName || "Overpayment"}`,
        debit: overpaymentAmount,
        credit: 0,
      });
    }

    // Credit bank for full amount
    lines.push({
      accountId: bankAccount._id,
      accountCode: bankAccount.accountCode,
      accountName: bankAccount.accountName,
      description: `Payment made via ${paymentMethod}`,
      debit: 0,
      credit: amount,
    });

    // Create journal entry
    const entryData = {
      companyId,
      entryType: "payment_made",
      entryDate: paymentDate,
      description: hasOverpayment
        ? `Payment made (includes ${overpaymentAmount.toFixed(2)} advance) - ${reference || "Bank transfer"}`
        : `Payment made - ${reference || "Bank transfer"}`,
      reference,
      sourceDocument: {
        type: "bill",
        id: billId,
      },
      // Track party for advance reconciliation
      party: supplierId ? { type: "supplier", id: supplierId, name: supplierName } : null,
      lines,
    };

    const user = { name: "System", id: "system" };
    const entry = await this.createJournalEntry(entryData, user, dbSession, companyId);

    // Auto-post the entry
    await this.postJournalEntry(entry._id, user, dbSession);

    // Return entry with overpayment info
    return {
      ...entry.toObject(),
      overpaymentAmount,
      appliedToDocument: applyToDocument,
    };
  }

  /**
   * Apply supplier advance to a bill
   * Used when a supplier has advance credit from previous overpayment
   * Debit: Accounts Payable (reduce what we owe)
   * Credit: Supplier Advance (reduce the prepaid asset)
   */
  static async applySupplierAdvanceToBill(data, dbSession = null) {
    await dbConnect();

    const {
      companyId,
      billId,
      billNumber,
      supplierId,
      supplierName,
      amount, // Amount of advance to apply
      applyDate,
      reference,
    } = data;

    // Get required accounts
    const [apAccount, supplierAdvanceAccount] = await Promise.all([
      Account.findOne({ companyId, systemAccount: "accounts_payable" }),
      Account.findOne({ companyId, systemAccount: "supplier_advance" }),
    ]);

    if (!apAccount) throw new Error("Accounts Payable account not found");
    if (!supplierAdvanceAccount) throw new Error("Supplier Advance account not found");

    const entryData = {
      companyId,
      entryType: "adjustment",
      entryDate: applyDate || new Date(),
      description: `Apply supplier advance to ${billNumber}`,
      reference,
      sourceDocument: {
        type: "bill",
        id: billId,
      },
      party: { type: "supplier", id: supplierId, name: supplierName },
      lines: [
        {
          accountId: apAccount._id,
          accountCode: apAccount.accountCode,
          accountName: apAccount.accountName,
          description: `Apply advance from ${supplierName}`,
          debit: amount,
          credit: 0,
        },
        {
          accountId: supplierAdvanceAccount._id,
          accountCode: supplierAdvanceAccount.accountCode,
          accountName: supplierAdvanceAccount.accountName,
          description: `Apply advance to ${billNumber}`,
          debit: 0,
          credit: amount,
        },
      ],
    };

    const user = { name: "System", id: "system" };
    const entry = await this.createJournalEntry(entryData, user, dbSession, companyId);
    await this.postJournalEntry(entry._id, user, dbSession);

    return entry;
  }

  /**
   * Apply customer advance to an invoice
   * Used when a customer has advance credit from previous overpayment
   * Debit: Customer Advance (reduce liability to customer)
   * Credit: Accounts Receivable (reduce what customer owes)
   */
  static async applyCustomerAdvanceToInvoice(data, dbSession = null) {
    await dbConnect();

    const {
      companyId,
      invoiceId,
      invoiceNumber,
      customerId,
      customerName,
      amount, // Amount of advance to apply
      applyDate,
      reference,
    } = data;

    // Get required accounts
    const [arAccount, customerAdvanceAccount] = await Promise.all([
      Account.findOne({ companyId, systemAccount: "accounts_receivable" }),
      Account.findOne({ companyId, systemAccount: "customer_advance" }),
    ]);

    if (!arAccount) throw new Error("Accounts Receivable account not found");
    if (!customerAdvanceAccount) throw new Error("Customer Advance account not found");

    const entryData = {
      companyId,
      entryType: "adjustment",
      entryDate: applyDate || new Date(),
      description: `Apply customer advance to ${invoiceNumber}`,
      reference,
      sourceDocument: {
        type: "invoice",
        id: invoiceId,
      },
      party: { type: "customer", id: customerId, name: customerName },
      lines: [
        {
          accountId: customerAdvanceAccount._id,
          accountCode: customerAdvanceAccount.accountCode,
          accountName: customerAdvanceAccount.accountName,
          description: `Apply advance from ${customerName}`,
          debit: amount,
          credit: 0,
        },
        {
          accountId: arAccount._id,
          accountCode: arAccount.accountCode,
          accountName: arAccount.accountName,
          description: `Apply advance to ${invoiceNumber}`,
          debit: 0,
          credit: amount,
        },
      ],
    };

    const user = { name: "System", id: "system" };
    const entry = await this.createJournalEntry(entryData, user, dbSession, companyId);
    await this.postJournalEntry(entry._id, user, dbSession);

    return entry;
  }
}

export default JournalEntryService;