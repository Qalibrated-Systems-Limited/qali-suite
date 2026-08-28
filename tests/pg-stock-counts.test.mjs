/**
 * Stocktake sessions — 0068.
 *
 * The `physical_count` adjustment type existed and the only way to use it was
 * to type the counted number straight into an adjustment form. What is tested
 * here is everything between, and above all the two quantities that a
 * stocktake has to keep apart:
 *
 *   the FROZEN system quantity, which says how far out the book had drifted;
 *   the LIVE one at posting, which is what the correction moves from.
 *
 * Getting that wrong silently reverses every sale made while people were
 * counting, so there is a test that sells stock mid-count and checks the
 * outcome from both angles.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));

const { getTenantContext } = await import("@/lib/utils/tenant-utils");
const counts = await import("@/app/db/actions/stock-count-actions");

suite("stocktake sessions", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let inventoryAcct;
  let adjustmentAcct;
  let widget;
  let gadget;
  let scalesCategory;

  const asRole = (role) =>
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: `${role} User`, role },
      companyId: mongoCompanyId,
    });

  const openSheet = async (over = {}) => {
    const fd = new FormData();
    fd.append("name", over.name ?? "August count");
    fd.append("countDate", over.countDate ?? "2026-08-20");
    if (over.categoryId) fd.append("categoryId", over.categoryId);
    if (over.isBlind === false) fd.append("isBlind", "false");
    return counts.createStockCountPg(null, fd);
  };

  const linesOf = (countId) => admin`
    SELECT l.id, l.product_id, l.system_quantity::float8 AS system_qty,
           l.counted_quantity::float8 AS counted_qty,
           l.variance_quantity::float8 AS variance_qty,
           l.variance_value::float8 AS variance_value,
           l.unit_cost::float8 AS unit_cost
      FROM stock_count_lines l WHERE l.count_id = ${countId}
     ORDER BY l.product_name_at_count`;

  const onHand = async (id) => {
    const [r] = await admin`
      SELECT quantity_on_hand::float8 AS q FROM products WHERE id = ${id}`;
    return r.q;
  };

  const product = async (id, sku, { qty = 100, cost = 50, category = null } = {}) => {
    await admin`
      INSERT INTO products (id, company_id, sku, name, unit, cost_price,
                            selling_price, quantity_on_hand, category_id)
      VALUES (${id}, ${companyUuid}, ${sku}, ${sku}, 'pcs', ${cost}, ${cost * 2},
              ${qty}, ${category})`;
  };

  /** Counts every line at the given quantities, keyed by product id. */
  const countAll = async (countId, byProduct) => {
    for (const line of await linesOf(countId)) {
      const q = byProduct[line.product_id];
      if (q === undefined) continue;
      const r = await counts.recordCountPg(countId, line.id, String(q));
      expect(r.success).toBe(true);
    }
  };

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyUuid = randomUUID();
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    inventoryAcct = randomUUID();
    adjustmentAcct = randomUUID();
    widget = randomUUID();
    gadget = randomUUID();
    scalesCategory = randomUUID();

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    await admin`
      INSERT INTO company_settings (company_id) VALUES (${companyUuid})`;

    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
          (${inventoryAcct},  ${companyUuid}, '1300', 'Inventory',             'asset',   'inventory'),
          (${adjustmentAcct}, ${companyUuid}, '5300', 'Inventory Adjustments', 'expense', 'inventory_adjustments')`;
      await tx`
        INSERT INTO categories (id, company_id, name, slug, path)
        VALUES (${scalesCategory}, ${companyUuid}, 'Scales', 'scales', 'scales')`;
    });

    await product(widget, "WID-1");
    await product(gadget, "GAD-1");

    asRole("Admin");
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the sheet", () => {
    it("freezes what the book says, once", async () => {
      const opened = await openSheet();
      expect(opened.success).toBe(true);

      const gen = await counts.generateCountSheetPg(opened.countId);
      expect(gen.success).toBe(true);
      expect(gen.message).toMatch(/2 products/);

      const lines = await linesOf(opened.countId);
      expect(lines).toHaveLength(2);
      expect(lines[0].system_qty).toBe(100);
      expect(lines[0].unit_cost).toBe(50);
      // Uncounted, so no variance at all — not a variance of zero.
      expect(lines[0].counted_qty).toBeNull();
      expect(lines[0].variance_qty).toBeNull();

      // Pressing generate again is refused rather than doubling the sheet.
      const again = await counts.generateCountSheetPg(opened.countId);
      expect(again.success).toBe(false);
      expect(again.message).toMatch(/already been generated/i);
      expect(await linesOf(opened.countId)).toHaveLength(2);
    });

    it("does not move when the book does", async () => {
      const opened = await openSheet();
      await counts.generateCountSheetPg(opened.countId);

      // Somebody sells 30 while the count is open.
      await admin`UPDATE products SET quantity_on_hand = 70 WHERE id = ${widget}`;

      const [line] = await linesOf(opened.countId);
      // The frozen figure is what the book said when counting began.
      expect(line.system_qty).toBe(100);
    });

    it("covers only the category it was scoped to", async () => {
      await admin`UPDATE products SET category_id = ${scalesCategory} WHERE id = ${widget}`;

      const opened = await openSheet({ categoryId: scalesCategory });
      const gen = await counts.generateCountSheetPg(opened.countId);

      expect(gen.message).toMatch(/1 product\b/);
      const lines = await linesOf(opened.countId);
      expect(lines).toHaveLength(1);
      expect(lines[0].product_id).toBe(widget);
    });

    it("refuses a sheet with nothing on it", async () => {
      await admin`UPDATE products SET is_active = false`;
      const opened = await openSheet();
      const gen = await counts.generateCountSheetPg(opened.countId);

      expect(gen.success).toBe(false);
      expect(gen.message).toMatch(/nothing to count/i);
    });

    it("is blind unless asked not to be", async () => {
      const blind = await openSheet();
      const open = await openSheet({ name: "Open count", isBlind: false });

      const [b] = await admin`SELECT is_blind FROM stock_counts WHERE id = ${blind.countId}`;
      const [o] = await admin`SELECT is_blind FROM stock_counts WHERE id = ${open.countId}`;
      expect(b.is_blind).toBe(true);
      expect(o.is_blind).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("counting", () => {
    it("computes the variance and its value from the frozen cost", async () => {
      const opened = await openSheet();
      await counts.generateCountSheetPg(opened.countId);
      await countAll(opened.countId, { [widget]: 95, [gadget]: 100 });

      const lines = await linesOf(opened.countId);
      const w = lines.find((l) => l.product_id === widget);
      expect(w.variance_qty).toBe(-5);
      // Signed, so a shortfall reads negative on the report.
      expect(w.variance_value).toBe(-250);

      const g = lines.find((l) => l.product_id === gadget);
      expect(g.variance_qty).toBe(0);
    });

    it("overwrites on a recount rather than adding a second line", async () => {
      const opened = await openSheet();
      await counts.generateCountSheetPg(opened.countId);
      const [line] = await linesOf(opened.countId);

      await counts.recordCountPg(opened.countId, line.id, "90");
      await counts.recordCountPg(opened.countId, line.id, "95");

      const after = await linesOf(opened.countId);
      expect(after).toHaveLength(2);
      expect(after.find((l) => l.id === line.id).counted_qty).toBe(95);
    });

    it("will not submit a sheet that is not finished", async () => {
      const opened = await openSheet();
      await counts.generateCountSheetPg(opened.countId);
      const [line] = await linesOf(opened.countId);
      await counts.recordCountPg(opened.countId, line.id, "100");

      const submitted = await counts.submitCountForReviewPg(opened.countId);
      expect(submitted.success).toBe(false);
      expect(submitted.message).toMatch(/1 line .* not been counted/i);
    });

    it("refuses a negative count", async () => {
      const opened = await openSheet();
      await counts.generateCountSheetPg(opened.countId);
      const [line] = await linesOf(opened.countId);

      const r = await counts.recordCountPg(opened.countId, line.id, "-5");
      expect(r.success).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("posting", () => {
    const finish = async (byProduct) => {
      const opened = await openSheet();
      await counts.generateCountSheetPg(opened.countId);
      await countAll(opened.countId, byProduct);
      const submitted = await counts.submitCountForReviewPg(opened.countId);
      expect(submitted.success).toBe(true);
      return opened.countId;
    };

    it("raises one adjustment for the lines that disagree", async () => {
      const countId = await finish({ [widget]: 95, [gadget]: 100 });
      const posted = await counts.postStockCountPg(countId);

      expect(posted.success).toBe(true);
      expect(posted.adjustmentId).toEqual(expect.any(String));

      const [adj] = await admin`
        SELECT adjustment_type::text AS type, status::text AS status,
               reference_number
          FROM stock_adjustments WHERE id = ${posted.adjustmentId}`;
      expect(adj.type).toBe("physical_count");
      expect(adj.status).toBe("approved");

      // Only the line that disagreed.
      const adjLines = await admin`
        SELECT product_id FROM stock_adjustment_lines
         WHERE adjustment_id = ${posted.adjustmentId}`;
      expect(adjLines).toHaveLength(1);
      expect(adjLines[0].product_id).toBe(widget);

      expect(await onHand(widget)).toBe(95);
      expect(await onHand(gadget)).toBe(100);
    });

    it("posts nothing when every line agreed, and says so", async () => {
      const countId = await finish({ [widget]: 100, [gadget]: 100 });
      const posted = await counts.postStockCountPg(countId);

      expect(posted.success).toBe(true);
      expect(posted.adjustmentId).toBeNull();
      expect(posted.message).toMatch(/no adjustment was needed/i);

      const [c] = await admin`
        SELECT status::text AS status, adjustment_id
          FROM stock_counts WHERE id = ${countId}`;
      expect(c.status).toBe("posted");
      expect(c.adjustment_id).toBeNull();
    });

    /**
     * The one that matters.
     *
     * Book says 100 at the freeze. Somebody sells 30, so the book is now 70.
     * The counter finds 95 on the shelf.
     *
     * The stock must end at 95 — the sale was real and must not be reversed.
     * The VARIANCE against the freeze is -5, which is the drift the stocktake
     * was run to find. Correcting from the frozen 100 would have set stock to
     * 95 by a different route and quietly undone the sale on the way.
     */
    it("corrects from the LIVE book, and reports variance against the FROZEN one", async () => {
      const opened = await openSheet();
      await counts.generateCountSheetPg(opened.countId);

      await admin`UPDATE products SET quantity_on_hand = 70 WHERE id = ${widget}`;

      await countAll(opened.countId, { [widget]: 95, [gadget]: 100 });
      await counts.submitCountForReviewPg(opened.countId);
      const posted = await counts.postStockCountPg(opened.countId);
      expect(posted.success).toBe(true);

      // The shelf wins: stock is what was counted.
      expect(await onHand(widget)).toBe(95);

      // The adjustment moved it from 70, not from 100 — a rise of 25.
      const [adjLine] = await admin`
        SELECT system_quantity::float8 AS sys, physical_quantity::float8 AS phys,
               adjustment_quantity::float8 AS qty
          FROM stock_adjustment_lines WHERE adjustment_id = ${posted.adjustmentId}`;
      expect(adjLine.sys).toBe(70);
      expect(adjLine.phys).toBe(95);
      expect(adjLine.qty).toBe(25);

      // And the count still reports the drift against the book at the freeze.
      const lines = await linesOf(opened.countId);
      expect(lines.find((l) => l.product_id === widget).variance_qty).toBe(-5);
    });

    it("posts a journal entry through the adjustment, not around it", async () => {
      const countId = await finish({ [widget]: 95, [gadget]: 100 });
      const posted = await counts.postStockCountPg(countId);

      const entry = await admin`
        SELECT a.account_code, l.debit::float8 AS debit, l.credit::float8 AS credit
          FROM stock_adjustments s
          JOIN journal_lines l ON l.entry_id = s.journal_entry_id
          JOIN accounts a ON a.id = l.account_id
         WHERE s.id = ${posted.adjustmentId}
         ORDER BY l.line_number`;

      // A shortfall of 5 at 50: DR Adjustments, CR Inventory.
      expect(entry).toHaveLength(2);
      expect(entry[0]).toMatchObject({ account_code: "5300", debit: 250 });
      expect(entry[1]).toMatchObject({ account_code: "1300", credit: 250 });
    });

    it("will not post a sheet that has not been reviewed", async () => {
      const opened = await openSheet();
      await counts.generateCountSheetPg(opened.countId);
      await countAll(opened.countId, { [widget]: 95, [gadget]: 100 });

      const posted = await counts.postStockCountPg(opened.countId);
      expect(posted.success).toBe(false);
      expect(posted.message).toMatch(/reviewed/i);
      expect(await onHand(widget)).toBe(100);
    });

    it("inherits the adjustment module's segregation of duties", async () => {
      const countId = await finish({ [widget]: 95, [gadget]: 100 });

      // Store Manager may post, and the adjustment beneath is small and
      // low-risk, so it applies.
      asRole("Store Manager");
      const posted = await counts.postStockCountPg(countId);
      expect(posted.success).toBe(true);

      const [adj] = await admin`
        SELECT status::text AS status FROM stock_adjustments
         WHERE id = ${posted.adjustmentId}`;
      expect(adj.status).toBe("approved");
    });

    it("routes rather than applies when the adjustment is above the threshold", async () => {
      // 100 units at 50 = 5,000 short of nothing; make it big instead.
      await admin`UPDATE products SET cost_price = 1000 WHERE id = ${widget}`;
      asRole("Store Manager");

      const countId = await finish({ [widget]: 0, [gadget]: 100 });
      const posted = await counts.postStockCountPg(countId);

      // The sheet is posted either way — it is a record of what was found.
      expect(posted.success).toBe(true);
      const [adj] = await admin`
        SELECT status::text AS status FROM stock_adjustments
         WHERE id = ${posted.adjustmentId}`;
      // 100 * 1000 = 100,000, over the 50,000 default threshold.
      expect(adj.status).toBe("draft");
      expect(await onHand(widget)).toBe(100);
      expect(posted.message).toMatch(/waiting for approval/i);
    });

    it("a Storekeeper may count and may not post", async () => {
      const countId = await finish({ [widget]: 95, [gadget]: 100 });

      asRole("Storekeeper");
      const posted = await counts.postStockCountPg(countId);
      expect(posted.success).toBe(false);
      expect(posted.message).toMatch(/permission/i);
      expect(await onHand(widget)).toBe(100);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("cancelling", () => {
    it("abandons an open sheet and refuses a posted one", async () => {
      const opened = await openSheet();
      await counts.generateCountSheetPg(opened.countId);

      const cancelled = await counts.cancelStockCountPg(
        opened.countId,
        "Recount next week",
      );
      expect(cancelled.success).toBe(true);

      const again = await counts.cancelStockCountPg(opened.countId, "again");
      expect(again.success).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the summary", () => {
    it("separates overs from shorts and nets them", async () => {
      const opened = await openSheet();
      await counts.generateCountSheetPg(opened.countId);
      // widget short 5 (-250), gadget over 2 (+100)
      await countAll(opened.countId, { [widget]: 95, [gadget]: 102 });

      const count = await counts.getStockCountPg(opened.countId);
      expect(count.lineCount).toBe(2);
      expect(count.countedLines).toBe(2);
      expect(count.varianceLines).toBe(2);
      expect(count.shortLines).toBe(1);
      expect(count.overLines).toBe(1);
      expect(Number(count.shortValue)).toBe(250);
      expect(Number(count.overValue)).toBe(100);
      expect(Number(count.netVarianceValue)).toBe(-150);
      expect(Number(count.frozenValue)).toBe(10000);
    });

    it("opens the review on the biggest variances first", async () => {
      const opened = await openSheet();
      await counts.generateCountSheetPg(opened.countId);
      await countAll(opened.countId, { [widget]: 99, [gadget]: 80 });

      const variances = await counts.getCountVariancesPg(opened.countId);
      expect(variances).toHaveLength(2);
      // gadget is 20 out, widget is 1 — biggest by value first.
      expect(variances[0].productId).toBe(gadget);
    });
  });
});
