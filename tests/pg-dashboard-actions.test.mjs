/**
 * The dashboard, on Postgres.
 *
 * These figures were read from Mongo models that had all moved. Once the
 * uuid/ObjectId cast was fixed the queries stopped throwing and started
 * SUCCEEDING against pre-migration documents, so the first screen every user
 * sees went from visibly broken to quietly wrong. The point of these tests is
 * that each number is derived from the store that actually holds the data.
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
const dash = await import("@/app/db/actions/dashboard-actions");

suite("dashboard actions", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let customerId;

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
    customerId = randomUUID();

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${customerId}, ${companyUuid}, 'customer', true, 'Acme Ltd')`;
    });

    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Admin User", role: "Admin" },
      companyId: mongoCompanyId,
    });
  });

  const addProduct = (over = {}) => {
    const id = randomUUID();
    const {
      sku = "SKU-" + id.slice(0, 4),
      name = "Widget",
      onHand = 0,
      reorder = 0,
      cost = 0,
      category = null,
    } = over;
    return admin`
      INSERT INTO products (id, company_id, sku, name, quantity_on_hand, reorder_level, cost_price, category)
      VALUES (${id}, ${companyUuid}, ${sku}, ${name}, ${onHand}, ${reorder}, ${cost}, ${category})
    `.then(() => id);
  };

  describe("the alert counts", () => {
    it("counts an overdue invoice from its due date, not a stored status", async () => {
      await admin`
        INSERT INTO invoices (company_id, invoice_number, invoice_date, due_date,
                              customer_id, subtotal, total, amount_paid, status, payment_status)
        VALUES (${companyUuid}, 'INV-1', CURRENT_DATE - 60, CURRENT_DATE - 30,
                ${customerId}, 1000, 1000, 0, 'completed', 'unpaid')`;

      const alerts = await dash.getDashboardAlerts();
      expect(alerts.overdueInvoices).toBe(1);
      expect(alerts.total).toBeGreaterThanOrEqual(1);
    });

    it("does not count one that is merely unpaid and not yet due", async () => {
      await admin`
        INSERT INTO invoices (company_id, invoice_number, invoice_date, due_date,
                              customer_id, subtotal, total, amount_paid, status, payment_status)
        VALUES (${companyUuid}, 'INV-2', CURRENT_DATE, CURRENT_DATE + 30,
                ${customerId}, 1000, 1000, 0, 'completed', 'unpaid')`;

      const alerts = await dash.getDashboardAlerts();
      expect(alerts.overdueInvoices).toBe(0);
    });

    it("counts low stock against each product's own reorder level", async () => {
      // The stocks page used to count "below 10 units" — a fixed threshold
      // that disagreed with the table's own per-row badge.
      await addProduct({ sku: "A", onHand: 3, reorder: 5 }); // low
      await addProduct({ sku: "B", onHand: 40, reorder: 50 }); // ALSO low
      await addProduct({ sku: "C", onHand: 8, reorder: 2 }); // not low, under 10

      const alerts = await dash.getDashboardAlerts();
      expect(alerts.lowStockCount).toBe(2);
    });

    it("adds the five counts into the total", async () => {
      await addProduct({ sku: "A", onHand: 0, reorder: 5 });
      const alerts = await dash.getDashboardAlerts();
      expect(alerts.total).toBe(
        alerts.overdueInvoices +
          alerts.lowStockCount +
          alerts.pendingClaims +
          alerts.overdueCheckouts +
          alerts.pendingRequests,
      );
    });
  });

  describe("the inventory KPIs", () => {
    it("values stock at cost, and agrees with the stocks page", async () => {
      await addProduct({ sku: "A", onHand: 10, cost: 40, reorder: 2 });
      await addProduct({ sku: "B", onHand: 0, cost: 25, reorder: 5 });

      const stats = await dash.getStockStats();
      expect(stats.totalProducts).toBe(2);
      // 10 × 40 — never × selling price.
      expect(stats.totalValue).toBe(400);
      expect(stats.totalQuantity).toBe(10);
      expect(stats.outOfStockCount).toBe(1);
      expect(stats.lowStockCount).toBe(1);
    });

    it("lists the products below their level, most urgent first", async () => {
      await addProduct({ sku: "NEAR", onHand: 4, reorder: 5 }); // -1
      await addProduct({ sku: "DEEP", onHand: 0, reorder: 20 }); // -20
      await addProduct({ sku: "FINE", onHand: 99, reorder: 5 });

      const low = await dash.getLowStockProducts();
      expect(low.map((p) => p.SKU)).toEqual(["DEEP", "NEAR"]);
    });

    it("lists what is out of stock", async () => {
      await addProduct({ sku: "GONE", onHand: 0, reorder: 5 });
      await addProduct({ sku: "HERE", onHand: 1, reorder: 5 });
      const out = await dash.getOutOfStockProducts();
      expect(out.map((p) => p.SKU)).toEqual(["GONE"]);
    });

    it("splits stock by category, naming the unfiled", async () => {
      await addProduct({ sku: "A", onHand: 10, cost: 10, category: "Hardware" });
      await addProduct({ sku: "B", onHand: 5, cost: 2, category: null });

      const dist = await dash.getCategoryDistribution();
      const names = dist.map((d) => d.name);
      expect(names).toContain("Hardware");
      expect(names).toContain("Uncategorised");
      expect(dist.find((d) => d.name === "Hardware").value).toBe(100);
    });
  });

  describe("the movement trend", () => {
    it("returns a row per day, zero-filled, so the chart keeps its shape", async () => {
      const trend = await dash.getMovementTrend(7);
      // A day with no movements is a zero, not a gap.
      expect(trend).toHaveLength(7);
      expect(trend.every((d) => d.stockIn === 0 && d.stockOut === 0)).toBe(true);
    });
  });

  describe("aging", () => {
    it("sums the ledger's buckets rather than re-deriving from documents", async () => {
      const ar = await dash.getARAgingSummary();
      // No posted entries yet — every bucket is zero rather than undefined.
      expect(ar).toEqual({
        current: 0,
        days30: 0,
        days60: 0,
        days90: 0,
        over90: 0,
        total: 0,
      });
    });
  });
});
