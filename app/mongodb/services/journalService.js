import JournalEntry from "../../models/JournalEntry";
import Account from "../../models/account";
import FiscalPeriod from "../../models/fiscalPeriod";
import dbConnect from "../../config/dbConnect";

// ============================================
// JOURNAL ENTRY SERVICE - USES SCHEMA METHODS
// ============================================

export class JournalEntryService {
  /**
   * Create journal entry (draft) - Orchestrates schema logic
   */
  static async createJournalEntry(data, user, session = null) {
    await dbConnect();

    const entryNumber = await this.generateEntryNumber(data.entryType, session);
    const fiscalPeriod = await this.determineFiscalPeriod(data.entryDate);

    const entryData = {
      ...data,
      entryNumber,
      fiscalPeriodId: fiscalPeriod?._id,
      fiscalYear: new Date(data.entryDate).getFullYear(),
      fiscalMonth: new Date(data.entryDate).getMonth() + 1,
      status: "draft",
      createdBy: { name: user.name, id: user.id },
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

    const reversalNumber = await this.generateReversalNumber(session);

    const reversalData = {
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

    return await JournalEntry.find(query)
      .sort({ entryDate: -1, entryNumber: -1 })
      .lean();
  }

  /**
   * Get journal entry by ID
   */
  static async getJournalEntryById(entryId) {
    await dbConnect();

    const entry = await JournalEntry.findById(entryId).lean();
    if (!entry) throw new Error("Journal entry not found");

    return entry;
  }

  /**
   * Update journal entry (draft only)
   */
  static async updateJournalEntry(entryId, data, user, session = null) {
    await dbConnect();

    const entry = session
      ? await JournalEntry.findById(entryId).session(session)
      : await JournalEntry.findById(entryId);

    if (!entry) throw new Error("Journal entry not found");
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

    const entry = session
      ? await JournalEntry.findById(entryId).session(session)
      : await JournalEntry.findById(entryId);

    if (!entry) throw new Error("Journal entry not found");
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

    const account = await Account.findById(accountId);
    if (!account) throw new Error("Account not found");

    const query = {
      status: "posted",
      "lines.accountId": accountId,
    };

    if (startDate || endDate) {
      query.entryDate = {};
      if (startDate) query.entryDate.$gte = new Date(startDate);
      if (endDate) query.entryDate.$lte = new Date(endDate);
    }

    const entries = await JournalEntry.find(query)
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

  static async generateEntryNumber(entryType, session = null) {
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
    return generateUniqueEntryNumber(prefix, session);
  }

  static async generateReversalNumber(session = null) {
    const { generateUniqueEntryNumber } = await import("@/lib/utils/server-utils");
    return generateUniqueEntryNumber("REV", session);
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

  static async determineFiscalPeriod(entryDate) {
    await dbConnect();

    const date = new Date(entryDate);

    const fiscalPeriod = await FiscalPeriod.findOne({
      startDate: { $lte: date },
      endDate: { $gte: date },
    }).lean();

    return fiscalPeriod;
  }

  static async getEntryStatistics(filters = {}) {
    await dbConnect();

    const query = { status: "posted" };

    if (filters.startDate || filters.endDate) {
      query.entryDate = {};
      if (filters.startDate) query.entryDate.$gte = new Date(filters.startDate);
      if (filters.endDate) query.entryDate.$lte = new Date(filters.endDate);
    }

    const result = await JournalEntry.aggregate([
      { $match: query },
      { $group: { _id: "$entryType", count: { $sum: 1 } } },
    ]);

    const stats = { total: 0, byType: {} };

    result.forEach(item => {
      stats.byType[item._id] = item.count;
      stats.total += item.count;
    });

    return stats;
  }
}

export default JournalEntryService;