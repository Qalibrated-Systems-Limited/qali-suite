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

  describe("the financial overview", () => {
    // Revenue and expense accounts carry OPPOSITE natural balances, so the
    // sign convention is the thing to get right: revenue is credit-less-debit
    // and expense is debit-less-credit. Backwards, a profitable month shows a
    // loss.
    const post = async ({ date, lines }) => {
      const entryId = randomUUID();
      await admin`
        INSERT INTO journal_entries (id, company_id, entry_number, entry_date,
                                     entry_type, description, status)
        VALUES (${entryId}, ${companyUuid}, ${"JE-" + entryId.slice(0, 6)},
                ${date}, 'adjustment', 'Test', 'draft')`;
      let n = 0;
      for (const l of lines) {
        n += 1;
        await admin`
          INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit)
          VALUES (${companyUuid}, ${entryId}, ${l.account}, ${n}, ${l.debit ?? 0}, ${l.credit ?? 0})`;
      }
      await admin`UPDATE journal_entries SET status='posted', posted_at=now() WHERE id = ${entryId}`;
    };

    let revenueAcct, expenseAcct, bankAcct;
    beforeEach(async () => {
      revenueAcct = randomUUID();
      expenseAcct = randomUUID();
      bankAcct = randomUUID();
      await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        await tx`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type, sub_type) VALUES
            (${revenueAcct}, ${companyUuid}, '4000', 'Sales',   'revenue', NULL),
            (${expenseAcct}, ${companyUuid}, '5000', 'Rent',    'expense', NULL),
            (${bankAcct},    ${companyUuid}, '1000', 'Equity Bank', 'asset', 'bank')`;
      });
    });

    it("reads revenue as credit-less-debit and expense the other way", async () => {
      const today = new Date().toISOString().slice(0, 10);
      await post({
        date: today,
        lines: [
          { account: bankAcct, debit: 1000 },
          { account: revenueAcct, credit: 1000 },
        ],
      });
      await post({
        date: today,
        lines: [
          { account: expenseAcct, debit: 300 },
          { account: bankAcct, credit: 300 },
        ],
      });

      const o = await dash.getFinancialOverview();
      expect(o.revenue.current).toBe(1000);
      expect(o.expenses.current).toBe(300);
      expect(o.profit.current).toBe(700);
      // Cash is the LEDGER balance of the bank account, not a stored figure.
      expect(o.cash.bankOnly).toBe(700);
      expect(o.cash.balance).toBe(700);
    });

    it("reports no change rather than infinity against a zero base", async () => {
      const o = await dash.getFinancialOverview();
      expect(o.revenue.trend).toBe(0);
      expect(o.profit.trend).toBe(0);
    });

    it("returns a point per month, zero-filled", async () => {
      const trend = await dash.getRevenueTrend(6);
      expect(trend).toHaveLength(6);
      expect(trend.every((m) => /^\d{4}-\d{2}$/.test(m.month))).toBe(true);
    });

    it("breaks expenses down by account, largest first", async () => {
      const today = new Date().toISOString().slice(0, 10);
      await post({
        date: today,
        lines: [
          { account: expenseAcct, debit: 500 },
          { account: bankAcct, credit: 500 },
        ],
      });
      const breakdown = await dash.getExpenseBreakdown();
      expect(breakdown[0]).toEqual({ category: "Rent", value: 500 });
    });

    it("lists recent postings with the entry's size", async () => {
      const today = new Date().toISOString().slice(0, 10);
      await post({
        date: today,
        lines: [
          { account: bankAcct, debit: 250 },
          { account: revenueAcct, credit: 250 },
        ],
      });
      const [txn] = await dash.getRecentTransactions();
      // Sum of the DEBITS — a balanced entry gives the same either side.
      expect(txn.amount).toBe(250);
      expect(txn.entryDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("the accountant's workload", () => {
    it("separates what is late from what falls due this week", async () => {
      await admin`
        INSERT INTO invoices (company_id, invoice_number, invoice_date, due_date,
                              customer_id, subtotal, total, amount_paid, status, payment_status)
        VALUES
          (${companyUuid}, 'L-1', CURRENT_DATE - 60, CURRENT_DATE - 10,
           ${customerId}, 1000, 1000, 200, 'completed', 'partial'),
          (${companyUuid}, 'W-1', CURRENT_DATE, CURRENT_DATE + 3,
           ${customerId}, 500, 500, 0, 'completed', 'unpaid')`;

      const w = await dash.getAccountantWorkload();
      expect(w.overdueInvoices.count).toBe(1);
      // What is STILL DUE on it, not the invoice total.
      expect(w.overdueInvoices.total).toBe(800);
      expect(w.dueThisWeek.count).toBe(1);
      expect(w.dueThisWeek.total).toBe(500);
    });
  });

  describe("the headline metrics", () => {
    it("takes AR and AP from the ledger, not from summing documents", async () => {
      await addProduct({ sku: "A", onHand: 10, cost: 40, reorder: 2 });
      const m = await dash.getKeyMetrics();
      expect(m.stockValue).toBe(400);
      expect(m.lowStockCount).toBe(0);
      // No posted entries, so nothing is outstanding either way.
      expect(m.arOutstanding).toBe(0);
      expect(m.apOutstanding).toBe(0);
    });

    it("renames the moved-products figures for the tile that reads them", async () => {
      const top = await dash.getTopProducts(5);
      expect(Array.isArray(top)).toBe(true);
      // { name, sku, quantity } — not the { SKU, totalMoved } of the source.
      for (const p of top) expect(Object.keys(p).sort()).toEqual(["name", "quantity", "sku"]);
    });

    it("keys the movement chart by direction", async () => {
      const trend = await dash.getStockMovementTrend(7);
      expect(trend).toHaveLength(7);
      // Recharts series are named after the directions, not stockIn/stockOut.
      expect(Object.keys(trend[0]).sort()).toEqual(["date", "in", "out"]);
      expect(trend[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("counts today's movements", async () => {
      expect(await dash.getTodayMovementCount()).toBe(0);
    });
  });

  describe("aging", () => {
    it("sums the ledger's buckets rather than re-deriving from documents", async () => {
      const ar = await dash.getARAgingSummary();
      // An ARRAY of {bucket, amount} — the shape the dashboards reduce over.
      // Labelled the way they index it, not the way the SQL names its columns.
      expect(ar.map((b) => b.bucket)).toEqual([
        "current",
        "1-30",
        "31-60",
        "61-90",
        "90+",
      ]);
      // No posted entries yet — every bucket is zero rather than missing.
      expect(ar.every((b) => b.amount === 0)).toBe(true);
    });
  });
});
