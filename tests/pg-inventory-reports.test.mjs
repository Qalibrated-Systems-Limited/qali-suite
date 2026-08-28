/**
 * The stock valuation report and the movements ledger, on Postgres.
 *
 * Both were the last Mongo reads in inventory: the valuation report priced a
 * collection nothing has written since products moved, and the movements
 * screens browsed an empty history of stock that had demonstrably moved.
 *
 * What is asserted beyond the translation:
 *
 *   - `averageMargin` is profit over RETAIL. The Mongo version divided by
 *     COST, which is markup, on a card that says "% margin".
 *   - the ledger's role scope is enforced in the QUERY, not passed in by the
 *     page — the old signature took userId/userRole as arguments, so a caller
 *     that passed neither saw everything.
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
const products = await import("@/app/db/actions/product-actions");
const movements = await import("@/app/db/actions/stock-movement-actions");

suite("inventory reporting", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let widget;
  let gadget;
  let storekeeperId;

  const asRole = (role, id) =>
    getTenantContext.mockResolvedValue({
      user: { id: id ?? randomUUID(), name: `${role} User`, role },
      companyId: mongoCompanyId,
    });

  const product = async (id, sku, { onHand, cost, selling, category = null }) => {
    await admin`
      INSERT INTO products (id, company_id, sku, name, unit, cost_price,
                            selling_price, quantity_on_hand, category)
      VALUES (${id}, ${companyUuid}, ${sku}, ${sku}, 'pcs', ${cost},
              ${selling}, ${onHand}, ${category})`;
  };

  const movement = async ({ product: productId, direction, qty, cost, by, byName }) => {
    await admin`
      INSERT INTO stock_movements
        (company_id, movement_number, product_id, product_sku_at_movement,
         product_name_at_movement, movement_type, direction, quantity,
         previous_stock, new_stock, unit_cost, total_cost,
         performed_by_id, performed_by_name_at_movement)
      VALUES (${companyUuid}, ${"SM-" + randomUUID().slice(0, 8)}, ${productId},
              'SKU', 'Name', 'adjustment', ${direction}, ${qty},
              ${direction === "in" ? 0 : qty}, ${direction === "in" ? qty : 0},
              ${cost}, ${qty * cost}, ${by ?? null}, ${byName ?? null})`;
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
    widget = randomUUID();
    gadget = randomUUID();
    storekeeperId = randomUUID();

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    await admin`
      INSERT INTO company_settings (company_id) VALUES (${companyUuid})`;

    asRole("Admin");
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("stock valuation", () => {
    it("values stock at cost and at retail, and groups by category", async () => {
      // 10 at 100 cost / 150 retail, and 5 at 200 / 260.
      await product(widget, "WID-1", {
        onHand: 10, cost: 100, selling: 150, category: "Scales",
      });
      await product(gadget, "GAD-1", {
        onHand: 5, cost: 200, selling: 260, category: "Scales",
      });

      const r = await products.getStockValuationReportPg();

      expect(r.summary.totalInventoryValue).toBe(2000); // 1000 + 1000
      expect(r.summary.totalRetailValue).toBe(2800);    // 1500 + 1300
      expect(r.summary.totalPotentialProfit).toBe(800);
      expect(r.summary.totalProducts).toBe(2);
      expect(r.summary.productsWithStock).toBe(2);

      expect(r.categories).toHaveLength(1);
      expect(r.categories[0]).toMatchObject({
        category: "Scales",
        totalQuantity: 15,
        totalInventoryValue: 2000,
        totalRetailValue: 2800,
      });
      expect(r.categories[0].items).toHaveLength(2);
    });

    it("reports margin over RETAIL, not markup over cost", async () => {
      // Cost 100, sells for 150. Margin is 50/150 = 33.33%.
      // The Mongo version computed 50/100 = 50% and called it margin.
      await product(widget, "WID-1", { onHand: 1, cost: 100, selling: 150 });

      const r = await products.getStockValuationReportPg();
      expect(r.summary.averageMargin).toBeCloseTo(33.333, 2);
    });

    it("counts products with no stock without valuing them", async () => {
      await product(widget, "WID-1", { onHand: 0, cost: 100, selling: 150 });
      await product(gadget, "GAD-1", { onHand: 2, cost: 50, selling: 80 });

      const r = await products.getStockValuationReportPg();
      expect(r.summary.productsOutOfStock).toBe(1);
      expect(r.summary.productsWithStock).toBe(1);
      expect(r.summary.totalInventoryValue).toBe(100);
    });

    it("falls back to the category snapshot, then to Uncategorized", async () => {
      // 0062 made `category` a text snapshot and `category_id` the reference.
      // A product filed before the tree existed has the text and no id, and
      // the Mongo populate() on an ObjectId field reported it as uncategorised.
      await product(widget, "WID-1", {
        onHand: 1, cost: 10, selling: 20, category: "Legacy Bucket",
      });
      await product(gadget, "GAD-1", { onHand: 1, cost: 10, selling: 20 });

      const r = await products.getStockValuationReportPg();
      const names = r.categories.map((c) => c.category).sort();
      expect(names).toEqual(["Legacy Bucket", "Uncategorized"]);
    });

    it("has no opinion when there is nothing to value", async () => {
      const r = await products.getStockValuationReportPg();
      expect(r.summary.totalInventoryValue).toBe(0);
      expect(r.summary.averageMargin).toBe(0);
      expect(r.categories).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the movements ledger", () => {
    beforeEach(async () => {
      await product(widget, "WID-1", { onHand: 100, cost: 50, selling: 90 });
      await product(gadget, "GAD-1", { onHand: 100, cost: 50, selling: 90 });
      await admin`
        INSERT INTO users (id, name, email)
        VALUES (${storekeeperId}, 'Sam Store', ${"sam" + storekeeperId.slice(0, 6) + "@x.io"})`;
    });

    it("shapes a movement the way the table reads it", async () => {
      await movement({
        product: widget, direction: "in", qty: 10, cost: 50,
        by: storekeeperId, byName: "Sam Store",
      });

      const [row] = await movements.searchMovementsPg();
      // The nested snapshots, not flat columns — movementTable.jsx reads these.
      expect(row.productSnapshot.SKU).toBe("SKU");
      expect(row.performedBy.name).toBe("Sam Store");
      expect(row.costing.totalCost).toBe(500);
      expect(row.direction).toBe("in");
      expect(row.quantity).toBe(10);
    });

    it("totals value in and out, and nets them", async () => {
      await movement({ product: widget, direction: "in", qty: 10, cost: 50 });
      await movement({ product: gadget, direction: "out", qty: 4, cost: 50 });

      const stats = await movements.getMovementStatsPg();
      expect(stats.totalMovements).toBe(2);
      expect(stats.totalIn).toBe(1);
      expect(stats.totalOut).toBe(1);
      expect(stats.totalValueIn).toBe(500);
      expect(stats.totalValueOut).toBe(200);
      expect(stats.netValue).toBe(300);
      expect(stats.netQuantity).toBe(6);
    });

    it("filters by direction and by type", async () => {
      await movement({ product: widget, direction: "in", qty: 10, cost: 50 });
      await movement({ product: gadget, direction: "out", qty: 4, cost: 50 });

      expect(await movements.searchMovementsPg({ direction: "in" })).toHaveLength(1);
      // "all" is the UI's no-filter value and must not filter.
      expect(await movements.searchMovementsPg({ direction: "all" })).toHaveLength(2);
    });

    it("searches the snapshots, and ignores a one-character term", async () => {
      await movement({
        product: widget, direction: "in", qty: 1, cost: 50,
        by: storekeeperId, byName: "Sam Store",
      });
      await movement({ product: gadget, direction: "out", qty: 1, cost: 50 });

      expect(await movements.searchMovementsPg({ search: "Sam" })).toHaveLength(1);
      // Under two characters the term is not applied — as in Mongo, where it
      // guarded a six-field regex scan.
      expect(await movements.searchMovementsPg({ search: "S" })).toHaveLength(2);
    });

    it("shows a technician only the movements they performed", async () => {
      await movement({
        product: widget, direction: "in", qty: 1, cost: 50,
        by: storekeeperId, byName: "Sam Store",
      });
      await movement({ product: gadget, direction: "out", qty: 1, cost: 50 });

      asRole("Admin");
      expect(await movements.searchMovementsPg()).toHaveLength(2);

      // The scope is the ACTION's, decided from the session — the old
      // signature took it as an argument the page could simply not pass.
      asRole("Technician", storekeeperId);
      const theirs = await movements.searchMovementsPg();
      expect(theirs).toHaveLength(1);
      expect(theirs[0].performedBy.name).toBe("Sam Store");

      // and the tiles above the list agree with the list
      const stats = await movements.getMovementStatsPg();
      expect(stats.totalMovements).toBe(1);
    });

    it("pages at twenty, and counts the pages the same way it filters", async () => {
      for (let i = 0; i < 25; i += 1) {
        await movement({ product: widget, direction: "in", qty: 1, cost: 50 });
      }

      expect(await movements.searchMovementsPg({ page: 1 })).toHaveLength(20);
      expect(await movements.searchMovementsPg({ page: 2 })).toHaveLength(5);
      expect(await movements.fetchMovementPagesPg()).toBe(2);
      // A filter that matches nothing still has one page, not zero.
      expect(await movements.fetchMovementPagesPg({ direction: "out" })).toBe(1);
    });
  });
});
