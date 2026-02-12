import TaxTransaction from "../../models/taxTransactions";

import Account from "../../models/account";
import dbConnect from "../../config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
  validateTenantAccess,
  getCompanyIdForCreate,
  withTenantPipeline,
} from "@/lib/utils/tenant-utils";

// ============================================
// TAX SERVICE - TAX TRANSACTION MANAGEMENT
// Multi-tenant: All operations scoped by companyId
// ============================================

export class TaxService {
  static calculateVAT(amount, rate = 16) {
    return (amount * rate) / 100;
  }

  static calculateWHT(amount, rate) {
    return (amount * rate) / 100;
  }

  static async createTaxTransactionFromInvoice(invoice, user) {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();
    const targetCompanyId = invoice.companyId || companyId;

    if (!targetCompanyId && !isSuperAdmin) {
      throw new Error("Company context required");
    }

    if (typeof TaxTransaction.createFromInvoice === "function") {
      return await TaxTransaction.createFromInvoice(invoice, user);
    }

    if (invoice.taxAmount <= 0) return null;

    const invoiceDate = new Date(invoice.invoiceDate);
    const filingPeriod = `${invoiceDate.getFullYear()}-${String(
      invoiceDate.getMonth() + 1
    ).padStart(2, "0")}`;

    const vatAccount = await Account.findOne(
      withTenantScope({ systemAccount: "vat_output" }, targetCompanyId, false)
    );
    if (!vatAccount) throw new Error("VAT Output account not configured");

    return await TaxTransaction.create({
      companyId: targetCompanyId,
      transactionNumber: `VAT-OUT-${invoice.invoiceNumber}`,
      transactionDate: invoice.invoiceDate,
      taxType: "vat_output",
      taxCode: "VAT-16",
      taxRate: 16,
      baseAmount: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      totalAmount: invoice.total,
      currency: invoice.currency || "KES",
      party: {
        type: "customer",
        id: invoice.customer.id,
        name: invoice.customer.name,
        taxPin: invoice.customer.taxPin,
        email: invoice.customer.email,
        phone: invoice.customer.phone,
      },
      sourceDocument: {
        type: "invoice",
        id: invoice._id,
        number: invoice.invoiceNumber,
        date: invoice.invoiceDate,
      },
      kraTracking: { filingPeriod, filed: false },
      journalEntryId: invoice.accounting?.revenueJournalEntryId,
      accountId: vatAccount._id,
      accountCode: vatAccount.accountCode,
      accountName: vatAccount.accountName,
      description: `VAT Output on sale to ${invoice.customer.name}`,
      createdBy: { name: user.name, id: user.id },
    });
  }

