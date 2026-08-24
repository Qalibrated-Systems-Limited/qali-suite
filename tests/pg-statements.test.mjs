/**
 * Statements of account, derived from the ledger.
 *
 * The Mongo version summed Invoice, Payment and Party documents and added up a
 * running balance in JavaScript. Those collections stopped being written, so
 * the statements rendered an empty ledger. These tests cover the arithmetic
 * the replacement does in SQL: the opening balance, the running balance
 * continuing from it, and the sign convention flipping for a supplier.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as reports from "@/app/db/repositories/reports";
import * as partyRepo from "@/app/db/repositories/parties";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("postgres statements", () => {
  let client;
  let admin;
  let db;
  let companyA;
  let customer;
  let supplier;
  let arAccount;
  let apAccount;
  let salesAccount;
  let entrySeq = 0;

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });

  /**
   * One posted entry hitting a control account. Written directly rather than
   * through the invoice or bill repositories: what is under test is the
   * statement arithmetic, and a fixture that posts a raw entry can place a
   * date either side of the period boundary without inventing a document.
   */
  async function post({
    date,
    partyType,
    partyId,
    control,
    debit = "0",
    credit = "0",
    dueDate = null,
    isFullyPaid = false,
    sourceType = null,
    sourceId = null,
    description = "Entry",
  }) {
    const entryId = randomUUID();
    entrySeq += 1;
    // DRAFT, THEN LINES, THEN POST. A trigger refuses to post an entry with
    // fewer than two lines, and the lines cannot exist before the entry they
    // reference — so inserting it already posted fails on its own contents.
    await admin`
      INSERT INTO journal_entries
        (id, company_id, entry_number, entry_date, entry_type, description,
         party_type, party_id, due_date, is_fully_paid, source_type, source_id,
         status)
      VALUES (${entryId}, ${companyA}, ${"JE-" + String(entrySeq).padStart(4, "0")},
              ${date}, 'adjustment', ${description},
              ${partyType}, ${partyId}, ${dueDate}, ${isFullyPaid},
              ${sourceType}, ${sourceId}, 'draft')`;
    // Balanced by the contra line on sales; only the control-account line is
    // read by the statement.
    await admin`
      INSERT INTO journal_lines
        (company_id, entry_id, account_id, line_number, debit, credit)
      VALUES (${companyA}, ${entryId}, ${control},      1, ${debit}, ${credit}),
             (${companyA}, ${entryId}, ${salesAccount}, 2, ${credit}, ${debit})`;
    await admin`
      UPDATE journal_entries SET status = 'posted', posted_at = now()
       WHERE id = ${entryId}`;
    return entryId;
  }

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, {
      max: 1,
      onnotice: () => {},
    });
    db = drizzle(client);
  });

  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, entry_counters CASCADE`;

    companyA = randomUUID();
    arAccount = randomUUID();
    apAccount = randomUUID();
    salesAccount = randomUUID();
    entrySeq = 0;

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
          (${arAccount},    ${companyA}, '1100', 'Receivables', 'asset',     'accounts_receivable'),
          (${apAccount},    ${companyA}, '2100', 'Payables',    'liability', 'accounts_payable'),
          (${salesAccount}, ${companyA}, '4000', 'Sales',       'revenue',   NULL)
      `);
      customer = (
        await partyRepo.createParty(tx, {
          companyId: companyA,
          name: "Acme Ltd",
          primaryType: "customer",
        })
      ).id;
      supplier = (
        await partyRepo.createParty(tx, {
          companyId: companyA,
          name: "Supplies Co",
          primaryType: "supplier",
        })
      ).id;
    });
  });

  describe("the opening balance", () => {
    it("sums everything before the period and nothing inside it", async () => {
      await post({ date: "2026-01-10", partyType: "customer", partyId: customer, control: arAccount, debit: "1000" });
      await post({ date: "2026-01-20", partyType: "customer", partyId: customer, control: arAccount, credit: "400" });
      // Inside the window — must not count towards what the period opens with.
      await post({ date: "2026-02-05", partyType: "customer", partyId: customer, control: arAccount, debit: "250" });

      const opening = await asTenant(companyA, (tx) =>
        reports.getStatementOpeningBalance(tx, "customer", customer, "2026-02-01"),
      );
      expect(Number(opening)).toBe(600);
    });

    it("is zero when nothing precedes the period", async () => {
      await post({ date: "2026-02-05", partyType: "customer", partyId: customer, control: arAccount, debit: "250" });
      const opening = await asTenant(companyA, (tx) =>
        reports.getStatementOpeningBalance(tx, "customer", customer, "2026-02-01"),
      );
      expect(Number(opening)).toBe(0);
    });

    it("ignores a draft entry — only posted movements are owed", async () => {
      const id = await post({ date: "2026-01-10", partyType: "customer", partyId: customer, control: arAccount, debit: "1000" });
      await admin`UPDATE journal_entries SET status = 'draft' WHERE id = ${id}`;
      const opening = await asTenant(companyA, (tx) =>
        reports.getStatementOpeningBalance(tx, "customer", customer, "2026-02-01"),
      );
      expect(Number(opening)).toBe(0);
    });
  });

  describe("the running balance", () => {
    it("continues from the opening balance rather than restarting at zero", async () => {
      await post({ date: "2026-01-10", partyType: "customer", partyId: customer, control: arAccount, debit: "1000" });
      await post({ date: "2026-02-05", partyType: "customer", partyId: customer, control: arAccount, debit: "300" });
      await post({ date: "2026-02-10", partyType: "customer", partyId: customer, control: arAccount, credit: "500" });

      const rows = await asTenant(companyA, (tx) =>
        reports.getStatementOfAccount(tx, "customer", customer, "2026-02-01", "2026-02-28"),
      );

      expect(rows).toHaveLength(2);
      // 1000 opening + 300 invoiced, then less the 500 paid.
      expect(Number(rows[0].balance)).toBe(1300);
      expect(Number(rows[1].balance)).toBe(800);
    });

    it("carries the source document so a row can link to it", async () => {
      const invoiceId = randomUUID();
      await post({
        date: "2026-02-05", partyType: "customer", partyId: customer, control: arAccount,
        debit: "300", sourceType: "invoice", sourceId: invoiceId, dueDate: "2026-03-07",
      });

      const [row] = await asTenant(companyA, (tx) =>
        reports.getStatementOfAccount(tx, "customer", customer, "2026-02-01", "2026-02-28"),
      );
      expect(row.sourceType).toBe("invoice");
      expect(String(row.sourceId)).toBe(invoiceId);
      expect(String(row.dueDate)).toContain("2026-03-07");
    });

    it("shows only the party asked for", async () => {
      await post({ date: "2026-02-05", partyType: "customer", partyId: customer, control: arAccount, debit: "300" });
      await post({ date: "2026-02-06", partyType: "supplier", partyId: supplier, control: apAccount, credit: "900" });

      const rows = await asTenant(companyA, (tx) =>
        reports.getStatementOfAccount(tx, "customer", customer, "2026-02-01", "2026-02-28"),
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].balance)).toBe(300);
    });
  });

  describe("a supplier reads the other way round", () => {
    it("treats a credit as increasing what we owe", async () => {
      // A bill credits AP; on a supplier statement that is a rising balance,
      // where the same movement on a customer statement would reduce one.
      await post({ date: "2026-01-15", partyType: "supplier", partyId: supplier, control: apAccount, credit: "700" });
      await post({ date: "2026-02-08", partyType: "supplier", partyId: supplier, control: apAccount, credit: "200" });
      await post({ date: "2026-02-20", partyType: "supplier", partyId: supplier, control: apAccount, debit: "300" });

      const opening = await asTenant(companyA, (tx) =>
        reports.getStatementOpeningBalance(tx, "supplier", supplier, "2026-02-01"),
      );
      expect(Number(opening)).toBe(700);

      const rows = await asTenant(companyA, (tx) =>
        reports.getStatementOfAccount(tx, "supplier", supplier, "2026-02-01", "2026-02-28"),
      );
      expect(Number(rows[0].balance)).toBe(900);
      // Paying the supplier debits AP and brings it down.
      expect(Number(rows[1].balance)).toBe(600);
    });
  });

  describe("the aging report", () => {
    it("names the party, so callers do not join in JavaScript", async () => {
      await post({
        date: "2026-02-05", partyType: "customer", partyId: customer, control: arAccount,
        debit: "300", dueDate: "2026-02-01", isFullyPaid: false,
      });

      const rows = await asTenant(companyA, (tx) =>
        reports.getAgingReport(tx, "receivable", "2026-02-28"),
      );
      const row = rows.find((r) => String(r.partyId) === String(customer));
      // It returned NULL::text as a placeholder before, so every statements
      // index had to fetch the parties separately to print a name.
      expect(row.partyName).toBe("Acme Ltd");
    });

    it("leaves out anything already settled", async () => {
      await post({
        date: "2026-02-05", partyType: "customer", partyId: customer, control: arAccount,
        debit: "300", dueDate: "2026-02-01", isFullyPaid: true,
      });
      const rows = await asTenant(companyA, (tx) =>
        reports.getAgingReport(tx, "receivable", "2026-02-28"),
      );
      expect(rows.find((r) => String(r.partyId) === String(customer))).toBeUndefined();
    });

    it("buckets by how overdue the entry is", async () => {
      await post({ date: "2026-01-01", partyType: "customer", partyId: customer, control: arAccount, debit: "100", dueDate: "2026-02-25" });
      await post({ date: "2026-01-02", partyType: "customer", partyId: customer, control: arAccount, debit: "200", dueDate: "2026-02-10" });
      await post({ date: "2026-01-03", partyType: "customer", partyId: customer, control: arAccount, debit: "400", dueDate: "2025-10-01" });

      const rows = await asTenant(companyA, (tx) =>
        reports.getAgingReport(tx, "receivable", "2026-02-28"),
      );
      const row = rows.find((r) => String(r.partyId) === String(customer));
      expect(Number(row.current)).toBe(0);
      expect(Number(row.days0_30)).toBe(300); // 3 and 18 days over
      expect(Number(row.days90plus)).toBe(400);
      expect(Number(row.total)).toBe(700);
    });
  });
});
