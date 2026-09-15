/**
 * The cash requisition — 0107.
 *
 * THE POINT OF THE TABLE IS WHAT IT DOES NOT DO. A requisition authorises;
 * the money leaves on a path that already posts — an employee advance, the
 * petty cash float, a stock request — so the first thing asserted here is that
 * raising, approving and funding one writes NO journal line. A fourth money
 * path would put the same figure in the ledger twice, which is the rule the
 * timesheet decision already made (0089 decision 4).
 *
 * Everything else is the document's own discipline: approved is the point it
 * counts, a decision carries a name, a refusal carries a reason, and what was
 * authorised cannot quietly change afterwards.
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
const repo = await import("@/app/db/repositories/projects");

/** Drizzle wraps a PostgresError in "Failed query: …"; unwrap to the real one. */
const failsWith = async (fn, pattern) => {
  const err = await fn().then(
    () => {
      throw new Error("expected a rejection");
    },
    (e) => e,
  );
  expect(userMessage(err)).toMatch(pattern);
};

suite("cash requisitions", () => {
  let admin, client, db;
  let companyA, projectId, costCode, expenseAccount;
  const actor = { id: null, name: "J. Otieno" };
  const approver = { id: null, name: "The Manager" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const raise = async (over = {}) =>
    inA((tx) =>
      repo.createCashRequisition(tx, {
        companyId: companyA,
        projectId,
        purpose: over.purpose ?? "Fuel and lubricants, week to 12 April",
        amount: over.amount ?? 180000,
        requestedByName: actor.name,
        createdByName: actor.name,
        ...over,
      }),
    );

  /** Every journal line in the database, so "posts nothing" can be proved. */
  const journalLineCount = async () => {
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM journal_lines`;
    return n;
  };

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
    await admin`TRUNCATE companies, users, entry_counters CASCADE`;
    companyA = randomUUID();
    projectId = randomUUID();
    costCode = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
                VALUES (${companyA}, 'Contractor', ${"c-" + companyA.slice(0, 8)})`;
    await admin`INSERT INTO projects (id, company_id, project_number, name)
                VALUES (${projectId}, ${companyA}, 'PRJ-0001', 'Otho Road')`;
    /*
     * A COST CODE POINTS AT AN ACCOUNT, and the column is NOT NULL with a
     * trigger checking the chart — a cost code is how a project's spend
     * reaches the ledger, so one that codes to nothing would be a dimension
     * with no home. The fixture therefore seeds the account first.
     */
    expenseAccount = randomUUID();
    await admin`INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
                VALUES (${expenseAccount}, ${companyA}, '5400', 'Plant hire', 'expense')`;
    await admin`INSERT INTO project_cost_codes (id, company_id, code, name, account_id)
                VALUES (${costCode}, ${companyA}, '06', 'Plant', ${expenseAccount})`;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("it authorises, and it moves no money", () => {
    it("raises, approves and funds without writing a journal line", async () => {
      const before = await journalLineCount();

      const r = await raise();
      await inA((tx) => repo.setCashRequisitionStatus(tx, r.id, "submitted", actor));
      await inA((tx) => repo.setCashRequisitionStatus(tx, r.id, "approved", approver));
      await inA((tx) =>
        repo.fundCashRequisition(tx, r.id, { source: "petty_cash" }, approver),
      );

      expect(await journalLineCount()).toBe(before);
    });

    it("records WHICH document released the money", async () => {
      const advance = randomUUID();
      const r = await raise();
      await inA((tx) => repo.setCashRequisitionStatus(tx, r.id, "submitted", actor));
      await inA((tx) => repo.setCashRequisitionStatus(tx, r.id, "approved", approver));

      const funded = await inA((tx) =>
        repo.fundCashRequisition(
          tx,
          r.id,
          { source: "employee_advance", sourceId: advance },
          approver,
        ),
      );

      expect(funded.status).toBe("funded");
      expect(funded.fundedSource).toBe("employee_advance");
      expect(funded.fundedSourceId).toBe(advance);
      expect(funded.fundedAt).toBeTruthy();
    });

    it("takes `other` with no id — cash released outside the three paths", async () => {
      const r = await raise();
      await inA((tx) => repo.setCashRequisitionStatus(tx, r.id, "submitted", actor));
      await inA((tx) => repo.setCashRequisitionStatus(tx, r.id, "approved", approver));
      const funded = await inA((tx) =>
        repo.fundCashRequisition(tx, r.id, { source: "other" }, approver),
      );
      expect(funded.fundedSource).toBe("other");
      expect(funded.fundedSourceId).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("approved is the point it counts", () => {
    it("refuses to fund anything that is not approved", async () => {
      const r = await raise();
      await failsWith(
        () => inA((tx) => repo.fundCashRequisition(tx, r.id, { source: "petty_cash" }, approver)),
        /only an approved requisition can be funded/i,
      );
    });

    it("refuses a transition the machine does not allow", async () => {
      const r = await raise();
      await failsWith(
        () => inA((tx) => repo.setCashRequisitionStatus(tx, r.id, "approved", approver)),
        /cannot go from draft to approved/i,
      );
    });

    it("lets the requester recall a submitted one and send it again", async () => {
      const r = await raise({ submit: true });
      expect(r.status).toBe("submitted");

      await inA((tx) => repo.setCashRequisitionStatus(tx, r.id, "draft", actor));
      const edited = await inA((tx) =>
        repo.updateCashRequisition(tx, r.id, { amount: 240000, purpose: "Fuel, revised" }),
      );
      expect(Number(edited.amount)).toBe(240000);

      const sent = await inA((tx) =>
        repo.setCashRequisitionStatus(tx, r.id, "submitted", actor),
      );
      expect(sent.status).toBe("submitted");
    });

    it("freezes the figures at approval, not at submission", async () => {
      const r = await raise({ submit: true });

      // Still under discussion: the site may correct it.
      await inA((tx) => repo.updateCashRequisition(tx, r.id, { amount: 200000 }));

      await inA((tx) => repo.setCashRequisitionStatus(tx, r.id, "approved", approver));
      await failsWith(
        () => inA((tx) => repo.updateCashRequisition(tx, r.id, { amount: 900000 })),
        /can no longer be changed/i,
      );
    });

    /*
     * The repository refuses it in words; this proves the DATABASE refuses it
     * too. A guard that only exists in the function above it is a guard any
     * other caller walks past.
     */
    it("refuses an amendment to an approved one at the trigger", async () => {
      const r = await raise({ submit: true });
      await inA((tx) => repo.setCashRequisitionStatus(tx, r.id, "approved", approver));

      await failsWith(
        () =>
          admin`UPDATE project_cash_requisitions SET amount = 900000 WHERE id = ${r.id}`,
        /can no longer change/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("a decision carries a name, a refusal carries a reason", () => {
    it("stamps who decided and when", async () => {
      const r = await raise({ submit: true });
      const approved = await inA((tx) =>
        repo.setCashRequisitionStatus(tx, r.id, "approved", approver),
      );
      expect(approved.decidedByName).toBe("The Manager");
      expect(approved.decidedAt).toBeTruthy();
    });

    /*
     * The database refuses it, and the ACTION is what phrases it: the check
     * violation reaches a user as "That combination of values is not allowed",
     * which says nothing. `setCashRequisitionStatus` in project-actions.ts
     * therefore asks for the reason before it tries. Both halves are asserted
     * — the guard above, and the constraint under it that no other caller can
     * walk past.
     */
    it("refuses a rejection with no grounds", async () => {
      const r = await raise({ submit: true });
      await failsWith(
        () =>
          inA((tx) =>
            repo.setCashRequisitionStatus(tx, r.id, "rejected", approver, "no"),
          ),
        /not allowed/i,
      );

      const [row] = await admin`SELECT status FROM project_cash_requisitions WHERE id = ${r.id}`;
      expect(row.status).toBe("submitted");
    });

    it("takes a rejection with grounds, and lets it be raised again", async () => {
      const r = await raise({ submit: true });
      const rejected = await inA((tx) =>
        repo.setCashRequisitionStatus(
          tx,
          r.id,
          "rejected",
          approver,
          "Fuel was drawn twice this week — see CRQ-0001.",
        ),
      );
      expect(rejected.status).toBe("rejected");

      const again = await inA((tx) =>
        repo.setCashRequisitionStatus(tx, r.id, "submitted", actor),
      );
      expect(again.status).toBe("submitted");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the cost code, and the snapshot beside it", () => {
    it("freezes the code as it read on the day", async () => {
      const r = await raise({ costCodeId: costCode });
      expect(r.costCodeAtRequest).toBe("06 — Plant");

      await admin`UPDATE project_cost_codes SET name = 'Plant and transport' WHERE id = ${costCode}`;
      const [row] = await admin`SELECT cost_code_at_request FROM project_cash_requisitions WHERE id = ${r.id}`;
      expect(row.cost_code_at_request).toBe("06 — Plant");
    });

    it("refuses a cost code belonging to another project", async () => {
      const otherProject = randomUUID();
      const otherCode = randomUUID();
      await admin`INSERT INTO projects (id, company_id, project_number, name)
                  VALUES (${otherProject}, ${companyA}, 'PRJ-0002', 'Sori Road')`;
      await admin`INSERT INTO project_cost_codes (id, company_id, project_id, code, name, account_id)
                  VALUES (${otherCode}, ${companyA}, ${otherProject}, '07', 'Theirs', ${expenseAccount})`;

      await failsWith(
        () => raise({ costCodeId: otherCode }),
        /belongs to a different project/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the register and its figures", () => {
    it("counts what is live and ignores what was refused", async () => {
      const a = await raise({ amount: 100000, submit: true });
      const b = await raise({ amount: 250000, submit: true });
      const c = await raise({ amount: 999000, submit: true });

      await inA((tx) => repo.setCashRequisitionStatus(tx, b.id, "approved", approver));
      await inA((tx) =>
        repo.setCashRequisitionStatus(
          tx,
          c.id,
          "rejected",
          approver,
          "Not in this month's budget at all.",
        ),
      );

      const s = await inA((tx) => repo.getCashRequisitionSummary(tx, projectId));
      expect(s.requested).toBe(350000); // a + b; the refused one is not live
      expect(s.approved).toBe(250000);
      expect(s.awaiting).toBe(100000);
      expect(s.awaitingCount).toBe(1);
      expect(s.count).toBe(3);
      expect(a.requisitionNumber).toMatch(/^CRQ/);
    });

    it("moves the figure from approved to funded when the cash goes out", async () => {
      const r = await raise({ amount: 400000, submit: true });
      await inA((tx) => repo.setCashRequisitionStatus(tx, r.id, "approved", approver));
      await inA((tx) => repo.fundCashRequisition(tx, r.id, { source: "petty_cash" }, approver));

      const s = await inA((tx) => repo.getCashRequisitionSummary(tx, projectId));
      expect(s.approved).toBe(0);
      expect(s.funded).toBe(400000);
      expect(s.requested).toBe(400000);
    });

    it("numbers them in sequence, per company", async () => {
      const a = await raise();
      const b = await raise();
      expect(a.requisitionNumber).not.toBe(b.requisitionNumber);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("deleting", () => {
    it("deletes a draft", async () => {
      const r = await raise();
      expect(await inA((tx) => repo.deleteCashRequisition(tx, r.id))).toBe(true);
    });

    it("refuses to delete one that was issued — cancel it instead", async () => {
      const r = await raise({ submit: true });
      await failsWith(
        () => inA((tx) => repo.deleteCashRequisition(tx, r.id)),
        /cancel it instead of deleting it/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("tenant isolation", () => {
    it("is invisible from another company's scope", async () => {
      const companyB = randomUUID();
      await admin`INSERT INTO companies (id, name, slug)
                  VALUES (${companyB}, 'Rival', ${"r-" + companyB.slice(0, 8)})`;
      await raise();

      const seen = await asTenant(companyB, (tx) =>
        repo.listCashRequisitions(tx, projectId),
      );
      expect(seen).toHaveLength(0);
    });
  });
});
