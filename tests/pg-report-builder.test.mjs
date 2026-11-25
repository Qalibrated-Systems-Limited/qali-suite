/**
 * The report builder (each_module_keeps_saved_custom_reports): columns come
 * from the database, names are whitelisted, rows are the company's own.
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
const reports = await import("@/app/db/actions/report-builder-actions");

suite("report builder", () => {
  let admin;
  let companyUuid;
  let otherCompany;
  let mongoCompanyId;
  const me = randomUUID();

  const asRole = (role, id = me) =>
    getTenantContext.mockResolvedValue({ user: { id, name: `${role} User`, role }, companyId: mongoCompanyId });

  const company = async (id, mongo) => {
    await admin`INSERT INTO companies (id, name, slug) VALUES (${id}, 'Co', ${"r-" + id.slice(0, 8)})`;
    if (mongo) await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid) VALUES ('companies', ${mongo}, ${id})`;
    await admin`INSERT INTO company_settings (company_id) VALUES (${id})`;
  };
  const product = (co, sku, onHand, cost) => admin`
    INSERT INTO products (id, company_id, sku, name, unit, cost_price, selling_price, quantity_on_hand, costing_method, category)
    VALUES (${randomUUID()}, ${co}, ${sku}, ${sku + " name"}, 'pcs', ${cost}, ${cost * 2}, ${onHand}, 'average', ${sku.startsWith("G") ? "Gauges" : "Valves"})`;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyUuid = randomUUID();
    otherCompany = randomUUID();
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    await company(companyUuid, mongoCompanyId);
    await company(otherCompany, null);
    await product(companyUuid, "G-1", 10, 100);
    await product(companyUuid, "G-2", 5, 200);
    await product(companyUuid, "V-1", 7, 50);
    await product(otherCompany, "G-9", 999, 1);
    asRole("Store Manager");
  });

  it("reads a dataset's columns from the database, hiding the company key", async () => {
    const cols = await reports.getDatasetColumns("stock", "products");
    const keys = cols.map((c) => c.key);
    expect(keys).toContain("sku");
    expect(keys).toContain("quantity_on_hand");
    expect(keys).not.toContain("company_id");
    expect(cols.find((c) => c.key === "quantity_on_hand").type).toBe("number");
  });

  it("lists only the company's rows, with filters and sorting", async () => {
    const r = await reports.runCustomReport({
      module: "stock",
      dataset: "products",
      columns: ["sku", "quantity_on_hand"],
      filters: [{ column: "sku", op: "contains", value: "G-" }],
      sort: { column: "quantity_on_hand", dir: "asc" },
    });
    expect(r.success).toBe(true);
    expect(r.rows.map((x) => x.sku)).toEqual(["G-2", "G-1"]);
  });

  it("groups with a count and totals of the number columns", async () => {
    const r = await reports.runCustomReport({
      module: "stock",
      dataset: "products",
      columns: ["category", "quantity_on_hand"],
      groupBy: "category",
    });
    expect(r.success).toBe(true);
    const g = Object.fromEntries(r.rows.map((x) => [x.category, x]));
    expect(g.Gauges).toMatchObject({ count: 2, quantity_on_hand: 15 });
    expect(g.Valves).toMatchObject({ count: 1, quantity_on_hand: 7 });
  });

  it("ignores a column name that is not one of the dataset's", async () => {
    const r = await reports.runCustomReport({
      module: "stock",
      dataset: "products",
      columns: ['sku"; DROP TABLE products; --', "sku"],
      filters: [{ column: "1=1 OR company_id", op: "eq", value: "x" }],
    });
    expect(r.success).toBe(true);
    expect(r.columns.map((c) => c.key)).toEqual(["sku"]);
    expect(r.rows).toHaveLength(3);
  });

  it("refuses a module the role may not report on", async () => {
    asRole("Storekeeper");
    const r = await reports.runCustomReport({ module: "hr", dataset: "employees", columns: [] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/access/i);
  });

  it("saves, lists, and lets only its owner or an admin delete a report", async () => {
    const saved = await reports.saveReport("Gauges on hand", { module: "stock", dataset: "products", columns: ["sku"] }, true);
    expect(saved.success).toBe(true);
    const listed = await reports.listSavedReports("stock");
    expect(listed.map((x) => x.name)).toEqual(["Gauges on hand"]);

    asRole("Store Manager", randomUUID());
    expect((await reports.deleteSavedReport(saved.id)).success).toBe(false);
    asRole("Admin", randomUUID());
    expect((await reports.deleteSavedReport(saved.id)).success).toBe(true);
  });
});