  static async createTaxTransactionsFromBill(bill, user) {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();
    const targetCompanyId = bill.companyId || companyId;

    if (!targetCompanyId && !isSuperAdmin) {
      throw new Error("Company context required");
    }

    if (typeof TaxTransaction.createFromBill === "function") {
      return await TaxTransaction.createFromBill(bill, user);
    }

    const transactions = [];
    const billDate = new Date(bill.billDate);
    const filingPeriod = `${billDate.getFullYear()}-${String(
      billDate.getMonth() + 1
    ).padStart(2, "0")}`;

    if (bill.taxAmount > 0) {
      const vatAccount = await Account.findOne(
        withTenantScope({ systemAccount: "vat_input" }, targetCompanyId, false)
      );
      if (!vatAccount) throw new Error("VAT Input account not configured");

      const vatTransaction = await TaxTransaction.create({
        companyId: targetCompanyId,
        transactionNumber: `VAT-IN-${bill.billNumber}`,
        transactionDate: bill.billDate,
        taxType: "vat_input",
        taxCode: "VAT-16",
        taxRate: 16,
        baseAmount: bill.subtotal,
        taxAmount: bill.taxAmount,
        totalAmount: bill.total,
        currency: bill.currency || "KES",
        party: {
          type: "supplier",
          id: bill.supplier.id,
          name: bill.supplier.name,
          taxPin: bill.supplier.taxPin,
          email: bill.supplier.email,
          phone: bill.supplier.phone,
        },
        sourceDocument: {
          type: "bill",
          id: bill._id,
          number: bill.billNumber,
          date: bill.billDate,
        },
        kraTracking: { filingPeriod, filed: false },
        journalEntryId: bill.journalEntryId,
        accountId: vatAccount._id,
        accountCode: vatAccount.accountCode,
        accountName: vatAccount.accountName,
        description: `VAT Input on purchase from ${bill.supplier.name}`,
        createdBy: { name: user.name, id: user.id },
      });

      transactions.push(vatTransaction);
    }

    if (bill.withholdingTaxAmount > 0) {
      const whtAccount = await Account.findOne(
        withTenantScope({ systemAccount: "wht_payable" }, targetCompanyId, false)
      );
      if (!whtAccount) throw new Error("WHT Payable account not configured");

      const whtLine = bill.lines.find(
        (line) => line.whtApplicable && line.whtRate > 0
      );
      const whtRate = whtLine?.whtRate || 5;

      const whtTransaction = await TaxTransaction.create({
        companyId: targetCompanyId,
        transactionNumber: `WHT-${bill.billNumber}`,
        transactionDate: bill.billDate,
        taxType: "wht",
        taxCode: `WHT-${whtRate}`,
        taxRate: whtRate,
        baseAmount: bill.subtotal,
        taxAmount: bill.withholdingTaxAmount,
        totalAmount: bill.netPayable,
        currency: bill.currency || "KES",
        party: {
          type: "supplier",
          id: bill.supplier.id,
          name: bill.supplier.name,
          taxPin: bill.supplier.taxPin,
          email: bill.supplier.email,
          phone: bill.supplier.phone,
        },
        sourceDocument: {
          type: "bill",
          id: bill._id,
          number: bill.billNumber,
          date: bill.billDate,
        },
        kraTracking: { filingPeriod, filed: false, remitted: false },
        journalEntryId: bill.journalEntryId,
        accountId: whtAccount._id,
        accountCode: whtAccount.accountCode,
        accountName: whtAccount.accountName,
        description: `WHT ${whtRate}% on payment to ${bill.supplier.name}`,
        createdBy: { name: user.name, id: user.id },
      });

      transactions.push(whtTransaction);
    }

    return transactions;
  }

  static async generateVATReturn(filingPeriod) {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Model static method now requires companyId for tenant isolation
    if (typeof TaxTransaction.getVATReturn === "function" && companyId) {
      return await TaxTransaction.getVATReturn(companyId, filingPeriod);
    }

    const [inputResult, outputResult] = await Promise.all([
      TaxTransaction.aggregate(
        withTenantPipeline(
          [
            {
              $match: {
                taxType: "vat_input",
                "kraTracking.filingPeriod": filingPeriod,
              },
            },
            {
              $group: {
                _id: null,
                totalBase: { $sum: "$baseAmount" },
                totalTax: { $sum: "$taxAmount" },
                count: { $sum: 1 },
              },
            },
          ],
          companyId,
          isSuperAdmin
        )
      ),
      TaxTransaction.aggregate(
        withTenantPipeline(
          [
            {
              $match: {
                taxType: "vat_output",
                "kraTracking.filingPeriod": filingPeriod,
              },
            },
            {
              $group: {
                _id: null,
                totalBase: { $sum: "$baseAmount" },
                totalTax: { $sum: "$taxAmount" },
                count: { $sum: 1 },
              },
            },
          ],
          companyId,
          isSuperAdmin
        )
      ),
    ]);

    const vatInput = inputResult[0] || { totalBase: 0, totalTax: 0, count: 0 };
    const vatOutput = outputResult[0] || {
      totalBase: 0,
      totalTax: 0,
      count: 0,
    };
    const vatPayable = vatOutput.totalTax - vatInput.totalTax;

    return {
      period: filingPeriod,
      input: {
        totalPurchases: vatInput.totalBase,
        totalVAT: vatInput.totalTax,
        transactionCount: vatInput.count,
      },
      output: {
        totalSales: vatOutput.totalBase,
        totalVAT: vatOutput.totalTax,
        transactionCount: vatOutput.count,
      },
      summary: {
        vatPayable: vatPayable > 0 ? vatPayable : 0,
        vatRefundable: vatPayable < 0 ? Math.abs(vatPayable) : 0,
        netPosition: vatPayable,
      },
    };
  }

