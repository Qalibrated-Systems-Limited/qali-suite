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

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI must be set");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db();

await Promise.all(
  ["companies", "accounts", "fiscalperiods", "journalentries"].map((c) =>
    db.collection(c).deleteMany({}),
  ),
);

const companyId = new ObjectId();
const cashId = new ObjectId();
const salesId = new ObjectId();
const arId = new ObjectId();

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
    party: { type: "customer", id: new ObjectId(), name: "Acme Ltd" },
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
  // A draft — must migrate without being subject to the balance rule.
  {
    companyId, entryNumber: "JE-DRAFT-00001", entryDate: new Date("2026-08-09"),
    entryType: "adjustment", description: "Work in progress", status: "draft",
    lines: [{ accountId: cashId, debit: 250, credit: 0 }],
  },
]);

console.log("Seeded test source:");
console.log("  1 company, 3 accounts, 1 fiscal period, 4 journal entries");
console.log("  (JE-00003 is deliberately off by 0.005)");

await client.close();
