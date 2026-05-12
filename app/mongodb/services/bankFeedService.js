import { BankStatement, BankFeedLine } from "../../models/bankFeed";
import JournalEntry from "../../models/JournalEntry";
import Account from "../../models/account";
import Invoice from "../../models/invoice";
import Bill from "../../models/bill";
import connectDB from "../../config/dbConnect";
import JournalService from "./journalService";
import mongoose from "mongoose";
import crypto from "crypto";

// ============================================
// BANK FEED SERVICE
// Core business logic for bank statement processing
// Reusable across web (server actions) and mobile (API)
// ============================================

export class BankFeedService {
  // ============================================
  // HASH UTILITIES FOR DUPLICATE DETECTION
  // ============================================

  /**
   * Generate a hash for the entire CSV content
   */
  static generateContentHash(csvContent) {
    return crypto.createHash("sha256").update(csvContent).digest("hex");
  }

  /**
   * Generate a unique hash for a bank line
   * Uses: bankAccountId + date + description + debit + credit
   */
  static generateLineHash(bankAccountId, date, description, debit, credit) {
    const dateStr = date instanceof Date ? date.toISOString().split("T")[0] : date;
    const data = `${bankAccountId}|${dateStr}|${description}|${debit}|${credit}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Check if a statement with same content already exists
   */
  static async checkDuplicateStatement(companyId, contentHash) {
    await connectDB();
    const existing = await BankStatement.findOne({ companyId, contentHash });
    return existing;
  }

  /**
   * Check for duplicate lines in the system
   * Returns: { duplicates: [...], newLines: [...] }
   * Optimized: batch query instead of N+1 individual queries
   */
  static async checkDuplicateLines(companyId, bankAccountId, lines) {
    await connectDB();

    // Generate hashes for all lines upfront
    const linesWithHashes = lines.map(line => ({
      ...line,
      lineHash: this.generateLineHash(
        bankAccountId,
        line.date,
        line.description,
        line.debit || 0,
        line.credit || 0
      ),
    }));

    // Batch fetch all existing hashes in one query
    const allHashes = linesWithHashes.map(l => l.lineHash);
    const existingLines = await BankFeedLine.find({
      companyId,
      lineHash: { $in: allHashes },
    }).select('lineHash _id').lean();

    // Create a Map for O(1) lookup
    const existingHashMap = new Map(
      existingLines.map(l => [l.lineHash, l._id])
    );

    // Categorize lines
    const duplicates = [];
    const newLines = [];

    for (const line of linesWithHashes) {
      if (existingHashMap.has(line.lineHash)) {
        duplicates.push({ ...line, existingId: existingHashMap.get(line.lineHash) });
      } else {
        newLines.push(line);
      }
    }

    return { duplicates, newLines };
  }

  // ============================================
  // STATEMENT MANAGEMENT
  // ============================================

  /**
   * Create a new bank statement record
   */
  static async createStatement(data) {
    await connectDB();

    // Check for duplicate content
    if (data.contentHash) {
      const existing = await this.checkDuplicateStatement(data.companyId, data.contentHash);
      if (existing) {
        throw new Error(
          `Duplicate statement detected. A statement with the same content was uploaded on ${existing.createdAt.toLocaleDateString()}.`
        );
      }
    }

    const statement = new BankStatement({
      companyId: data.companyId,
      bankAccountId: data.bankAccountId,
      fileName: data.fileName,
      statementPeriod: data.statementPeriod,
      columnMapping: data.columnMapping,
      dateFormat: data.dateFormat || "DD/MM/YYYY",
      contentHash: data.contentHash,
      uploadedBy: data.uploadedBy,
      status: "processing",
    });

    await statement.save();
    return statement;
  }

  /**
   * Import lines from parsed CSV data
   * Skips duplicate lines automatically
   */
  static async importLines(statementId, lines, companyId, bankAccountId) {
    await connectDB();

    const statement = await BankStatement.findById(statementId);
    if (!statement) {
      throw new Error("Statement not found");
    }

    // Check for duplicates
    const { duplicates, newLines } = await this.checkDuplicateLines(
      companyId,
      bankAccountId,
      lines
    );

    if (newLines.length === 0) {
      throw new Error(
        `All ${duplicates.length} transactions already exist in the system. No new lines to import.`
      );
    }

    // Prepare bulk insert (only new lines)
    const feedLines = newLines.map((line, index) => ({
      companyId,
      statementId,
      bankAccountId,
      transactionDate: line.date,
      description: line.description,
      reference: line.reference || "",
      debitAmount: line.debit || 0,
      creditAmount: line.credit || 0,
      runningBalance: line.balance,
      rawData: line.raw,
      rowNumber: index + 1,
      lineHash: line.lineHash,
      status: "unallocated",
    }));

    // Bulk insert with ordered: false to continue on duplicate errors
    let inserted = [];
    let duplicateCount = duplicates.length;

    try {
      inserted = await BankFeedLine.insertMany(feedLines, { ordered: false });
    } catch (bulkError) {
      // Handle bulk write error - some documents may have been inserted
      if (bulkError.code === 11000 || bulkError.name === "MongoBulkWriteError") {
        // Get successfully inserted documents
        inserted = bulkError.insertedDocs || [];
        // Add to duplicate count
        const writeErrors = bulkError.writeErrors || [];
        duplicateCount += writeErrors.length;

        // If nothing was inserted at all, throw error
        if (inserted.length === 0) {
          throw new Error(
            `All ${feedLines.length} transactions already exist in the system. No new lines to import.`
          );
        }
      } else {
        throw bulkError;
      }
    }

    // Update statement stats — round to clean KES values.
    const totalDebits =
      Math.round(feedLines.reduce((sum, l) => sum + l.debitAmount, 0) * 100) /
      100;
    const totalCredits =
      Math.round(feedLines.reduce((sum, l) => sum + l.creditAmount, 0) * 100) /
      100;

    // ──────────────────────────────────────────
    // RECONCILIATION: extract opening / closing balance
    // ──────────────────────────────────────────
    // If the bank includes a running-balance column, infer:
    //   openingBalance = first line's runningBalance - net effect of that line
    //   closingBalance = last line's runningBalance
    // Sort by date (ascending) then by row number to get chronological order
    // — robust against banks that import lines out of date order.
    let openingBalance = null;
    let closingBalance = null;
    let balanceSource = "unavailable";
    const linesWithBalance = feedLines
      .filter((l) => l.runningBalance != null && Number.isFinite(l.runningBalance))
      .sort((a, b) => {
        const ta = a.transactionDate?.getTime?.() || 0;
        const tb = b.transactionDate?.getTime?.() || 0;
        if (ta !== tb) return ta - tb;
        return (a.rowNumber || 0) - (b.rowNumber || 0);
      });
    if (linesWithBalance.length > 0) {
      const first = linesWithBalance[0];
      const last = linesWithBalance[linesWithBalance.length - 1];
      // Net effect of the first line: credit - debit. Subtract from the
      // running balance to back-calculate what came BEFORE the first line.
      const firstNet = (first.creditAmount || 0) - (first.debitAmount || 0);
      openingBalance = Math.round((first.runningBalance - firstNet) * 100) / 100;
      closingBalance = Math.round(last.runningBalance * 100) / 100;
      balanceSource = "from_file";
    }

    await BankStatement.findByIdAndUpdate(statementId, {
      status: "ready",
      stats: {
        totalLines: inserted.length,
        unallocatedLines: inserted.length,
        allocatedLines: 0,
        excludedLines: 0,
        totalDebits,
        totalCredits,
      },
      openingBalance,
      closingBalance,
      balanceSource,
    });

    // Run auto-matching in background
    this.autoMatchLines(statementId, companyId).catch(console.error);

    return {
      inserted,
      duplicatesSkipped: duplicateCount,
      message:
        duplicateCount > 0
          ? `Imported ${inserted.length} new lines. Skipped ${duplicateCount} duplicate transactions.`
          : `Imported ${inserted.length} lines.`,
    };
  }

  /**
   * Parse CSV content based on column mapping
   */
  static parseCSV(csvContent, columnMapping, dateFormat = "DD/MM/YYYY") {
    const lines = csvContent.split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("CSV must have at least a header row and one data row");
    }

    const headers = this.parseCSVLine(lines[0]);
    const headerIndexes = {};

    // Map column names to indexes
    for (const [field, columnName] of Object.entries(columnMapping)) {
      if (columnName) {
        const index = headers.findIndex(
          (h) => h.toLowerCase().trim() === columnName.toLowerCase().trim()
        );
        if (index !== -1) {
          headerIndexes[field] = index;
        }
      }
    }

    const parsedLines = [];
    let droppedDateInvalid = 0;
    let droppedZeroAmount = 0;

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length === 0 || values.every((v) => !v.trim())) continue;

      const line = {
        date: this.parseDate(values[headerIndexes.date], dateFormat),
        description: values[headerIndexes.description] || "",
        reference: values[headerIndexes.reference] || "",
        balance: this.parseNumber(values[headerIndexes.balance]),
        raw: values,
      };

      // Handle debit/credit columns
      if (headerIndexes.amount !== undefined) {
        // Single amount column (positive = credit, negative = debit)
        const amount = this.parseNumber(values[headerIndexes.amount]);
        if (amount >= 0) {
          line.credit = amount;
          line.debit = 0;
        } else {
          line.debit = Math.abs(amount);
          line.credit = 0;
        }
      } else {
        // Separate debit/credit columns
        // Use absolute values - bank statements may show withdrawals as negative
        // even in separate columns (e.g., "Money Out" = -204,021.00)
        const rawDebit = this.parseNumber(values[headerIndexes.debit]);
        const rawCredit = this.parseNumber(values[headerIndexes.credit]);
        line.debit = Math.abs(rawDebit) || 0;
        line.credit = Math.abs(rawCredit) || 0;
      }

      // Skip lines with invalid dates — but track the count so we can give
      // a useful error if it happens to every row (almost always means the
      // user's selected dateFormat doesn't match the actual file).
      if (!line.date || isNaN(line.date.getTime())) {
        droppedDateInvalid++;
        continue;
      }

      // Skip zero-amount rows — typically "BALANCE B/FWD" entries that
      // some banks include as the first line.
      if (line.debit === 0 && line.credit === 0) {
        droppedZeroAmount++;
        continue;
      }

      parsedLines.push(line);
    }

    // Attach diagnostics so the caller can build a meaningful error
    // instead of a generic "No valid transactions" message.
    parsedLines.diagnostics = {
      totalDataRows: lines.length - 1,
      droppedDateInvalid,
      droppedZeroAmount,
    };

    return parsedLines;
  }

  /**
   * Parse a single CSV line (handles quoted values)
   */
  static parseCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  /**
   * Parse date from string
   */
  static parseDate(dateStr, format = "DD/MM/YYYY") {
    if (!dateStr) return null;

    dateStr = dateStr.trim();

    // Try common formats. The wizard exposes DD.MM.YYYY (and auto-detects
    // it client-side) — keep this list in sync, otherwise every row gets
    // dropped server-side as "invalid date".
    const formats = [
      { regex: /^(\d{2})\/(\d{2})\/(\d{4})$/, parse: (m) => new Date(m[3], m[2] - 1, m[1]) }, // DD/MM/YYYY
      { regex: /^(\d{2})-(\d{2})-(\d{4})$/, parse: (m) => new Date(m[3], m[2] - 1, m[1]) }, // DD-MM-YYYY
      { regex: /^(\d{2})\.(\d{2})\.(\d{4})$/, parse: (m) => new Date(m[3], m[2] - 1, m[1]) }, // DD.MM.YYYY
      { regex: /^(\d{4})-(\d{2})-(\d{2})$/, parse: (m) => new Date(m[1], m[2] - 1, m[3]) }, // YYYY-MM-DD
      { regex: /^(\d{4})\/(\d{2})\/(\d{2})$/, parse: (m) => new Date(m[1], m[2] - 1, m[3]) }, // YYYY/MM/DD
      { regex: /^(\d{2})\/(\d{2})\/(\d{2})$/, parse: (m) => new Date(2000 + parseInt(m[3]), m[2] - 1, m[1]) }, // DD/MM/YY
      { regex: /^(\d{2})\.(\d{2})\.(\d{2})$/, parse: (m) => new Date(2000 + parseInt(m[3]), m[2] - 1, m[1]) }, // DD.MM.YY
    ];

    for (const { regex, parse } of formats) {
      const match = dateStr.match(regex);
      if (match) {
        return parse(match);
      }
    }

    // Fallback to Date.parse
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Parse number from string (handles currency symbols, commas, brackets)
   */
  static parseNumber(str) {
    if (!str) return 0;

    str = String(str).trim();

    // Check for brackets (negative)
    const isNegative = str.startsWith("(") && str.endsWith(")");
    if (isNegative) {
      str = str.slice(1, -1);
    }

    // Remove currency symbols, spaces, and commas
    str = str.replace(/[KES$£€\s,]/gi, "");

    const num = parseFloat(str);
    if (isNaN(num)) return 0;

    return isNegative ? -num : num;
  }

  // ============================================
  // AUTO-MATCHING
  // ============================================

  /**
   * Auto-match bank lines to invoices/bills
   */
  static async autoMatchLines(statementId, companyId) {
    await connectDB();

    const lines = await BankFeedLine.find({
      statementId,
      status: "unallocated",
    }).lean();

    if (lines.length === 0) return { matched: 0, autoAllocated: 0 };

    // Convert companyId to ObjectId if it's a string
    const companyOid =
      typeof companyId === "string"
        ? new mongoose.Types.ObjectId(companyId)
        : companyId;

    // Get unpaid invoices and bills (lean — we only need a few fields)
    const [invoices, bills] = await Promise.all([
      Invoice.find({
        companyId: companyOid,
        status: "completed",
        paymentStatus: { $in: ["unpaid", "partial"] },
        amountDue: { $gt: 0 },
      })
        .select(
          "invoiceNumber amountDue total customer.id customer.name",
        )
        .lean(),
      Bill.find({
        companyId: companyOid,
        status: "approved",
        paymentStatus: { $in: ["unpaid", "partial"] },
        "amounts.balance": { $gt: 0 },
      })
        .select(
          "billNumber amounts.balance total supplier.partyId supplier.name",
        )
        .lean(),
    ]);

    // Lines that look like a perfect match (≥95 confidence, exact amount,
    // reference number found in description) get auto-allocated below.
    // Threshold high enough to avoid false positives — anything ambiguous
    // still goes to the user for review.
    const AUTO_ALLOCATE_THRESHOLD = 95;
    const SUGGEST_THRESHOLD = 30;

    const suggestionUpdates = []; // bulk-write payload
    const autoAllocateQueue = []; // [{ lineId, type, documentId }]

    for (const line of lines) {
      const suggestions = [];

      // Money in → match invoices
      if (line.creditAmount > 0) {
        for (const invoice of invoices) {
          const confidence = this.calculateMatchConfidence(
            line,
            invoice,
            "invoice",
          );
          if (confidence > SUGGEST_THRESHOLD) {
            suggestions.push({
              type: "invoice",
              documentId: invoice._id,
              documentNumber: invoice.invoiceNumber,
              partyName: invoice.customer?.name,
              amount: invoice.amountDue,
              confidence,
              matchReason: this.getMatchReason(line, invoice),
            });
          }
        }
      }

      // Money out → match bills
      if (line.debitAmount > 0) {
        for (const bill of bills) {
          const confidence = this.calculateMatchConfidence(
            line,
            bill,
            "bill",
          );
          if (confidence > SUGGEST_THRESHOLD) {
            suggestions.push({
              type: "bill",
              documentId: bill._id,
              documentNumber: bill.billNumber,
              partyName: bill.supplier?.name,
              amount: bill.amounts?.balance || 0,
              confidence,
              matchReason: this.getMatchReason(line, bill),
            });
          }
        }
      }

      if (suggestions.length === 0) continue;

      suggestions.sort((a, b) => b.confidence - a.confidence);
      const topSuggestions = suggestions.slice(0, 5);
      const top = topSuggestions[0];

      // If the top suggestion is perfect AND distinctly better than the
      // next-best, auto-allocate. The "distinctly better" rule prevents
      // the engine from confidently picking one of two identical-amount
      // invoices for the same customer — those need a human.
      const second = topSuggestions[1];
      const isUnambiguous =
        top.confidence >= AUTO_ALLOCATE_THRESHOLD &&
        (!second || top.confidence - second.confidence >= 15);

      if (isUnambiguous) {
        autoAllocateQueue.push({
          lineId: line._id,
          type: top.type,
          documentId: top.documentId,
        });
      } else {
        // Just save the suggestion list — user picks.
        suggestionUpdates.push({
          updateOne: {
            filter: { _id: line._id },
            update: { $set: { suggestions: topSuggestions } },
          },
        });
      }
    }

    // Single bulk write replaces N findByIdAndUpdate calls.
    if (suggestionUpdates.length > 0) {
      await BankFeedLine.bulkWrite(suggestionUpdates, { ordered: false });
    }

    // Auto-allocate perfect matches sequentially (each is its own
    // transaction, so a single failure doesn't block the others).
    let autoAllocated = 0;
    for (const item of autoAllocateQueue) {
      try {
        if (item.type === "invoice") {
          await this.allocateToInvoice(
            item.lineId,
            item.documentId,
            "system",
            "Auto-match",
          );
        } else {
          await this.allocateToBill(
            item.lineId,
            item.documentId,
            "system",
            "Auto-match",
          );
        }
        autoAllocated += 1;
      } catch (err) {
        // Auto-allocate failed (race / state changed / etc.) — fall back
        // to keeping the suggestion so the user can retry manually.
        console.error("Auto-allocate failed for line", item.lineId, err.message);
        try {
          await BankFeedLine.findOneAndUpdate(
            { _id: item.lineId, companyId: companyOid },
            {
              $set: {
                suggestions: [
                  {
                    type: item.type,
                    documentId: item.documentId,
                    confidence: AUTO_ALLOCATE_THRESHOLD,
                    matchReason: "auto_allocate_failed",
                  },
                ],
              },
            },
          );
        } catch {}
      }
    }

    return {
      matched: suggestionUpdates.length + autoAllocated,
      autoAllocated,
    };
  }

  /**
   * Calculate match confidence (0-100)
   */
  static calculateMatchConfidence(line, document, type) {
    let confidence = 0;
    const amount = type === "invoice" ? line.creditAmount : line.debitAmount;
    // Invoice uses amountDue, Bill uses amounts.balance
    const docAmount = type === "invoice"
      ? (document.amountDue || document.total)
      : (document.amounts?.balance || document.total);

    // Amount match (40 points max)
    if (Math.abs(amount - docAmount) < 1) {
      confidence += 40; // Exact match
    } else if (Math.abs(amount - docAmount) < docAmount * 0.05) {
      confidence += 25; // Within 5%
    }

    // Reference match (35 points max)
    const docNumber = type === "invoice" ? document.invoiceNumber : document.billNumber;
    const description = (line.description + " " + line.reference).toLowerCase();

    if (docNumber && description.includes(docNumber.toLowerCase())) {
      confidence += 35;
    }

    // Party name match (25 points max)
    const partyName = type === "invoice"
      ? document.customer?.name
      : document.supplier?.name;

    if (partyName) {
      const partyWords = partyName.toLowerCase().split(/\s+/);
      const matchedWords = partyWords.filter((w) =>
        w.length > 2 && description.includes(w)
      );
      if (matchedWords.length > 0) {
        confidence += Math.min(25, matchedWords.length * 10);
      }
    }

    return Math.min(100, confidence);
  }

  /**
   * Get human-readable match reason
   */
  static getMatchReason(line, document) {
    const reasons = [];
    const description = (line.description + " " + line.reference).toLowerCase();
    const docNumber = document.invoiceNumber || document.billNumber;

    if (docNumber && description.includes(docNumber.toLowerCase())) {
      reasons.push("reference_match");
    }

    const amount = line.creditAmount > 0 ? line.creditAmount : line.debitAmount;
    // Invoice uses amountDue, Bill uses amounts.balance
    const docAmount = document.amountDue || document.amounts?.balance || document.total;
    if (Math.abs(amount - docAmount) < 1) {
      reasons.push("amount_match");
    }

    const partyName = document.customer?.name || document.supplier?.name;
    if (partyName && description.includes(partyName.toLowerCase().split(" ")[0])) {
      reasons.push("party_match");
    }

    return reasons.join(", ") || "partial_match";
  }

  // ============================================
  // ALLOCATION
  // ============================================

  /**
   * Allocate a bank line to an invoice (payment received)
   * Handles overpayments by recording excess as Customer Advance (liability)
   */
  static async allocateToInvoice(lineId, invoiceId, userId, userName) {
    await connectDB();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const line = await BankFeedLine.findById(lineId).session(session);
      if (!line) throw new Error("Bank feed line not found");
      if (line.status !== "unallocated") throw new Error("Line already allocated");

      const invoice = await Invoice.findById(invoiceId).session(session);
      if (!invoice) throw new Error("Invoice not found");

      // Calculate amounts for overpayment handling
      const bankAmount = line.creditAmount;
      const invoiceBalance = invoice.amountDue || 0;
      const hasOverpayment = bankAmount > invoiceBalance;
      const appliedAmount = hasOverpayment ? invoiceBalance : bankAmount;
      const overpaymentAmount = hasOverpayment ? bankAmount - invoiceBalance : 0;

      // Create journal entry for payment received (handles overpayment internally)
      const journalResult = await JournalService.createPaymentReceivedEntry(
        {
          companyId: line.companyId,
          invoiceId: invoice._id,
          customerId: invoice.customer?.id,
          customerName: invoice.customer?.name,
          amount: bankAmount,
          documentBalance: invoiceBalance, // Pass balance for overpayment handling
          paymentDate: line.transactionDate,
          paymentMethod: "bank_transfer",
          reference: line.reference || line.description,
          bankAccountId: line.bankAccountId,
        },
        session
      );

      // Update bank feed line with overpayment info — tenant-scoped
      // so a malicious lineId from another tenant can't be hijacked
      // even if upstream auth is bypassed.
      await BankFeedLine.findOneAndUpdate(
        { _id: lineId, companyId: line.companyId },
        {
          status: "allocated",
          allocationType: "invoice_payment",
          matchedDocument: {
            type: "invoice",
            documentId: invoice._id,
            documentNumber: invoice.invoiceNumber,
            partyId: invoice.customer?.id,
            partyName: invoice.customer?.name,
            appliedAmount,
            overpaymentAmount,
          },
          journalEntryId: journalResult._id,
          allocatedBy: { id: userId, name: userName },
          allocatedAt: new Date(),
        },
        { session },
      );

      // Update invoice payment status — tenant-scoped + value-rounded.
      // Only credit the invoice for the applied amount (not the overpayment).
      const currentPaid = invoice.amountPaid || 0;
      const invoiceTotal = invoice.total || 0;
      const newAmountPaid = Math.round((currentPaid + appliedAmount) * 100) / 100;
      const newAmountDue =
        Math.round(Math.max(0, invoiceTotal - newAmountPaid) * 100) / 100;
      const newPaymentStatus = newAmountDue <= 0 ? "paid" : "partial";

      await Invoice.findOneAndUpdate(
        { _id: invoiceId, companyId: line.companyId },
        {
          amountPaid: newAmountPaid,
          amountDue: newAmountDue,
          paymentStatus: newPaymentStatus,
        },
        { session },
      );

      // Update statement stats
      await this.updateStatementStats(line.statementId, session);

      await session.commitTransaction();
      return {
        success: true,
        journalEntryId: journalResult._id,
        appliedAmount,
        overpaymentAmount,
        message: hasOverpayment
          ? `Payment allocated. ${appliedAmount.toFixed(2)} applied to invoice, ${overpaymentAmount.toFixed(2)} recorded as customer advance.`
          : `Payment of ${appliedAmount.toFixed(2)} allocated to invoice.`,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Allocate a bank line to a bill (payment made)
   * Handles overpayments by recording excess as Supplier Advance (asset)
   */
  static async allocateToBill(lineId, billId, userId, userName) {
    await connectDB();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const line = await BankFeedLine.findById(lineId).session(session);
      if (!line) throw new Error("Bank feed line not found");
      if (line.status !== "unallocated") throw new Error("Line already allocated");

      const bill = await Bill.findById(billId).session(session);
      if (!bill) throw new Error("Bill not found");

      // Calculate amounts for overpayment handling
      const bankAmount = line.debitAmount;
      const billBalance = bill.amounts?.balance || 0;
      const hasOverpayment = bankAmount > billBalance;
      const appliedAmount = hasOverpayment ? billBalance : bankAmount;
      const overpaymentAmount = hasOverpayment ? bankAmount - billBalance : 0;

      // Create journal entry for payment made (handles overpayment internally)
      const journalResult = await JournalService.createPaymentMadeEntry(
        {
          companyId: line.companyId,
          billId: bill._id,
          supplierId: bill.supplier?.id,
          supplierName: bill.supplier?.name,
          amount: bankAmount,
          documentBalance: billBalance, // Pass balance for overpayment handling
          paymentDate: line.transactionDate,
          paymentMethod: "bank_transfer",
          reference: line.reference || line.description,
          bankAccountId: line.bankAccountId,
        },
        session
      );

      // Update bank feed line with overpayment info — tenant-scoped.
      await BankFeedLine.findOneAndUpdate(
        { _id: lineId, companyId: line.companyId },
        {
          status: "allocated",
          allocationType: "bill_payment",
          matchedDocument: {
            type: "bill",
            documentId: bill._id,
            documentNumber: bill.billNumber,
            partyId: bill.supplier?.id,
            partyName: bill.supplier?.name,
            appliedAmount,
            overpaymentAmount,
          },
          journalEntryId: journalResult._id,
          allocatedBy: { id: userId, name: userName },
          allocatedAt: new Date(),
        },
        { session },
      );

      // Update bill payment status — tenant-scoped + value-rounded.
      const currentPaid = bill.amounts?.paid || 0;
      const netPayable = bill.amounts?.netPayable || 0;
      const newAmountPaid =
        Math.round((currentPaid + appliedAmount) * 100) / 100;
      const newBalance =
        Math.round(Math.max(0, netPayable - newAmountPaid) * 100) / 100;
      const newPaymentStatus = newBalance <= 0 ? "paid" : "partial";

      await Bill.findOneAndUpdate(
        { _id: billId, companyId: line.companyId },
        {
          "amounts.paid": newAmountPaid,
          "amounts.balance": newBalance,
          paymentStatus: newPaymentStatus,
        },
        { session },
      );

      // Update statement stats
      await this.updateStatementStats(line.statementId, session);

      await session.commitTransaction();
      return {
        success: true,
        journalEntryId: journalResult._id,
        appliedAmount,
        overpaymentAmount,
        message: hasOverpayment
          ? `Payment allocated. ${appliedAmount.toFixed(2)} applied to bill, ${overpaymentAmount.toFixed(2)} recorded as supplier advance.`
          : `Payment of ${appliedAmount.toFixed(2)} allocated to bill.`,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Allocate a bank line to an expense account
   */
  static async allocateToExpense(lineId, allocationData, userId, userName) {
    await connectDB();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const line = await BankFeedLine.findById(lineId).session(session);
      if (!line) throw new Error("Bank feed line not found");
      if (line.status !== "unallocated") throw new Error("Line already allocated");

      const { accountId, description, partyId, partyName, taxAmount, taxAccountId } = allocationData;

      // Get account details
      const account = await Account.findById(accountId);
      if (!account) throw new Error("Account not found");

      // Build journal entry lines
      const lines = [
        {
          accountId: accountId,
          debit: line.debitAmount,
          credit: 0,
          description: description || line.description,
        },
        {
          accountId: line.bankAccountId,
          debit: 0,
          credit: line.debitAmount,
          description: description || line.description,
        },
      ];

      // Add tax line if applicable
      if (taxAmount && taxAccountId) {
        lines[0].debit -= taxAmount;
        lines.push({
          accountId: taxAccountId,
          debit: taxAmount,
          credit: 0,
          description: `VAT on ${description || line.description}`,
        });
      }

      // Create journal entry
      const user = { name: userName, id: userId };
      const journalEntry = await JournalService.createJournalEntry(
        {
          companyId: line.companyId,
          entryType: "expense",
          entryDate: line.transactionDate,
          description: description || line.description,
          reference: line.reference,
          lines,
          party: partyId ? { type: "supplier", id: partyId, name: partyName } : null,
          sourceDocument: {
            type: "bank_feed",
            id: line._id,
          },
        },
        user,
        session,
        line.companyId
      );

      // Update bank feed line
      await BankFeedLine.findByIdAndUpdate(
        lineId,
        {
          status: "allocated",
          allocationType: "expense",
          allocations: [
            {
              accountId,
              accountCode: account.accountCode,
              accountName: account.accountName,
              amount: line.debitAmount - (taxAmount || 0),
              description: description || line.description,
              taxAmount,
              taxAccountId,
            },
          ],
          party: partyId ? { type: "supplier", id: partyId, name: partyName } : null,
          journalEntryId: journalEntry._id,
          allocatedBy: { id: userId, name: userName },
          allocatedAt: new Date(),
        },
        { session }
      );

      // Update statement stats
      await this.updateStatementStats(line.statementId, session);

      await session.commitTransaction();
      return { success: true, journalEntryId: journalEntry._id };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Allocate a bank line to income account
   */
  static async allocateToIncome(lineId, allocationData, userId, userName) {
    await connectDB();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const line = await BankFeedLine.findById(lineId).session(session);
      if (!line) throw new Error("Bank feed line not found");
      if (line.status !== "unallocated") throw new Error("Line already allocated");

      const { accountId, description, partyId, partyName, taxAmount, taxAccountId } = allocationData;

      // Get account details
      const account = await Account.findById(accountId);
      if (!account) throw new Error("Account not found");

      // Build journal entry lines
      const lines = [
        {
          accountId: line.bankAccountId,
          debit: line.creditAmount,
          credit: 0,
          description: description || line.description,
        },
        {
          accountId: accountId,
          debit: 0,
          credit: line.creditAmount,
          description: description || line.description,
        },
      ];

      // Add tax line if applicable
      if (taxAmount && taxAccountId) {
        lines[1].credit -= taxAmount;
        lines.push({
          accountId: taxAccountId,
          debit: 0,
          credit: taxAmount,
          description: `VAT on ${description || line.description}`,
        });
      }

      // Create journal entry
      const user = { name: userName, id: userId };
      const journalEntry = await JournalService.createJournalEntry(
        {
          companyId: line.companyId,
          entryType: "income",
          entryDate: line.transactionDate,
          description: description || line.description,
          reference: line.reference,
          lines,
          party: partyId ? { type: "customer", id: partyId, name: partyName } : null,
          sourceDocument: {
            type: "bank_feed",
            id: line._id,
          },
        },
        user,
        session,
        line.companyId
      );

      // Update bank feed line
      await BankFeedLine.findByIdAndUpdate(
        lineId,
        {
          status: "allocated",
          allocationType: "income",
          allocations: [
            {
              accountId,
              accountCode: account.accountCode,
              accountName: account.accountName,
              amount: line.creditAmount - (taxAmount || 0),
              description: description || line.description,
              taxAmount,
              taxAccountId,
            },
          ],
          party: partyId ? { type: "customer", id: partyId, name: partyName } : null,
          journalEntryId: journalEntry._id,
          allocatedBy: { id: userId, name: userName },
          allocatedAt: new Date(),
        },
        { session }
      );

      // Update statement stats
      await this.updateStatementStats(line.statementId, session);

      await session.commitTransaction();
      return { success: true, journalEntryId: journalEntry._id };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Allocate a bank line to a liability account (statutory payments like HELB, PAYE, loans)
   * Journal entry: Dr Liability, Cr Bank
   */
  static async allocateToLiability(lineId, allocationData, userId, userName) {
    await connectDB();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const line = await BankFeedLine.findById(lineId).session(session);
      if (!line) throw new Error("Bank feed line not found");
      if (line.status !== "unallocated") throw new Error("Line already allocated");

      const { accountId, description, reference } = allocationData;

      // Get account details
      const account = await Account.findById(accountId);
      if (!account) throw new Error("Liability account not found");

      // Build journal entry lines: Dr Liability, Cr Bank
      const journalLines = [
        {
          accountId: accountId,
          debit: line.debitAmount,
          credit: 0,
          description: description || line.description,
        },
        {
          accountId: line.bankAccountId,
          debit: 0,
          credit: line.debitAmount,
          description: description || line.description,
        },
      ];

      // Create journal entry
      const user = { name: userName, id: userId };
      const journalEntry = await JournalService.createJournalEntry(
        {
          companyId: line.companyId,
          entryType: "liability_payment",
          entryDate: line.transactionDate,
          description: description || `Liability payment - ${account.accountName}`,
          reference: reference || line.reference,
          lines: journalLines,
          sourceDocument: {
            type: "bank_feed",
            id: line._id,
          },
        },
        user,
        session,
        line.companyId
      );

      // Update bank feed line
      await BankFeedLine.findByIdAndUpdate(
        lineId,
        {
          status: "allocated",
          allocationType: "liability_payment",
          allocations: [
            {
              accountId,
              accountCode: account.accountCode,
              accountName: account.accountName,
              amount: line.debitAmount,
              description: description || line.description,
            },
          ],
          journalEntryId: journalEntry._id,
          allocatedBy: { id: userId, name: userName },
          allocatedAt: new Date(),
        },
        { session }
      );

      // Update statement stats
      await this.updateStatementStats(line.statementId, session);

      await session.commitTransaction();
      return { success: true, journalEntryId: journalEntry._id };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Allocate a bank line to multiple invoices (combined payment)
   * @param {string} lineId - Bank feed line ID
   * @param {Array} invoiceAllocations - Array of { invoiceId, amount }
   * @param {string} userId - User ID
   * @param {string} userName - User name
   */
  static async allocateToMultipleInvoices(lineId, invoiceAllocations, userId, userName) {
    await connectDB();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const line = await BankFeedLine.findById(lineId).session(session);
      if (!line) throw new Error("Bank feed line not found");
      if (line.status !== "unallocated") throw new Error("Line already allocated");

      const totalAllocated = invoiceAllocations.reduce((sum, a) => sum + a.amount, 0);
      const bankAmount = line.creditAmount;

      // Validate total doesn't exceed bank amount
      if (totalAllocated > bankAmount + 0.01) {
        throw new Error(`Total allocation (${totalAllocated}) exceeds bank amount (${bankAmount})`);
      }

      const matchedDocuments = [];
      const journalLines = [
        {
          accountId: line.bankAccountId,
          debit: bankAmount,
          credit: 0,
          description: line.description,
        },
      ];

      // Process each invoice
      for (const allocation of invoiceAllocations) {
        const invoice = await Invoice.findById(allocation.invoiceId).session(session);
        if (!invoice) throw new Error(`Invoice ${allocation.invoiceId} not found`);

        // Update invoice payment
        const newAmountPaid = (invoice.amountPaid || 0) + allocation.amount;
        const newBalanceDue = invoice.total - newAmountPaid;
        const newStatus = newBalanceDue <= 0.01 ? "paid" : "partially_paid";

        await Invoice.findByIdAndUpdate(
          allocation.invoiceId,
          {
            amountPaid: newAmountPaid,
            balanceDue: Math.max(0, newBalanceDue),
            status: newStatus,
          },
          { session }
        );

        matchedDocuments.push({
          type: "invoice",
          documentId: invoice._id,
          documentNumber: invoice.invoiceNumber,
          partyId: invoice.customer?.id,
          partyName: invoice.customer?.name,
          amount: allocation.amount,
        });

        // Add journal line for A/R
        journalLines.push({
          accountId: invoice.accountsReceivableId || line.companyId, // Use default A/R
          debit: 0,
          credit: allocation.amount,
          description: `Payment for ${invoice.invoiceNumber}`,
        });
      }

      // Handle overpayment (excess goes to customer advance)
      const excess = bankAmount - totalAllocated;
      if (excess > 0.01) {
        // TODO: Get customer advance account from settings
        // For now, add note about excess
        journalLines.push({
          accountId: line.bankAccountId, // Placeholder - should be Customer Advances
          debit: 0,
          credit: excess,
          description: `Excess payment / Customer advance`,
        });
      }

      // Create journal entry
      const user = { name: userName, id: userId };
      const journalEntry = await JournalService.createJournalEntry(
        {
          companyId: line.companyId,
          entryType: "payment_received",
          entryDate: line.transactionDate,
          description: `Payment received - ${matchedDocuments.map(d => d.documentNumber).join(", ")}`,
          reference: line.reference,
          lines: journalLines,
          sourceDocument: {
            type: "bank_feed",
            id: line._id,
          },
        },
        user,
        session,
        line.companyId
      );

      // Update bank feed line
      await BankFeedLine.findByIdAndUpdate(
        lineId,
        {
          status: "allocated",
          allocationType: "invoice_payment",
          matchedDocuments,
          journalEntryId: journalEntry._id,
          allocatedBy: { id: userId, name: userName },
          allocatedAt: new Date(),
        },
        { session }
      );

      await this.updateStatementStats(line.statementId, session);
      await session.commitTransaction();

      return {
        success: true,
        journalEntryId: journalEntry._id,
        invoicesUpdated: matchedDocuments.length,
        excessAmount: excess > 0.01 ? excess : 0,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Allocate a bank line to multiple bills (combined payment)
   */
  static async allocateToMultipleBills(lineId, billAllocations, userId, userName) {
    await connectDB();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const line = await BankFeedLine.findById(lineId).session(session);
      if (!line) throw new Error("Bank feed line not found");
      if (line.status !== "unallocated") throw new Error("Line already allocated");

      const totalAllocated = billAllocations.reduce((sum, a) => sum + a.amount, 0);
      const bankAmount = line.debitAmount;

      if (totalAllocated > bankAmount + 0.01) {
        throw new Error(`Total allocation (${totalAllocated}) exceeds bank amount (${bankAmount})`);
      }

      const matchedDocuments = [];
      const journalLines = [
        {
          accountId: line.bankAccountId,
          debit: 0,
          credit: bankAmount,
          description: line.description,
        },
      ];

      for (const allocation of billAllocations) {
        const bill = await Bill.findById(allocation.billId).session(session);
        if (!bill) throw new Error(`Bill ${allocation.billId} not found`);

        const newAmountPaid = (bill.amountPaid || 0) + allocation.amount;
        const newBalanceDue = bill.total - newAmountPaid;
        const newStatus = newBalanceDue <= 0.01 ? "paid" : "partially_paid";

        await Bill.findByIdAndUpdate(
          allocation.billId,
          {
            amountPaid: newAmountPaid,
            balanceDue: Math.max(0, newBalanceDue),
            status: newStatus,
          },
          { session }
        );

        matchedDocuments.push({
          type: "bill",
          documentId: bill._id,
          documentNumber: bill.billNumber,
          partyId: bill.supplier?.id,
          partyName: bill.supplier?.name,
          amount: allocation.amount,
        });

        journalLines.push({
          accountId: bill.accountsPayableId || line.companyId,
          debit: allocation.amount,
          credit: 0,
          description: `Payment for ${bill.billNumber}`,
        });
      }

      const user = { name: userName, id: userId };
      const journalEntry = await JournalService.createJournalEntry(
        {
          companyId: line.companyId,
          entryType: "payment_made",
          entryDate: line.transactionDate,
          description: `Payment made - ${matchedDocuments.map(d => d.documentNumber).join(", ")}`,
          reference: line.reference,
          lines: journalLines,
          sourceDocument: { type: "bank_feed", id: line._id },
        },
        user,
        session,
        line.companyId
      );

      await BankFeedLine.findByIdAndUpdate(
        lineId,
        {
          status: "allocated",
          allocationType: "bill_payment",
          matchedDocuments,
          journalEntryId: journalEntry._id,
          allocatedBy: { id: userId, name: userName },
          allocatedAt: new Date(),
        },
        { session }
      );

      await this.updateStatementStats(line.statementId, session);
      await session.commitTransaction();

      return { success: true, journalEntryId: journalEntry._id, billsUpdated: matchedDocuments.length };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Allocate as bank transfer (between accounts)
   */
  static async allocateAsTransfer(lineId, targetAccountId, description, userId, userName) {
    await connectDB();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const line = await BankFeedLine.findById(lineId).session(session);
      if (!line) throw new Error("Bank feed line not found");
      if (line.status !== "unallocated") throw new Error("Line already allocated");

      const targetAccount = await Account.findById(targetAccountId);
      if (!targetAccount) throw new Error("Target account not found");

      const amount = line.debitAmount > 0 ? line.debitAmount : line.creditAmount;
      const isOutgoing = line.debitAmount > 0;

      const journalLines = isOutgoing
        ? [
            { accountId: targetAccountId, debit: amount, credit: 0, description },
            { accountId: line.bankAccountId, debit: 0, credit: amount, description },
          ]
        : [
            { accountId: line.bankAccountId, debit: amount, credit: 0, description },
            { accountId: targetAccountId, debit: 0, credit: amount, description },
          ];

      const user = { name: userName, id: userId };
      const journalEntry = await JournalService.createJournalEntry(
        {
          companyId: line.companyId,
          entryType: "transfer",
          entryDate: line.transactionDate,
          description: description || `Bank transfer`,
          reference: line.reference,
          lines: journalLines,
          sourceDocument: { type: "bank_feed", id: line._id },
        },
        user,
        session,
        line.companyId
      );

      await BankFeedLine.findByIdAndUpdate(
        lineId,
        {
          status: "allocated",
          allocationType: "transfer",
          allocations: [
            {
              accountId: targetAccountId,
              accountCode: targetAccount.accountCode,
              accountName: targetAccount.accountName,
              amount,
              description,
            },
          ],
          journalEntryId: journalEntry._id,
          allocatedBy: { id: userId, name: userName },
          allocatedAt: new Date(),
        },
        { session }
      );

      await this.updateStatementStats(line.statementId, session);
      await session.commitTransaction();

      return { success: true, journalEntryId: journalEntry._id };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Allocate with split across multiple accounts
   * @param {string} lineId - Bank feed line ID
   * @param {Array} splits - Array of { accountId, amount, description }
   */
  static async allocateWithSplit(lineId, splits, userId, userName) {
    await connectDB();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const line = await BankFeedLine.findById(lineId).session(session);
      if (!line) throw new Error("Bank feed line not found");
      if (line.status !== "unallocated") throw new Error("Line already allocated");

      const bankAmount = line.debitAmount > 0 ? line.debitAmount : line.creditAmount;
      const totalSplit = splits.reduce((sum, s) => sum + s.amount, 0);

      // Validate split total matches bank amount
      if (Math.abs(totalSplit - bankAmount) > 0.01) {
        throw new Error(`Split total (${totalSplit}) must equal bank amount (${bankAmount})`);
      }

      const isDebit = line.debitAmount > 0;
      const allocations = [];
      const journalLines = [
        {
          accountId: line.bankAccountId,
          debit: isDebit ? 0 : bankAmount,
          credit: isDebit ? bankAmount : 0,
          description: line.description,
        },
      ];

      for (const split of splits) {
        const account = await Account.findById(split.accountId);
        if (!account) throw new Error(`Account ${split.accountId} not found`);

        journalLines.push({
          accountId: split.accountId,
          debit: isDebit ? split.amount : 0,
          credit: isDebit ? 0 : split.amount,
          description: split.description || line.description,
        });

        allocations.push({
          accountId: split.accountId,
          accountCode: account.accountCode,
          accountName: account.accountName,
          amount: split.amount,
          description: split.description,
        });
      }

      const user = { name: userName, id: userId };
      const journalEntry = await JournalService.createJournalEntry(
        {
          companyId: line.companyId,
          entryType: isDebit ? "expense" : "income",
          entryDate: line.transactionDate,
          description: line.description,
          reference: line.reference,
          lines: journalLines,
          sourceDocument: { type: "bank_feed", id: line._id },
        },
        user,
        session,
        line.companyId
      );

      await BankFeedLine.findByIdAndUpdate(
        lineId,
        {
          status: "allocated",
          allocationType: "split",
          allocations,
          journalEntryId: journalEntry._id,
          allocatedBy: { id: userId, name: userName },
          allocatedAt: new Date(),
        },
        { session }
      );

      await this.updateStatementStats(line.statementId, session);
      await session.commitTransaction();

      return { success: true, journalEntryId: journalEntry._id, splitCount: splits.length };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Exclude a bank line from allocation
   */
  static async excludeLine(lineId, reason, note, userId, userName) {
    await connectDB();

    const line = await BankFeedLine.findById(lineId);
    if (!line) throw new Error("Bank feed line not found");

    await BankFeedLine.findByIdAndUpdate(lineId, {
      status: "excluded",
      excludeReason: reason,
      excludeNote: note,
      allocatedBy: { id: userId, name: userName },
      allocatedAt: new Date(),
    });

    await this.updateStatementStats(line.statementId);

    return { success: true };
  }

  /**
   * Undo allocation (revert to unallocated)
   */
  static async undoAllocation(lineId) {
    await connectDB();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const line = await BankFeedLine.findById(lineId).session(session);
      if (!line) throw new Error("Bank feed line not found");
      if (line.status === "unallocated") throw new Error("Line is not allocated");

      // Delete the journal entry if exists
      if (line.journalEntryId) {
        await JournalEntry.findByIdAndDelete(line.journalEntryId, { session });
      }

      // Revert invoice/bill payment status if applicable
      if (line.matchedDocument && line.matchedDocument.documentId) {
        const appliedAmount = line.matchedDocument.appliedAmount || 0;

        if (line.allocationType === "invoice_payment" && appliedAmount > 0) {
          // Revert invoice payment
          const invoice = await Invoice.findById(line.matchedDocument.documentId).session(session);
          if (invoice) {
            const newAmountPaid = Math.max(0, (invoice.amountPaid || 0) - appliedAmount);
            const newAmountDue = (invoice.total || 0) - newAmountPaid;
            let newPaymentStatus = "unpaid";
            if (newAmountPaid > 0 && newAmountDue > 0) {
              newPaymentStatus = "partial";
            } else if (newAmountDue <= 0) {
              newPaymentStatus = "paid";
            }

            await Invoice.findByIdAndUpdate(
              line.matchedDocument.documentId,
              {
                amountPaid: newAmountPaid,
                amountDue: Math.max(0, newAmountDue),
                paymentStatus: newPaymentStatus,
              },
              { session }
            );
          }
        } else if (line.allocationType === "bill_payment" && appliedAmount > 0) {
          // Revert bill payment
          const bill = await Bill.findById(line.matchedDocument.documentId).session(session);
          if (bill) {
            const newAmountPaid = Math.max(0, (bill.amounts?.paid || 0) - appliedAmount);
            const newBalance = (bill.amounts?.netPayable || 0) - newAmountPaid;
            let newPaymentStatus = "unpaid";
            if (newAmountPaid > 0 && newBalance > 0) {
              newPaymentStatus = "partial";
            } else if (newBalance <= 0) {
              newPaymentStatus = "paid";
            }

            await Bill.findByIdAndUpdate(
              line.matchedDocument.documentId,
              {
                "amounts.paid": newAmountPaid,
                "amounts.balance": Math.max(0, newBalance),
                paymentStatus: newPaymentStatus,
              },
              { session }
            );
          }
        }
      }

      // Reset line
      await BankFeedLine.findByIdAndUpdate(
        lineId,
        {
          status: "unallocated",
          allocationType: null,
          matchedDocument: null,
          allocations: [],
          party: null,
          journalEntryId: null,
          allocatedBy: null,
          allocatedAt: null,
          excludeReason: null,
          excludeNote: null,
        },
        { session }
      );

      // Update statement stats
      await this.updateStatementStats(line.statementId, session);

      await session.commitTransaction();
      return { success: true };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  /**
   * Update statement statistics
   */
  static async updateStatementStats(statementId, session = null) {
    const stats = await BankFeedLine.aggregate([
      { $match: { statementId: new mongoose.Types.ObjectId(statementId) } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalDebits: { $sum: "$debitAmount" },
          totalCredits: { $sum: "$creditAmount" },
        },
      },
    ]);

    const statsByStatus = stats.reduce((acc, s) => {
      acc[s._id] = s;
      return acc;
    }, {});

    const totalLines = stats.reduce((sum, s) => sum + s.count, 0);
    const allocatedLines = (statsByStatus.allocated?.count || 0) + (statsByStatus.matched?.count || 0);
    const excludedLines = statsByStatus.excluded?.count || 0;
    const unallocatedLines = statsByStatus.unallocated?.count || 0;

    const totalDebits = stats.reduce((sum, s) => sum + s.totalDebits, 0);
    const totalCredits = stats.reduce((sum, s) => sum + s.totalCredits, 0);

    const updateData = {
      stats: {
        totalLines,
        allocatedLines,
        excludedLines,
        unallocatedLines,
        totalDebits,
        totalCredits,
      },
    };

    // Update status to completed if all lines are processed
    if (unallocatedLines === 0 && totalLines > 0) {
      updateData.status = "completed";
    }

    const options = session ? { session } : {};
    await BankStatement.findByIdAndUpdate(statementId, updateData, options);
  }
}

export default BankFeedService;