  static async generateWHTReportByRate(startDate, endDate) {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Model static method now requires companyId for tenant isolation
    if (typeof TaxTransaction.getWHTReportByRate === "function" && companyId) {
      return await TaxTransaction.getWHTReportByRate(companyId, startDate, endDate);
    }

    const result = await TaxTransaction.aggregate(
      withTenantPipeline(
        [
          {
            $match: {
              taxType: "wht",
              transactionDate: {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
              },
            },
          },
          {
            $group: {
              _id: { taxCode: "$taxCode", taxRate: "$taxRate" },
              totalBase: { $sum: "$baseAmount" },
              totalWHT: { $sum: "$taxAmount" },
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              taxCode: "$_id.taxCode",
              taxRate: "$_id.taxRate",
              totalBase: 1,
              totalWHT: 1,
              count: 1,
            },
          },
          { $sort: { taxRate: 1 } },
        ],
        companyId,
        isSuperAdmin
      )
    );

    return {
      period: { startDate, endDate },
      whtByRate: result,
      totalWHT: result.reduce((sum, item) => sum + item.totalWHT, 0),
      totalBase: result.reduce((sum, item) => sum + item.totalBase, 0),
      totalTransactions: result.reduce((sum, item) => sum + item.count, 0),
    };
  }

  static async generateWHTReportBySupplier(startDate, endDate) {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Model static method now requires companyId for tenant isolation
    if (typeof TaxTransaction.getWHTReportByParty === "function" && companyId) {
      return await TaxTransaction.getWHTReportByParty(companyId, startDate, endDate);
    }

    const result = await TaxTransaction.aggregate(
      withTenantPipeline(
        [
          {
            $match: {
              taxType: "wht",
              transactionDate: {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
              },
            },
          },
          {
            $group: {
              _id: {
                supplierId: "$party.id",
                supplierName: "$party.name",
                taxPin: "$party.taxPin",
              },
              totalBase: { $sum: "$baseAmount" },
              totalWHT: { $sum: "$taxAmount" },
              transactions: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              supplierId: "$_id.supplierId",
              supplierName: "$_id.supplierName",
              taxPin: "$_id.taxPin",
              totalBase: 1,
              totalWHT: 1,
              transactions: 1,
            },
          },
          { $sort: { totalWHT: -1 } },
        ],
        companyId,
        isSuperAdmin
      )
    );

    return {
      period: { startDate, endDate },
      whtBySupplier: result,
      totalWHT: result.reduce((sum, item) => sum + item.totalWHT, 0),
      totalBase: result.reduce((sum, item) => sum + item.totalBase, 0),
      totalTransactions: result.reduce(
        (sum, item) => sum + item.transactions,
        0
      ),
    };
  }

  static async getTaxTransactions(filters = {}) {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const query = {};
    if (filters.taxType) query.taxType = filters.taxType;
    if (filters.filingPeriod)
      query["kraTracking.filingPeriod"] = filters.filingPeriod;
    if (filters.filed !== undefined) query["kraTracking.filed"] = filters.filed;
    if (filters.remitted !== undefined)
      query["kraTracking.remitted"] = filters.remitted;

    if (filters.startDate || filters.endDate) {
      query.transactionDate = {};
      if (filters.startDate)
        query.transactionDate.$gte = new Date(filters.startDate);
      if (filters.endDate)
        query.transactionDate.$lte = new Date(filters.endDate);
    }

    return await TaxTransaction.find(
      withTenantScope(query, companyId, isSuperAdmin)
    )
      .sort({ transactionDate: -1 })
      .lean();
  }

