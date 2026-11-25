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
const docs = await import("@/app/db/actions/inventory-document-actions");

suite("inventory documents", () => {
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

  const productId = async () => (await admin`SELECT id::text AS id FROM products WHERE company_id = ${companyUuid} LIMIT 1`)[0].id;
  const file = (n) => ({ name: `${n}.pdf`, url: `https://res.cloudinary.com/demo/raw/upload/${n}.pdf`, mimeType: "application/pdf", size: 2048, category: "sds" });

  it("attaches, lists and removes a product's documents", async () => {
    const id = await productId();
    const r = await docs.attachInventoryDocuments("product", id, [file("sds"), { ...file("cert"), category: "certificate" }]);
    expect(r.success).toBe(true);
    const listed = await docs.listInventoryDocuments("product", id);
    expect(listed.map((d) => d.category).sort()).toEqual(["certificate", "sds"]);
    expect(listed.every((d) => d.canRemove)).toBe(true);

    asRole("Storekeeper", "someone-else");
    const other = await docs.listInventoryDocuments("product", id);
    expect(other.every((d) => !d.canRemove)).toBe(true);
    expect((await docs.removeInventoryDocument(other[0].id)).success).toBe(false);

    asRole("Store Manager", me);
    expect((await docs.removeInventoryDocument(other[0].id)).success).toBe(true);
    expect(await docs.listInventoryDocuments("product", id)).toHaveLength(1);
  });

  it("refuses a link that is not an uploaded file", async () => {
    const r = await docs.attachInventoryDocuments("product", await productId(), [{ name: "x", url: "https://evil.example.com/x.pdf" }]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/upload/i);
  });

  it("refuses a record that is not in the company", async () => {
    const [theirs] = await admin`SELECT id::text AS id FROM products WHERE company_id = ${otherCompany}`;
    // The superuser test connection skips RLS, so this checks the explicit lookup too.
    const r = await docs.attachInventoryDocuments("product", theirs.id, [file("x")]);
    expect(r.success).toBe(false);
  });

  it("refuses someone who does not work the stock", async () => {
    asRole("Employee");
    const r = await docs.attachInventoryDocuments("product", await productId(), [file("x")]);
    expect(r.success).toBe(false);
  });
});
