/**
 * The product master, end to end through the server action.
 *
 * The repository has been there since early in the port and nothing called it:
 * products were written to Mongo by the screens while INVOICES read Postgres,
 * so the product dropdown on a new invoice was empty and no stock item could
 * be sold. This covers the layer that was missing — the role gates, the
 * segregation of cost from price, and opening stock reaching the ledger.
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
const productActions = await import("@/app/db/actions/product-actions");

function form(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) fd.set(k, String(v));
  }
  return fd;
}

suite("product actions (end to end)", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let inventoryId;
  let openingEquityId;
  let categoryId;

  const asRole = (role) =>
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: `${role} User`, role },
      // The session carries the Mongo company id during the transition and the
      // action resolves it through _migration_id_map, exactly as in production.
      companyId: mongoCompanyId,
    });

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, _migration_id_map, entry_counters CASCADE`;

    companyUuid = randomUUID();
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    inventoryId = randomUUID();
    openingEquityId = randomUUID();
    categoryId = randomUUID();

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    // Provisioning creates this row WITH the company (0035), so a company
    // without one cannot occur in production — the fixture was simply
    // unfaithful, and it started mattering when the pricing gate began
    // reading `minimumMarginPercent` from it (0069).
    await admin`
      INSERT INTO company_settings (company_id) VALUES (${companyUuid})`;
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
          (${inventoryId},     ${companyUuid}, '1300', 'Inventory',              'asset',  'inventory'),
          (${openingEquityId}, ${companyUuid}, '3900', 'Opening Balance Equity', 'equity', 'opening_balance_equity')`;
      await tx`
        INSERT INTO categories (id, company_id, name, slug)
        VALUES (${categoryId}, ${companyUuid}, 'Hardware', 'hardware')`;
    });

    asRole("Admin");
  });

  const product = (over = {}) =>
    form({
      name: "Widget",
      sku: "wid-1",
      unit: "pcs",
      type: "Inventory Item",
      costPrice: "40",
      sellingPrice: "250",
      reorderLevel: "5",
      isActive: "true",
      ...over,
    });

  describe("creating", () => {
    it("creates a product the invoice picker can actually see", async () => {
      const r = await productActions.addProductPg(null, product());
      expect(r.error).toBeUndefined();
      expect(r.success).toBe(true);

      const [row] = await admin`
        SELECT sku, name, selling_price, is_active FROM products WHERE id = ${r.productId}`;
      // Upper-cased on the way in, as the repository does.
      expect(row.sku).toBe("WID-1");
      expect(Number(row.selling_price)).toBe(250);
      expect(row.is_active).toBe(true);
    });

    it("refuses a duplicate SKU in the same company", async () => {
      await productActions.addProductPg(null, product());
      const r = await productActions.addProductPg(null, product({ name: "Other" }));
      expect(r.error?.sku?.[0]).toMatch(/already exists/i);
    });

    it("files the product under a category by id, and snapshots its name", async () => {
      // The form posts the category ID in a field called `category`.
      const r = await productActions.addProductPg(null, product({ category: categoryId }));
      const [row] = await admin`
        SELECT category, category_id FROM products WHERE id = ${r.productId}`;
      expect(row.category_id).toBe(categoryId);
      // The snapshot, so renaming the category does not rewrite history.
      expect(row.category).toBe("Hardware");
    });

    it("refuses a category that does not exist", async () => {
      const r = await productActions.addProductPg(
        null,
        product({ category: randomUUID() }),
      );
      expect(r.error?.category?.[0]).toMatch(/no longer exists/i);
    });

    it("keeps the fields the form collects and the table had nowhere to put", async () => {
      const r = await productActions.addProductPg(
        null,
        product({ taxRate: "0", reorderQuantity: "50", location: "Main", binNumber: "A-12" }),
      );
      const [row] = await admin`
        SELECT default_tax_rate, reorder_quantity, location, bin_number
          FROM products WHERE id = ${r.productId}`;
      // Zero-rated, which the per-line default of 16 could not express.
      expect(Number(row.default_tax_rate)).toBe(0);
      expect(Number(row.reorder_quantity)).toBe(50);
      expect(row.location).toBe("Main");
      expect(row.bin_number).toBe("A-12");
    });
  });

  describe("opening stock reaches the ledger", () => {
    it("posts DR Inventory / CR Opening Balance Equity for the stock value", async () => {
      const r = await productActions.addProductPg(
        null,
        product({ initialStock: "10", costPrice: "40" }),
      );
      expect(r.error).toBeUndefined();

      const [row] = await admin`
        SELECT quantity_on_hand, quantity_available FROM products WHERE id = ${r.productId}`;
      expect(Number(row.quantity_on_hand)).toBe(10);
      // GENERATED: on_hand - committed - on_hold, never stored.
      expect(Number(row.quantity_available)).toBe(10);

      const lines = await admin`
        SELECT l.account_id, l.debit, l.credit
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.entry_id
         WHERE e.company_id = ${companyUuid} AND e.entry_type = 'opening_balance'
         ORDER BY l.line_number`;
      expect(lines).toHaveLength(2);
      const dr = lines.find((l) => Number(l.debit) > 0);
      const cr = lines.find((l) => Number(l.credit) > 0);
      expect(dr.account_id).toBe(inventoryId);
      expect(cr.account_id).toBe(openingEquityId);
      // 10 × 40 — the balance sheet carries stock at cost.
      expect(Number(dr.debit)).toBe(400);
      expect(Number(cr.credit)).toBe(400);
    });

    it("records the movement that explains the level", async () => {
      const r = await productActions.addProductPg(
        null,
        product({ initialStock: "10", costPrice: "40" }),
      );
      const [m] = await admin`
        SELECT movement_type, direction, quantity, previous_stock, new_stock
          FROM stock_movements WHERE product_id = ${r.productId}`;
      expect(m.movement_type).toBe("initial");
      expect(m.direction).toBe("in");
      // Recorded BEFORE the level moved, so the transition is the real one.
      expect(Number(m.previous_stock)).toBe(0);
      expect(Number(m.new_stock)).toBe(10);
    });

    it("posts nothing at all when there is no opening stock", async () => {
      const r = await productActions.addProductPg(null, product());
      const entries = await admin`
        SELECT id FROM journal_entries WHERE company_id = ${companyUuid}`;
      expect(entries).toHaveLength(0);
      const [row] = await admin`
        SELECT quantity_on_hand FROM products WHERE id = ${r.productId}`;
      expect(Number(row.quantity_on_hand)).toBe(0);
    });

    it("refuses opening stock with no cost rather than valuing it at nothing", async () => {
      const r = await productActions.addProductPg(
        null,
        product({ initialStock: "10", costPrice: "0" }),
      );
      expect(r.error?.initialStock?.[0]).toMatch(/cost price/i);
      const rows = await admin`SELECT id FROM products WHERE company_id = ${companyUuid}`;
      // Refused BEFORE the insert, so no half-made product is left behind.
      expect(rows).toHaveLength(0);
    });

    it("refuses negative opening stock", async () => {
      const r = await productActions.addProductPg(
        null,
        product({ initialStock: "-5" }),
      );
      expect(r.error?.initialStock?.[0]).toMatch(/negative/i);
    });
  });

  describe("segregation of duties", () => {
    it("lets a Store Manager register an item but not value it", async () => {
      asRole("Store Manager");
      const r = await productActions.addProductPg(null, product());
      expect(r.success).toBe(true);

      const [row] = await admin`
        SELECT cost_price, selling_price FROM products WHERE id = ${r.productId}`;
      // Neither cost nor price is theirs to set, so both are dropped rather
      // than the whole create being rejected.
      expect(Number(row.cost_price)).toBe(0);
      expect(Number(row.selling_price)).toBe(0);
    });

    it("stops a Store Manager registering opening stock they cannot value", async () => {
      asRole("Store Manager");
      const r = await productActions.addProductPg(
        null,
        product({ initialStock: "10", costPrice: "40" }),
      );
      expect(r.error?.initialStock?.[0]).toMatch(/do not set cost prices/i);
    });

    it("refuses a role with no product authority at all", async () => {
      asRole("Employee");
      const r = await productActions.addProductPg(null, product());
      expect(r.error?._form?.[0]).toMatch(/permission/i);
    });

    it("lets Procurement set cost but not selling price", async () => {
      asRole("Procurement Officer");
      // Procurement is not in PRODUCT_WRITE_ROLES, so the create is refused
      // outright — cost authority does not imply catalogue authority.
      const r = await productActions.addProductPg(null, product());
      expect(r.error?._form?.[0]).toMatch(/permission/i);
    });
  });

  describe("editing", () => {
    let id;
    beforeEach(async () => {
      const r = await productActions.addProductPg(
        null,
        product({ initialStock: "10", costPrice: "40" }),
      );
      id = r.productId;
    });

    it("never lets a form move the stock level", async () => {
      await productActions.updateProductPg(
        id,
        null,
        form({ name: "Renamed", quantityOnHand: "9999", initialStock: "500" }),
      );
      const [row] = await admin`
        SELECT name, quantity_on_hand FROM products WHERE id = ${id}`;
      expect(row.name).toBe("Renamed");
      // Levels move only through a movement. A form that could write this
      // would put stock on the shelf that nothing explains.
      expect(Number(row.quantity_on_hand)).toBe(10);
    });

    it("does not reset prices for a user who may edit but not price", async () => {
      asRole("Store Manager");
      await productActions.updateProductPg(id, null, form({ name: "Renamed" }));
      const [row] = await admin`SELECT selling_price FROM products WHERE id = ${id}`;
      expect(Number(row.selling_price)).toBe(250);
    });

    it("refuses a floor above the price it protects", async () => {
      const r = await productActions.updateProductPricingPg(
        id,
        null,
        form({ sellingPrice: "100", minimumPrice: "150" }),
      );
      expect(r.error?.minimumPrice?.[0]).toMatch(/cannot be above/i);
    });

    it("refuses pricing from a role without price authority", async () => {
      asRole("Store Manager");
      const r = await productActions.updateProductPricingPg(
        id,
        null,
        form({ sellingPrice: "500" }),
      );
      expect(r.error?._form?.[0]).toMatch(/permission/i);
    });
  });

  describe("removing", () => {
    it("deactivates a product that has traded, keeping its history", async () => {
      const r = await productActions.addProductPg(
        null,
        product({ initialStock: "10", costPrice: "40" }),
      );
      const outcome = await productActions.deleteProductPg(r.productId);
      expect(outcome.deleted).toBe(false);
      expect(outcome.deactivated).toBe(true);

      const [row] = await admin`
        SELECT is_active FROM products WHERE id = ${r.productId}`;
      expect(row.is_active).toBe(false);
      // The movement that explains last year's cost of sales still resolves.
      const movements = await admin`
        SELECT id FROM stock_movements WHERE product_id = ${r.productId}`;
      expect(movements).toHaveLength(1);
    });

    it("deletes one that never traded", async () => {
      const r = await productActions.addProductPg(null, product());
      const outcome = await productActions.deleteProductPg(r.productId);
      expect(outcome.deleted).toBe(true);
      const rows = await admin`SELECT id FROM products WHERE id = ${r.productId}`;
      expect(rows).toHaveLength(0);
    });
  });

  describe("the list", () => {
    it("reports the figures the page prints above it", async () => {
      await productActions.addProductPg(
        null,
        product({ sku: "A-1", initialStock: "10", costPrice: "40", reorderLevel: "2" }),
      );
      await productActions.addProductPg(
        null,
        product({ sku: "B-1", name: "Low", reorderLevel: "5" }),
      );

      const { rows, total, stats } = await productActions.getProductsPg({});
      expect(total).toBe(2);
      expect(stats.total).toBe(2);
      // B-1 has nothing on hand against a level of 5.
      expect(stats.lowStock).toBe(1);
      expect(stats.outOfStock).toBe(1);
      // Valued at COST, never at selling price: 10 × 40.
      expect(Number(stats.stockValue)).toBe(400);
      expect(rows.find((p) => p.SKU === "B-1").isLowStock).toBe(true);
    });

    it("filters to low stock only", async () => {
      await productActions.addProductPg(
        null,
        product({ sku: "A-1", initialStock: "10", costPrice: "40", reorderLevel: "2" }),
      );
      await productActions.addProductPg(null, product({ sku: "B-1", reorderLevel: "5" }));

      const { rows } = await productActions.getProductsPg({ lowStockOnly: true });
      expect(rows.map((p) => p.SKU)).toEqual(["B-1"]);
    });
  });
});
