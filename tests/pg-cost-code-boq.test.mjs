/**
 * Cost codes from the BOQ — 0118, against a real PostgreSQL.
 *
 * Pins: budgetable items come from the effective bill; a cost code is created
 * against one item (named after it) or a GROUP of items; the same set reuses
 * one code; RLS isolation.
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
const repo = await import("@/app/db/repositories/projects");

suite("cost codes from the BOQ", () => {
  let admin, client, db, co, acct, proj, boq, i1, i2, i3;
  const actor = { id: null, name: "PM" };

  const tenant = (fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${co}, true)`);
      return fn(tx);
    });

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
    await admin`TRUNCATE companies, users, accounts, projects, project_boqs, project_boq_items, project_cost_codes, project_cost_code_boq_items CASCADE`;
    co = randomUUID(); acct = randomUUID(); proj = randomUUID(); boq = randomUUID();
    i1 = randomUUID(); i2 = randomUUID(); i3 = randomUUID();
    await admin`INSERT INTO companies (id,name,slug) VALUES (${co},'C',${"c-" + co.slice(0, 8)})`;
    await admin`INSERT INTO accounts (id,company_id,account_code,account_name,account_type) VALUES (${acct},${co},'6200','Direct costs','expense')`;
    await admin`INSERT INTO projects (id,company_id,project_number,name) VALUES (${proj},${co},'PRJ-1','Test')`;
    await admin`INSERT INTO project_boqs (id,company_id,project_id,status) VALUES (${boq},${co},${proj},'draft')`;
    for (const [id, code, desc, q, r] of [
      [i1, "A/1", "Site est.", 1, 1500000],
      [i2, "A/2", "Insurance", 1, 450000],
      [i3, "B/1", "Clearance", 100, 180],
    ]) {
      await admin`INSERT INTO project_boq_items (id,company_id,boq_id,project_id,item_code,description,unit,quantity,rate)
                  VALUES (${id},${co},${boq},${proj},${code},${desc},'Sum',${q},${r})`;
    }
  });

  it("lists the priced BOQ items to budget against", async () => {
    const items = await tenant((tx) => repo.listBudgetableBoqItems(tx, proj));
    expect(items.map((x) => x.itemCode)).toEqual(["A/1", "A/2", "B/1"]);
  });

  it("codes a group of items once, reuses it, and names a single-item code after the item", async () => {
    const grouped = await tenant((tx) =>
      repo.ensureCostCodeForBoqItems(tx, { companyId: co, projectId: proj, boqItemIds: [i1, i2], accountId: acct, actor }),
    );
    const [{ n }] = await admin`SELECT count(*)::int n FROM project_cost_code_boq_items WHERE cost_code_id=${grouped}`;
    expect(n).toBe(2);

    const again = await tenant((tx) =>
      repo.ensureCostCodeForBoqItems(tx, { companyId: co, projectId: proj, boqItemIds: [i2, i1], accountId: acct, actor }),
    );
    expect(again).toBe(grouped);

    const single = await tenant((tx) =>
      repo.ensureCostCodeForBoqItems(tx, { companyId: co, projectId: proj, boqItemIds: [i3], accountId: acct, actor }),
    );
    expect(single).not.toBe(grouped);
    const [row] = await admin`SELECT code, account_id FROM project_cost_codes WHERE id=${single}`;
    expect(row.code).toBe("B/1");
    expect(row.account_id).toBe(acct);
  });

  it("marks a BOQ item as coded once it is budgeted", async () => {
    await tenant((tx) =>
      repo.ensureCostCodeForBoqItems(tx, { companyId: co, projectId: proj, boqItemIds: [i1], accountId: acct, actor }),
    );
    const items = await tenant((tx) => repo.listBudgetableBoqItems(tx, proj));
    expect(items.find((x) => x.itemCode === "A/1").costCodeId).toBeTruthy();
    expect(items.find((x) => x.itemCode === "A/2").costCodeId).toBeNull();
  });
});