  static async getUnfiledTransactions(taxType = null) {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Model static method now requires companyId for tenant isolation
    if (typeof TaxTransaction.getUnfiled === "function" && companyId) {
      return await TaxTransaction.getUnfiled(companyId, taxType);
    }

    const query = { "kraTracking.filed": false };
    if (taxType) query.taxType = taxType;

    return await TaxTransaction.find(
      withTenantScope(query, companyId, isSuperAdmin)
    )
      .sort({ transactionDate: 1 })
      .lean();
  }

  static async getUnremittedWHT() {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Model static method now requires companyId for tenant isolation
    if (typeof TaxTransaction.getUnremittedWHT === "function" && companyId) {
      return await TaxTransaction.getUnremittedWHT(companyId);
    }

    return await TaxTransaction.find(
      withTenantScope(
        { taxType: "wht", "kraTracking.remitted": false },
        companyId,
        isSuperAdmin
      )
    )
      .sort({ transactionDate: 1 })
      .lean();
  }

  static async markAsFiled(transactionIds, filingReference, user) {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Add tenant scoping to ensure we only update our own transactions
    return await TaxTransaction.updateMany(
      withTenantScope({ _id: { $in: transactionIds } }, companyId, isSuperAdmin),
      {
        $set: {
          "kraTracking.filed": true,
          "kraTracking.filedAt": new Date(),
          "kraTracking.filedBy": { name: user.name, id: user.id },
          "kraTracking.filingReference": filingReference,
          lastModifiedBy: { name: user.name, id: user.id },
        },
      }
    );
  }

  static async markWHTAsRemitted(transactionIds, remittanceReference, user) {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Add tenant scoping to ensure we only update our own transactions
    return await TaxTransaction.updateMany(
      withTenantScope(
        { _id: { $in: transactionIds }, taxType: "wht" },
        companyId,
        isSuperAdmin
      ),
      {
        $set: {
          "kraTracking.remitted": true,
          "kraTracking.remittedAt": new Date(),
          "kraTracking.remittedBy": { name: user.name, id: user.id },
          "kraTracking.remittanceReference": remittanceReference,
          lastModifiedBy: { name: user.name, id: user.id },
        },
      }
    );
  }

  static async getTaxSummary(startDate, endDate) {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const [vatSummary, whtSummary] = await Promise.all([
      TaxTransaction.aggregate(
        withTenantPipeline(
          [
            {
              $match: {
                taxType: { $in: ["vat_input", "vat_output"] },
                transactionDate: {
                  $gte: new Date(startDate),
                  $lte: new Date(endDate),
                },
              },
            },
            {
              $group: {
                _id: "$taxType",
                totalTax: { $sum: "$taxAmount" },
                count: { $sum: 1 },
              },
            },
          ],
          companyId,
          isSuperAdmin
        )
      ),
      TaxTransaction.aggregate(
        withTenantPipeline(
          [
            {
              $match: {
                taxType: "wht",
                transactionDate: {
                  $gte: new Date(startDate),
                  $lte: new Date(endDate),
                },
              },
            },
            {
              $group: {
                _id: null,
                totalWHT: { $sum: "$taxAmount" },
                remitted: {
                  $sum: { $cond: ["$kraTracking.remitted", "$taxAmount", 0] },
                },
                unremitted: {
                  $sum: {
                    $cond: [{ $not: "$kraTracking.remitted" }, "$taxAmount", 0],
                  },
                },
                count: { $sum: 1 },
              },
            },
          ],
          companyId,
          isSuperAdmin
        )
      ),
    ]);

    const vatInput =
      vatSummary.find((v) => v._id === "vat_input")?.totalTax || 0;
    const vatOutput =
      vatSummary.find((v) => v._id === "vat_output")?.totalTax || 0;
    const wht = whtSummary[0] || {
      totalWHT: 0,
      remitted: 0,
      unremitted: 0,
      count: 0,
    };

    return {
      period: { startDate, endDate },
      vat: {
        input: vatInput,
        output: vatOutput,
        netPayable: vatOutput - vatInput,
      },
      wht: {
        total: wht.totalWHT,
        remitted: wht.remitted,
        unremitted: wht.unremitted,
        transactionCount: wht.count,
      },
    };
  }
}

export default TaxService;
