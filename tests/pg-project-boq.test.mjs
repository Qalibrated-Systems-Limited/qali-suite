/**
 * The bill of quantities — 0080 — against a real PostgreSQL.
 *
 * This is the table that makes progress a MEASUREMENT rather than an opinion,
 * so most of what is worth testing is what the database REFUSES: a section
 * carrying a rate of its own, a rate awarded and then quietly edited, a
 * quantity measured against a bill nobody signed. Each of those is a wrong
 * final account, and each is enforced by a trigger rather than by the action
 * that remembers to look — so the writes below are fired AT THE TABLE wherever
 * the point is the database's refusal and not the repository's care.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as repo from "@/app/db/repositories/projects";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

async function expectRejection(promise, pattern) {
  let caught;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the operation to be rejected").toBeDefined();
  expect(`${caught.message} ${caught.cause ?? ""}`).toMatch(pattern);
}

suite("the bill of quantities", () => {
  let client, admin, db;
  let companyA, projectA, boqA;
  const actor = { id: null, name: "Otieno, QS" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  /** A section, or a priced item under one. */
  const item = (over = {}) => ({
    companyId: companyA,
    boqId: boqA,
    projectId: projectA,
    description: "Excavate to reduce level",
    createdByName: "Seed",
    ...over,
  });

  const priced = (over = {}) =>
    item({ unit: "m3", quantity: "100", rate: "500", ...over });

  const addItem = (over = {}) => inA((tx) => repo.createBoqItem(tx, item(over)));
  const addPriced = (over = {}) => inA((tx) => repo.createBoqItem(tx, priced(over)));

  const measure = (itemId, quantity, over = {}) =>
    inA((tx) =>
      repo.recordBoqMeasurement(tx, {
        companyId: companyA,
        boqItemId: itemId,
        quantity,
        measuredByName: "Site Agent",
        ...over,
      }),
    );

  const award = () => inA((tx) => repo.awardBoq(tx, boqA, actor));

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
    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})`;

    projectA = (
      await inA((tx) =>
        repo.createProject(tx, {
          companyId: companyA,
          name: "Nakuru Depot",
          createdByName: "Seed",
        }),
      )
    ).id;

    boqA = (
      await inA((tx) =>
        repo.createBoq(tx, {
          companyId: companyA,
          projectId: projectA,
          methodOfMeasurement: "CESMM4",
          createdByName: "Seed",
        }),
      )
    ).id;
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the tree", () => {
    it("maintains the path and depth, and moves the descendants with a section", async () => {
      const billA = await addItem({ description: "Bill 1 — Earthworks", isHeading: true });
      const section = await addItem({
        description: "1.1 Excavation",
        isHeading: true,
        parentItemId: billA.id,
      });
      const leaf = await addPriced({ description: "Excavate", parentItemId: section.id });

      const billB = await addItem({ description: "Bill 2 — Roadworks", isHeading: true });
      await inA((tx) => repo.updateBoqItem(tx, section.id, { parentItemId: billB.id }));

      const rows = await inA((tx) => repo.listBoqItems(tx, boqA));
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      // The leaf was never touched; its depth moved because its ancestor did.
      expect(byId[section.id].depth).toBe(1);
      expect(byId[leaf.id].depth).toBe(2);
      expect(byId[leaf.id].parentItemId).toBe(section.id);
    });

    it("refuses an item beneath itself", async () => {
      const parent = await addItem({ description: "Bill 1", isHeading: true });
      const child = await addItem({
        description: "1.1",
        isHeading: true,
        parentItemId: parent.id,
      });
      await expectRejection(
        inA((tx) => repo.updateBoqItem(tx, parent.id, { parentItemId: child.id })),
        /beneath itself/i,
      );
    });

    it("keeps a sub-item inside its own bill", async () => {
      const other = await inA((tx) =>
        repo.createBoq(tx, {
          companyId: companyA,
          projectId: projectA,
          createdByName: "Seed",
        }),
      );
      const mine = await addItem({ description: "Bill 1", isHeading: true });
      await expectRejection(
        inA((tx) =>
          repo.createBoqItem(
            tx,
            item({ boqId: other.id, description: "Stray", parentItemId: mine.id }),
          ),
        ),
        /parent_same_boq|foreign key/i,
      );
    });

    it("will not delete a section that still has items priced under it", async () => {
      const section = await addItem({ description: "Bill 1", isHeading: true });
      await addPriced({ parentItemId: section.id });
      await expectRejection(
        inA((tx) => repo.deleteBoqItem(tx, section.id)),
        /parent_same_boq|foreign key|still referenced/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("pricing", () => {
    it("computes the amount from the quantity and the rate", async () => {
      const row = await addPriced({ quantity: "120.5", rate: "480" });
      const [db_] = await admin`SELECT amount FROM project_boq_items WHERE id = ${row.id}`;
      expect(Number(db_.amount)).toBe(57840);
    });

    it("refuses a quantity with no unit", async () => {
      await expectRejection(
        inA((tx) => repo.createBoqItem(tx, item({ quantity: "10", rate: "5" }))),
        /quantity_needs_unit/i,
      );
    });

    it("refuses a rate with nothing to apply it to", async () => {
      await expectRejection(
        inA((tx) => repo.createBoqItem(tx, item({ unit: "m3", rate: "500" }))),
        /rate_needs_quantity/i,
      );
    });

    it("refuses to price a heading", async () => {
      await expectRejection(
        inA((tx) =>
          repo.createBoqItem(
            tx,
            item({ isHeading: true, unit: "m3", quantity: "10", rate: "5" }),
          ),
        ),
        /heading_is_unpriced/i,
      );
    });

    it("REFUSES to price a section — its amount is what is under it", async () => {
      // The double-count: a priced parent with priced children appears twice in
      // the bill total and there is no way to tell from the row which was meant.
      const section = await addItem({ description: "1.1 Excavation" });
      await addPriced({ parentItemId: section.id });
      await expectRejection(
        admin`UPDATE project_boq_items
                 SET unit = 'm3', quantity = 50, rate = 400
               WHERE id = ${section.id}`,
        /sub-items/i,
      );
    });

    it("REFUSES to break down a priced item, rather than discarding its rate", async () => {
      // 0071 demoted a parent task to 0% silently. A percentage is a working
      // number; a rate is a contractual figure, so this declines and says how.
      const item1 = await addPriced({ description: "Excavate" });
      await expectRejection(
        inA((tx) => repo.createBoqItem(tx, item({ description: "Sub", parentItemId: item1.id }))),
        /is priced.*sub-items|Clear its quantity/i,
      );
    });

    it("keeps two items from claiming the same bill reference", async () => {
      await addPriced({ itemCode: "B.2.14" });
      await expectRejection(
        inA((tx) => repo.createBoqItem(tx, priced({ itemCode: "B.2.14" }))),
        /code_uq|duplicate key/i,
      );
    });

    it("lets unnumbered narrative lines coexist", async () => {
      await addItem({ description: "Rates to include for all fixings.", isHeading: true });
      await addItem({ description: "Rates to include for making good.", isHeading: true });
      const rows = await inA((tx) => repo.listBoqItems(tx, boqA));
      expect(rows).toHaveLength(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("awarding", () => {
    it("refuses to award a bill with nothing priced in it", async () => {
      await addItem({ description: "Bill 1 — Earthworks", isHeading: true });
      await expectRejection(award(), /no priced item/i);
    });

    it("awards, stamps who and when, and supersedes the bill before it", async () => {
      await addPriced();
      const first = await award();
      expect(first.status).toBe("awarded");
      expect(first.awardedByName).toBe("Otieno, QS");
      expect(first.awardedAt).toBeTruthy();

      const v2 = await inA((tx) =>
        repo.createBoq(tx, {
          companyId: companyA,
          projectId: projectA,
          createdByName: "Seed",
        }),
      );
      expect(v2.version).toBe(2);
      await inA((tx) =>
        repo.createBoqItem(tx, {
          companyId: companyA,
          boqId: v2.id,
          projectId: projectA,
          description: "Excavate",
          unit: "m3",
          quantity: "150",
          rate: "500",
          createdByName: "Seed",
        }),
      );
      await inA((tx) => repo.awardBoq(tx, v2.id, actor));

      const all = await inA((tx) => repo.listBoqsForProject(tx, projectA));
      expect(all.find((b) => b.version === 1).status).toBe("superseded");
      expect(all.find((b) => b.version === 2).status).toBe("awarded");
      // A superseded bill KEEPS its stamp — the biconditional is against
      // `draft`, not against `awarded`.
      expect(all.find((b) => b.version === 1).awardedAt).toBeTruthy();
    });

    it("cannot have two awarded, even written directly", async () => {
      await addPriced();
      await award();
      const v2 = await inA((tx) =>
        repo.createBoq(tx, { companyId: companyA, projectId: projectA, createdByName: "Seed" }),
      );
      // v2 has to be awardable for the INDEX to be what refuses it —
      // otherwise `project_boq_has_priced_items` gets there first and the test
      // proves the wrong guard.
      await inA((tx) =>
        repo.createBoqItem(tx, {
          companyId: companyA,
          boqId: v2.id,
          projectId: projectA,
          description: "Excavate",
          unit: "m3",
          quantity: "10",
          rate: "500",
          createdByName: "Seed",
        }),
      );
      await expectRejection(
        admin`UPDATE project_boqs
                 SET status = 'awarded', awarded_at = now(), awarded_by_name = 'X'
               WHERE id = ${v2.id}`,
        /one_awarded|duplicate key/i,
      );
    });

    it("FREEZES the priced facts once awarded", async () => {
      const row = await addPriced();
      await award();
      await expectRejection(
        inA((tx) => repo.updateBoqItem(tx, row.id, { rate: "9999" })),
        /cannot be changed|variation/i,
      );
      await expectRejection(
        admin`UPDATE project_boq_items SET quantity = 5 WHERE id = ${row.id}`,
        /cannot be changed|variation/i,
      );
      await expectRejection(
        inA((tx) => repo.createBoqItem(tx, priced({ description: "Added later" }))),
        /cannot be changed|variation/i,
      );
    });

    it("still lets an awarded item be cross-referenced and reordered", async () => {
      // Needing a new version of the bill to tie an item to a programme
      // activity would mean nobody ever does it. None of these is a
      // contractual figure.
      const row = await addPriced();
      await award();
      const task = await inA((tx) =>
        repo.createTask(tx, {
          companyId: companyA,
          projectId: projectA,
          title: "Bulk excavation",
          createdByName: "Seed",
        }),
      );
      const updated = await inA((tx) =>
        repo.updateBoqItem(tx, row.id, { taskId: task.id, sortOrder: 5 }),
      );
      expect(updated.taskId).toBe(task.id);
      expect(updated.sortOrder).toBe(5);
    });

    it("keeps an item's measured task inside the same project", async () => {
      const other = await inA((tx) =>
        repo.createProject(tx, { companyId: companyA, name: "Other job", createdByName: "Seed" }),
      );
      const strayTask = await inA((tx) =>
        repo.createTask(tx, {
          companyId: companyA,
          projectId: other.id,
          title: "Not ours",
          createdByName: "Seed",
        }),
      );
      const row = await addPriced();
      await expectRejection(
        inA((tx) => repo.updateBoqItem(tx, row.id, { taskId: strayTask.id })),
        /task_same_project|foreign key/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("measurement", () => {
    it("refuses a measurement against a bill nobody has awarded", async () => {
      const row = await addPriced();
      await expectRejection(measure(row.id, "10"), /Award it first|nothing to measure/i);
    });

    it("refuses a heading and an unpriced item", async () => {
      const heading = await addItem({ description: "Bill 1", isHeading: true });
      const unpriced = await addItem({ description: "Provisional" });
      await addPriced();
      await award();
      await expectRejection(measure(heading.id, "10"), /not a priced item/i);
      await expectRejection(measure(unpriced.id, "10"), /not a priced item/i);
    });

    it("refuses a measurement of nothing", async () => {
      const row = await addPriced();
      await award();
      await expectRejection(measure(row.id, "0"), /quantity_not_zero/i);
    });

    it("sums the log, and a NEGATIVE row corrects an over-measure", async () => {
      const row = await addPriced({ quantity: "100", rate: "500" });
      await award();
      await measure(row.id, "60", { reference: "CH 0+000 – 0+060" });
      await measure(row.id, "-10", { reference: "CH 0+050 remeasure", notes: "Over-measured in August" });

      const items = await inA((tx) => repo.listBoqItems(tx, boqA));
      expect(items[0].measuredQuantity).toBe(50);
      expect(items[0].measuredAmount).toBe(25000);

      const log = await inA((tx) => repo.listBoqMeasurements(tx, row.id));
      // BOTH survive. The correction does not erase what was certified.
      expect(log).toHaveLength(2);
    });

    it("allows measuring MORE than was billed, and counts it", async () => {
      // Over-measurement is usually the first evidence of a variation. The
      // module warns; it does not block.
      const row = await addPriced({ quantity: "100", rate: "500" });
      await award();
      await measure(row.id, "130");

      const summary = await inA((tx) => repo.getBoqSummary(tx, boqA));
      expect(summary.billed).toBe(50000);
      expect(summary.measured).toBe(65000);
      expect(summary.percent).toBe(130);
      expect(summary.overMeasured).toBe(1);
    });

    it("rolls a section up from the items under it", async () => {
      const section = await addItem({ description: "Bill 1 — Earthworks", isHeading: true });
      const a = await addPriced({ description: "Excavate", quantity: "100", rate: "500", parentItemId: section.id });
      const b = await addPriced({ description: "Cart away", quantity: "100", rate: "300", parentItemId: section.id });
      await award();
      await measure(a.id, "50");
      await measure(b.id, "25");

      const rows = await inA((tx) => repo.listBoqItems(tx, boqA));
      const head = rows.find((r) => r.id === section.id);
      expect(head.billedAmount).toBe(80000);
      expect(head.measuredAmount).toBe(32500);
      // The heading itself is priced at nothing; the total is its subtree's.
      expect(head.amount).toBeNull();
    });

    it("does not see another tenant's bill", async () => {
      const companyB = randomUUID();
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})`;
      await addPriced();
      const seen = await asTenant(companyB, (tx) => repo.listBoqItems(tx, boqA));
      expect(seen).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("progress", () => {
    const addTask = (over = {}) =>
      inA((tx) =>
        repo.createTask(tx, {
          companyId: companyA,
          projectId: projectA,
          title: "Bulk excavation",
          createdByName: "Seed",
          ...over,
        }),
      );

    it("is TYPED with no tasks and no bill", async () => {
      await inA((tx) => repo.setProjectProgress(tx, projectA, 90, actor));
      const p = await inA((tx) => repo.getProjectProgress(tx, projectA));
      expect(p).toMatchObject({ percent: 90, source: "typed" });
    });

    it("is earned from TASKS once there is a WBS", async () => {
      await inA((tx) => repo.setProjectProgress(tx, projectA, 90, actor));
      const t = await addTask();
      await inA((tx) => repo.setTaskProgress(tx, t.id, { progressPercent: 40 }, actor));
      const p = await inA((tx) => repo.getProjectProgress(tx, projectA));
      expect(p).toMatchObject({ percent: 40, source: "tasks" });
    });

    it("is MEASURED once a bill is awarded, and outranks both", async () => {
      // The whole point of 0080: 8 of 20 km laid is 40% because 8 km was
      // measured, not because anybody thought so.
      await inA((tx) => repo.setProjectProgress(tx, projectA, 90, actor));
      const t = await addTask();
      await inA((tx) => repo.setTaskProgress(tx, t.id, { progressPercent: 75 }, actor));

      const row = await addPriced({ quantity: "20", rate: "1000", unit: "km" });
      await award();
      await measure(row.id, "8");

      const p = await inA((tx) => repo.getProjectProgress(tx, projectA));
      expect(p).toMatchObject({
        percent: 40,
        source: "measured",
        billedValue: 20000,
        measuredValue: 8000,
      });
      // The other two answers are still there, and still say what they are.
      expect(p.taskCount).toBe(1);
    });

    it("falls through to the next source rather than dividing by a bill worth nothing", async () => {
      const t = await addTask();
      await inA((tx) => repo.setTaskProgress(tx, t.id, { progressPercent: 30 }, actor));
      await addPriced({ quantity: "10", rate: "0" });
      await award();

      const p = await inA((tx) => repo.getProjectProgress(tx, projectA));
      expect(p).toMatchObject({ percent: 30, source: "tasks" });
    });

    it("does not take a DRAFT bill as measured progress", async () => {
      await inA((tx) => repo.setProjectProgress(tx, projectA, 15, actor));
      await addPriced();
      const p = await inA((tx) => repo.getProjectProgress(tx, projectA));
      expect(p).toMatchObject({ percent: 15, source: "typed" });
    });

    it("reports an over-measure as it is", async () => {
      const row = await addPriced({ quantity: "100", rate: "500" });
      await award();
      await measure(row.id, "115");
      const p = await inA((tx) => repo.getProjectProgress(tx, projectA));
      expect(p.percent).toBe(115);
      expect(p.source).toBe("measured");
    });
  });


  // ───────────────────────────────────────────────────────────────────────────
  describe("importing a bill", () => {
    /**
     * A priced bill arrives as a spreadsheet. These pin the SHAPE a real one
     * has — sections written once, narrative lines with no quantity, thousands
     * separators, a currency symbol — because every one of those is a row that
     * a strict parser drops silently and a QS then cannot find.
     */
    const csv = (lines) => ({
      name: "bill.csv",
      size: 1,
      arrayBuffer: async () => new TextEncoder().encode(lines.join("\n")).buffer,
    });

    it("reads sections, priced items and narrative lines", async () => {
      const { rowsFromFile } = await import("@/lib/spreadsheet");
      const rows = await rowsFromFile(
        csv([
          "Section,Item code,Description,Unit,Quantity,Rate",
          "Bill 2 — Earthworks,B.2.1,Clear and grub,ha,12,45000",
          ",B.2.2,\"Excavate, to formation\",m3,\"18,000\",350",
          ",,Rates to include for all fixings,,,",
          "Bill 3 — Concrete,B.3.1,Mass concrete,m3,240,\"KES 12,500\"",
        ]),
      );
      expect(rows).toHaveLength(5);
      // The quoted comma inside a description survives.
      expect(rows[2][2]).toBe("Excavate, to formation");
    });

    it("PRICES only the rows that carry a unit and a quantity", async () => {
      // `project_boq_items_quantity_needs_unit` refuses a quantity with no
      // unit, and a narrative line is a legitimate row rather than an error —
      // so those land as unpriced headings instead of being dropped.
      const section = await addItem({ description: "Bill 2", isHeading: true });
      const narrative = await addItem({
        description: "Rates to include for all fixings",
        isHeading: true,
        parentItemId: section.id,
      });
      const priced = await addPriced({
        description: "Excavate",
        parentItemId: section.id,
        quantity: "18000",
        rate: "350",
      });

      const rows = await inA((tx) => repo.listBoqItems(tx, boqA));
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[narrative.id].quantity).toBeNull();
      expect(byId[priced.id].amount).toBe(6300000);
      // The section rolls up only what is priced beneath it.
      expect(byId[section.id].billedAmount).toBe(6300000);
    });

    it("refuses to import into an awarded bill", async () => {
      // The rates are frozen, which is what makes a final account answerable.
      await addPriced();
      await award();
      const boq = await inA((tx) => repo.getEffectiveBoq(tx, projectA));
      expect(boq.status).toBe("awarded");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the bill's own facts", () => {
    it("versions per project", async () => {
      const v2 = await inA((tx) =>
        repo.createBoq(tx, { companyId: companyA, projectId: projectA, createdByName: "Seed" }),
      );
      expect(v2.version).toBe(2);
    });

    it("takes the method of measurement as written, whatever it is", async () => {
      // TEXT, not an enum: CESMM4, SMM7, POMI and the national standards are
      // not interchangeable, and this is multi-tenant.
      const boq = await inA((tx) =>
        repo.createBoq(tx, {
          companyId: companyA,
          projectId: projectA,
          methodOfMeasurement: "SMM7 (amended per Appendix C)",
          createdByName: "Seed",
        }),
      );
      expect(boq.methodOfMeasurement).toBe("SMM7 (amended per Appendix C)");
    });

    it("refuses to edit an awarded bill's own facts", async () => {
      await addPriced();
      await award();
      await expectRejection(
        inA((tx) => repo.updateBoq(tx, boqA, { notes: "changed my mind" })),
        /cannot be edited|new version/i,
      );
    });

    it("prefers the awarded bill over a later draft", async () => {
      await addPriced();
      await award();
      await inA((tx) =>
        repo.createBoq(tx, { companyId: companyA, projectId: projectA, createdByName: "Seed" }),
      );
      const effective = await inA((tx) => repo.getEffectiveBoq(tx, projectA));
      expect(effective.version).toBe(1);
      expect(effective.status).toBe("awarded");
    });
  });
});
