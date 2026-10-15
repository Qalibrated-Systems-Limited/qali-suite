/**
 * The document steps of the backfill: invoices, bills, payments, tax,
 * expenses and HR, against a fixture shaped like a live tenant's documents.
 *
 * These are the steps a real client's books move through, so each test pins
 * one property the cutover depends on: documents link to the entries already
 * migrated instead of posting again, the ledger still ties, and the three
 * defects the MongoDB app left behind are corrected and recorded rather than
 * copied.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { MongoMemoryServer } from "mongodb-memory-server";
import { backfill } from "@/app/db/backfill/backfill";
import { reconcile } from "@/app/db/backfill/reconcile";
import { seedDocumentsSource } from "@/app/db/backfill/seed-documents-source";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("backfill: documents on top of the ledger", () => {
  let mongod;
  let mongoUri;
  let admin;
  let stats;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create({ binary: { version: "7.0.14" } });
    mongoUri = `${mongod.getUri()}haulage`;
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  }, 120_000);

  afterAll(async () => {
    if (admin) await admin.end();
    if (mongod) await mongod.stop();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, _migration_id_map, _migration_rejects, entry_counters CASCADE`;
    await seedDocumentsSource(mongoUri);
    stats = await backfill({ mongoUri, databaseUrl: ADMIN_URL });
  });

  const rejects = () =>
    admin`SELECT collection, reason FROM _migration_rejects ORDER BY collection, reason`;

  it("moves every document, and quarantines nothing it should have carried", async () => {
    expect(stats).toMatchObject({
      invoices: 2, bills: 3, payments: 1, allocations: 1,
      taxTransactions: 2, expenses: 2, departments: 1, employees: 1,
      leaveTypes: 2, leaveEntitlements: 2, employmentEvents: 1, attendance: 1,
      pettyCashReturns: 1,
    });
    // Only the corrections and differences, each with its reason.
    expect(await rejects()).toEqual([
      { collection: "employeeprofiles", reason: "variance:leave_used_without_requests_annual_2026" },
      { collection: "expenses", reason: "variance:draft_with_orphan_entry" },
      { collection: "taxtransactions", reason: "tax_on_cancelled_document" },
    ]);
  });

  it("links each document to its migrated entry rather than posting again", async () => {
    const [{ n: entries }] = await admin`SELECT count(*)::int AS n FROM journal_entries`;
    expect(entries).toBe(7); // exactly the source's seven, none added

    const [inv] = await admin`
      SELECT i.status::text, je.entry_number, je.source_type::text
        FROM invoices i JOIN journal_entries je ON je.id = i.revenue_entry_id
       WHERE i.invoice_number = 'INV-HAU-202601-0001'`;
    expect(inv).toEqual({ status: "completed", entry_number: "JE-HAU-INV-0001", source_type: "invoice" });

    const [bill] = await admin`
      SELECT je.source_type::text FROM bills b JOIN journal_entries je ON je.id = b.journal_entry_id
       WHERE b.bill_number = 'BILL-HAU-202601-0001'`;
    expect(bill.source_type).toBe("bill");
  });

  it("keeps drafts and submitted bills out of the books, as they were", async () => {
    const docs = await admin`
      SELECT 'invoice' AS kind, invoice_number AS number, status::text, revenue_entry_id IS NULL AS unposted
        FROM invoices WHERE status = 'draft'
      UNION ALL
      SELECT 'bill', bill_number, status::text, journal_entry_id IS NULL FROM bills WHERE status = 'submitted'
      ORDER BY kind`;
    expect(docs).toEqual([
      { kind: "bill", number: "BILL-HAU-202602-0002", status: "submitted", unposted: true },
      { kind: "invoice", number: "INV-HAU-202603-0002", status: "draft", unposted: true },
    ]);
  });

  it("derives what was paid from the allocation", async () => {
    const [b] = await admin`
      SELECT amount_paid::text, balance::text, payment_status::text
        FROM bills WHERE bill_number = 'BILL-HAU-202601-0001'`;
    expect(b).toEqual({ amount_paid: "30000.0000", balance: "28000.0000", payment_status: "partial" });
  });

  // The MongoDB reports skipped the 'reversed' original and counted its
  // reversal, so the cancelled bill showed as -4,310.34 of truck maintenance.
  it("nets the cancelled bill to zero instead of inverting it", async () => {
    const [orig] = await admin`
      SELECT status::text, reversed_at IS NOT NULL AS flagged, reversal_entry_id IS NOT NULL AS linked
        FROM journal_entries WHERE entry_number = 'JE-HAU-BILL-0002'`;
    expect(orig).toEqual({ status: "posted", flagged: true, linked: true });

    const [truck] = await admin`
      SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS net
        FROM journal_lines l JOIN accounts a ON a.id = l.account_id
        JOIN journal_entries e ON e.id = l.entry_id
       WHERE a.account_code = '6002' AND e.entry_date >= '2026-10-01' AND e.status = 'posted'`;
    expect(truck.net).toBe("0.0000");
  });

  it("does not carry the cancelled bill's VAT onto October's return", async () => {
    const taxes = await admin`
      SELECT filing_period, tax_type::text, tax_amount::text FROM tax_transactions ORDER BY filing_period, tax_type`;
    expect(taxes).toEqual([
      { filing_period: "2026-01", tax_type: "vat_input", tax_amount: "8000.0000" },
      { filing_period: "2026-01", tax_type: "vat_output", tax_amount: "16000.0000" },
    ]);
  });

  it("brings the failed WHT expense across as a draft with no entry", async () => {
    const [e] = await admin`
      SELECT status::text, journal_entry_id, withholding_tax::text, payment_method
        FROM expenses WHERE expense_number = 'EXP-HAU-202601-0002'`;
    expect(e).toEqual({ status: "draft", journal_entry_id: null, withholding_tax: "251.8800", payment_method: null });
  });

  it("carries HR with the identity payroll needs and the leave entitlements", async () => {
    const [emp] = await admin`
      SELECT e.kra_pin, e.status, d.code AS dept, u.email
        FROM employees e
        LEFT JOIN departments d ON d.id = e.department_id
        LEFT JOIN users u ON u.id = e.user_id`;
    expect(emp).toEqual({ kra_pin: "A012345678Z", status: "active", dept: "OPS", email: "grace@haulage.test" });

    const [att] = await admin`SELECT status FROM attendance`;
    expect(att.status).toBe("half_day");
  });

  it("continues numbering after the migrated documents", async () => {
    const counters = await admin`SELECT prefix, last_value::int FROM entry_counters ORDER BY prefix`;
    expect(counters).toEqual(
      expect.arrayContaining([
        { prefix: "INV", last_value: 2 },
        { prefix: "BILL", last_value: 3 },
        { prefix: "PMT", last_value: 1 },
        { prefix: "EXP", last_value: 2 },
        { prefix: "EMP", last_value: 1 },
      ]),
    );
  });

  it("is resumable: a second run adds nothing", async () => {
    const before = await admin`
      SELECT (SELECT count(*) FROM invoices) + (SELECT count(*) FROM bills)
           + (SELECT count(*) FROM payments) + (SELECT count(*) FROM tax_transactions)
           + (SELECT count(*) FROM expenses) + (SELECT count(*) FROM employees) AS n`;
    await backfill({ mongoUri, databaseUrl: ADMIN_URL });
    const after = await admin`
      SELECT (SELECT count(*) FROM invoices) + (SELECT count(*) FROM bills)
           + (SELECT count(*) FROM payments) + (SELECT count(*) FROM tax_transactions)
           + (SELECT count(*) FROM expenses) + (SELECT count(*) FROM employees) AS n`;
    expect(after[0].n).toBe(before[0].n);
    expect((await rejects()).length).toBe(3);
  });

  // --company was compared as a string against an ObjectId, matched nothing,
  // and fell through to migrating every company in the source.
  it("migrates only the company it is asked for, and refuses an unknown one", async () => {
    const { MongoClient, ObjectId } = await import("mongodb");
    const client = new MongoClient(mongoUri);
    await client.connect();
    const other = new ObjectId();
    await client.db().collection("companies").insertOne({ _id: other, name: "Someone Else", slug: "else" });
    await client.db().collection("accounts").insertOne({
      _id: new ObjectId(), companyId: other, accountCode: "1000", accountName: "Cash",
      accountType: "asset", canPost: true, isActive: true, level: 0,
    });
    const [{ _id: target }] = await client.db().collection("companies").find({ slug: "haulage" }).toArray();
    await client.close();

    await admin`TRUNCATE companies, _migration_id_map, _migration_rejects, entry_counters CASCADE`;
    await backfill({ mongoUri, databaseUrl: ADMIN_URL, onlyCompany: String(target) });
    const names = (await admin`SELECT name FROM companies`).map((r) => r.name);
    expect(names).toEqual(["Haulage Ltd"]);

    await expect(
      backfill({ mongoUri, databaseUrl: ADMIN_URL, onlyCompany: String(new ObjectId()) }),
    ).rejects.toThrow(/matches no company/);
  });

  it("reconciles the ledger exactly, and names what the MongoDB reports omitted", async () => {
    const lines = [];
    const { findings } = await reconcile({ mongoUri, databaseUrl: ADMIN_URL, log: (m) => lines.push(m) });

    expect(findings.filter((f) => f.kind === "account_variance")).toEqual([]);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "mongo_report_omitted_reversed", entry: "JE-HAU-BILL-0002" }),
      ]),
    );
  });
});
