/**
 * Seeds a throwaway MongoDB with documents shaped like a live tenant's:
 * invoices, bills, payments, tax transactions, expenses and HR, each with the
 * journal entry it posted.
 *
 * Shapes are taken from the production documents (field names and types
 * sampled, no values), and it deliberately carries the three defects the
 * MongoDB app left in that tenant's books:
 *
 *   - a cancelled bill whose entry is 'reversed' and whose VAT record was
 *     never removed;
 *   - a draft expense with withholding tax whose posting failed, leaving a
 *     draft entry behind;
 *   - leave balances with used days but no leave requests.
 *
 *   MONGODB_URI=... node app/db/backfill/seed-documents-source.mjs
 */
import { MongoClient, ObjectId } from "mongodb";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const IDS = {};

export async function seedDocumentsSource(mongoUri = process.env.MONGODB_URI) {
  if (!mongoUri) throw new Error("MONGODB_URI must be set");
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db();

  const collections = [
    "companies", "accounts", "fiscalperiods", "parties", "users", "products",
    "weighbridgeTickets", "journalentries", "stockrequests", "invoices", "bills",
    "payments", "taxtransactions", "expenses", "departments", "leavetypes",
    "employeeprofiles", "employmenthistories", "attendance", "pettycashreturns",
  ];
  await Promise.all(collections.map((c) => db.collection(c).deleteMany({})));

  const id = () => new ObjectId();
  const companyId = (IDS.company = id());
  const by = { name: "Grace Admin", id: String((IDS.user = id())) };

  const acct = {};
  const mk = (key, code, name, type, sub, system) => {
    acct[key] = id();
    return {
      _id: acct[key], companyId, accountCode: code, accountName: name,
      accountType: type, subType: sub, systemAccount: system, canPost: true,
      isActive: true, level: 0,
    };
  };
  await db.collection("accounts").insertMany([
    mk("bank", "1112", "Cash at Bank", "asset", "bank", null),
    mk("ar", "1100", "Accounts Receivable", "asset", "accounts_receivable", "accounts_receivable"),
    mk("vatIn", "1150", "VAT Receivable (Input VAT)", "asset", "current_asset", "vat_input"),
    mk("ap", "2110", "Accounts Payable", "liability", "accounts_payable", "accounts_payable"),
    mk("vatOut", "2120", "VAT Payable (Output VAT)", "liability", "current_liability", "vat_output"),
    mk("wht", "2140", "WHT Payable", "liability", "current_liability", "wht_payable"),
    mk("accrued", "2170", "Accrued Expenses", "liability", "current_liability", "accrued_expenses"),
    mk("sales", "4000", "Transport Revenue", "revenue", "sales_revenue", "sales_revenue"),
    mk("truck", "6002", "Truck Maintenance cost", "expense", "operating_expense", null),
    mk("fuel", "6500", "Transport & Fuel", "expense", "operating_expense", null),
  ]);
  IDS.acct = acct;

  await db.collection("companies").insertOne({
    _id: companyId, name: "Haulage Ltd", slug: "haulage", code: "HAU",
    status: "active", settings: { currency: "KES", defaultVatRate: 16 },
    subscription: { plan: "professional", status: "active" },
  });
  await db.collection("users").insertOne({
    _id: IDS.user, companyId, name: by.name, email: "grace@haulage.test",
    role: "Admin", authProvider: "google", status: "Active", tokenVersion: 0,
  });

  const customer = (IDS.customer = id());
  const supplier = (IDS.supplier = id());
  const staffParty = (IDS.staffParty = id());
  await db.collection("parties").insertMany([
    { _id: customer, companyId, type: "customer", name: "Mining Co", taxPin: "P051111111A", isActive: true },
    { _id: supplier, companyId, type: "supplier", name: "Dalewa Investment Limited", taxPin: "P052222222B", isActive: true },
    { _id: staffParty, companyId, type: "employee", name: "Peter Otieno", employeeNumber: "EMP-0001", isActive: true },
  ]);

  // ── journal entries, one per posting ──────────────────────────────────────
  const je = async (number, type, date, status, lines, extra = {}) => {
    const _id = id();
    await db.collection("journalentries").insertOne({
      _id, companyId, entryNumber: number, entryType: type, entryDate: new Date(date),
      description: `${type} ${number}`, status,
      postedAt: status === "draft" ? null : new Date(date),
      lines: lines.map(([a, debit, credit]) => ({ accountId: acct[a], debit, credit })),
      ...extra,
    });
    return _id;
  };

  const saleJe = await je("JE-HAU-INV-0001", "sale", "2026-01-15", "posted",
    [["ar", 116000, 0], ["sales", 0, 100000], ["vatOut", 0, 16000]]);
  const billJe = await je("JE-HAU-BILL-0001", "purchase", "2026-01-20", "posted",
    [["truck", 50000, 0], ["vatIn", 8000, 0], ["ap", 0, 58000]]);
  const payJe = await je("JE-HAU-PAY-0001", "payment_made", "2026-02-01", "posted",
    [["ap", 30000, 0], ["bank", 0, 30000]]);
  const expJe = await je("JE-HAU-EXP-0001", "expense", "2026-02-05", "posted",
    [["fuel", 10000, 0], ["vatIn", 1600, 0], ["bank", 0, 11600]]);
  // The cancelled bill: original marked reversed, and its swapped reversal.
  const cancelledJe = await je("JE-HAU-BILL-0002", "purchase", "2026-10-03", "reversed",
    [["truck", 4310.34, 0], ["vatIn", 689.65, 0], ["ap", 0, 4999.99]],
    { reversedAt: new Date("2026-10-03T09:00:00Z"), reversedBy: by });
  const reversalJe = await je("JE-REV-0001", "adjustment", "2026-10-03", "posted",
    [["truck", 0, 4310.34], ["vatIn", 0, 689.65], ["ap", 4999.99, 0]],
    { originalEntryId: cancelledJe });
  await db.collection("journalentries").updateOne({ _id: cancelledJe }, { $set: { reversalEntryId: reversalJe } });
  // Posting the WHT expense failed after its entry was created.
  const orphanJe = await je("JE-HAU-EXP-0002", "expense", "2026-01-05", "draft",
    [["fuel", 12593.77, 0], ["vatIn", 2015, 0], ["bank", 0, 14356.89]]);
  Object.assign(IDS, { saleJe, billJe, payJe, expJe, cancelledJe, reversalJe, orphanJe });

  // ── invoices ──────────────────────────────────────────────────────────────
  const service = (desc, qty, price) => ({
    _id: id(), itemType: "service", serviceCategory: "other", description: desc,
    unit: "Transport", quantity: qty, unitPrice: price, amount: qty * price,
    taxRate: 16, taxAmount: qty * price * 0.16, discountPercentage: 0, discountAmount: 0,
    costing: { unitCost: 0, totalCost: 0 }, stockCommitted: false,
  });
  IDS.invoiceDone = id();
  IDS.invoiceDraft = id();
  await db.collection("invoices").insertMany([
    {
      _id: IDS.invoiceDone, companyId, invoiceNumber: "INV-HAU-202601-0001",
      invoiceDate: new Date("2026-01-15"), dueDate: new Date("2026-02-14"),
      customer: { id: String(customer), name: "Mining Co", taxPin: "P051111111A" },
      items: [service("Haulage Jan", 4, 25000)], subtotal: 100000, totalDiscount: 0,
      discountPercentage: 0, taxAmount: 16000, total: 116000, currency: "KES",
      paymentStatus: "unpaid", amountPaid: 0, status: "completed", paymentTerms: "Net 30",
      accounting: { accountingComplete: true, revenueJournalEntryId: saleJe },
      completedAt: new Date("2026-01-15"), completedBy: by, createdBy: by,
      createdAt: new Date("2026-01-15"), updatedAt: new Date("2026-01-15"),
    },
    {
      _id: IDS.invoiceDraft, companyId, invoiceNumber: "INV-HAU-202603-0002",
      invoiceDate: new Date("2026-03-10"), dueDate: new Date("2026-04-09"),
      customer: { id: String(customer), name: "Mining Co" },
      items: [service("Haulage Mar", 2, 30000)], subtotal: 60000, totalDiscount: 0,
      discountPercentage: 0, taxAmount: 9600, total: 69600, currency: "KES",
      paymentStatus: "unpaid", amountPaid: 0, status: "draft", paymentTerms: "Net 30",
      accounting: {}, createdBy: by,
    },
  ]);

  // ── bills ─────────────────────────────────────────────────────────────────
  const billLine = (desc, account, qty, price, vatRate) => ({
    _id: id(), lineNumber: 1, product: null, description: desc,
    account: { id: acct[account], code: account === "truck" ? "6002" : "6500", name: desc, type: "expense" },
    quantity: qty, unit: "pcs", unitPrice: price, amount: qty * price,
    vat: { rate: vatRate, amount: qty * price * vatRate / 100 },
    lineTotal: qty * price * (1 + vatRate / 100),
    weighbridgeRef: { ticketId: null, ticketNumber: null },
  });
  const billBase = (over) => ({
    companyId, supplierInvoiceNumber: "SUP-1",
    supplier: { partyId: supplier, name: "Dalewa Investment Limited", taxPin: "P052222222B" },
    whtApplicable: false, whtRate: 0, currency: "KES", isOpeningBalance: false,
    createdBy: by, ...over,
  });
  IDS.billApproved = id();
  IDS.billSubmitted = id();
  IDS.billCancelled = id();
  await db.collection("bills").insertMany([
    billBase({
      _id: IDS.billApproved, billNumber: "BILL-HAU-202601-0001",
      billDate: new Date("2026-01-20"), dueDate: new Date("2026-02-19"),
      lines: [billLine("Gearbox overhaul", "truck", 1, 50000, 16)],
      amounts: { subtotal: 50000, vat: 8000, total: 58000, wht: 0, netPayable: 58000, paid: 30000, balance: 28000 },
      status: "approved", paymentStatus: "partial",
      accounting: { journalEntryId: billJe, inventoryMoved: true, usedGRNI: false },
      submittedAt: new Date("2026-01-20"), submittedBy: by,
      approvedAt: new Date("2026-01-21"), approvedBy: by,
    }),
    billBase({
      _id: IDS.billSubmitted, billNumber: "BILL-HAU-202602-0002",
      billDate: new Date("2026-02-10"), dueDate: new Date("2026-03-12"),
      lines: [billLine("Tyres", "truck", 4, 12500, 16)],
      amounts: { subtotal: 50000, vat: 8000, total: 58000, wht: 0, netPayable: 58000, paid: 0, balance: 58000 },
      status: "submitted", paymentStatus: "unpaid", accounting: {},
      submittedAt: new Date("2026-02-10"), submittedBy: by,
    }),
    billBase({
      _id: IDS.billCancelled, billNumber: "BILL-HAU-202610-0003",
      billDate: new Date("2026-10-03"), dueDate: new Date("2026-11-02"),
      lines: [billLine("Brake service", "truck", 1, 4310.34, 16)],
      amounts: { subtotal: 4310.34, vat: 689.65, total: 4999.99, wht: 0, netPayable: 4999.99, paid: 0, balance: 4999.99 },
      status: "cancelled", paymentStatus: "unpaid",
      accounting: { journalEntryId: cancelledJe, inventoryMoved: true },
      cancelledAt: new Date("2026-10-03T09:00:00Z"), cancelledBy: by, cancellationReason: "Duplicate",
    }),
  ]);

  // ── a payment against the approved bill ───────────────────────────────────
  await db.collection("payments").insertOne({
    _id: (IDS.payment = id()), companyId, paymentNumber: "PAY-HAU-0001", paymentType: "made",
    paymentDate: new Date("2026-02-01"), amount: 30000, currency: "KES",
    paymentMethod: "bank_transfer",
    account: { id: acct.bank, code: "1112", name: "Cash at Bank", subType: "bank" },
    party: { type: "supplier", partyId: supplier, name: "Dalewa Investment Limited" },
    allocations: [{
      _id: id(), documentType: "bill", documentId: IDS.billApproved,
      documentNumber: "BILL-HAU-202601-0001", originalAmount: 58000,
      balanceBefore: 58000, amountAllocated: 30000,
    }],
    totalAllocated: 30000, unappliedAmount: 0, status: "confirmed",
    confirmedAt: new Date("2026-02-01"), confirmedBy: by, journalEntryId: payJe, createdBy: by,
  });

  // ── tax records, including the one the cancel never removed ───────────────
  const tax = (number, type, rate, base, amount, partyType, partyId, partyName, srcType, srcId, srcNumber, period, accountKey, jeId) => ({
    _id: id(), companyId, transactionNumber: number, transactionDate: new Date(`${period}-15`),
    taxType: type, taxCode: `VAT-${rate}`, taxRate: rate, baseAmount: base, taxAmount: amount,
    totalAmount: base + amount, currency: "KES",
    party: { type: partyType, id: String(partyId), name: partyName },
    sourceDocument: { type: srcType, id: srcId, number: srcNumber, date: new Date(`${period}-15`) },
    kraTracking: { filingPeriod: period, filed: false, remitted: false, certificateIssued: false },
    reconciliation: { reconciled: false },
    journalEntryId: jeId ?? null, accountId: acct[accountKey],
    accountCode: accountKey === "vatOut" ? "2120" : "1150",
    accountName: accountKey === "vatOut" ? "VAT Payable (Output VAT)" : "VAT Receivable (Input VAT)",
    createdBy: by,
  });
  await db.collection("taxtransactions").insertMany([
    tax("VAT-OUT-0001", "vat_output", 16, 100000, 16000, "customer", customer, "Mining Co", "invoice", IDS.invoiceDone, "INV-HAU-202601-0001", "2026-01", "vatOut", saleJe),
    tax("VAT-IN-0001", "vat_input", 16, 50000, 8000, "supplier", supplier, "Dalewa Investment Limited", "bill", IDS.billApproved, "BILL-HAU-202601-0001", "2026-01", "vatIn"),
    tax("VAT-IN-0003", "vat_input", 16, 4310.34, 689.65, "supplier", supplier, "Dalewa Investment Limited", "bill", IDS.billCancelled, "BILL-HAU-202610-0003", "2026-10", "vatIn"),
  ]);

  // ── expenses ──────────────────────────────────────────────────────────────
  IDS.expensePaid = id();
  IDS.expenseDraft = id();
  await db.collection("expenses").insertMany([
    {
      _id: IDS.expensePaid, companyId, expenseNumber: "EXP-HAU-202602-0001",
      expenseDate: new Date("2026-02-05"), category: "transport", accountId: acct.fuel,
      accountCode: "6500", accountName: "Transport & Fuel", amount: 10000, taxAmount: 1600,
      taxRate: 16, withholdingTax: 0, subtotal: 10000, total: 11600, currency: "KES",
      paymentMethod: "bank_transfer", paidFrom: acct.bank, paidAt: new Date("2026-02-05"),
      vendor: { id: String(supplier), name: "Dalewa Investment Limited", partyType: "supplier" },
      description: "Diesel", status: "paid", paymentStatus: "paid", journalEntryId: expJe,
      postedAt: new Date("2026-02-05"), postedBy: by, createdBy: by, receipts: [],
      isReimbursable: false,
    },
    {
      _id: IDS.expenseDraft, companyId, expenseNumber: "EXP-HAU-202601-0002",
      expenseDate: new Date("2026-01-05"), category: "transport", accountId: acct.fuel,
      accountCode: "6500", accountName: "Transport & Fuel", amount: 12593.77, taxAmount: 2015,
      taxRate: 16, withholdingTax: 251.88, subtotal: 12593.77, total: 14356.89, currency: "KES",
      paymentMethod: "unpaid", paidFrom: null, paidAt: null,
      vendor: { id: null, name: "Fuel station" }, description: "Fuel",
      status: "draft", paymentStatus: "unpaid", journalEntryId: orphanJe, createdBy: by,
      receipts: [], isReimbursable: false,
    },
  ]);

  // ── HR ────────────────────────────────────────────────────────────────────
  IDS.department = id();
  await db.collection("departments").insertOne({
    _id: IDS.department, companyId, code: "OPS", name: "Operations", isActive: true, createdBy: by,
  });
  await db.collection("leavetypes").insertMany(
    ["annual", "sick"].map((code, i) => ({
      _id: id(), companyId, code, name: code === "annual" ? "Annual Leave" : "Sick Leave",
      defaultEntitlement: code === "annual" ? 21 : 14, maxCarryOver: 5, paidLeave: true,
      requiresDocument: code === "sick", applicableGender: "all", isActive: true,
      isDefault: true, sortOrder: i,
    })),
  );
  IDS.profile = id();
  await db.collection("employeeprofiles").insertOne({
    _id: IDS.profile, companyId, partyId: staffParty, userId: IDS.user, employeeNumber: "EMP-0001",
    personalInfo: {
      firstName: "Peter", lastName: "Otieno", gender: "male", nationalId: "23456789",
      kraPin: "a012345678z", nssfNumber: "NS1", nhifNumber: null, nationality: "Kenyan",
      dateOfBirth: new Date("1990-04-01"),
    },
    employment: {
      departmentId: IDS.department, department: "Operations", designation: "Driver",
      employmentType: "full_time", status: "active", hireDate: new Date("2026-01-02"),
      confirmationDate: new Date("2026-04-02"), workLocation: "Yard",
    },
    compensation: {
      basicSalary: 45000, currency: "KES",
      allowances: { housing: 5000, transport: 2000, medical: 0, other: 0 },
      paymentMethod: "bank", bankName: "KCB", bankAccount: "1234",
    },
    leaveBalances: [
      { leaveType: "annual", label: "Annual Leave", entitledDays: 21, usedDays: 3, pendingDays: 0, balanceDays: 18, carryOver: 0, year: 2026 },
      { leaveType: "sick", label: "Sick Leave", entitledDays: 14, usedDays: 0, pendingDays: 0, balanceDays: 14, carryOver: 0, year: 2026 },
    ],
    createdBy: by,
  });
  await db.collection("employmenthistories").insertOne({
    _id: id(), companyId, profileId: IDS.profile, partyId: staffParty, employeeName: "Peter Otieno",
    employeeNumber: "EMP-0001", eventType: "probation_confirmation", field: "status",
    previousValue: "probation", newValue: "active", effectiveDate: new Date("2026-04-02"), changedBy: by,
  });
  await db.collection("attendance").insertOne({
    _id: id(), companyId, profileId: IDS.profile, partyId: staffParty, date: new Date("2026-03-02"),
    checkIn: new Date("2026-03-02T05:00:00Z"), checkOut: new Date("2026-03-02T08:00:00Z"),
    hoursWorked: 3, overtime: 0, overtimePay: 0, shift: "morning", shiftStart: "08:00",
    standardHours: 8, status: "half-day", method: "web", employeeNumber: "EMP-0001",
  });
  await db.collection("pettycashreturns").insertOne({
    _id: id(), companyId, documentNumber: "PCR-0001", floatAccountId: acct.bank,
    custodian: { userId: IDS.user, name: by.name },
    period: { from: new Date("2026-02-01"), to: new Date("2026-02-28") },
    openingBalance: 0, totals: { debits: 0, credits: 0, closing: 0 }, status: "draft",
  });

  await client.close();
  return IDS;
}

const isCli =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) {
  await seedDocumentsSource();
  console.log("Seeded document fixture.");
}
