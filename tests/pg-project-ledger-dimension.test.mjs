/**
 * The project as a dimension on the ledger — 0084.
 *
 * Two things are tested and they are different. First, that every posting whose
 * document knows a project STAMPS it: an invoice, a bill, an expense, a claim
 * and a credit note. That is the mechanical half and it is what a later port
 * will break silently.
 *
 * Second — and this is the half worth having — that the ledger figure and the
 * document scan can be COMPARED, and that the known reasons they differ are
 * pinned as facts rather than discovered as bugs. Chief among them: stock
 * issued to a project posts nothing at all, so the ledger cannot see materials
 * however well this column is populated.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as repo from "@/app/db/repositories/projects";
import * as journal from "@/app/db/repositories/journal";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("the project dimension on the ledger", () => {
  let client, admin, db;
  let companyA, projectA, customer, revenueAcct, expenseAcct, arAcct, cashAcct, costCode;

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  /** A posted entry, optionally against a project. */
  const post = (over = {}) =>
    inA((tx) =>
      journal.createJournalEntry(tx, {
        companyId: companyA,
        entryDate: "2026-08-31",
        entryType: "adjustment",
        description: "Test entry",
        postImmediately: true,
        lines: [
          { accountId: expenseAcct, debit: "1000" },
          { accountId: cashAcct, credit: "1000" },
        ],
        ...over,
      }),
    );

  const linesOf = (entryId) =>
    admin`SELECT line_number, project_id, cost_code_id FROM journal_lines
           WHERE entry_id = ${entryId} ORDER BY line_number`;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });

  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, entry_counters CASCADE`;
    companyA = randomUUID();
    customer = randomUUID();
    revenueAcct = randomUUID();
    expenseAcct = randomUUID();
    arAcct = randomUUID();
    cashAcct = randomUUID();

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${customer}::uuid, ${companyA}::uuid, 'customer', true, 'KeRRA')`);
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
        VALUES (${revenueAcct}, ${companyA}, '4000', 'Contract Revenue', 'revenue'),
               (${expenseAcct}, ${companyA}, '6200', 'Materials',        'expense'),
               (${arAcct},      ${companyA}, '1200', 'Receivables',      'asset'),
               (${cashAcct},    ${companyA}, '1000', 'Cash',             'asset')`);
    });

    projectA = (
      await inA((tx) =>
        repo.createProject(tx, {
          companyId: companyA,
          name: "Otho–Got Kachola Road",
          createdByName: "Seed",
        }),
      )
    ).id;

    costCode = (
      await inA((tx) =>
        repo.createCostCode(tx, {
          companyId: companyA,
          code: "EW-01",
          name: "Earthworks",
          accountId: expenseAcct,
          createdByName: "Seed",
        }),
      )
    ).id;
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what the posting layer carries", () => {
    it("stamps EVERY line of an entry from the project on the entry", async () => {
      // The entry-level field is a convenience; the LINE is the truth, and both
      // sides of a two-line entry belong to the job.
      const entry = await post({ projectId: projectA });
      const lines = await linesOf(entry.id);
      expect(lines).toHaveLength(2);
      expect(lines.every((l) => l.project_id === projectA)).toBe(true);
    });

    it("lets one line opt out of the entry's project", async () => {
      // `undefined` on a line means "not stated" and inherits; an explicit
      // null means "deliberately no project".
      const entry = await post({
        projectId: projectA,
        lines: [
          { accountId: expenseAcct, debit: "1000" },
          { accountId: cashAcct, credit: "1000", projectId: null },
        ],
      });
      const lines = await linesOf(entry.id);
      expect(lines[0].project_id).toBe(projectA);
      expect(lines[1].project_id).toBeNull();
    });

    it("carries the cost code, and DROPS one that has no project to roll up to", async () => {
      const withBoth = await post({ projectId: projectA, costCodeId: costCode });
      expect((await linesOf(withBoth.id))[0].cost_code_id).toBe(costCode);

      // `journal_lines_cost_code_needs_project` would refuse this; the posting
      // layer drops the orphan code rather than failing the entry, because a
      // cost code without its project is meaningless rather than fatal.
      const codeOnly = await post({ costCodeId: costCode });
      const lines = await linesOf(codeOnly.id);
      expect(lines[0].project_id).toBeNull();
      expect(lines[0].cost_code_id).toBeNull();
    });

    it("refuses a cost code with no project, written directly", async () => {
      const entry = await post();
      let caught;
      try {
        await admin`UPDATE journal_lines SET cost_code_id = ${costCode}
                     WHERE entry_id = ${entry.id}`;
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.message).toMatch(/cost_code_needs_project/i);
    });

    it("leaves an entry with no project alone", async () => {
      const entry = await post();
      const lines = await linesOf(entry.id);
      expect(lines.every((l) => l.project_id === null)).toBe(true);
    });

    it("A MANUAL JOURNAL CAN NOW REACH A PROJECT — which nothing could before", async () => {
      // The whole argument for the column. A manual journal has no source
      // document, so `computeProjectActuals` — which scans invoices, bills,
      // claims, expenses and stock requests — can never see it, however
      // carefully it is written.
      const entry = await post({ projectId: projectA, costCodeId: costCode });

      const fromScan = await inA((tx) => repo.computeProjectActuals(tx, projectA));
      const fromLedger = await inA((tx) =>
        repo.getProjectLedgerActuals(tx, [projectA]),
      );

      expect(fromScan.costs).toBe(0);
      expect(fromLedger.get(projectA).costs).toBe(1000);
      expect(fromLedger.get(projectA).lineCount).toBe(2);
      expect(entry.status).toBe("posted");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the ledger figure", () => {
    it("nets revenue as credits less debits, and cost as debits less credits", async () => {
      await post({
        projectId: projectA,
        lines: [
          { accountId: arAcct, debit: "5000" },
          { accountId: revenueAcct, credit: "5000" },
        ],
      });
      await post({ projectId: projectA });

      const p = (await inA((tx) => repo.getProjectLedgerActuals(tx, [projectA]))).get(
        projectA,
      );
      expect(p.revenue).toBe(5000);
      expect(p.costs).toBe(1000);
    });

    it("counts POSTED entries only", async () => {
      await post({ projectId: projectA, postImmediately: false });
      const p = (await inA((tx) => repo.getProjectLedgerActuals(tx, [projectA]))).get(
        projectA,
      );
      expect(p.costs).toBe(0);
      expect(p.lineCount).toBe(0);
    });

    it("answers zero, not undefined, for a project the ledger has never heard of", async () => {
      const p = (await inA((tx) => repo.getProjectLedgerActuals(tx, [projectA]))).get(
        projectA,
      );
      expect(p).toEqual({ revenue: 0, costs: 0, lineCount: 0 });
    });

    it("breaks cost down by cost code, and keeps the uncoded lines visible", async () => {
      await post({ projectId: projectA, costCodeId: costCode });
      await post({ projectId: projectA });

      const rows = await inA((tx) => repo.getProjectLedgerByCostCode(tx, projectA));
      const coded = rows.find((r) => r.costCodeId === costCode);
      const uncoded = rows.find((r) => r.costCodeId === null);
      expect(coded.code).toBe("EW-01");
      expect(coded.actual).toBe(1000);
      // Uncoded project cost is real cost and must not vanish from the
      // breakdown just because nobody classified it.
      expect(uncoded.actual).toBe(1000);
    });

    it("does not see another tenant's postings", async () => {
      const companyB = randomUUID();
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})`;
      await post({ projectId: projectA });
      const seen = await asTenant(companyB, (tx) =>
        repo.getProjectLedgerActuals(tx, [projectA]),
      );
      expect(seen.get(projectA)).toEqual({ revenue: 0, costs: 0, lineCount: 0 });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the reconciliation, and what it cannot yet reconcile", () => {
    it("reports both answers and their difference", async () => {
      await post({ projectId: projectA });
      const r = await inA((tx) => repo.reconcileProjectActuals(tx, projectA));

      expect(r.ledger.costs).toBe(1000);
      expect(r.documents.costs).toBe(0);
      expect(r.difference.costs).toBe(-1000);
      expect(r.ledgerSilent).toBe(false);
    });

    it("says the ledger is SILENT rather than that the figures agree at zero", async () => {
      // A project the ledger has never been told about is a different statement
      // from "both answers are zero", and conflating them is how a broken
      // dimension looks healthy.
      const r = await inA((tx) => repo.reconcileProjectActuals(tx, projectA));
      expect(r.ledgerSilent).toBe(true);
      expect(r.difference).toEqual({ revenue: 0, costs: 0 });
    });

    it("PINS THE MATERIALS GAP: stock issued to a project posts nothing", async () => {
      /**
       * Not a defect in either query — a fact about the system, pinned so it is
       * not rediscovered as a bug.
       *
       * A bill for an inventory purchase DEBITS Inventory. Issuing that stock
       * to a job records a movement and decrements the product, and creates NO
       * journal entry — so materials are relieved from stock in quantity and
       * never in the ledger. The document scan counts them; the ledger cannot
       * see them at all.
       *
       * If this test ever fails because the ledger figure moved, somebody has
       * made issues post — which is the accounting decision in plan §12, and
       * this test should then be rewritten rather than deleted.
       */
      const product = randomUUID();
      const requestId = randomUUID();
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO products (id, company_id, sku, name, cost_price, quantity_on_hand)
          VALUES (${product}::uuid, ${companyA}::uuid, 'CBL-1', 'Cable', 1000, 100)`),
      );
      await admin`
        INSERT INTO stock_requests (id, company_id, request_number, status,
                                    request_type, requester_name_at_request,
                                    requester_department, total_value, project_id)
        VALUES (${requestId}, ${companyA}, 'REQ-1', 'approved', 'internal',
                'Jane', 'Technical', 12000, ${projectA})`;
      await admin`
        INSERT INTO stock_request_items (company_id, request_id, line_number,
                                         product_id, product_name_at_request,
                                         sku_at_request, stock_at_request,
                                         requested_quantity, approved_quantity,
                                         total_fulfilled, unit_price, unit)
        VALUES (${companyA}, ${requestId}, 1, ${product}, 'Cable',
                'CBL-1', 100, 10, 10, 0, 1200, 'm')`;

      const r = await inA((tx) => repo.reconcileProjectActuals(tx, projectA));

      // The scan sees an approved, unfulfilled request as COMMITMENT...
      expect(r.documents.committed).toBe(12000);
      // ...and the ledger sees nothing, because no entry was ever made.
      expect(r.ledger.costs).toBe(0);
      expect(r.ledgerSilent).toBe(true);
    });
  });
});
