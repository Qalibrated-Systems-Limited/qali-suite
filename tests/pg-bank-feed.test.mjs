/**
 * The bank feed reaches the ledger — 0100.
 *
 * Banking was carried in every count as "STAYS ON MONGO BY DECISION … it is
 * not currently broken — it reads the store it still writes". Half of that was
 * true: its own two collections worked. The other three models it read —
 * Account, Invoice, Bill — had all moved, so the bank picker was empty, every
 * account picker in the allocation dialog was empty, and no line could be
 * matched to anything. The module was inert.
 *
 * The centre of this file is the thing that made it worth doing properly: a
 * bank line matched to an invoice raises a REAL PAYMENT, so the receipt is on
 * the payments screen, the invoice's `amount_paid` moves through the trigger
 * that owns it, and undoing the match reverses the posting rather than
 * deleting it.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { userMessage } = await import("@/app/db/errors");
const bankFeed = await import("@/app/db/repositories/bankFeed");

const failsWith = async (fn, pattern) => {
  const err = await fn().then(
    () => {
      throw new Error("expected a rejection");
    },
    (e) => e,
  );
  expect(userMessage(err)).toMatch(pattern);
};

suite("the bank feed reaches the ledger", () => {
  let admin, client, db;
  let companyA, companyB, customer, supplier;
  let bankAcct, otherBankAcct, arAcct, apAcct, salesAcct, rentAcct;
  const actor = { id: "u-1", name: "The Accountant" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const statement = (over = {}) =>
    inA((tx) =>
      bankFeed.createStatement(tx, {
        companyId: companyA,
        bankAccountId: over.bankAccountId ?? bankAcct,
        fileName: over.fileName ?? "april.csv",
        contentHash: over.contentHash ?? randomUUID(),
        uploadedByName: "Seed",
      }),
    );

  /** A statement with lines already in it. */
  const imported = async (lines, over = {}) => {
    const s = await statement(over);
    const result = await inA((tx) =>
      bankFeed.importLines(tx, s.id, lines, {
        companyId: companyA,
        bankAccountId: over.bankAccountId ?? bankAcct,
      }),
    );
    return { statement: s, result };
  };

  const moneyIn = (amount = 5000, over = {}) => ({
    date: over.date ?? "2026-04-02",
    description: over.description ?? "RTGS ACME LTD",
    reference: over.reference ?? "REF1",
    credit: amount,
    debit: 0,
    balance: over.balance ?? null,
  });

  const moneyOut = (amount = 2000, over = {}) => ({
    date: over.date ?? "2026-04-03",
    description: over.description ?? "KPLC PREPAID",
    reference: over.reference ?? "REF2",
    debit: amount,
    credit: 0,
    balance: over.balance ?? null,
  });

  const firstLine = async (statementId) => {
    const { lines } = await inA((tx) => bankFeed.listLines(tx, statementId));
    return lines[0];
  };

  const makeInvoice = async (total, paid = 0) => {
    const id = randomUUID();
    await inA((tx) =>
      tx.execute(sql`
        INSERT INTO invoices (id, company_id, invoice_number, invoice_date,
                              customer_id, status, total, amount_paid)
        VALUES (${id}, ${companyA}, ${"INV-" + id.slice(0, 5)}, '2026-04-01'::date,
                ${customer}::uuid, 'completed', ${String(total)}, ${String(paid)})`),
    );
    return id;
  };

  /**
   * A bill and its line. `net_payable` is GENERATED and a trigger refuses a
   * bill with no lines — both of which are the schema doing its job, and both
   * of which this fixture has to respect rather than work around.
   */
  const makeBill = async (total) => {
    const id = randomUUID();
    await inA(async (tx) => {
      await tx.execute(sql`
        INSERT INTO bills (id, company_id, bill_number, bill_date, due_date,
                           supplier_id, supplier_name_at_bill, status)
        VALUES (${id}, ${companyA}, ${"BILL-" + id.slice(0, 5)},
                '2026-04-01'::date, '2026-05-01'::date,
                ${supplier}::uuid, 'Kenya Power', 'draft')`);
      await tx.execute(sql`
        INSERT INTO bill_lines (company_id, bill_id, line_number, description,
                                account_id, account_code_at_bill,
                                account_name_at_bill, account_type,
                                quantity, unit_price)
        VALUES (${companyA}, ${id}::uuid, 1, 'Electricity',
                ${rentAcct}::uuid, '6300', 'Rent', 'expense',
                1, ${String(total)})`);
      await tx.execute(sql`
        UPDATE bills SET status = 'approved' WHERE id = ${id}::uuid`);
    });
    return id;
  };

  const invoiceState = async (id) => {
    const [r] = await admin`SELECT total::float8, amount_paid::float8 FROM invoices WHERE id = ${id}`;
    return r;
  };

  const paymentsFor = async (lineId) =>
    admin`SELECT id, status, payment_type, amount::float8, source_line_id
            FROM payments WHERE source_line_id = ${lineId}`;

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
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;

    companyA = randomUUID();
    companyB = randomUUID();
    customer = randomUUID();
    supplier = randomUUID();
    [bankAcct, otherBankAcct, arAcct, apAcct, salesAcct, rentAcct] = Array.from(
      { length: 6 },
      () => randomUUID(),
    );

    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)}),
      (${companyB}, 'Rival', ${"r-" + companyB.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${customer}, ${companyA}, 'customer', true, 'Acme Ltd')`);
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_supplier, name)
        VALUES (${supplier}, ${companyA}, 'supplier', true, 'Kenya Power')`);
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name,
                              account_type, sub_type, system_account)
        VALUES
          (${bankAcct},      ${companyA}, '1112', 'Equity Bank',    'asset',     'bank',       'cash_at_bank'),
          (${otherBankAcct}, ${companyA}, '1113', 'KCB',            'asset',     'bank',        NULL),
          (${arAcct},        ${companyA}, '1120', 'Trade Debtors',  'asset',     'receivable', 'accounts_receivable'),
          (${apAcct},        ${companyA}, '2110', 'Trade Creditors','liability', 'payable',    'accounts_payable'),
          (${salesAcct},     ${companyA}, '4000', 'Sales',          'revenue',   'sales',       NULL),
          (${rentAcct},      ${companyA}, '6300', 'Rent',           'expense',   'occupancy',   NULL)`);
    });
    /*
     * `TRUNCATE ... CASCADE` measures ~4s against this schema even on an idle
     * database — 156 tables, and the cost is per TABLE, not per row. Forty-odd
     * of them in one file occasionally spikes past vitest's 120s default hook
     * timeout, and when it does the next test inserts into a database that was
     * never cleared and fails on a primary key with a freshly generated uuid.
     * Every failure of that shape in this suite has been infrastructure; none
     * has ever been an assertion.
     */
  }, 300_000);

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the pickers that were empty", () => {
    it("lists the bank accounts a statement can be imported against", async () => {
      // `getBankAccounts()` read Mongo `Account`, so the upload screen's only
      // picker was empty and a statement could not be imported at all.
      const accounts = await inA((tx) => bankFeed.listBankAccounts(tx));
      const codes = accounts.map((a) => a.accountCode).sort();
      expect(codes).toEqual(["1112", "1113"]);
    });

    it("lists expense accounts by the LOWERCASE type the enum uses", async () => {
      // The Mongo query asked for `accountType: "Expense"` — capitalised, as
      // that schema's enum was. Transcribing the string would have kept this
      // empty in a new and more confusing way.
      const accounts = await inA((tx) =>
        bankFeed.listPostableAccounts(tx, "expense"),
      );
      expect(accounts.map((a) => a.accountCode)).toEqual(["6300"]);
    });

    it("offers every cash account except the one being reconciled", async () => {
      const targets = await inA((tx) =>
        bankFeed.listPostableAccounts(tx, "asset", {
          excludeId: bankAcct,
          cashOnly: true,
        }),
      );
      expect(targets.map((a) => a.accountCode)).toEqual(["1113"]);
    });

    it("finds open invoices and bills, which auto-match could not", async () => {
      await makeInvoice(5000);
      await makeBill(2000);

      const invoices = await inA((tx) => bankFeed.listOpenDocuments(tx, "invoice"));
      const bills = await inA((tx) => bankFeed.listOpenDocuments(tx, "bill"));
      expect(invoices).toHaveLength(1);
      expect(invoices[0].dueAmount).toBe(5000);
      expect(invoices[0].partyName).toBe("Acme Ltd");
      expect(bills).toHaveLength(1);
      expect(bills[0].dueAmount).toBe(2000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("importing", () => {
    it("stores the lines and reports what it did", async () => {
      const { result } = await imported([moneyIn(), moneyOut()]);
      expect(result.insertedCount).toBe(2);
      expect(result.duplicatesSkipped).toBe(0);
    });

    it("skips a transaction already imported, however it arrives", async () => {
      const { statement: s1 } = await imported([moneyIn(), moneyOut()]);
      expect(s1).toBeTruthy();

      const s2 = await statement({ fileName: "april-again.csv" });
      const again = await inA((tx) =>
        bankFeed.importLines(tx, s2.id, [moneyIn(), moneyOut(5000)], {
          companyId: companyA,
          bankAccountId: bankAcct,
        }),
      );
      // The repeat of moneyIn() is a duplicate; the 5000 debit is new.
      expect(again.duplicatesSkipped).toBe(1);
      expect(again.insertedCount).toBe(1);
    });

    it("refuses a file whose content was uploaded before", async () => {
      const hash = "identical-content";
      await statement({ contentHash: hash });
      await failsWith(() => statement({ contentHash: hash }), /Duplicate statement/i);
    });

    it("refuses an import where every line is already in", async () => {
      await imported([moneyIn()]);
      const s2 = await statement({ fileName: "same.csv" });
      await failsWith(
        () =>
          inA((tx) =>
            bankFeed.importLines(tx, s2.id, [moneyIn()], {
              companyId: companyA,
              bankAccountId: bankAcct,
            }),
          ),
        /already exist/i,
      );
    });

    it("derives the opening and closing balance from the running column", async () => {
      const { statement: s } = await imported([
        moneyIn(5000, { balance: 15000 }),
        moneyOut(2000, { balance: 13000 }),
      ]);
      const read = await inA((tx) => bankFeed.getStatement(tx, s.id));
      expect(read.openingBalance).toBe(10000);
      expect(read.closingBalance).toBe(13000);
      expect(read.balanceSource).toBe("from_file");
    });

    it("REFUSES a line that moves money in both directions", async () => {
      // Mongo's schema allowed it, and every net-amount calculation
      // downstream would then have been quietly wrong.
      const s = await statement();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              INSERT INTO bank_feed_lines (company_id, statement_id,
                bank_account_id, transaction_date, description,
                debit_amount, credit_amount)
              VALUES (${companyA}, ${s.id}::uuid, ${bankAcct}::uuid,
                      '2026-04-02'::date, 'BOTH', 100, 200)`),
          ),
        /not allowed|one_direction/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the stats are a view, so they cannot drift", () => {
    it("counts the lines without anything having to maintain a counter", async () => {
      const { statement: s } = await imported([moneyIn(), moneyOut()]);
      const read = await inA((tx) => bankFeed.getStatement(tx, s.id));
      expect(read.stats.totalLines).toBe(2);
      expect(read.stats.unallocatedLines).toBe(2);
      expect(read.stats.totalCredits).toBe(5000);
      expect(read.stats.totalDebits).toBe(2000);
    });

    it("moves the moment a line does, with no call to update it", async () => {
      const { statement: s } = await imported([moneyIn(), moneyOut()]);
      const line = await firstLine(s.id);
      await inA((tx) => bankFeed.excludeLine(tx, line._id, "bank_charge", null, actor));

      const read = await inA((tx) => bankFeed.getStatement(tx, s.id));
      expect(read.stats.excludedLines).toBe(1);
      expect(read.stats.unallocatedLines).toBe(1);
    });

    it("flips the statement to completed when nothing is left", async () => {
      const { statement: s } = await imported([moneyIn()]);
      expect((await inA((tx) => bankFeed.getStatement(tx, s.id))).status).toBe("ready");

      const line = await firstLine(s.id);
      await inA((tx) => bankFeed.excludeLine(tx, line._id, "duplicate", null, actor));

      expect((await inA((tx) => bankFeed.getStatement(tx, s.id))).status).toBe("completed");
    });

    it("reports the reconciliation difference, which is the point", async () => {
      const { statement: s } = await imported([
        moneyIn(5000, { balance: 15000 }),
        moneyOut(2000, { balance: 13000 }),
      ]);
      const summary = await inA((tx) => bankFeed.getStatementSummary(tx, s.id));
      expect(summary.netMovement).toBe(3000);
      expect(summary.expectedClosing).toBe(13000);
      expect(summary.difference).toBe(0);
      expect(summary.reconciled).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("a matched receipt IS a payment", () => {
    it("raises a confirmed payment and moves the invoice's balance", async () => {
      const invoiceId = await makeInvoice(5000);
      const { statement: s } = await imported([moneyIn(5000)]);
      const line = await firstLine(s.id);

      const result = await inA((tx) =>
        bankFeed.allocateToDocument(
          tx,
          line._id,
          { documentType: "invoice", documentId: invoiceId },
          actor,
        ),
      );

      expect(result.appliedAmount).toBe(5000);
      expect(result.overpaymentAmount).toBe(0);

      const [payment] = await paymentsFor(line._id);
      expect(payment).toBeTruthy();
      expect(payment.status).toBe("confirmed");
      expect(payment.payment_type).toBe("received");
      expect(payment.amount).toBe(5000);

      // `amount_paid` is written by the allocation trigger that owns it —
      // never by this module, which is what Mongo did by hand.
      expect((await invoiceState(invoiceId)).amount_paid).toBe(5000);
    });

    it("posts to the ledger, which is the whole point", async () => {
      const invoiceId = await makeInvoice(5000);
      const { statement: s } = await imported([moneyIn(5000)]);
      const line = await firstLine(s.id);
      await inA((tx) =>
        bankFeed.allocateToDocument(
          tx,
          line._id,
          { documentType: "invoice", documentId: invoiceId },
          actor,
        ),
      );

      const read = await inA((tx) => bankFeed.getLine(tx, line._id));
      expect(read.journalEntryId).toBeTruthy();

      const [entry] = await admin`
        SELECT status FROM journal_entries WHERE id = ${read.journalEntryId}`;
      expect(entry.status).toBe("posted");
    });

    it("pays a supplier bill from a debit line", async () => {
      const billId = await makeBill(2000);
      const { statement: s } = await imported([moneyOut(2000)]);
      const line = await firstLine(s.id);

      await inA((tx) =>
        bankFeed.allocateToDocument(
          tx,
          line._id,
          { documentType: "bill", documentId: billId },
          actor,
        ),
      );

      const [payment] = await paymentsFor(line._id);
      expect(payment.payment_type).toBe("made");
      const [bill] = await admin`SELECT balance::float8 FROM bills WHERE id = ${billId}`;
      expect(bill.balance).toBe(0);
    });

    it("leaves an overpayment UNAPPLIED against the party", async () => {
      // Mongo posted the excess to a Customer Advance account. Keeping it on
      // the payment leaves the money attached to whoever sent it, allocatable
      // to their next invoice, and needs no second account to exist.
      const invoiceId = await makeInvoice(3000);
      const { statement: s } = await imported([moneyIn(5000)]);
      const line = await firstLine(s.id);

      const result = await inA((tx) =>
        bankFeed.allocateToDocument(
          tx,
          line._id,
          { documentType: "invoice", documentId: invoiceId },
          actor,
        ),
      );

      expect(result.appliedAmount).toBe(3000);
      expect(result.overpaymentAmount).toBe(2000);
      expect((await invoiceState(invoiceId)).amount_paid).toBe(3000);

      const [payment] = await paymentsFor(line._id);
      expect(payment.amount).toBe(5000);
    });

    it("refuses to pay an invoice with money going OUT", async () => {
      const invoiceId = await makeInvoice(5000);
      const { statement: s } = await imported([moneyOut(5000)]);
      const line = await firstLine(s.id);

      await failsWith(
        () =>
          inA((tx) =>
            bankFeed.allocateToDocument(
              tx,
              line._id,
              { documentType: "invoice", documentId: invoiceId },
              actor,
            ),
          ),
        /money out/i,
      );
    });

    it("refuses to allocate a line twice", async () => {
      const invoiceId = await makeInvoice(5000);
      const { statement: s } = await imported([moneyIn(5000)]);
      const line = await firstLine(s.id);
      await inA((tx) =>
        bankFeed.allocateToDocument(
          tx,
          line._id,
          { documentType: "invoice", documentId: invoiceId },
          actor,
        ),
      );
      await failsWith(
        () =>
          inA((tx) =>
            bankFeed.allocateToDocument(
              tx,
              line._id,
              { documentType: "invoice", documentId: invoiceId },
              actor,
            ),
          ),
        /already allocated/i,
      );
    });

    it("refuses one line settling two different parties' documents", async () => {
      // A payment names the party it came from, so this cannot be one payment.
      // Mongo allowed it and produced an entry crediting two parties'
      // receivables against one receipt.
      const other = randomUUID();
      await inA((tx) =>
        tx.execute(sql`
          INSERT INTO parties (id, company_id, primary_type, is_customer, name)
          VALUES (${other}, ${companyA}, 'customer', true, 'Beta Ltd')`),
      );
      const inv1 = await makeInvoice(2000);
      const inv2 = randomUUID();
      await inA((tx) =>
        tx.execute(sql`
          INSERT INTO invoices (id, company_id, invoice_number, invoice_date,
                                customer_id, status, total, amount_paid)
          VALUES (${inv2}, ${companyA}, 'INV-OTHER', '2026-04-01'::date,
                  ${other}::uuid, 'completed', '3000', '0')`),
      );

      const { statement: s } = await imported([moneyIn(5000)]);
      const line = await firstLine(s.id);

      await failsWith(
        () =>
          inA((tx) =>
            bankFeed.allocateToMultipleDocuments(
              tx,
              line._id,
              "invoice",
              [
                { documentId: inv1, amount: 2000 },
                { documentId: inv2, amount: 3000 },
              ],
              actor,
            ),
          ),
        /different parties/i,
      );
    });

    it("settles several of ONE party's invoices with one line", async () => {
      const inv1 = await makeInvoice(2000);
      const inv2 = await makeInvoice(3000);
      const { statement: s } = await imported([moneyIn(5000)]);
      const line = await firstLine(s.id);

      await inA((tx) =>
        bankFeed.allocateToMultipleDocuments(
          tx,
          line._id,
          "invoice",
          [
            { documentId: inv1, amount: 2000 },
            { documentId: inv2, amount: 3000 },
          ],
          actor,
        ),
      );

      expect((await invoiceState(inv1)).amount_paid).toBe(2000);
      expect((await invoiceState(inv2)).amount_paid).toBe(3000);
      const [payment] = await paymentsFor(line._id);
      expect(payment.amount).toBe(5000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("allocating to accounts", () => {
    it("posts an expense with the bank on the other side", async () => {
      const { statement: s } = await imported([moneyOut(2000)]);
      const line = await firstLine(s.id);

      await inA((tx) =>
        bankFeed.allocateToAccounts(
          tx,
          line._id,
          [{ accountId: rentAcct, amount: 2000, description: "April rent" }],
          { allocationType: "expense", description: "April rent" },
          actor,
        ),
      );

      const read = await inA((tx) => bankFeed.getLine(tx, line._id));
      expect(read.status).toBe("allocated");
      expect(read.allocations).toHaveLength(1);
      expect(read.allocations[0].accountCode).toBe("6300");

      const rows = await admin`
        SELECT a.account_code, l.debit::float8, l.credit::float8
          FROM journal_lines l JOIN accounts a ON a.id = l.account_id
         WHERE l.entry_id = ${read.journalEntryId} ORDER BY a.account_code`;
      expect(rows).toEqual([
        { account_code: "1112", debit: 0, credit: 2000 },
        { account_code: "6300", debit: 2000, credit: 0 },
      ]);
    });

    it("posts income the other way round, from the LINE's direction", async () => {
      // Mongo took the caller's word for it, so calling `allocateToIncome` on
      // a debit line posted the entry backwards.
      const { statement: s } = await imported([moneyIn(5000)]);
      const line = await firstLine(s.id);

      await inA((tx) =>
        bankFeed.allocateToAccounts(
          tx,
          line._id,
          [{ accountId: salesAcct, amount: 5000 }],
          { allocationType: "income" },
          actor,
        ),
      );

      const read = await inA((tx) => bankFeed.getLine(tx, line._id));
      const rows = await admin`
        SELECT a.account_code, l.debit::float8, l.credit::float8
          FROM journal_lines l JOIN accounts a ON a.id = l.account_id
         WHERE l.entry_id = ${read.journalEntryId} ORDER BY a.account_code`;
      expect(rows).toEqual([
        { account_code: "1112", debit: 5000, credit: 0 },
        { account_code: "4000", debit: 0, credit: 5000 },
      ]);
    });

    it("splits one line across several accounts", async () => {
      const { statement: s } = await imported([moneyOut(3000)]);
      const line = await firstLine(s.id);

      await inA((tx) =>
        bankFeed.allocateToAccounts(
          tx,
          line._id,
          [
            { accountId: rentAcct, amount: 2000, description: "Rent" },
            { accountId: salesAcct, amount: 1000, description: "Refund" },
          ],
          { allocationType: "split" },
          actor,
        ),
      );

      const read = await inA((tx) => bankFeed.getLine(tx, line._id));
      expect(read.allocations).toHaveLength(2);
      expect(read.allocations.reduce((s2, a) => s2 + a.amount, 0)).toBe(3000);
    });

    it("refuses a split that does not add up to the line", async () => {
      const { statement: s } = await imported([moneyOut(3000)]);
      const line = await firstLine(s.id);
      await failsWith(
        () =>
          inA((tx) =>
            bankFeed.allocateToAccounts(
              tx,
              line._id,
              [{ accountId: rentAcct, amount: 2500 }],
              { allocationType: "split" },
              actor,
            ),
          ),
        /totals 2500.*line is 3000|have to match/i,
      );
    });

    it("puts the tax on its own leg", async () => {
      const vatAcct = randomUUID();
      await inA((tx) =>
        tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name,
                                account_type, sub_type, system_account)
          VALUES (${vatAcct}, ${companyA}, '1180', 'VAT Input', 'asset', 'tax', 'vat_input')`),
      );
      const { statement: s } = await imported([moneyOut(1160)]);
      const line = await firstLine(s.id);

      await inA((tx) =>
        bankFeed.allocateToAccounts(
          tx,
          line._id,
          [
            {
              accountId: rentAcct,
              amount: 1160,
              taxAmount: 160,
              taxAccountId: vatAcct,
            },
          ],
          { allocationType: "expense" },
          actor,
        ),
      );

      const read = await inA((tx) => bankFeed.getLine(tx, line._id));
      const rows = await admin`
        SELECT a.account_code, l.debit::float8, l.credit::float8
          FROM journal_lines l JOIN accounts a ON a.id = l.account_id
         WHERE l.entry_id = ${read.journalEntryId} ORDER BY a.account_code`;
      expect(rows).toEqual([
        { account_code: "1112", debit: 0, credit: 1160 },
        { account_code: "1180", debit: 160, credit: 0 },
        { account_code: "6300", debit: 1000, credit: 0 },
      ]);
    });

    it("records a transfer to another account of ours", async () => {
      const { statement: s } = await imported([moneyOut(4000)]);
      const line = await firstLine(s.id);

      await inA((tx) =>
        bankFeed.allocateAsTransfer(tx, line._id, otherBankAcct, "To KCB", actor),
      );

      const read = await inA((tx) => bankFeed.getLine(tx, line._id));
      expect(read.allocationType).toBe("transfer");
      const [entry] = await admin`
        SELECT entry_type FROM journal_entries WHERE id = ${read.journalEntryId}`;
      expect(entry.entry_type).toBe("transfer");
    });

    it("refuses a transfer to the same account", async () => {
      const { statement: s } = await imported([moneyOut(4000)]);
      const line = await firstLine(s.id);
      await failsWith(
        () => inA((tx) => bankFeed.allocateAsTransfer(tx, line._id, bankAcct, null, actor)),
        /different account/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("undoing", () => {
    it("cancels the payment, which gives the invoice its balance back", async () => {
      const invoiceId = await makeInvoice(5000);
      const { statement: s } = await imported([moneyIn(5000)]);
      const line = await firstLine(s.id);
      await inA((tx) =>
        bankFeed.allocateToDocument(
          tx,
          line._id,
          { documentType: "invoice", documentId: invoiceId },
          actor,
        ),
      );
      expect((await invoiceState(invoiceId)).amount_paid).toBe(5000);

      await inA((tx) => bankFeed.undoAllocation(tx, line._id, actor));

      const [payment] = await paymentsFor(line._id);
      expect(payment.status).toBe("cancelled");
      expect((await invoiceState(invoiceId)).amount_paid).toBe(0);

      const read = await inA((tx) => bankFeed.getLine(tx, line._id));
      expect(read.status).toBe("unallocated");
      expect(read.paymentId).toBeNull();
    });

    it("REVERSES a posted entry rather than deleting it", async () => {
      const { statement: s } = await imported([moneyOut(2000)]);
      const line = await firstLine(s.id);
      await inA((tx) =>
        bankFeed.allocateToAccounts(
          tx,
          line._id,
          [{ accountId: rentAcct, amount: 2000 }],
          { allocationType: "expense" },
          actor,
        ),
      );
      const allocated = await inA((tx) => bankFeed.getLine(tx, line._id));
      const entryId = allocated.journalEntryId;

      await inA((tx) => bankFeed.undoAllocation(tx, line._id, actor));

      // The original is still there and now carries its reversal.
      const [original] = await admin`
        SELECT status, reversed_at, reversal_entry_id
          FROM journal_entries WHERE id = ${entryId}`;
      expect(original).toBeTruthy();
      expect(original.reversed_at).toBeTruthy();
      expect(original.reversal_entry_id).toBeTruthy();
    });

    it("clears the allocation legs with it", async () => {
      const { statement: s } = await imported([moneyOut(2000)]);
      const line = await firstLine(s.id);
      await inA((tx) =>
        bankFeed.allocateToAccounts(
          tx,
          line._id,
          [{ accountId: rentAcct, amount: 2000 }],
          { allocationType: "expense" },
          actor,
        ),
      );
      await inA((tx) => bankFeed.undoAllocation(tx, line._id, actor));

      const read = await inA((tx) => bankFeed.getLine(tx, line._id));
      expect(read.allocations).toHaveLength(0);
      expect(read.allocationType).toBeNull();
    });

    it("refuses to undo a line that was never allocated", async () => {
      const { statement: s } = await imported([moneyIn()]);
      const line = await firstLine(s.id);
      await failsWith(
        () => inA((tx) => bankFeed.undoAllocation(tx, line._id, actor)),
        /not allocated/i,
      );
    });

    it("puts an excluded line back too", async () => {
      const { statement: s } = await imported([moneyIn()]);
      const line = await firstLine(s.id);
      await inA((tx) => bankFeed.excludeLine(tx, line._id, "personal", "mine", actor));
      await inA((tx) => bankFeed.undoAllocation(tx, line._id, actor));

      const read = await inA((tx) => bankFeed.getLine(tx, line._id));
      expect(read.status).toBe("unallocated");
      expect(read.excludeReason).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("matching", () => {
    it("suggests the invoice whose number is in the narrative", async () => {
      const invoiceId = await makeInvoice(5000);
      const [inv] = await admin`SELECT invoice_number FROM invoices WHERE id = ${invoiceId}`;

      const { statement: s } = await imported([
        moneyIn(5000, { description: `RTGS ACME LTD ${inv.invoice_number}` }),
      ]);
      const result = await inA((tx) => bankFeed.autoMatch(tx, s.id));
      expect(result.suggested).toBeGreaterThan(0);

      const line = await firstLine(s.id);
      expect(line.suggestions[0].documentNumber).toBe(inv.invoice_number);
      expect(line.suggestions[0].confidence).toBeGreaterThanOrEqual(75);
    });

    it("matches money OUT against bills, not invoices", async () => {
      await makeInvoice(2000);
      const billId = await makeBill(2000);
      const [bill] = await admin`SELECT bill_number FROM bills WHERE id = ${billId}`;

      const { statement: s } = await imported([moneyOut(2000)]);
      await inA((tx) => bankFeed.autoMatch(tx, s.id));

      const line = await firstLine(s.id);
      expect(line.suggestions.every((x) => x.type === "bill")).toBe(true);
      expect(line.suggestions[0].documentNumber).toBe(bill.bill_number);
    });

    it("rewrites suggestions wholesale rather than piling them up", async () => {
      await makeInvoice(5000);
      const { statement: s } = await imported([moneyIn(5000)]);

      await inA((tx) => bankFeed.autoMatch(tx, s.id));
      const first = (await firstLine(s.id)).suggestions.length;
      await inA((tx) => bankFeed.autoMatch(tx, s.id));
      const second = (await firstLine(s.id)).suggestions.length;

      expect(second).toBe(first);
    });

    it("does NOT allocate anything by itself", async () => {
      // Mongo auto-allocated a ≥95% match from a `.catch(console.error)`
      // background promise — posting to the ledger with nobody watching.
      const invoiceId = await makeInvoice(5000);
      const [inv] = await admin`SELECT invoice_number FROM invoices WHERE id = ${invoiceId}`;
      const { statement: s } = await imported([
        moneyIn(5000, { description: `ACME LTD ${inv.invoice_number}` }),
      ]);

      const result = await inA((tx) => bankFeed.autoMatch(tx, s.id));
      expect(result.confident).toBeGreaterThan(0);

      const line = await firstLine(s.id);
      expect(line.status).toBe("unallocated");
      expect(await paymentsFor(line._id)).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("deleting and tenancy", () => {
    it("refuses to delete a statement with an allocated line", async () => {
      const invoiceId = await makeInvoice(5000);
      const { statement: s } = await imported([moneyIn(5000)]);
      const line = await firstLine(s.id);
      await inA((tx) =>
        bankFeed.allocateToDocument(
          tx,
          line._id,
          { documentType: "invoice", documentId: invoiceId },
          actor,
        ),
      );
      await failsWith(
        () => inA((tx) => bankFeed.deleteStatement(tx, s.id)),
        /Undo those allocations/i,
      );
    });

    it("deletes an untouched statement and its lines", async () => {
      const { statement: s } = await imported([moneyIn(), moneyOut()]);
      await inA((tx) => bankFeed.deleteStatement(tx, s.id));
      expect(await inA((tx) => bankFeed.getStatement(tx, s.id))).toBeNull();
      const [{ n }] = await admin`SELECT COUNT(*)::int AS n FROM bank_feed_lines`;
      expect(n).toBe(0);
    });

    it("treats an id a uuid column cannot hold as not found", async () => {
      expect(await inA((tx) => bankFeed.getStatement(tx, "6a3ba4ae0f569c9f3d9a907f"))).toBeNull();
      expect(await inA((tx) => bankFeed.getLine(tx, "6a3ba4ae0f569c9f3d9a907f"))).toBeNull();
    });

    it("does not leak another company's statements or counts", async () => {
      await imported([moneyIn()]);
      const theirs = await asTenant(companyB, (tx) => bankFeed.listStatements(tx));
      expect(theirs.statements).toHaveLength(0);
      expect(await asTenant(companyB, (tx) => bankFeed.getUnallocatedCount(tx))).toBe(0);
      expect(await inA((tx) => bankFeed.getUnallocatedCount(tx))).toBe(1);
    });
  });
});
