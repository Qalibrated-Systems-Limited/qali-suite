import dbConnect from "@/app/config/dbConnect";
import Invoice from "@/app/models/invoice";
import Bill from "@/app/models/bill";
import Payment from "@/app/models/payment";
import CreditNote from "@/app/models/creditNote";
import Party from "@/app/models/parties";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { ObjectId } from "mongodb";
import { serializeBsonType } from "@/lib/utils";

// ============================================
// GET STATEMENT OF ACCOUNT DATA
// ============================================
export async function getStatementOfAccount(
  customerId,
  startDate = null,
  endDate = null,
) {
  if (!customerId || !ObjectId.isValid(customerId)) {
    return null;
  }

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Build base query
  const baseQuery = {};
  if (!isSuperAdmin && companyId) {
    baseQuery.companyId = new ObjectId(companyId);
  }

  // Get customer details
  const customer = await Party.findOne({
    _id: new ObjectId(customerId),
    ...baseQuery,
    type: { $in: ["customer", "both"] },
  }).lean();

  if (!customer) {
    return null;
  }

  // Date range filter
  const dateFilter = {};
  if (startDate) {
    dateFilter.$gte = new Date(startDate);
  }
  if (endDate) {
    dateFilter.$lte = new Date(endDate);
  }

  // Get invoices
  const invoiceQuery = {
    ...baseQuery,
    "customer.id": customerId,
    status: { $in: ["completed", "sent"] },
  };
  if (startDate || endDate) {
    invoiceQuery.invoiceDate = dateFilter;
  }

  const invoices = await Invoice.find(invoiceQuery)
    .sort({ invoiceDate: 1 })
    .lean();

  // Get payments
  const paymentQuery = {
    ...baseQuery,
    "party.partyId": new ObjectId(customerId),
    paymentType: "received",
    status: "confirmed",
  };
  if (startDate || endDate) {
    paymentQuery.paymentDate = dateFilter;
  }

  const payments = await Payment.find(paymentQuery)
    .sort({ paymentDate: 1 })
    .lean();

  // Get credit notes
  const creditNoteQuery = {
    ...baseQuery,
    "customer.id": customerId,
    status: { $in: ["issued", "applied"] },
  };
  if (startDate || endDate) {
    creditNoteQuery.creditNoteDate = dateFilter;
  }

  const creditNotes = await CreditNote.find(creditNoteQuery)
    .sort({ creditNoteDate: 1 })
    .lean();

  // Build transactions list
  const transactions = [];

  // Add invoices as debits (money owed)
  for (const inv of invoices) {
    transactions.push({
      date: inv.invoiceDate,
      type: "invoice",
      reference: inv.invoiceNumber,
      description: `Invoice ${inv.invoiceNumber}`,
      debit: inv.total,
      credit: 0,
      documentId: inv._id,
      dueDate: inv.dueDate,
      status: inv.paymentStatus,
    });
  }

  // Add payments as credits (money received)
  for (const pmt of payments) {
    transactions.push({
      date: pmt.paymentDate,
      type: "payment",
      reference: pmt.paymentNumber,
      description: `Payment ${pmt.paymentNumber} - ${pmt.paymentMethod}`,
      debit: 0,
      credit: pmt.amount,
      documentId: pmt._id,
      paymentMethod: pmt.paymentMethod,
    });
  }

  // Add credit notes as credits (reduce balance)
  for (const cn of creditNotes) {
    transactions.push({
      date: cn.creditNoteDate,
      type: "credit_note",
      reference: cn.creditNoteNumber,
      description: `Credit Note ${cn.creditNoteNumber} - ${cn.reason}`,
      debit: 0,
      credit: cn.total,
      documentId: cn._id,
      relatedInvoice: cn.invoice?.invoiceNumber,
    });
  }

  // Sort by date
  transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Calculate opening balance (before start date)
  let openingBalance = 0;
  if (startDate) {
    // Sum invoices before start date
    const priorInvoices = await Invoice.aggregate([
      {
        $match: {
          ...baseQuery,
          "customer.id": customerId,
          status: { $in: ["completed", "sent"] },
          invoiceDate: { $lt: new Date(startDate) },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
        },
      },
    ]);

    // Sum payments before start date
    const priorPayments = await Payment.aggregate([
      {
        $match: {
          ...baseQuery,
          "party.partyId": new ObjectId(customerId),
          paymentType: "received",
          status: "confirmed",
          paymentDate: { $lt: new Date(startDate) },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    // Sum credit notes before start date
    const priorCreditNotes = await CreditNote.aggregate([
      {
        $match: {
          ...baseQuery,
          "customer.id": customerId,
          status: { $in: ["issued", "applied"] },
          creditNoteDate: { $lt: new Date(startDate) },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
        },
      },
    ]);

    const invoiceTotal = priorInvoices[0]?.total || 0;
    const paymentTotal = priorPayments[0]?.total || 0;
    const creditNoteTotal = priorCreditNotes[0]?.total || 0;

    openingBalance = invoiceTotal - paymentTotal - creditNoteTotal;
  }

  // Calculate running balance
  let runningBalance = openingBalance;
  const transactionsWithBalance = transactions.map((txn) => {
    runningBalance += txn.debit - txn.credit;
    return {
      ...txn,
      balance: runningBalance,
    };
  });

  // Calculate summary
  const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const totalPaid = payments.reduce((sum, pmt) => sum + pmt.amount, 0);
  const totalCredited = creditNotes.reduce((sum, cn) => sum + cn.total, 0);
  const closingBalance =
    openingBalance + totalInvoiced - totalPaid - totalCredited;

  // Aging analysis
  const today = new Date();
  const aging = {
    current: 0,
    days30: 0,
    days60: 0,
    days90: 0,
    over90: 0,
  };

  for (const inv of invoices) {
    const amountDue = inv.amountDue || inv.total - (inv.amountPaid || 0);
    if (amountDue <= 0) continue;

    const dueDate = new Date(inv.dueDate);
    const daysPastDue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

    if (daysPastDue <= 0) {
      aging.current += amountDue;
    } else if (daysPastDue <= 30) {
      aging.days30 += amountDue;
    } else if (daysPastDue <= 60) {
      aging.days60 += amountDue;
    } else if (daysPastDue <= 90) {
      aging.days90 += amountDue;
    } else {
      aging.over90 += amountDue;
    }
  }

  return {
    customer,
    transactions: transactionsWithBalance,
    summary: {
      openingBalance,
      totalInvoiced,
      totalPaid,
      totalCredited,
      closingBalance,
    },
    aging,
    period: {
      startDate: startDate || null,
      endDate: endDate || null,
    },
    generatedAt: new Date(),
  };
}

// ============================================
// GET CUSTOMERS WITH BALANCES
// ============================================
export async function getCustomersWithBalances() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = {
    type: { $in: ["customer", "both"] },
    isActive: true,
  };
  if (!isSuperAdmin && companyId) {
    query.companyId = new ObjectId(companyId);
  }

  const customers = await Party.find(query)
    .select("_id name displayName email phone cachedBalance creditTerms")
    .sort({ name: 1 })
    .lean();

  return customers;
}

// ============================================
// GET AGING SUMMARY FOR ALL CUSTOMERS
// ============================================
export async function getAgingSummary() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const matchStage = {
    status: { $in: ["completed", "sent"] },
    paymentStatus: { $ne: "paid" },
  };
  if (!isSuperAdmin && companyId) {
    matchStage.companyId = new ObjectId(companyId);
  }

  const today = new Date();
  const day30 = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const day60 = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);
  const day90 = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);

  const aging = await Invoice.aggregate([
    { $match: matchStage },
    {
      $addFields: {
        amountOutstanding: {
          $subtract: ["$total", { $ifNull: ["$amountPaid", 0] }],
        },
      },
    },
    {
      $group: {
        _id: null,
        current: {
          $sum: {
            $cond: [{ $gte: ["$dueDate", today] }, "$amountOutstanding", 0],
          },
        },
        days30: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $lt: ["$dueDate", today] },
                  { $gte: ["$dueDate", day30] },
                ],
              },
              "$amountOutstanding",
              0,
            ],
          },
        },
        days60: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $lt: ["$dueDate", day30] },
                  { $gte: ["$dueDate", day60] },
                ],
              },
              "$amountOutstanding",
              0,
            ],
          },
        },
        days90: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $lt: ["$dueDate", day60] },
                  { $gte: ["$dueDate", day90] },
                ],
              },
              "$amountOutstanding",
              0,
            ],
          },
        },
        over90: {
          $sum: {
            $cond: [{ $lt: ["$dueDate", day90] }, "$amountOutstanding", 0],
          },
        },
        totalOutstanding: { $sum: "$amountOutstanding" },
      },
    },
  ]);

  return (
    aging[0] || {
      current: 0,
      days30: 0,
      days60: 0,
      days90: 0,
      over90: 0,
      totalOutstanding: 0,
    }
  );
}

