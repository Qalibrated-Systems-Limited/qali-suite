/**
 * Stock changes pass a chain of approvers who tick every line
 * (stock_changes_pass_three_approvers_who_tick_every_line).
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
const stepActions = await import("@/app/db/actions/approval-step-actions");
const approvalActions = await import("@/app/db/actions/approval-actions");

suite("stock approval chain", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let inventoryAcct;
  let adjustmentAcct;
  let widget;
  let gadget;

  let currentRole = "Admin";
  const asRole = (role) => {
    currentRole = role;
    return getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: `${role} User`, role },
      companyId: mongoCompanyId,
    });
  };

  /**
   * Drive an adjustment's approval chain to the end: one different person per
   * step, each ticking every line. Returns the last step's result.
   */
  const approveChain = async (adjustmentId, role = "Admin") => {
    const before = currentRole;
    const [a] = await admin`
      SELECT id::text AS id, total_steps FROM approval_requests
       WHERE target_id = ${adjustmentId} ORDER BY created_at DESC LIMIT 1`;
    const lines = (await admin`
      SELECT id::text AS id FROM stock_adjustment_lines WHERE adjustment_id = ${adjustmentId}::uuid`).map((l) => l.id);
    let res;
    for (let i = 0; i < a.total_steps; i++) {
      asRole(role);
      const fd = new FormData();
      fd.append("confirmedLines", JSON.stringify(lines));
      res = await approvalActions.approveApproval(a.id, null, fd);
      if (!res.success) break;
    }
    asRole(before);
    return res;
  };

  /** The form's payload: one JSON field, items in increase/decrease terms. */
  const submit = async (items, over = {}) => {
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
    const r = await adjustments.createStockAdjustmentPg(null, fd);
    // Every change now passes the three-step chain. As an Admin (the old
    // fully-authorised path) the tests below drive it to the end, so what
    // they assert is what an approved adjustment does.
    if (r.success && currentRole === "Admin") {
      const [row] = await admin`SELECT status FROM stock_adjustments WHERE id = ${r.adjustmentId}`;
      if (row?.status === "draft") await approveChain(r.adjustmentId);
    }
    return r;
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

  const raise = async (items) => {
    asRole("Storekeeper");
    const r = await submit(items);
    expect(r.success).toBe(true);
    const [a] = await admin`
      SELECT id::text AS id, current_step, total_steps, current_step_label, status::text AS status
        FROM approval_requests WHERE target_id = ${r.adjustmentId}`;
    const lines = (await admin`
      SELECT id::text AS id FROM stock_adjustment_lines WHERE adjustment_id = ${r.adjustmentId}::uuid`).map((l) => l.id);
    return { r, a, lines };
  };
  const as = (role, id = randomUUID()) =>
    getTenantContext.mockResolvedValue({ user: { id, name: `${role} ${id.slice(0, 4)}`, role }, companyId: mongoCompanyId });
  const sign = (approvalId, lines, note = "") => {
    const fd = new FormData();
    fd.append("confirmedLines", JSON.stringify(lines));
    fd.append("note", note);
    return approvalActions.approveApproval(approvalId, null, fd);
  };
  const stepOf = async (id) =>
    (await admin`SELECT current_step, status::text AS status FROM approval_requests WHERE id = ${id}::uuid`)[0];

  it("needs three different approvers, and moves stock only at the last", async () => {
    const { r, a, lines } = await raise([item(widget, "decrease", 10, "Damaged")]);
    expect(a.total_steps).toBe(3);
    expect(a.current_step_label).toBe("Store check");

    as("Store Manager");
    expect((await sign(a.id, lines)).success).toBe(true);
    expect((await levels(widget)).on_hand).toBe(100);
    as("Manager");
    expect((await sign(a.id, lines)).success).toBe(true);
    expect((await levels(widget)).on_hand).toBe(100);
    as("Finance Manager");
    expect((await sign(a.id, lines)).success).toBe(true);

    expect((await levels(widget)).on_hand).toBe(90);
    expect((await stepOf(a.id)).status).toBe("approved");
    const sigs = await admin`SELECT step_no, step_label, jsonb_array_length(confirmed_lines) AS n
                               FROM approval_step_decisions WHERE approval_id = ${a.id}::uuid ORDER BY step_no`;
    expect(sigs.map((s) => s.step_label)).toEqual(["Store check", "Operations review", "Finance approval"]);
    expect(sigs.every((s) => s.n === 1)).toBe(true);
    const [adj] = await admin`SELECT status::text AS status FROM stock_adjustments WHERE id = ${r.adjustmentId}`;
    expect(adj.status).toBe("approved");
  });

  it("refuses an approval until every line is ticked", async () => {
    const { a, lines } = await raise([item(widget, "decrease", 1), item(gadget, "increase", 2)]);
    as("Store Manager");
    const res = await sign(a.id, lines.slice(0, 1));
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/tick every line/i);
    expect((await stepOf(a.id)).current_step).toBe(1);
  });

  it("lets one person sign only one step", async () => {
    const { a, lines } = await raise([item(widget, "decrease", 1)]);
    const me = randomUUID();
    as("Admin", me);
    expect((await sign(a.id, lines)).success).toBe(true);
    as("Admin", me);
    const again = await sign(a.id, lines);
    expect(again.success).toBe(false);
    expect(again.error).toMatch(/already signed/i);
  });

  it("does not let the person who raised it sign any step", async () => {
    const raiser = randomUUID();
    asRole("Store Manager");
    as("Store Manager", raiser);
    const r = await submit([item(widget, "decrease", 1)]);
    const [a] = await admin`SELECT id::text AS id FROM approval_requests WHERE target_id = ${r.adjustmentId}`;
    const lines = (await admin`SELECT id::text AS id FROM stock_adjustment_lines WHERE adjustment_id = ${r.adjustmentId}::uuid`).map((l) => l.id);
    as("Store Manager", raiser);
    const res = await sign(a.id, lines);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/you raised this/i);
  });

  it("only lets the current step's roles act, and shows each role its own queue", async () => {
    const { a, lines } = await raise([item(widget, "decrease", 1)]);
    as("Finance Manager");
    expect((await sign(a.id, lines)).error).toMatch(/waiting for/i);
    expect(await approvalActions.getApprovalQueuePg()).toHaveLength(0);

    as("Storekeeper");
    const q = await approvalActions.getApprovalQueuePg();
    expect(q).toHaveLength(1);
    expect(q[0].chain.lines).toHaveLength(1);
    expect(q[0].chain.canSign).toBe(true);
    expect((await sign(a.id, lines)).success).toBe(true);

    as("Storekeeper");
    expect(await approvalActions.getApprovalQueuePg()).toHaveLength(0);
    as("Manager");
    expect(await approvalActions.getApprovalQueuePg()).toHaveLength(1);
  });

  it("a rejection at any step needs a reason and voids the draft", async () => {
    const { r, a, lines } = await raise([item(widget, "decrease", 5)]);
    as("Store Manager");
    await sign(a.id, lines);
    as("Manager");
    const fd = new FormData();
    expect((await approvalActions.rejectApproval(a.id, null, fd)).success).toBe(false);
    fd.append("note", "Counted again: only 2 damaged");
    expect((await approvalActions.rejectApproval(a.id, null, fd)).success).toBe(true);
    const [adj] = await admin`SELECT status::text AS status FROM stock_adjustments WHERE id = ${r.adjustmentId}`;
    expect(adj.status).not.toBe("approved");
    expect((await levels(widget)).on_hand).toBe(100);
  });

  it("follows the company's own chain when one is set", async () => {
    as("Admin");
    const saved = await stepActions.saveApprovalStepPolicy("stock_adjustment", [
      { label: "Store", roles: ["Store Manager"] },
      { label: "Finance", roles: ["CFO"] },
    ]);
    expect(saved.success).toBe(true);
    const { a, lines } = await raise([item(widget, "decrease", 1)]);
    expect(a.total_steps).toBe(2);
    as("Store Manager");
    expect((await sign(a.id, lines)).success).toBe(true);
    as("CFO");
    expect((await sign(a.id, lines)).success).toBe(true);
    expect((await levels(widget)).on_hand).toBe(99);
  });
});
