/**
 * Seeds a throwaway Mongo with representative accounting-core data so the
 * backfill and reconciliation can be exercised end to end without touching a
 * real tenant.
 *
 * Deliberately includes a journal entry whose float debits and credits differ
 * by 0.005 — under the old `Math.abs(d - c) < 0.01` tolerance that entry was
 * considered balanced and would have posted. It exists here to prove the
 * backfill quarantines it instead of rounding it into agreement.
 *
 *   MONGODB_URI=... node app/db/backfill/seed-test-source.mjs
 */
import { MongoClient, ObjectId } from "mongodb";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * Seeds the representative source data. Exported so the backfill test can use
 * exactly the fixture the cutover rehearsal uses — including the entry that is
 * deliberately off by 0.005.
 */
export async function seedTestSource(mongoUri = process.env.MONGODB_URI) {
  if (!mongoUri) throw new Error("MONGODB_URI must be set");

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db();

await Promise.all(
  [
    "companies", "accounts", "fiscalperiods", "journalentries", "parties",
    "products", "weighbridgeTickets", "stockrequests",
  ].map(
    (c) => db.collection(c).deleteMany({}),
  ),
);

const companyId = new ObjectId();
const cashId = new ObjectId();
const salesId = new ObjectId();
const widgetId = new ObjectId();
const gadgetId = new ObjectId();
const arId = new ObjectId();
const customerId = new ObjectId();
// Referenced by JE-00004 but never inserted into `parties` — stands in for a
// customer deleted from Mongo after entries referenced them. The entry must
// still migrate, losing only the party attribution.
const ghostCustomerId = new ObjectId();

await db.collection("companies").insertOne({
  _id: companyId,
  name: "Pilot Tenant",
  slug: "pilot",
  baseCurrency: "KES",
});

await db.collection("accounts").insertMany([
  {
    _id: cashId, companyId, accountCode: "1000", accountName: "Cash",
    accountType: "asset", subType: "cash", systemAccount: "cash",
    canPost: true, isActive: true, level: 0,
  },
  {
    _id: arId, companyId, accountCode: "1100", accountName: "Accounts Receivable",
    accountType: "asset", subType: "accounts_receivable",
    systemAccount: "accounts_receivable", canPost: true, isActive: true, level: 0,
  },
  {
    _id: salesId, companyId, accountCode: "4000", accountName: "Sales",
    accountType: "revenue", subType: "sales_revenue", systemAccount: null,
    canPost: true, isActive: true, level: 0,
  },
]);

await db.collection("parties").insertOne({
  _id: customerId,
  companyId,
  type: "both", // customer AND supplier — exercises the boolean-role split
  name: "Acme Ltd",
  email: "ac@acme.co",
  taxPin: "P051234567A",
  address: { line1: "1 Moi Ave", city: "Nairobi", country: "Kenya" },
  creditTerms: { creditLimit: 500000, paymentTermsDays: 45 },
  isActive: true,
});

await db.collection("products").insertMany([
  {
    _id: widgetId,
    companyId,
    name: "Widget",
    SKU: "wid-1", // lowercase on purpose: the target column is uppercased
    description: "A widget",
    category: "Hardware",
    unit: "pcs",
    inventory: {
      quantityOnHand: 100,
      quantityCommitted: 10,
      quantityOnHold: 0,
      reorderLevel: 25,
    },
    costing: { costPrice: 40.5, lastPurchaseCost: 42, costingMethod: "fifo" },
    pricing: { sellingPrice: 250, wholesalePrice: 200 },
    status: "active",
    isActive: true,
  },
  {
    // status and isActive disagree; the target keeps only the boolean, and
    // "not active" wins.
    _id: gadgetId,
    companyId,
    name: "Gadget",
    SKU: "GAD-1",
    unit: "box",
    inventory: { quantityOnHand: 0, quantityCommitted: 0 },
    costing: { costPrice: 0 },
    pricing: { sellingPrice: 99.99 },
    status: "discontinued",
    isActive: true,
  },
]);

await db.collection("weighbridgeTickets").insertMany([
  {
    // Clean two-pass weighing. Net is NOT seeded: it is generated in the
    // target as abs(first - second), and seeding a third number that could
    // disagree with the two readings is the defect being corrected.
    companyId,
    ticketNumber: "WB-00001",
    externalRef: "GATE-001",
    transactionType: "purchase",
    direction: "inbound",
    vehicleReg: "KDA 123A",
    productId: widgetId,
    productName: "Widget",
    firstWeight: 18500,
    secondWeight: 6200,
    weightUnit: "kg",
    status: "completed",
    completedAt: new Date("2026-08-04"),
  },
  {
    // Direction contradicts the transaction type. Mongo constrains neither
    // against the other; the target pairs them.
    companyId,
    ticketNumber: "WB-00002",
    transactionType: "purchase",
    direction: "outbound",
    productId: widgetId,
    firstWeight: 100,
    secondWeight: 50,
    status: "first_recorded",
  },
  {
    // Claims to be complete on one weighing, so it has no net weight.
    companyId,
    ticketNumber: "WB-00003",
    transactionType: "sale",
    direction: "outbound",
    productId: widgetId,
    firstWeight: 9000,
    status: "completed",
  },
]);

await db.collection("stockrequests").insertMany([
  {
    // A pending request, untouched since creation. Its items therefore carry
    // approvedQuantity: 0 — the creation default, which means "not approved
    // yet" and NOT "approved for none". Every reader in the source resolves
    // the target as `approvedQuantity || requestedQuantity`, so the target
    // must come out as the requested quantity, not zero.
    companyId,
    requestNumber: "SR-00001",
    requestType: "sale",
    status: "pending",
    priority: "high",
    customer: {
      id: customerId,
      name: "Acme Ltd",
      email: "ac@acme.co",
      phone: "",
      address: "",
      taxPin: "P051234567A",
    },
    requester: {
      name: "Jane Field",
      id: "user-1",
      department: "Sales",
      email: "jane@pilot.co",
    },
    items: [
      {
        _id: new ObjectId(),
        productId: widgetId,
        productName: "Widget",
        SKU: "wid-1",
        currentStock: 100,
        requestedQuantity: 12,
        approvedQuantity: 0,
        unitPrice: 250,
        unit: "pcs",
        fulfillments: [],
        totalFulfilled: 0,
        remainingToFulfill: 0,
        fulfillmentStatus: "pending",
      },
    ],
    approvalHistory: [],
    requiredByDate: new Date("2026-09-01"),
    totalValue: 0,
    createdAt: new Date("2026-08-10"),
    updatedAt: new Date("2026-08-10"),
  },
  {
    // An approved internal request. customer.id is "" — creation writes the
    // empty string, not null, for the two customerless types — and the target
    // CHECK allows a null customer only for exactly these.
    companyId,
    requestNumber: "SR-00002",
    requestType: "internal",
    status: "approved",
    priority: "normal",
    customer: { id: "", name: "Internal Use" },
    requester: {
      name: "Sam Store",
      id: "user-2",
      department: "Technical",
    },
    items: [
      {
        _id: new ObjectId(),
        productId: gadgetId,
        productName: "Gadget",
        SKU: "GAD-1",
        currentStock: 0,
        requestedQuantity: 4,
        approvedQuantity: 3,
        unitPrice: 99.99,
        unit: "box",
        fulfillments: [],
        totalFulfilled: 0,
        remainingToFulfill: 3,
        fulfillmentStatus: "pending",
      },
      {
        // The approver denied this line outright. Mongo stores the 0 and then
        // discards it on every read, so it cannot represent the denial either.
        _id: new ObjectId(),
        productId: widgetId,
        productName: "Widget",
        SKU: "WID-1",
        currentStock: 100,
        requestedQuantity: 2,
        approvedQuantity: 0,
        unitPrice: 250,
        unit: "pcs",
        fulfillments: [],
        totalFulfilled: 0,
        fulfillmentStatus: "pending",
      },
    ],
    approver: {
      name: "Ada Manager",
      id: "user-9",
      approvedAt: new Date("2026-08-12"),
      comments: "Approved short",
      conditions: "Return by month end",
    },
    approvalHistory: [
      {
        _id: new ObjectId(),
        approverName: "Ada Manager",
        approverId: "user-9",
        action: "approved",
        comments: "Approved short",
        timestamp: new Date("2026-08-12"),
      },
    ],
    // totalValue is stale in the source: 4 x 99.99 was never re-derived after
    // the approval cut it to 3. The target computes it from the items.
    totalValue: 399.96,
    createdAt: new Date("2026-08-11"),
    updatedAt: new Date("2026-08-12"),
  },
  {
    // Names a customer that no longer exists in `parties`. A journal entry in
    // this position keeps the entry and drops the attribution; a sale request
    // cannot, because the target requires a customer for customer-facing
    // types. It must be quarantined, not silently reclassified.
    companyId,
    requestNumber: "SR-00003",
    requestType: "demo",
    status: "pending",
    customer: { id: ghostCustomerId, name: "Gone Ltd" },
    requester: { name: "Jane Field", id: "user-1", department: "Sales" },
    items: [
      {
        _id: new ObjectId(),
        productId: widgetId,
        productName: "Widget",
        SKU: "WID-1",
        currentStock: 100,
        requestedQuantity: 1,
        approvedQuantity: 0,
        unitPrice: 250,
        unit: "pcs",
        fulfillments: [],
      },
    ],
    createdAt: new Date("2026-08-13"),
    updatedAt: new Date("2026-08-13"),
  },
]);

await db.collection("fiscalperiods").insertOne({
  companyId,
  year: 2026, month: 8,
  periodName: "August 2026", periodCode: "2026-08",
  startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31"),
  status: "open",
});

await db.collection("journalentries").insertMany([
  // Clean cash sale.
  {
    companyId, entryNumber: "JE-00001", entryDate: new Date("2026-08-02"),
    entryType: "sale", description: "Cash sale", status: "posted",
    postedAt: new Date("2026-08-02"), isFullyPaid: true,
    amountPaid: 5000, amountOutstanding: 0,
    lines: [
      { accountId: cashId, debit: 5000, credit: 0, description: "Cash in" },
      { accountId: salesId, debit: 0, credit: 5000, description: "Revenue" },
    ],
  },
  // Credit sale, still outstanding — feeds the AR aging report.
  {
    companyId, entryNumber: "JE-00002", entryDate: new Date("2026-08-05"),
    entryType: "sale", description: "Credit sale", status: "posted",
    postedAt: new Date("2026-08-05"), dueDate: new Date("2026-06-20"),
    party: { type: "customer", id: customerId, name: "Acme Ltd" },
    isFullyPaid: false, amountPaid: 0, amountOutstanding: 12000,
    lines: [
      { accountId: arId, debit: 12000, credit: 0, description: "Receivable" },
      { accountId: salesId, debit: 0, credit: 12000, description: "Revenue" },
    ],
  },
  // THE DRIFTED ENTRY — off by 0.005. Old tolerance accepted this.
  {
    companyId, entryNumber: "JE-00003", entryDate: new Date("2026-08-07"),
    entryType: "sale", description: "Drifted sale", status: "posted",
    postedAt: new Date("2026-08-07"), isFullyPaid: true,
    amountPaid: 100, amountOutstanding: 0,
    lines: [
      { accountId: cashId, debit: 100.0, credit: 0 },
      { accountId: salesId, debit: 0, credit: 99.995 },
    ],
  },
  // References a party that was never migrated — must still migrate, with
  // party_type and party_id both dropped (the CHECK requires them to agree).
  {
    companyId, entryNumber: "JE-00004", entryDate: new Date("2026-08-08"),
    entryType: "sale", description: "Sale to deleted customer", status: "posted",
    postedAt: new Date("2026-08-08"), dueDate: new Date("2026-09-08"),
    party: { type: "customer", id: ghostCustomerId, name: "Gone Ltd" },
    isFullyPaid: false, amountPaid: 0, amountOutstanding: 300,
    lines: [
      { accountId: arId, debit: 300, credit: 0 },
      { accountId: salesId, debit: 0, credit: 300 },
    ],
  },
  // A draft — must migrate without being subject to the balance rule.
  {
    companyId, entryNumber: "JE-DRAFT-00001", entryDate: new Date("2026-08-09"),
    entryType: "adjustment", description: "Work in progress", status: "draft",
    lines: [{ accountId: cashId, debit: 250, credit: 0 }],
  },
]);

  await client.close();
  return {
    companyId,
    accounts: { cashId, salesId },
    products: { widgetId, gadgetId },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isCli =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  await seedTestSource();
  console.log("Seeded test source:");
  console.log(
    "  1 company, 3 accounts, 1 party, 2 products, 3 weighbridge tickets,\n" +
      "  3 stock requests, 1 fiscal period, 5 journal entries",
  );
  console.log("  (JE-00003 is deliberately off by 0.005)");
}