// ============================================
// SUPPLIER STATEMENT OF ACCOUNT
// ============================================
export async function getSupplierStatement(
  supplierId,
  startDate = null,
  endDate = null,
) {
  if (!supplierId || !ObjectId.isValid(supplierId)) {
    return null;
  }

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Build base query
  const baseQuery = {};
  if (!isSuperAdmin && companyId) {
    baseQuery.companyId = new ObjectId(companyId);
  }

  // Get supplier details
  const supplier = await Party.findOne({
    _id: new ObjectId(supplierId),
    ...baseQuery,
    type: { $in: ["supplier", "both"] },
  }).lean();

  if (!supplier) {
    return null;
  }

  // Date range filter
  const dateFilter = {};
  if (startDate) {
    dateFilter.$gte = new Date(startDate);
  }
  if (endDate) {
    dateFilter.$lte = new Date(endDate);
  }

  // Get bills
  const billQuery = {
    ...baseQuery,
    "supplier.partyId": new ObjectId(supplierId),
    status: "approved",
  };
  if (startDate || endDate) {
    billQuery.billDate = dateFilter;
  }

  const bills = await Bill.find(billQuery).sort({ billDate: 1 }).lean();

  // Get payments made
  const paymentQuery = {
    ...baseQuery,
    "party.partyId": new ObjectId(supplierId),
    paymentType: "made",
    status: "confirmed",
  };
  if (startDate || endDate) {
    paymentQuery.paymentDate = dateFilter;
  }

  const payments = await Payment.find(paymentQuery)
    .sort({ paymentDate: 1 })
    .lean();

  // Build transactions list
  const transactions = [];

  // Add bills as credits (what we owe - increases payable)
  for (const bill of bills) {
    transactions.push({
      date: bill.billDate,
      type: "bill",
      reference: bill.billNumber,
      description: `Bill ${bill.billNumber}${bill.supplierInvoiceNumber ? ` (Ref: ${bill.supplierInvoiceNumber})` : ""}`,
      debit: 0,
      credit: bill.total,
      documentId: bill._id,
      dueDate: bill.dueDate,
      status: bill.paymentStatus,
    });
  }

  // Add payments as debits (what we paid - decreases payable)
  for (const pmt of payments) {
    transactions.push({
      date: pmt.paymentDate,
      type: "payment",
      reference: pmt.paymentNumber,
      description: `Payment ${pmt.paymentNumber} - ${pmt.paymentMethod}`,
      debit: pmt.amount,
      credit: 0,
      documentId: pmt._id,
      paymentMethod: pmt.paymentMethod,
    });
  }

  // Sort by date
  transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Calculate opening balance (before start date)
  let openingBalance = 0;
  if (startDate) {
    // Sum bills before start date
    const priorBills = await Bill.aggregate([
      {
        $match: {
          ...baseQuery,
          "supplier.partyId": new ObjectId(supplierId),
          status: "approved",
          billDate: { $lt: new Date(startDate) },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
        },
      },
    ]);

    // Sum payments before start date
    const priorPayments = await Payment.aggregate([
      {
        $match: {
          ...baseQuery,
          "party.partyId": new ObjectId(supplierId),
          paymentType: "made",
          status: "confirmed",
          paymentDate: { $lt: new Date(startDate) },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    const billTotal = priorBills[0]?.total || 0;
    const paymentTotal = priorPayments[0]?.total || 0;

    openingBalance = billTotal - paymentTotal;
  }

  // Calculate running balance
  let runningBalance = openingBalance;
  const transactionsWithBalance = transactions.map((txn) => {
    runningBalance += txn.credit - txn.debit;
    return {
      ...txn,
      balance: runningBalance,
    };
  });

  // Calculate summary
  const totalBilled = bills.reduce((sum, bill) => sum + bill.total, 0);
  const totalPaid = payments.reduce((sum, pmt) => sum + pmt.amount, 0);
  const closingBalance = openingBalance + totalBilled - totalPaid;

  // Aging analysis (AP aging - how long we've owed)
  const today = new Date();
  const aging = {
    current: 0,
    days30: 0,
    days60: 0,
    days90: 0,
    over90: 0,
  };

  for (const bill of bills) {
    const amountDue = bill.amountDue || bill.total - (bill.amountPaid || 0);
    if (amountDue <= 0) continue;

    const dueDate = new Date(bill.dueDate);
    const daysPastDue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

    if (daysPastDue <= 0) {
      aging.current += amountDue;
    } else if (daysPastDue <= 30) {
      aging.days30 += amountDue;
    } else if (daysPastDue <= 60) {
      aging.days60 += amountDue;
    } else if (daysPastDue <= 90) {
      aging.days90 += amountDue;
    } else {
      aging.over90 += amountDue;
    }
  }

  return {
    supplier,
    transactions: transactionsWithBalance,
    summary: {
      openingBalance,
      totalBilled,
      totalPaid,
      closingBalance,
    },
    aging,
    period: {
      startDate: startDate || null,
      endDate: endDate || null,
    },
    generatedAt: new Date(),
  };
}

// ============================================
// GET SUPPLIERS WITH BALANCES
// ============================================
export async function getSuppliersWithBalances() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = {
    type: { $in: ["supplier", "both"] },
    isActive: true,
  };
  if (!isSuperAdmin && companyId) {
    query.companyId = new ObjectId(companyId);
  }

  const suppliers = await Party.find(query)
    .select("_id name displayName email phone cachedBalance creditTerms")
    .sort({ name: 1 })
    .lean();

  return serializeBsonType(suppliers);
}

// ============================================
// GET AP AGING SUMMARY FOR ALL SUPPLIERS
// ============================================
export async function getAPAgingSummary() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const matchStage = {
    status: "approved",
    paymentStatus: { $ne: "paid" },
  };
  if (!isSuperAdmin && companyId) {
    matchStage.companyId = new ObjectId(companyId);
  }

  const today = new Date();
  const day30 = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const day60 = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);
  const day90 = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);

  const aging = await Bill.aggregate([
    { $match: matchStage },
    {
      $addFields: {
        amountOutstanding: {
          $subtract: ["$total", { $ifNull: ["$amountPaid", 0] }],
        },
      },
    },
    {
      $group: {
        _id: null,
        current: {
          $sum: {
            $cond: [{ $gte: ["$dueDate", today] }, "$amountOutstanding", 0],
          },
        },
        days30: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $lt: ["$dueDate", today] },
                  { $gte: ["$dueDate", day30] },
                ],
              },
              "$amountOutstanding",
              0,
            ],
          },
        },
        days60: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $lt: ["$dueDate", day30] },
                  { $gte: ["$dueDate", day60] },
                ],
              },
              "$amountOutstanding",
              0,
            ],
          },
        },
        days90: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $lt: ["$dueDate", day60] },
                  { $gte: ["$dueDate", day90] },
                ],
              },
              "$amountOutstanding",
              0,
            ],
          },
        },
        over90: {
          $sum: {
            $cond: [{ $lt: ["$dueDate", day90] }, "$amountOutstanding", 0],
          },
        },
        totalOutstanding: { $sum: "$amountOutstanding" },
      },
    },
  ]);

  return (
    aging[0] || {
      current: 0,
      days30: 0,
      days60: 0,
      days90: 0,
      over90: 0,
      totalOutstanding: 0,
    }
  );
}
