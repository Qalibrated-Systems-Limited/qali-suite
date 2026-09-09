/**
 * Price changes: the gate, and the record — 0069.
 *
 * Both halves of what the products port dropped. `updateProductPricingPg` set
 * three columns and did nothing else, while the Mongo action it replaced
 * refused to apply a price below cost, below the product's floor, or under the
 * company's minimum margin, and routed it to the `price_change` approval type
 * instead. Nothing had raised one since products moved, and nothing recorded a
 * change either.
 *
 * The two belong in one file because they are the same hole from either side:
 * a control that does not stop anything, and no trace of what got through.
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

// The approval engine is Postgres since 0101 and is not exercised here; what
// matters is WHETHER it is called and that the price is left alone when it is.
const submitApproval = vi.fn(async () => ({
  success: true,
  approval: { _id: "a1", requestNumber: "APR-0007" },
}));
vi.mock("@/app/db/actions/approval-actions", () => ({ submitApproval }));

const { getTenantContext } = await import("@/lib/utils/tenant-utils");
const products = await import("@/app/db/actions/product-actions");

suite("price changes", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let widget;

  const asRole = (role) =>
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: `${role} User`, role },
      companyId: mongoCompanyId,
    });

  const priceForm = ({ selling, minimum = "0", wholesale = "0" }) => {
    const fd = new FormData();
    fd.append("sellingPrice", String(selling));
    fd.append("minimumPrice", String(minimum));
    fd.append("wholesalePrice", String(wholesale));
    return fd;
  };

  const setPrices = (over) =>
    products.updateProductPricingPg(widget, null, priceForm(over));

  /** `fail()` returns `{ error: { field: [msg] } }` with no `success` key. */
  const errorOf = (r) => Object.values(r.error ?? {}).flat().join(" ");

  const priceOf = async () => {
    const [r] = await admin`
      SELECT selling_price::float8 AS selling, minimum_price::float8 AS minimum,
             wholesale_price::float8 AS wholesale
        FROM products WHERE id = ${widget}`;
    return r;
  };

  const history = () => admin`
    SELECT field, old_value::float8 AS old_value, new_value::float8 AS new_value,
           cost_at_change::float8 AS cost_at_change, reason, approval_ref,
           changed_by_name
      FROM product_price_history WHERE product_id = ${widget}
     ORDER BY changed_at, field`;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    submitApproval.mockClear();
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyUuid = randomUUID();
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    widget = randomUUID();

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    // minimum_margin_percent defaults to 8.
    await admin`
      INSERT INTO company_settings (company_id) VALUES (${companyUuid})`;

    // Cost 100, selling 200 — a healthy 50% margin to move away from.
    await admin`
      INSERT INTO products (id, company_id, sku, name, unit, cost_price,
                            selling_price, minimum_price, wholesale_price,
                            quantity_on_hand)
      VALUES (${widget}, ${companyUuid}, 'WID-1', 'Widget', 'pcs', 100,
              200, 0, 0, 10)`;

    asRole("Sales Manager");
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the record", () => {
    it("writes one row per price that actually moved", async () => {
      const r = await setPrices({ selling: 250, wholesale: 220 });
      expect(r.success).toBe(true);

      const rows = await history();
      expect(rows).toHaveLength(2);

      const selling = rows.find((h) => h.field === "selling");
      expect(selling).toMatchObject({ old_value: 200, new_value: 250 });
      // The cost basis rides along, so the margin then is answerable later
      // without going back through the movements.
      expect(selling.cost_at_change).toBe(100);
      expect(selling.changed_by_name).toBe("Sales Manager User");

      expect(rows.find((h) => h.field === "wholesale")).toMatchObject({
        old_value: 0,
        new_value: 220,
      });
      // minimum did not move, so it is not in the history.
      expect(rows.find((h) => h.field === "minimum")).toBeUndefined();
    });

    it("records nothing when nothing changed", async () => {
      const r = await setPrices({ selling: 200 });
      expect(r.success).toBe(true);
      expect(r.message).toMatch(/nothing changed/i);
      expect(await history()).toHaveLength(0);
    });

    it("refuses a history row that records no change", async () => {
      // The CHECK, not the application — a history full of no-ops hides the
      // changes that matter.
      await expect(
        admin`
          INSERT INTO product_price_history
            (company_id, product_id, field, old_value, new_value, changed_by_name)
          VALUES (${companyUuid}, ${widget}, 'selling', 50, 50, 'Someone')`,
      ).rejects.toThrow(/actually_changed/);
    });

    it("refuses a field it does not know", async () => {
      await expect(
        admin`
          INSERT INTO product_price_history
            (company_id, product_id, field, old_value, new_value, changed_by_name)
          VALUES (${companyUuid}, ${widget}, 'cost', 1, 2, 'Someone')`,
      ).rejects.toThrow(/field_valid/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the gate", () => {
    it("routes a price below cost, and leaves the price alone", async () => {
      const r = await setPrices({ selling: 80 }); // cost is 100

      expect(errorOf(r)).toMatch(/APR-0007/);
      expect(submitApproval).toHaveBeenCalledTimes(1);
      expect(submitApproval.mock.calls[0][0].type).toBe("price_change");
      expect(submitApproval.mock.calls[0][0].reason).toMatch(/below cost/i);

      // THE POINT: nothing was written. A pending approval must leave the
      // shelf price exactly as it was.
      expect((await priceOf()).selling).toBe(200);
      expect(await history()).toHaveLength(0);
    });

    it("routes a price below the product's own floor", async () => {
      await admin`UPDATE products SET minimum_price = 180 WHERE id = ${widget}`;
      const r = await setPrices({ selling: 150, minimum: 180 });

      expect(errorOf(r)).toMatch(/below floor/i);
      expect(submitApproval.mock.calls[0][0].reason).toMatch(/below floor/i);
      expect((await priceOf()).selling).toBe(200);
    });

    it("refuses a floor RAISED above the price, rather than routing it", async () => {
      // The same inequality as the test above, and a different event. There
      // the floor stood at 180 and somebody wanted to sell under it — a
      // question an approver can answer. Here the save states a floor of 180
      // and a price of 150 at once, which no approver can make true.
      const r = await setPrices({ selling: 150, minimum: 180 });
      expect(errorOf(r)).toMatch(/cannot be above/i);
      expect(submitApproval).not.toHaveBeenCalled();
      expect((await priceOf()).selling).toBe(200);
    });

    it("routes a margin under the company minimum", async () => {
      // Cost 100, selling 105 → 4.8% margin, under the 8% default. Above cost
      // and there is no floor, so the margin rule is the only thing catching it.
      const r = await setPrices({ selling: 105 });

      expect(errorOf(r)).toMatch(/margin/i);
      expect(submitApproval.mock.calls[0][0].reason).toMatch(/margin/i);
      expect((await priceOf()).selling).toBe(200);
    });

    it("lets a healthy price straight through", async () => {
      const r = await setPrices({ selling: 300 });
      expect(r.success).toBe(true);
      expect(submitApproval).not.toHaveBeenCalled();
      expect((await priceOf()).selling).toBe(300);
    });

    it("lets a CFO override, and records that they did", async () => {
      asRole("CFO");
      const r = await setPrices({ selling: 80 }); // below cost

      expect(r.success).toBe(true);
      expect(submitApproval).not.toHaveBeenCalled();
      expect((await priceOf()).selling).toBe(80);

      // The bypass is of the GATE, not of the history — the record is the only
      // thing that makes an override reviewable afterwards.
      const [row] = await history();
      expect(row.reason).toMatch(/below cost/i);
      expect(row.reason).toMatch(/overridden by CFO/i);
    });

    it("does not let a Sales Manager override", async () => {
      // canOverridePricing is SuperAdmin, Admin, CFO. A Sales Manager may set
      // prices and may not break the floor — so the change is routed, not
      // applied.
      asRole("Sales Manager");
      const r = await setPrices({ selling: 80 });
      expect(errorOf(r)).toMatch(/below cost/i);
      expect((await priceOf()).selling).toBe(200);
    });

    it("does not let a role that cannot price at all near it", async () => {
      // PRICING_EDIT_ROLES excludes Manager, deliberately — see the note in
      // lib/permissions.js. It is refused before any gate runs.
      asRole("Manager");
      const r = await setPrices({ selling: 300 });
      expect(errorOf(r)).toMatch(/permission/i);
      expect(submitApproval).not.toHaveBeenCalled();
      expect((await priceOf()).selling).toBe(200);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("releasing an approved change", () => {
    it("writes the price and stamps the approval that released it", async () => {
      asRole("CFO");
      const r = await products.applyApprovedPriceChangePg(
        widget,
        { sellingPrice: "80", minimumPrice: null, wholesalePrice: null },
        { submittedCost: 100, approvalRef: "APR-0007" },
      );

      expect(r.success).toBe(true);
      expect((await priceOf()).selling).toBe(80);

      const [row] = await history();
      expect(row).toMatchObject({
        field: "selling",
        old_value: 200,
        new_value: 80,
        approval_ref: "APR-0007",
      });
    });

    it("refuses if cost moved since the approval was raised", async () => {
      // The request tripped the checks against a cost of 100; a receipt has
      // since re-costed the product. The approver would be greenlighting a
      // number that no longer means what it meant.
      await admin`UPDATE products SET cost_price = 140 WHERE id = ${widget}`;
      asRole("CFO");

      const r = await products.applyApprovedPriceChangePg(
        widget,
        { sellingPrice: "80" },
        { submittedCost: 100, approvalRef: "APR-0007" },
      );

      expect(errorOf(r)).toMatch(/cost changed/i);
      expect((await priceOf()).selling).toBe(200);
      expect(await history()).toHaveLength(0);
    });

    it("is not open to whoever asks", async () => {
      asRole("Storekeeper");
      const r = await products.applyApprovedPriceChangePg(
        widget,
        { sellingPrice: "80" },
        { submittedCost: 100 },
      );
      expect(errorOf(r)).toBeTruthy();
      expect((await priceOf()).selling).toBe(200);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the dashboard card", () => {
    it("reads newest first, with the product and who changed it", async () => {
      asRole("Sales Manager");
      await setPrices({ selling: 250 });
      await setPrices({ selling: 300 });

      const recent = await products.getRecentPriceChangesPg(8);
      expect(recent).toHaveLength(2);
      expect(recent[0]).toMatchObject({
        newValue: 300,
        oldValue: 250,
        field: "selling",
        SKU: "WID-1",
        productName: "Widget",
        changedByName: "Sales Manager User",
      });
      expect(recent[0].productId).toBe(widget);
    });
  });
});
