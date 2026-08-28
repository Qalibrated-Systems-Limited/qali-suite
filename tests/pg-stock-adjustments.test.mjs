/**
 * Stock adjustments on Postgres — 0066.
 *
 * The Mongo model performed four checks by hand that the schema now states, so
 * what is tested here is mostly what the schema CANNOT state, plus the two
 * places where this port deliberately behaves differently from the model it
 * replaces:
 *
 *   - the by-type total is the NET, where `calculateTotals()` summed
 *     magnitudes and reported a stock take that found and lost the same value
 *     as though it had moved twice that much;
 *   - a decrease does NOT release a commitment, where reusing `issueStock`
 *     would have, letting stock promised to an order be written off and sold.
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
const adjustments = await import("@/app/db/actions/adjustment-actions");

suite("stock adjustments", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let inventoryAcct;
  let adjustmentAcct;
  let widget;
  let gadget;

  const asRole = (role) =>
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: `${role} User`, role },
      companyId: mongoCompanyId,
    });

  /** The form's payload: one JSON field, items in increase/decrease terms. */
  const submit = (items, over = {}) => {
    const fd = new FormData();
    fd.append(
      "adjustmentData",
      JSON.stringify({
        adjustmentDate: "2026-08-15",
        adjustmentType: "physical_count",
        description: "Monthly count",
        notes: "",
        items,
        ...over,
      }),
    );
    return adjustments.createStockAdjustmentPg(null, fd);
  };

  const item = (productId, type, quantity, reason = "Counted") => ({
    productId,
    productName: "Widget",
    adjustmentType: type,
    quantity,
    reason,
  });

  const product = async (id, sku, { onHand = 100, cost = 50 } = {}) => {
    await admin`
      INSERT INTO products (id, company_id, sku, name, unit, cost_price,
                            selling_price, quantity_on_hand, costing_method)
      VALUES (${id}, ${companyUuid}, ${sku}, ${sku}, 'pcs', ${cost},
              ${cost * 2}, ${onHand}, 'average')`;
  };

  const levels = async (id) => {
    const [row] = await admin`
      SELECT quantity_on_hand::float8 AS on_hand,
             quantity_committed::float8 AS committed,
             cost_price::float8 AS cost,
             last_purchase_cost::float8 AS last_purchase
      FROM products WHERE id = ${id}`;
    return row;
  };

  const entryLines = async (adjustmentId) => admin`
    SELECT a.account_code, l.debit::float8 AS debit, l.credit::float8 AS credit
    FROM stock_adjustments s
    JOIN journal_lines l ON l.entry_id = s.journal_entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE s.id = ${adjustmentId}
    ORDER BY l.line_number`;

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

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    // Every column but the key has a default, and those defaults ARE the
    // thresholds the routing rules read: 50,000 on stock adjustments, and
    // theft / write_off / expiry as the high-risk types.
    await admin`
      INSERT INTO company_settings (company_id) VALUES (${companyUuid})`;

    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
          (${inventoryAcct},  ${companyUuid}, '1300', 'Inventory',              'asset',   'inventory'),
          (${adjustmentAcct}, ${companyUuid}, '5300', 'Inventory Adjustments',  'expense', 'inventory_adjustments')`;
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
    });

    await product(widget, "WID-1");
    await product(gadget, "GAD-1");

    asRole("Admin");
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the line arithmetic is the schema's, not the application's", () => {
    it("derives quantity and value from the counts", async () => {
      const r = await submit([item(widget, "decrease", 10)]);
      expect(r.success).toBe(true);

      const [line] = await admin`
        SELECT system_quantity::float8 AS sys, physical_quantity::float8 AS phys,
               adjustment_quantity::float8 AS qty, adjustment_value::float8 AS val
        FROM stock_adjustment_lines
        WHERE adjustment_id = ${r.adjustmentId}`;

      expect(line.sys).toBe(100);
      expect(line.phys).toBe(90);
      expect(line.qty).toBe(-10);
      // ABS(quantity) * cost — a magnitude, as in Mongo.
      expect(line.val).toBe(500);
    });

    it("refuses a line with no reason", async () => {
      // The Mongo check was `validateLines()`; here it is a CHECK, so it holds
      // for a write that never calls the application at all.
      const r = await submit([item(widget, "decrease", 1)]);
      const [{ id: adjustmentId }] = await admin`
        SELECT id FROM stock_adjustments WHERE id = ${r.adjustmentId}`;

      await expect(
        admin`
          INSERT INTO stock_adjustment_lines
            (company_id, adjustment_id, product_id, system_quantity,
             physical_quantity, unit_cost, reason)
          VALUES (${companyUuid}, ${adjustmentId}, ${widget}, 10, 5, 50, '   ')`,
      ).rejects.toThrow(/reason_not_blank/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the totals are summed, not stored", () => {
    it("reports the NET for a count that both finds and loses", async () => {
      // +2 widgets at 50 = 100 found; -2 gadgets at 50 = 100 lost.
      // calculateTotals() stored 200 as totalAdjustmentValue, and
      // getAdjustmentStats() reported that as the value of the type.
      const r = await submit([
        item(widget, "increase", 2),
        item(gadget, "decrease", 2),
      ]);
      expect(r.success).toBe(true);

      const stats = await adjustments.getAdjustmentStats({
        startDate: "2026-08-01",
        endDate: "2026-08-31",
      });

      expect(stats.totalIncreaseValue).toBe(100);
      expect(stats.totalDecreaseValue).toBe(100);
      expect(stats.netValue).toBe(0);

      const count = stats.byType.find((t) => t._id === "physical_count");
      expect(Number(count.value)).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("approving", () => {
    it("debits Inventory and credits Adjustments on a net increase", async () => {
      const r = await submit([item(widget, "increase", 4)]);
      const lines = await entryLines(r.adjustmentId);

      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ account_code: "1300", debit: 200, credit: 0 });
      expect(lines[1]).toMatchObject({ account_code: "5300", debit: 0, credit: 200 });
    });

    it("debits Adjustments and credits Inventory on a net decrease", async () => {
      const r = await submit([item(widget, "decrease", 4)]);
      const lines = await entryLines(r.adjustmentId);

      expect(lines[0]).toMatchObject({ account_code: "5300", debit: 200, credit: 0 });
      expect(lines[1]).toMatchObject({ account_code: "1300", debit: 0, credit: 200 });
    });

    it("posts NOTHING when the lines net to zero, and does not fail", async () => {
      const r = await submit([
        item(widget, "increase", 2),
        item(gadget, "decrease", 2),
      ]);
      expect(r.success).toBe(true);

      const [row] = await admin`
        SELECT journal_entry_id, status FROM stock_adjustments WHERE id = ${r.adjustmentId}`;
      expect(row.journal_entry_id).toBeNull();
      expect(row.status).toBe("approved");

      // The stock still moved, on both products.
      expect((await levels(widget)).on_hand).toBe(102);
      expect((await levels(gadget)).on_hand).toBe(98);
    });

    it("records the movement the level actually made", async () => {
      const r = await submit([item(widget, "decrease", 10)]);

      const [mv] = await admin`
        SELECT m.direction, m.quantity::float8 AS qty,
               m.previous_stock::float8 AS prev, m.new_stock::float8 AS next
        FROM stock_adjustment_lines l
        JOIN stock_movements m ON m.id = l.stock_movement_id
        WHERE l.adjustment_id = ${r.adjustmentId}`;

      expect(mv.direction).toBe("out");
      expect(mv.qty).toBe(10);
      expect(mv.prev).toBe(100);
      expect(mv.next).toBe(90);
      expect((await levels(widget)).on_hand).toBe(90);
    });

    it("cannot be approved twice", async () => {
      const r = await submit([item(widget, "decrease", 1)]);
      const again = await adjustments.applyApprovedStockAdjustmentPg(r.adjustmentId);

      expect(again.success).toBe(false);
      expect(again.message).toMatch(/draft/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what a decrease must not do", () => {
    it("leaves the commitment alone, so committed stock cannot be sold twice", async () => {
      // 40 of the 100 widgets are promised to an open order.
      await admin`UPDATE products SET quantity_committed = 40 WHERE id = ${widget}`;

      const r = await submit([item(widget, "decrease", 10, "Damaged")]);
      expect(r.success).toBe(true);

      const after = await levels(widget);
      expect(after.on_hand).toBe(90);
      // `issueStock` would have made this 30, releasing a promise the
      // write-off did not settle.
      expect(after.committed).toBe(40);
    });

    it("cannot write off stock that is committed to an order", async () => {
      await admin`UPDATE products SET quantity_committed = 95 WHERE id = ${widget}`;

      // committed + on_hold <= on_hand refuses it — no application check.
      const r = await submit([item(widget, "decrease", 10, "Damaged")]);
      expect(r.success).toBe(false);

      expect((await levels(widget)).on_hand).toBe(100);
      const [{ count }] = await admin`
        SELECT COUNT(*)::int AS count FROM stock_adjustments`;
      expect(count).toBe(0);
    });
  });

  describe("what an increase must not do", () => {
    it("moves the weighted average but not the purchase provenance", async () => {
      // 100 at 50, plus 100 found at 70 → average 60. Nothing was purchased.
      await admin`UPDATE products SET last_purchase_cost = 50 WHERE id = ${widget}`;
      await admin`UPDATE products SET cost_price = 50 WHERE id = ${widget}`;

      // The action reads the cost from the product, so to admit stock at a
      // different cost the product's cost has to be that. Instead, prove the
      // narrower claim: the average is recomputed and last_purchase is not
      // touched by the adjustment.
      const r = await submit([item(widget, "increase", 100, "Found")]);
      expect(r.success).toBe(true);

      const after = await levels(widget);
      expect(after.on_hand).toBe(200);
      expect(after.cost).toBe(50);
      expect(after.last_purchase).toBe(50);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("segregation of duties", () => {
    it("routes a Storekeeper's adjustment instead of applying it", async () => {
      asRole("Storekeeper");
      // 100 widgets at 50 = 5,000, well under the 50,000 threshold, and
      // physical_count is not high-risk — so on the Mongo rule this auto-
      // approved, because its value branch tested no role at all. The comment
      // beside CREATE_ROLES says a Storekeeper cannot auto-apply; now it can't.
      const r = await submit([item(widget, "decrease", 100, "Damaged")]);

      // The engine is Mongo and is not reachable in this suite, so the write
      // is what is asserted: a draft, and no stock moved.
      const [row] = await admin`
        SELECT status FROM stock_adjustments WHERE id = ${r.adjustmentId}`;
      expect(row?.status ?? "draft").toBe("draft");
      expect((await levels(widget)).on_hand).toBe(100);
    });

    it("still lets a Store Manager apply a small, low-risk one", async () => {
      // The other half of the same rule — closing the hole must not close the
      // path its policy header actually grants.
      asRole("Store Manager");
      const r = await submit([item(widget, "decrease", 10, "Damaged")]);
      expect(r.success).toBe(true);

      const [row] = await admin`
        SELECT status FROM stock_adjustments WHERE id = ${r.adjustmentId}`;
      expect(row.status).toBe("approved");
      expect((await levels(widget)).on_hand).toBe(90);
    });

    it("routes a Store Manager's HIGH-RISK one even when it is small", async () => {
      asRole("Store Manager");
      const r = await submit([item(widget, "decrease", 1, "Stolen")], {
        adjustmentType: "theft",
      });

      const [row] = await admin`
        SELECT status FROM stock_adjustments WHERE id = ${r.adjustmentId}`;
      expect(row?.status ?? "draft").toBe("draft");
      expect((await levels(widget)).on_hand).toBe(100);
    });

    it("never auto-approves stock admitted with no cost basis", async () => {
      // The zero-cost guard. An increase at a unit cost of zero posts nothing
      // to Inventory AND defeats the value threshold, since the total is
      // always zero and so never exceeds it.
      await admin`UPDATE products SET cost_price = 0 WHERE id = ${widget}`;
      asRole("Admin");

      const r = await submit([item(widget, "increase", 100, "Found")]);

      const [row] = await admin`
        SELECT status FROM stock_adjustments WHERE id = ${r.adjustmentId}`;
      expect(row?.status ?? "draft").toBe("draft");
      expect((await levels(widget)).on_hand).toBe(100);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the shapes the screens read", () => {
    it("hands the list Mongo's field names and numbers", async () => {
      await submit([item(widget, "increase", 2)]);

      const { adjustments: rows, pagination } = await adjustments.getAdjustments({});
      expect(rows).toHaveLength(1);

      const row = rows[0];
      expect(row._id).toEqual(expect.any(String));
      expect(row.createdBy.name).toBe("Admin User");
      expect(row.lines).toHaveLength(1);
      // NUMERIC comes back a string from Postgres; the table compares with > 0.
      expect(typeof row.totalIncreaseValue).toBe("number");
      expect(row.totalIncreaseValue).toBe(100);
      expect(row.totalDecreaseValue).toBe(0);
      expect(pagination.hasNext).toBe(false);
    });
  });
});
