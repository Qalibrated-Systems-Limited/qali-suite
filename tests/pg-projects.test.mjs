/**
 * Projects — 0070, and the gaps the module shipped with.
 *
 * The port is the small half. What this file is mostly about is the list in
 * `UPGRADE-PROJCECT.md` §8 ("Known Gaps") and the four things nobody had
 * written down, because a straight transcription would have carried every one
 * of them across:
 *
 *   - the cached `financials` nothing has ever updated, beside a live
 *     aggregation reading four Mongo collections nothing writes to. Both
 *     halves of every project's revenue said zero.
 *   - a status machine one of three writers goes through.
 *   - a supersede-then-approve race that leaves two approved budgets.
 *   - a parent picker whose docstring claims it excludes descendants.
 *   - a delete guard that counts claims and nothing else.
 *   - a cost code index that does not mean in Postgres what it means in Mongo.
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
// `requirePlanAccess` reaches next-auth through `@/auth`, which does not
// resolve under vitest. The gate is not what this file is about.
vi.mock("@/lib/plan-gate", () => ({
  requirePlanAccess: vi.fn(async () => true),
  checkPlanAccess: vi.fn(async () => ({ allowed: true })),
}));

const { userMessage } = await import("@/app/db/errors");
const { getTenantContext } = await import("@/lib/utils/tenant-utils");
const repo = await import("@/app/db/repositories/projects");
const actions = await import("@/app/db/actions/project-actions");

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

suite("projects", () => {
  let admin, client, db;
  let companyA, companyB;
  let customer, employeeParty, cableProduct, mongoCompanyId;
  let travelAcct, materialsAcct, arAcct;
  let actor;

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });

  const inA = (fn) => asTenant(companyA, fn);

  /** A project, straight in, so a test can name its own status. */
  const seedProject = async (over = {}) =>
    inA((tx) =>
      repo.createProject(tx, {
        companyId: companyA,
        name: over.name ?? "Road A",
        createdByName: "Seed",
        ...over,
      }),
    );

  /** A recognised invoice against the project. */
  const seedInvoice = async (projectId, total, status = "completed") => {
    const id = randomUUID();
    await admin`
      INSERT INTO invoices (id, company_id, invoice_number, invoice_date,
                            customer_id, total, status, project_id)
      VALUES (${id}, ${companyA}, ${"INV-" + id.slice(0, 6)}, CURRENT_DATE,
              ${customer}, ${total}, ${status}, ${projectId})`;
    return id;
  };

  /**
   * `total`, `net_payable` and `balance` are GENERATED from the subtotal, and
   * `bill_lines.amount` from quantity × unit_price — so the fixture seeds
   * neither. `bills_have_lines` is INITIALLY DEFERRED, which is why the header
   * and its line have to commit in ONE transaction. And `payment_status` is
   * maintained by a trigger from `amount_paid`, so a bill that says paid has
   * to have been paid.
   */
  const seedBill = async (
    projectId,
    amount,
    status = "approved",
    paymentStatus = "paid",
    accountId = null,
  ) => {
    const id = randomUUID();
    await admin.begin(async (tx) => {
      await tx`
        INSERT INTO bills (id, company_id, bill_number, bill_date, due_date,
                           supplier_id, supplier_name_at_bill, subtotal,
                           amount_paid, status, payment_status, project_id)
        VALUES (${id}, ${companyA}, ${"BILL-" + id.slice(0, 6)}, CURRENT_DATE,
                CURRENT_DATE, ${customer}, 'Supplier', ${amount},
                ${paymentStatus === "paid" ? amount : 0},
                ${status}, ${paymentStatus}, ${projectId})`;
      await tx`
        INSERT INTO bill_lines (company_id, bill_id, line_number, account_id,
                                account_type, account_code_at_bill,
                                account_name_at_bill, description, quantity,
                                unit_price)
        VALUES (${companyA}, ${id}, 1, ${accountId ?? materialsAcct}, 'expense',
                '6200', 'Materials', 'Supply', 1, ${amount})`;
    });
    return id;
  };

  /** A request with one line: 10 units at 1,200, `fulfilled` of them issued. */
  const seedRequest = async (projectId, { status, approved, fulfilled }) => {
    const requestId = randomUUID();
    const itemId = randomUUID();
    await admin`
      INSERT INTO stock_requests (id, company_id, request_number, status,
                                  request_type, requester_name_at_request,
                                  requester_department, total_value, project_id)
      VALUES (${requestId}, ${companyA}, ${"REQ-" + requestId.slice(0, 6)},
              ${status}, 'internal', 'Jane', 'Technical', ${approved * 1200},
              ${projectId})`;
    await admin`
      INSERT INTO stock_request_items (id, company_id, request_id, line_number,
                                       product_id, product_name_at_request,
                                       sku_at_request, stock_at_request,
                                       requested_quantity, approved_quantity,
                                       total_fulfilled, unit_price, unit)
      VALUES (${itemId}, ${companyA}, ${requestId}, 1, ${cableProduct}, 'Cable',
              'CBL-1', 100, ${approved}, ${approved}, ${fulfilled}, 1200, 'm')`;
    if (fulfilled > 0) {
      const movementId = randomUUID();
      await admin`
        INSERT INTO stock_movements (id, company_id, movement_number, product_id,
                                     product_name_at_movement, movement_type,
                                     direction, quantity, previous_stock,
                                     new_stock, unit_cost, total_cost, status)
        VALUES (${movementId}, ${companyA}, ${"MV-" + movementId.slice(0, 6)},
                ${cableProduct}, 'Cable', 'issue', 'out', ${fulfilled}, 100,
                ${100 - fulfilled}, 1000, ${fulfilled * 1000}, 'completed')`;
      await admin`
        INSERT INTO stock_request_fulfilments (company_id, item_id, quantity,
                                               fulfilled_by_name_at_fulfilment,
                                               movement_id)
        VALUES (${companyA}, ${itemId}, ${fulfilled}, 'Store', ${movementId})`;
    }
    return requestId;
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
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;

    companyA = randomUUID();
    companyB = randomUUID();
    customer = randomUUID();
    employeeParty = randomUUID();
    cableProduct = randomUUID();
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    travelAcct = randomUUID();
    materialsAcct = randomUUID();
    arAcct = randomUUID();
    actor = { id: null, name: "Test User" };

    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)}),
      (${companyB}, 'Rival', ${"r-" + companyB.slice(0, 8)})`;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyA})`;
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Test User", role: "Admin" },
      companyId: mongoCompanyId,
    });

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_customer, is_employee, name)
        VALUES (${customer}, ${companyA}, 'customer', true, false, 'Kerra'),
               (${employeeParty}, ${companyA}, 'employee', false, true, 'Jane Site')`);
      await tx.execute(sql`
        INSERT INTO products (id, company_id, sku, name)
        VALUES (${cableProduct}, ${companyA}, 'CBL-1', 'Cable')`);
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
        VALUES (${travelAcct}, ${companyA}, '6100', 'Travel', 'expense'),
               (${materialsAcct}, ${companyA}, '6200', 'Materials', 'expense'),
               (${arAcct}, ${companyA}, '1200', 'Accounts Receivable', 'asset')`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the status machine", () => {
    it("runs planning → active → completed → closed and stamps the end date", async () => {
      const p = await seedProject();
      expect(p.status).toBe("planning");
      expect(p.actualEndDate).toBeNull();

      await inA((tx) => repo.setProjectStatus(tx, p.id, "active", actor));
      const completed = await inA((tx) =>
        repo.setProjectStatus(tx, p.id, "completed", actor),
      );
      // The trigger stamps it; nothing in the application has to remember.
      expect(completed.actualEndDate).toBeTruthy();

      const closed = await inA((tx) =>
        repo.setProjectStatus(tx, p.id, "closed", actor),
      );
      // Mongo re-stamps on close, overwriting the completion date with the
      // administrative one. COALESCE keeps the first.
      expect(closed.actualEndDate).toBe(completed.actualEndDate);
    });

    it("refuses a jump the state machine does not allow", async () => {
      const p = await seedProject();
      await failsWith(
        () => inA((tx) => repo.setProjectStatus(tx, p.id, "completed", actor)),
        /cannot move from planning to completed/i,
      );
    });

    it("will not reopen a closed project", async () => {
      const p = await seedProject();
      await inA((tx) => repo.setProjectStatus(tx, p.id, "active", actor));
      await inA((tx) => repo.setProjectStatus(tx, p.id, "completed", actor));
      await inA((tx) => repo.setProjectStatus(tx, p.id, "closed", actor));
      await failsWith(
        () => inA((tx) => repo.setProjectStatus(tx, p.id, "active", actor)),
        /closed and cannot be reopened/i,
      );
    });

    it("holds even for a writer that does not use setProjectStatus", async () => {
      // The point of putting it in the database: `updateProject` and
      // `updateProjectProgress` both reach the Mongo document through
      // findOneAndUpdate, where the model's canTransitionTo never runs.
      const p = await seedProject();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`UPDATE projects SET status = 'closed' WHERE id = ${p.id}`),
          ),
        /cannot move from planning to closed/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the hierarchy", () => {
    it("refuses a cycle", async () => {
      const parent = await seedProject({ name: "Road A" });
      const child = await seedProject({
        name: "Road A Phase 1",
        parentProjectId: parent.id,
      });

      await failsWith(
        () =>
          inA((tx) =>
            repo.updateProject(tx, parent.id, { parentProjectId: child.id }),
          ),
        /cannot be a subproject of its own descendant/i,
      );
    });

    it("keeps descendants out of the parent picker", async () => {
      // The Mongo query excludes SELF and its docstring claims it excludes
      // children. Offering a child is how the cycle above gets attempted.
      const parent = await seedProject({ name: "Road A" });
      const child = await seedProject({
        name: "Phase 1",
        parentProjectId: parent.id,
      });
      const grandchild = await seedProject({
        name: "Phase 1a",
        parentProjectId: child.id,
      });
      const unrelated = await seedProject({ name: "Bridge B" });

      const options = await inA((tx) =>
        repo.getProjectsForParentPicker(tx, parent.id),
      );
      const ids = options.map((o) => o.id);
      expect(ids).toContain(unrelated.id);
      expect(ids).not.toContain(parent.id);
      expect(ids).not.toContain(child.id);
      expect(ids).not.toContain(grandchild.id);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("budgets", () => {
    /** A cost code charging `accountId`. Codes are the budget vocabulary. */
    const code = (accountId, over = {}) =>
      inA((tx) =>
        repo.createCostCode(tx, {
          companyId: companyA,
          code: over.code ?? "LAB",
          name: over.name ?? "Labour",
          accountId,
          projectId: over.projectId ?? null,
          createdByName: "Test User",
        }),
      );

    const draft = (projectId, lines) =>
      inA((tx) =>
        repo.createBudget(tx, {
          companyId: companyA,
          projectId,
          lines,
          createdByName: "Test User",
        }),
      );

    it("versions per project and derives the account from the cost code", async () => {
      const p = await seedProject();
      const lab = await code(travelAcct);
      const v1 = await draft(p.id, [{ costCodeId: lab.id, amount: "1000.0000" }]);
      const v2 = await draft(p.id, [{ costCodeId: lab.id, amount: "1500.0000" }]);
      expect(v1.version).toBe(1);
      expect(v2.version).toBe(2);

      const full = await inA((tx) => repo.getBudgetWithLines(tx, v1.id));
      // Written by the trigger, not supplied — 0073 decision 2.
      expect(full.lines[0].accountId).toBe(travelAcct);
      expect(full.lines[0].accountCodeAtBudget).toBe("6100");
      expect(full.lines[0].accountNameAtBudget).toBe("Travel");
      expect(full.lines[0].costCode).toBe("LAB");
    });

    it("refuses two lines against one cost code", async () => {
      const p = await seedProject();
      const lab = await code(travelAcct);
      await failsWith(
        () =>
          draft(p.id, [
            { costCodeId: lab.id, amount: "1000.0000" },
            { costCodeId: lab.id, amount: "500.0000" },
          ]),
        /appears twice on this budget/i,
      );
    });

    it("refuses two codes that charge the same account, and says why", async () => {
      // Budget-versus-actual matches by ACCOUNT, so two lines on one account
      // each show its full spend. Two codes sharing an account is legitimate;
      // both on one budget is not.
      const p = await seedProject();
      const site = await code(travelAcct, { code: "LAB-S", name: "Labour, site" });
      const office = await code(travelAcct, { code: "LAB-O", name: "Labour, office" });

      await failsWith(
        () =>
          draft(p.id, [
            { costCodeId: site.id, amount: "1000.0000" },
            { costCodeId: office.id, amount: "500.0000" },
          ]),
        /charge the same account/i,
      );
    });

    it("refuses a cost code that charges something other than an expense", async () => {
      await failsWith(
        () => code(arAcct, { code: "BAD", name: "Bad" }),
        /charges an expense account/i,
      );
    });

    it("refuses a cost code scoped to another project", async () => {
      const mine = await seedProject({ name: "Mine" });
      const theirs = await seedProject({ name: "Theirs" });
      const scoped = await code(travelAcct, { code: "OTH", projectId: theirs.id });

      await failsWith(
        () => draft(mine.id, [{ costCodeId: scoped.id, amount: "100.0000" }]),
        /belongs to a different project/i,
      );
    });

    it("does not rewrite an approved line when finance re-maps the code", async () => {
      // A budget was signed against an account and the signature refers to
      // that account.
      const p = await seedProject();
      const lab = await code(travelAcct);
      const v1 = await draft(p.id, [{ costCodeId: lab.id, amount: "1000.0000" }]);
      await inA((tx) => repo.approveBudget(tx, v1.id, actor));

      await inA((tx) => repo.updateCostCode(tx, lab.id, { accountId: materialsAcct }));

      const full = await inA((tx) => repo.getBudgetWithLines(tx, v1.id));
      expect(full.lines[0].accountCodeAtBudget).toBe("6100");
      expect(full.lines[0].accountId).toBe(travelAcct);
    });

    it("supersedes the incumbent on approval, and never leaves two approved", async () => {
      const p = await seedProject();
      const lab = await code(travelAcct);
      const mat = await code(materialsAcct, { code: "MAT", name: "Materials" });
      const v1 = await draft(p.id, [{ costCodeId: lab.id, amount: "1000.0000" }]);
      const v2 = await draft(p.id, [{ costCodeId: mat.id, amount: "2000.0000" }]);

      await inA((tx) => repo.approveBudget(tx, v1.id, actor));
      await inA((tx) => repo.approveBudget(tx, v2.id, actor));

      const rows = await admin`
        SELECT version, status FROM project_budgets
         WHERE project_id = ${p.id} ORDER BY version`;
      expect(rows.map((r) => r.status)).toEqual(["superseded", "approved"]);
    });

    it("cannot have two approved even written directly", async () => {
      // Mongo's approve() is read-then-write-then-write with no lock, so two
      // concurrent approvals both pass its check. The index does not care.
      const p = await seedProject();
      const lab = await code(travelAcct);
      const v1 = await draft(p.id, [{ costCodeId: lab.id, amount: "1000.0000" }]);
      await inA((tx) => repo.approveBudget(tx, v1.id, actor));

      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              INSERT INTO project_budgets
                (company_id, project_id, version, status, approved_at, approved_by_name)
              VALUES (${companyA}, ${p.id}, 99, 'approved', now(), 'Sneak')`),
          ),
        /already has an approved budget/i,
      );
    });

    it("freezes an approved budget's lines", async () => {
      const p = await seedProject();
      const lab = await code(travelAcct);
      const v1 = await draft(p.id, [{ costCodeId: lab.id, amount: "1000.0000" }]);
      await inA((tx) => repo.approveBudget(tx, v1.id, actor));

      await failsWith(
        () =>
          inA((tx) =>
            repo.replaceBudgetLines(tx, v1.id, companyA, [
              { costCodeId: lab.id, amount: "9999.0000" },
            ]),
          ),
        /cannot be changed/i,
      );
    });

    it("will not approve a budget with no lines", async () => {
      const p = await seedProject();
      const [row] = await admin`
        INSERT INTO project_budgets (company_id, project_id, version)
        VALUES (${companyA}, ${p.id}, 1) RETURNING id`;
      await failsWith(
        () => inA((tx) => repo.approveBudget(tx, row.id, actor)),
        /no lines to approve/i,
      );
    });

    it("takes the budget from the approved lines, and the form figure otherwise", async () => {
      // Decision 5: one number, not three. Mongo stores the total on the
      // budget AND copies it onto the project on approve.
      const p = await seedProject({ budgetAmount: "500.0000" });

      let budget = await inA((tx) => repo.getEffectiveBudget(tx, p.id));
      expect(budget.amount).toBe(500);
      expect(budget.fromApprovedBudget).toBe(false);

      const lab = await code(travelAcct);
      const mat = await code(materialsAcct, { code: "MAT", name: "Materials" });
      const v1 = await draft(p.id, [
        { costCodeId: lab.id, amount: "1000.0000" },
        { costCodeId: mat.id, amount: "250.0000" },
      ]);
      await inA((tx) => repo.approveBudget(tx, v1.id, actor));

      budget = await inA((tx) => repo.getEffectiveBudget(tx, p.id));
      expect(budget.amount).toBe(1250);
      expect(budget.fromApprovedBudget).toBe(true);

      // And nothing was written back to the project — no third copy.
      const [row] = await admin`
        SELECT budget_amount::float8 AS amount FROM projects WHERE id = ${p.id}`;
      expect(row.amount).toBe(500);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("cost codes", () => {
    const code = (over = {}) =>
      inA((tx) =>
        repo.createCostCode(tx, {
          companyId: companyA,
          code: over.code ?? "LAB",
          name: over.name ?? "Labour",
          accountId: over.accountId ?? travelAcct,
          projectId: over.projectId ?? null,
          createdByName: "Test User",
        }),
      );

    it("refuses a duplicate company-wide code", async () => {
      // Mongo's single { companyId, code, projectId } index catches this
      // because Mongo treats a missing projectId as a value. Postgres does
      // not, so the same index would let ten LAB codes through.
      await code();
      await failsWith(() => code(), /company-wide cost code with that code/i);
    });

    it("lets a project scope its own code of the same name", async () => {
      const p = await seedProject();
      await code();
      const scoped = await code({ projectId: p.id, name: "Labour on Road A" });
      expect(scoped.projectId).toBe(p.id);

      // And the picker offers both to that project, the company-wide one only
      // to everybody else.
      const forProject = await inA((tx) => repo.getCostCodes(tx, p.id));
      expect(forProject).toHaveLength(2);
      const companyWide = await inA((tx) => repo.getCostCodes(tx, null));
      expect(companyWide).toHaveLength(1);
    });

    it("keeps a deactivated code out of the picker and in the register", async () => {
      const c = await code();
      await inA((tx) => repo.setCostCodeActive(tx, c.id, false));
      expect(await inA((tx) => repo.getCostCodes(tx, null))).toHaveLength(0);
      expect(await inA((tx) => repo.getAllCostCodes(tx))).toHaveLength(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the roster", () => {
    it("reactivates rather than duplicating", async () => {
      const p = await seedProject();
      const assign = (role) =>
        inA((tx) =>
          repo.upsertAssignment(tx, {
            companyId: companyA,
            projectId: p.id,
            partyId: employeeParty,
            partyName: "Jane Site",
            role,
          }),
        );

      const first = await assign("Foreman");
      await inA((tx) => repo.setAssignmentStatus(tx, first.id, "removed"));
      const again = await assign("Site Agent");

      expect(again.id).toBe(first.id);
      expect(again.status).toBe("active");
      expect(again.removedAt).toBeNull();
      expect(again.role).toBe("Site Agent");
      expect(await inA((tx) => repo.getProjectAssignments(tx, p.id))).toHaveLength(1);
    });

    it("refuses an amount with no unit", async () => {
      const p = await seedProject();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              INSERT INTO project_assignments
                (company_id, project_id, party_id, party_name, rate_amount)
              VALUES (${companyA}, ${p.id}, ${employeeParty}, 'Jane', 500)`),
          ),
        /both an amount and a unit/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the money", () => {
    it("counts revenue net of the credit notes raised against it", async () => {
      const p = await seedProject();
      const inv = await seedInvoice(p.id, 100000);
      await seedInvoice(p.id, 50000, "draft"); // not recognised — not revenue

      let actuals = await inA((tx) => repo.computeProjectActuals(tx, p.id));
      expect(actuals.revenue).toBe(100000);

      // `assert_credit_note_valid` refuses a note with no lines, and `total`
      // is generated from the subtotal — so a note fixture is a header and a
      // line, the same as a bill.
      // `credit_notes_are_valid` is INITIALLY DEFERRED, so the note and its
      // line commit together; `total` is generated from the subtotal.
      const noteId = randomUUID();
      await admin.begin(async (tx) => {
        await tx`
          INSERT INTO credit_notes (id, company_id, credit_note_number,
                                    credit_note_date, invoice_id,
                                    invoice_number_at_issue, invoice_date_at_issue,
                                    invoice_total_at_issue, customer_id,
                                    customer_name_at_issue, reason,
                                    reason_description, subtotal, status)
          VALUES (${noteId}, ${companyA}, 'CN-1', CURRENT_DATE, ${inv}, 'INV-1',
                  CURRENT_DATE, 100000, ${customer}, 'Kerra', 'return',
                  'Short delivery', 15000, 'issued')`;
        await tx`
          INSERT INTO credit_note_lines (company_id, credit_note_id, line_number,
                                         item_type, description, quantity,
                                         unit_price, tax_rate)
          VALUES (${companyA}, ${noteId}, 1, 'service', 'Short delivery', 1,
                  15000, 0)`;
      });

      actuals = await inA((tx) => repo.computeProjectActuals(tx, p.id));
      // A credit note references the INVOICE, not the project, which is why
      // the Mongo version had to collect the invoice ids first.
      expect(actuals.revenue).toBe(85000);
    });

    it("counts an approved bill as cost whether or not it is paid", async () => {
      // 0088: approval is when the bill posts (DR expense / CR AP), so it is
      // when the project incurred it. Counting at payment instead put cost on
      // a cash basis while revenue stayed on an accrual one, and margin then
      // moved with supplier terms rather than with the job.
      const p = await seedProject();
      await seedBill(p.id, 40000, "approved", "paid");
      await seedBill(p.id, 25000, "approved", "unpaid");
      await seedBill(p.id, 90000, "cancelled", "paid");

      const actuals = await inA((tx) => repo.computeProjectActuals(tx, p.id));
      expect(actuals.costs).toBe(65000);
      expect(actuals.committed).toBe(0);
    });

    it("counts a bill still awaiting approval as commitment, not cost", async () => {
      const p = await seedProject();
      await seedBill(p.id, 12000, "draft", "unpaid");
      await seedBill(p.id, 8000, "submitted", "unpaid");
      // Rejected is neither: it will never be a cost and is not expected to be.
      await seedBill(p.id, 50000, "rejected", "unpaid");

      const actuals = await inA((tx) => repo.computeProjectActuals(tx, p.id));
      expect(actuals.costs).toBe(0);
      expect(actuals.committed).toBe(20000);
    });

    it("counts an approved stock request as commitment, which no ledger query could", async () => {
      // Decision 2: nothing has been received and nothing is owed, so there is
      // correctly no journal line — and it is exactly the number a budget is
      // checked against.
      const p = await seedProject();
      await seedRequest(p.id, { status: "approved", approved: 10, fulfilled: 0 });

      const actuals = await inA((tx) => repo.computeProjectActuals(tx, p.id));
      expect(actuals.committed).toBe(12000);
      expect(actuals.costs).toBe(0);
      const [lines] = await admin`SELECT COUNT(*)::int AS n FROM journal_lines`;
      expect(lines.n).toBe(0);
    });

    it("turns commitment into cost as the stock is issued, and does not lose it", async () => {
      // THE BUG THIS REPLACES: Mongo counts approved and partially_fulfilled
      // as committed and stops. The moment a request is fully fulfilled its
      // commitment disappears and nothing takes its place — the stock is on
      // site and the project's cost FALLS by what was just delivered.
      const p = await seedProject();

      // Six of ten issued: six at the movement's cost of 1,000, four still
      // committed at the request's price of 1,200.
      const partial = await seedRequest(p.id, {
        status: "partially_fulfilled",
        approved: 10,
        fulfilled: 6,
      });
      let actuals = await inA((tx) => repo.computeProjectActuals(tx, p.id));
      expect(actuals.costs).toBe(6000);
      expect(actuals.committed).toBe(4800);

      // The remaining four issued. A stock movement is immutable — the ledger
      // says so — so this is a SECOND movement, which is what a second
      // fulfilment actually produces.
      const [item] = await admin`
        SELECT id FROM stock_request_items WHERE request_id = ${partial}`;
      const movementId = randomUUID();
      await admin`
        INSERT INTO stock_movements (id, company_id, movement_number, product_id,
                                     product_name_at_movement, movement_type,
                                     direction, quantity, previous_stock,
                                     new_stock, unit_cost, total_cost, status)
        VALUES (${movementId}, ${companyA}, ${"MV-" + movementId.slice(0, 6)},
                ${cableProduct}, 'Cable', 'issue', 'out', 4, 94, 90, 1000, 4000,
                'completed')`;
      await admin`
        INSERT INTO stock_request_fulfilments (company_id, item_id, quantity,
                                               fulfilled_by_name_at_fulfilment,
                                               movement_id)
        VALUES (${companyA}, ${item.id}, 4, 'Store', ${movementId})`;
      await admin`
        UPDATE stock_request_items SET total_fulfilled = 10 WHERE id = ${item.id}`;
      await admin`
        UPDATE stock_requests SET status = 'fulfilled' WHERE id = ${partial}`;

      actuals = await inA((tx) => repo.computeProjectActuals(tx, p.id));
      expect(actuals.costs).toBe(10000);
      expect(actuals.committed).toBe(0);
    });

    it("reports zero rather than throwing for a project with nothing on it", async () => {
      const p = await seedProject();
      expect(await inA((tx) => repo.computeProjectActuals(tx, p.id))).toEqual({
        revenue: 0,
        costs: 0,
        committed: 0,
      });
    });

    it("derives margin and utilisation from the live figures", async () => {
      const p = await seedProject({ budgetAmount: "100000.0000" });
      await seedInvoice(p.id, 200000);
      await seedBill(p.id, 50000, "approved", "paid");
      await seedBill(p.id, 30000, "approved", "unpaid");
      await seedBill(p.id, 20000, "draft", "unpaid");

      const summary = await inA((tx) => repo.getProjectFinancialSummary(tx, p.id));
      expect(summary.revenue).toBe(200000);
      // Both approved bills, paid or not.
      expect(summary.costs).toBe(80000);
      expect(summary.committed).toBe(20000);
      expect(summary.margin).toBe(120000);
      expect(summary.marginPercent).toBe(60);
      expect(summary.budgetUtilization).toBe(100);
      expect(summary.available).toBe(0);
    });

    it("answers for many projects in one query", async () => {
      const a = await seedProject({ name: "A" });
      const b = await seedProject({ name: "B" });
      await seedInvoice(a.id, 1000);
      await seedInvoice(b.id, 2000);

      const map = await inA((tx) => repo.computeActualsFor(tx, [a.id, b.id]));
      expect(map.get(a.id).revenue).toBe(1000);
      expect(map.get(b.id).revenue).toBe(2000);
    });

    it("puts bills, claims and expenses against the budget line's account", async () => {
      const p = await seedProject();
      const lab = await inA((tx) =>
        repo.createCostCode(tx, {
          companyId: companyA, code: "LAB", name: "Labour",
          accountId: travelAcct, createdByName: "Test User",
        }),
      );
      const mat = await inA((tx) =>
        repo.createCostCode(tx, {
          companyId: companyA, code: "MAT", name: "Materials",
          accountId: materialsAcct, createdByName: "Test User",
        }),
      );
      const v1 = await inA((tx) =>
        repo.createBudget(tx, {
          companyId: companyA,
          projectId: p.id,
          lines: [
            { costCodeId: lab.id, amount: "10000.0000" },
            { costCodeId: mat.id, amount: "5000.0000" },
          ],
          createdByName: "Test User",
        }),
      );
      await inA((tx) => repo.approveBudget(tx, v1.id, actor));

      await seedBill(p.id, 4000, "approved", "paid", travelAcct);

      const bva = await inA((tx) => repo.getProjectBudgetVsActual(tx, p.id));
      const travel = bva.lines.find((l) => l.accountId === travelAcct);
      expect(travel.budgeted).toBe(10000);
      expect(travel.actual).toBe(4000);
      expect(travel.available).toBe(6000);
      expect(travel.percentUsed).toBe(40);

      const materials = bva.lines.find((l) => l.accountId === materialsAcct);
      expect(materials.actual).toBe(0);
      expect(materials.percentUsed).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the drill-down", () => {
    // `getProjectTransactions` had NO test, and its claims arm selected
    // `c.employee_name` — not a column. Every project detail page with a claim
    // against it threw. This exercises all five arms, because the failure was
    // "the query does not run", not "the number is wrong".
    it("returns all five link types, and every arm executes", async () => {
      const p = await seedProject();

      await seedInvoice(p.id, 5000);
      await seedBill(p.id, 4000, "approved", "paid");
      await seedRequest(p.id, { status: "approved", approved: 2, fulfilled: 0 });

      // `employee_claim_requires_items` is INITIALLY DEFERRED — a
      // reimbursement and its receipts commit together (0052 decision 1).
      const claimId = randomUUID();
      await admin.begin(async (tx) => {
        await tx`
          INSERT INTO employee_claims (id, company_id, claim_number, claim_date,
                                       claim_type, party_id, description,
                                       project_id, status)
          VALUES (${claimId}, ${companyA}, 'CLM-1', CURRENT_DATE, 'reimbursement',
                  ${employeeParty}, 'Site fuel', ${p.id}, 'submitted')`;
        await tx`
          INSERT INTO employee_claim_items (company_id, claim_id, line_number,
                                            item_date, category,
                                            expense_account_id, description, amount)
          VALUES (${companyA}, ${claimId}, 1, CURRENT_DATE, 'fuel',
                  ${travelAcct}, 'Diesel', 2500)`;
      });

      await admin`
        INSERT INTO expenses (company_id, expense_number, expense_date, category,
                              account_id, account_code_at_expense,
                              account_name_at_expense, amount,
                              payee_name_at_expense, description, project_id)
        VALUES (${companyA}, 'EXP-1', CURRENT_DATE, 'other', ${travelAcct},
                '6100', 'Travel', 2500, 'Jane Site', 'Site visit', ${p.id})`;

      const t = await inA((tx) => repo.getProjectTransactions(tx, p.id));

      expect(t.invoices).toHaveLength(1);
      expect(t.bills).toHaveLength(1);
      expect(t.requests).toHaveLength(1);
      expect(t.expenses).toHaveLength(1);
      expect(t.claims).toHaveLength(1);
      // The name comes from the party join `listClaims` already does — which
      // is why this delegates rather than re-deriving the query.
      expect(t.claims[0]).toMatchObject({
        claimNumber: "CLM-1",
        employeeName: "Jane Site",
      });
    });

    /**
     * WHAT THE SCREEN READS, pinned.
     *
     * Three lists render these rows — the project detail page's Linked
     * Transactions card, IPC & Payments, and Cash Requisitions — and all
     * three were written against the MONGO shapes: `inv.customer.name`,
     * `bill.vendor.name`, `claim.employee.name`, `req.requester.name`, and
     * `bill.amounts.netPayable`. Not one of those is a key on these rows.
     *
     * Nothing threw. React prints `undefined` as nothing, so every party name
     * rendered blank, and `formatCurrency(undefined || 0)` is a confident
     * zero — EVERY SUPPLIER BILL SHOWED KES 0 on all three screens.
     *
     * The test above already pinned `employeeName` and so already disagreed
     * with the screen beside it; nothing compared the two. This pins the
     * whole set, and the absence of the nested shapes with it.
     */
    it("carries every field the linked-transaction lists render", async () => {
      const p = await seedProject();
      await seedInvoice(p.id, 5000);
      await seedBill(p.id, 4000, "approved", "paid");
      await seedRequest(p.id, { status: "approved", approved: 2, fulfilled: 0 });
      await admin`
        INSERT INTO expenses (company_id, expense_number, expense_date, category,
                              account_id, account_code_at_expense,
                              account_name_at_expense, amount,
                              payee_name_at_expense, description, project_id)
        VALUES (${companyA}, 'EXP-1', CURRENT_DATE, 'other', ${travelAcct},
                '6100', 'Travel', 2500, 'Jane Site', 'Site visit', ${p.id})`;

      const t = await inA((tx) => repo.getProjectTransactions(tx, p.id));

      expect(t.invoices[0]).toMatchObject({ customerName: "Kerra", total: 5000 });
      expect(t.bills[0]).toMatchObject({
        vendorName: "Supplier",
        total: 4000,
        netPayable: 4000,
      });
      expect(t.requests[0]).toMatchObject({
        requesterName: "Jane",
        totalValue: 2400,
      });
      expect(t.expenses[0]).toMatchObject({
        expenseNumber: "EXP-1",
        accountName: "Travel",
      });

      // The nested shapes the screens used to read. They have never existed
      // on a Postgres row, and asserting their absence is what stops one
      // coming back the next time somebody ports a list from the Mongo app.
      expect(t.invoices[0].customer).toBeUndefined();
      expect(t.bills[0].vendor).toBeUndefined();
      expect(t.bills[0].amounts).toBeUndefined();
      expect(t.requests[0].requester).toBeUndefined();
      expect(t.claims.every((c) => c.employee === undefined)).toBe(true);
    });

    /**
     * MONEY IS A STRING on the two arms that come from a repository rather
     * than from hand-written SQL — `numeric(19,4)` in drizzle's string mode,
     * where the SELECTs above cast to `float8`. Cash Requisitions adds these
     * two lists up in JS, and `0 + "2500.0000"` CONCATENATES: one claim and
     * one expense summed to `"02500.00002500.0000"`, which
     * `Intl.NumberFormat` renders as NaN.
     *
     * Pinned as a type rather than fixed here, because the string is correct:
     * the repository contract is money-as-string, and it is the page that has
     * to coerce.
     */
    it("returns claim and expense money as strings, and the rest as numbers", async () => {
      const p = await seedProject();
      await seedInvoice(p.id, 5000);
      await seedBill(p.id, 4000, "approved", "paid");
      await admin`
        INSERT INTO expenses (company_id, expense_number, expense_date, category,
                              account_id, account_code_at_expense,
                              account_name_at_expense, amount,
                              payee_name_at_expense, description, project_id)
        VALUES (${companyA}, 'EXP-2', CURRENT_DATE, 'other', ${travelAcct},
                '6100', 'Travel', 2500, 'Jane Site', 'Site visit', ${p.id})`;

      const t = await inA((tx) => repo.getProjectTransactions(tx, p.id));

      expect(typeof t.expenses[0].total).toBe("string");
      expect(Number(t.expenses[0].total)).toBe(2500);
      expect(typeof t.invoices[0].total).toBe("number");
      expect(typeof t.bills[0].netPayable).toBe("number");
    });

    it("returns just the one type when asked for it", async () => {
      const p = await seedProject();
      await seedInvoice(p.id, 5000);

      const t = await inA((tx) => repo.getProjectTransactions(tx, p.id, "invoices"));
      expect(Object.keys(t)).toEqual(["invoices"]);
    });

    it("does not pick up another project's documents", async () => {
      const mine = await seedProject({ name: "Mine" });
      const theirs = await seedProject({ name: "Theirs" });
      await seedInvoice(theirs.id, 5000);

      const t = await inA((tx) => repo.getProjectTransactions(tx, mine.id));
      expect(t.invoices).toHaveLength(0);
      expect(t.claims).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("deleting", () => {
    it("counts every link, not just claims", async () => {
      // The module's own gap list: "Delete only checks claims. Should check
      // all 5 linked collections." A project with invoices and no claims
      // deleted cleanly and took the link off every one of them.
      const p = await seedProject();
      await admin`
        INSERT INTO invoices (company_id, invoice_number, invoice_date,
                              customer_id, total, status, project_id)
        VALUES (${companyA}, 'INV-9', CURRENT_DATE, ${customer}, 10, 'draft', ${p.id})`;

      const links = await inA((tx) => repo.countProjectLinks(tx, p.id));
      expect(links.claims).toBe(0);
      expect(links.invoices).toBe(1);
      expect(links.total).toBe(1);
    });

    it("counts subprojects too", async () => {
      const parent = await seedProject({ name: "Road A" });
      await seedProject({ name: "Phase 1", parentProjectId: parent.id });
      const links = await inA((tx) => repo.countProjectLinks(tx, parent.id));
      expect(links.subprojects).toBe(1);
    });

    it("leaves an invoice standing if a project goes anyway", async () => {
      // The guard is in the action; this is the backstop under it. Deleting a
      // project must never delete an invoice.
      const p = await seedProject();
      await admin`
        INSERT INTO invoices (company_id, invoice_number, invoice_date,
                              customer_id, total, status, project_id)
        VALUES (${companyA}, 'INV-8', CURRENT_DATE, ${customer}, 10, 'draft', ${p.id})`;

      await inA((tx) => repo.deleteProject(tx, p.id));
      const [row] = await admin`
        SELECT project_id, project_number_at_invoice FROM invoices
         WHERE invoice_number = 'INV-8'`;
      expect(row.project_id).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the client is a customer", () => {
    // The forms already offer customers only and have no quick-create beside
    // the picker. Everything here is the rule one layer down, where a crafted
    // request reaches — and where 0070 explicitly allowed a free-text name.
    it("refuses a name with no customer behind it", async () => {
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              INSERT INTO projects (company_id, project_number, name, client_name)
              VALUES (${companyA}, 'PRJ-X', 'Road', 'Some Guy Ltd')`),
          ),
        /client is a customer, chosen from the list/i,
      );
    });

    it("refuses an email with no client", async () => {
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              INSERT INTO projects (company_id, project_number, name, client_email)
              VALUES (${companyA}, 'PRJ-X', 'Road', 'a@b.c')`),
          ),
        /client email belongs to a client/i,
      );
    });

    it("refuses a supplier as the client, and says who", async () => {
      const supplier = randomUUID();
      await inA((tx) =>
        tx.execute(sql`
          INSERT INTO parties (id, company_id, primary_type, is_supplier, name)
          VALUES (${supplier}, ${companyA}, 'supplier', true, 'Bamburi')`),
      );
      await failsWith(
        () => seedProject({ clientPartyId: supplier, clientName: "Bamburi" }),
        /Bamburi is not one/i,
      );
    });

    it("takes the name and email from the party, not from the form", async () => {
      const fd = new FormData();
      fd.set("name", "Otho Road");
      fd.set("clientPartyId", customer);
      // Both ignored — the action reads `parties`. Before 0072 they were
      // stored as sent, with nothing checking they matched the id.
      fd.set("clientName", "Totally Different Ltd");
      fd.set("clientEmail", "spoof@example.com");

      await expect(actions.createProject(null, fd)).rejects.toThrow(); // redirect()

      const [row] = await admin`
        SELECT client_party_id, client_name, client_email FROM projects
         WHERE name = 'Otho Road'`;
      expect(row.client_party_id).toBe(customer);
      expect(row.client_name).toBe("Kerra");
      expect(row.client_email).toBeNull();
    });

    it("still allows a project with no client at all", async () => {
      // An internal project has no external client, and requiring one would
      // push people to invent a party to satisfy the form.
      const p = await seedProject({ name: "Warehouse move" });
      expect(p.clientPartyId).toBeNull();
      expect(p.clientName).toBeNull();
    });

    it("does not invalidate a project when its customer is reclassified", async () => {
      // Checked on the way in only. The invoices already raised against the
      // project are the record that they were a customer then.
      const p = await seedProject({ clientPartyId: customer, clientName: "Kerra" });
      await admin`
        UPDATE parties SET is_supplier = true, is_customer = false, primary_type = 'supplier'
         WHERE id = ${customer}`;

      const updated = await inA((tx) =>
        repo.updateProject(tx, p.id, { name: "Otho Road, renamed" }),
      );
      expect(updated.name).toBe("Otho Road, renamed");
      expect(updated.clientName).toBe("Kerra");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the roster action's contract", () => {
    // `ProjectTeam.jsx` sends `{ partyId, role, rate: { amount, unit } }` and
    // nothing else. An action that asked for a name and a flat rate instead
    // would have written "Unnamed" with no rate for every member added through
    // the only screen that adds one — and typechecked, and passed a test that
    // called it directly with the shape it wanted.
    it("takes the shape the screen sends, and snapshots the name itself", async () => {
      const p = await seedProject();

      const res = await actions.assignPartyToProject(p.id, {
        partyId: employeeParty,
        role: "Foreman",
        rate: { amount: 2500, unit: "day" },
      });
      expect(res.success).toBe(true);

      const [row] = await admin`
        SELECT party_name, party_type, role, rate_amount::float8 AS rate, rate_unit
          FROM project_assignments WHERE project_id = ${p.id}`;
      // Not taken from the request body — read from `parties`.
      expect(row.party_name).toBe("Jane Site");
      expect(row.party_type).toBe("employee");
      expect(row.role).toBe("Foreman");
      expect(row.rate).toBe(2500);
      expect(row.rate_unit).toBe("day");
    });

    it("defaults the unit rather than letting a blank select reach the CHECK", async () => {
      const p = await seedProject();
      const res = await actions.assignPartyToProject(p.id, {
        partyId: employeeParty,
        rate: { amount: 900, unit: "" },
      });
      expect(res.success).toBe(true);

      const [row] = await admin`
        SELECT rate_amount::float8 AS rate, rate_unit FROM project_assignments
         WHERE project_id = ${p.id}`;
      expect(row.rate).toBe(900);
      expect(row.rate_unit).toBe("day");
    });

    it("clears the rate when the amount is cleared", async () => {
      const p = await seedProject();
      await actions.assignPartyToProject(p.id, {
        partyId: employeeParty,
        rate: { amount: 900, unit: "day" },
      });
      const [a] = await admin`
        SELECT id FROM project_assignments WHERE project_id = ${p.id}`;

      await actions.updateProjectAssignment(a.id, { rate: { amount: "", unit: "day" } });
      const [row] = await admin`
        SELECT rate_amount, rate_unit FROM project_assignments WHERE id = ${a.id}`;
      // Both or neither — `project_assignments_rate_pair`.
      expect(row.rate_amount).toBeNull();
      expect(row.rate_unit).toBeNull();
    });

    it("refuses a party from another company", async () => {
      const p = await seedProject();
      const stranger = randomUUID();
      await asTenant(companyB, (tx) =>
        tx.execute(sql`
          INSERT INTO parties (id, company_id, primary_type, is_employee, name)
          VALUES (${stranger}, ${companyB}, 'employee', true, 'Outsider')`),
      );
      const res = await actions.assignPartyToProject(p.id, { partyId: stranger });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not found/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("tenant isolation", () => {
    it("does not show one company another's projects", async () => {
      await seedProject({ name: "Pilot's road" });
      const seen = await asTenant(companyB, (tx) => repo.listProjects(tx));
      expect(seen.projects).toHaveLength(0);
    });

    it("refuses to write a project into another company", async () => {
      await failsWith(
        () =>
          asTenant(companyB, (tx) =>
            repo.createProject(tx, {
              companyId: companyA,
              name: "Cross-tenant",
              createdByName: "Sneak",
            }),
          ),
        /.+/,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the list", () => {
    it("carries each row's live figures without a query per row", async () => {
      const p = await seedProject({ budgetAmount: "1000.0000" });
      await seedBill(p.id, 300);

      const { projects } = await inA((tx) => repo.listProjects(tx));
      expect(projects).toHaveLength(1);
      expect(projects[0].actuals.costs).toBe(300);
      expect(projects[0].effectiveBudget.amount).toBe(1000);
    });

    it("searches number, name, client and manager", async () => {
      // The client on a project is a customer (0072), so the search fixture is
      // a real one rather than a typed-in name.
      const kenha = randomUUID();
      await inA((tx) =>
        tx.execute(sql`
          INSERT INTO parties (id, company_id, primary_type, is_customer, name)
          VALUES (${kenha}, ${companyA}, 'customer', true, 'KeNHA')`),
      );
      await seedProject({ name: "Otho Road", clientPartyId: customer, clientName: "Kerra" });
      await seedProject({ name: "Bridge", clientPartyId: kenha, clientName: "KeNHA" });

      const byName = await inA((tx) => repo.listProjects(tx, { search: "otho" }));
      expect(byName.projects).toHaveLength(1);
      const byClient = await inA((tx) => repo.listProjects(tx, { search: "kenha" }));
      expect(byClient.projects[0].name).toBe("Bridge");
    });

    it("filters by status", async () => {
      const p = await seedProject({ name: "Running" });
      await seedProject({ name: "Planned" });
      await inA((tx) => repo.setProjectStatus(tx, p.id, "active", actor));

      const active = await inA((tx) => repo.listProjects(tx, { status: "active" }));
      expect(active.projects.map((r) => r.name)).toEqual(["Running"]);
    });

    /*
     * LIVE WORK FIRST. The register ordered by created_at alone, so a job
     * closed two years ago outranked a running one whenever it was created
     * later — and on a tenant with more finished jobs than live ones, that is
     * most of page one. `listProjectsForWorkspace` had floated live projects
     * since it was written; the register did not.
     *
     * Seeded oldest-first so recency ALONE would produce the exact reverse of
     * what is asserted: if the rank is ever dropped, this fails rather than
     * passing by luck.
     */
    it("ranks by status before recency — the newest closed job is not first", async () => {
      const running = await seedProject({ name: "Running" });
      const held = await seedProject({ name: "Held" });
      const done = await seedProject({ name: "Done" });
      const newest = await seedProject({ name: "Newest, and closed" });

      await inA((tx) => repo.setProjectStatus(tx, running.id, "active", actor));
      await inA((tx) => repo.setProjectStatus(tx, held.id, "active", actor));
      await inA((tx) => repo.setProjectStatus(tx, held.id, "on_hold", actor));
      await inA((tx) => repo.setProjectStatus(tx, done.id, "active", actor));
      await inA((tx) => repo.setProjectStatus(tx, done.id, "completed", actor));
      await inA((tx) => repo.setProjectStatus(tx, newest.id, "active", actor));
      await inA((tx) => repo.setProjectStatus(tx, newest.id, "completed", actor));
      await inA((tx) => repo.setProjectStatus(tx, newest.id, "closed", actor));

      const { projects } = await inA((tx) => repo.listProjects(tx));
      expect(projects.map((r) => r.name)).toEqual([
        "Running",
        "Held",
        "Done",
        "Newest, and closed",
      ]);
    });

    it("keeps newest-first WITHIN a status, which is what it always did", async () => {
      const first = await seedProject({ name: "First" });
      const second = await seedProject({ name: "Second" });
      await inA((tx) => repo.setProjectStatus(tx, first.id, "active", actor));
      await inA((tx) => repo.setProjectStatus(tx, second.id, "active", actor));

      const { projects } = await inA((tx) => repo.listProjects(tx));
      expect(projects.map((r) => r.name)).toEqual(["Second", "First"]);
    });
  });
});
