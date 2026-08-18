/**
 * The bills list and row actions, end to end through the server action.
 *
 * The repository has been covered since the AP slice; nothing called it. This
 * exercises the layer above — session to tenant, role gate, separation of
 * duties, system-account resolution, posting — and the shapes the list page
 * actually renders.
 *
 * app/mongodb/actions/bill-actions.js is the reference for behaviour. Three
 * things it gets wrong are asserted here as NOT carried across: a bill due
 * today counted as overdue, money added as JavaScript values, and a list
 * ordered by a column the page does not show.
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
const billActions = await import("@/app/db/actions/bill-actions");
const billRepo = await import("@/app/db/repositories/bills");
const { withTenant } = await import("@/app/db/client");

const iso = (d) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

suite("bill actions (end to end)", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let supplierId;
  let accounts;
  let approver;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  /** Creates a bill directly through the repository — createBill is not the surface under test. */
  async function makeBill(opts = {}) {
    return withTenant(companyUuid, (tx) =>
      billRepo.createBill(tx, {
        companyId: companyUuid,
        supplierId,
        billDate: opts.billDate ?? "2026-08-01",
        // NOT NULL on bills: a payable without a due date cannot be aged.
        dueDate: opts.dueDate ?? "2026-08-31",
        supplierInvoiceNumber: opts.supplierInvoiceNumber ?? null,
        createdById: randomUUID(),
        lines: opts.lines ?? [
          {
            description: "Diesel",
            accountId: accounts.expense,
            quantity: "10",
            unitPrice: "100.0000",
            vatRate: opts.vatRate ?? "0",
          },
        ],
        ...opts.extra,
      }),
    );
  }

  beforeEach(async () => {
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE _migration_id_map, entry_counters`;

    companyUuid = randomUUID();
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    supplierId = randomUUID();
    approver = randomUUID();
    accounts = {
      ap: randomUUID(),
      vatInput: randomUUID(),
      whtPayable: randomUUID(),
      inventory: randomUUID(),
      expense: randomUUID(),
      bank: randomUUID(),
    };

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})
    `;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})
    `;
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
          (${accounts.ap},         ${companyUuid}, '2000', 'Accounts Payable', 'liability', 'accounts_payable'),
          (${accounts.vatInput},   ${companyUuid}, '1400', 'VAT Input',        'asset',     'vat_input'),
          (${accounts.whtPayable}, ${companyUuid}, '2100', 'WHT Payable',      'liability', 'wht_payable'),
          (${accounts.inventory},  ${companyUuid}, '1300', 'Inventory',        'asset',     'inventory')
      `;
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, sub_type) VALUES
          (${accounts.expense}, ${companyUuid}, '5100', 'Fuel',        'expense', 'operating_expense'),
          (${accounts.bank},    ${companyUuid}, '1000', 'Equity Bank', 'asset',   'bank')
      `;
      await tx`
        INSERT INTO parties (id, company_id, primary_type, is_supplier, name)
        VALUES (${supplierId}, ${companyUuid}, 'supplier', true, 'Shell Kenya')
      `;
    });

    getTenantContext.mockResolvedValue({
      user: { id: approver, name: "Ada Manager", role: "Manager" },
      companyId: mongoCompanyId,
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Reads — the shapes the list page renders
  // ───────────────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns the shape the table renders, with money as strings", async () => {
      const bill = await makeBill({ supplierInvoiceNumber: "SUP-77" });

      const { bills, pagination } = await billActions.listBillsForPage({});
      expect(pagination).toEqual({ page: 1, total: 1, totalPages: 1 });

      const [row] = bills;
      expect(row._id).toBe(bill.id);
      expect(row.billNumber).toMatch(/^BILL-/);
      expect(row.supplierInvoiceNumber).toBe("SUP-77");
      // The snapshot taken at the bill, not a join on the party's name today.
      expect(row.supplier.name).toBe("Shell Kenya");
      expect(row.amounts.total).toBe("1000.0000");
      expect(row.amounts.balance).toBe("1000.0000");
      expect(row.status).toBe("draft");
      // Dates come back as plain ISO strings so the page never builds a Date
      // in the server's timezone to decide whether something is overdue.
      expect(row.billDate).toBe("2026-08-01");
    });

    it("orders by bill date, not by insertion order", async () => {
      // Inserted last, dated earliest. The Mongo query sorts on createdAt, so
      // this bill would head a list whose visible "Date" column says otherwise.
      await makeBill({ billDate: "2026-08-20" });
      await makeBill({ billDate: "2026-08-05" });

      const { bills } = await billActions.listBillsForPage({});
      expect(bills.map((b) => b.billDate)).toEqual(["2026-08-20", "2026-08-05"]);
    });

    it("filters by status and paginates", async () => {
      const a = await makeBill({ billDate: "2026-08-02" });
      await makeBill({ billDate: "2026-08-03" });
      await withTenant(companyUuid, (tx) =>
        billRepo.submitBill(tx, a.id, randomUUID()),
      );

      const submitted = await billActions.listBillsForPage({ status: "submitted" });
      expect(submitted.bills).toHaveLength(1);
      expect(submitted.bills[0]._id).toBe(a.id);

      const paged = await billActions.listBillsForPage({ limit: 1 });
      expect(paged.bills).toHaveLength(1);
      expect(paged.pagination).toEqual({ page: 1, total: 2, totalPages: 2 });
    });

    it("searches by bill number, supplier invoice number and supplier name", async () => {
      const bill = await makeBill({ supplierInvoiceNumber: "SUP-77" });

      const byNumber = await billActions.listBillsForPage({
        search: bill.billNumber.slice(0, 6),
      });
      expect(byNumber.bills).toHaveLength(1);

      const bySupplierInvoice = await billActions.listBillsForPage({ search: "SUP-" });
      expect(bySupplierInvoice.bills).toHaveLength(1);

      const byName = await billActions.listBillsForPage({ search: "hell" });
      expect(byName.bills).toHaveLength(1);

      const miss = await billActions.listBillsForPage({ search: "zzz" });
      expect(miss.bills).toHaveLength(0);
      expect(miss.pagination.total).toBe(0);
    });

    it("shows another tenant nothing", async () => {
      await makeBill();
      const otherMongoId = randomUUID().replace(/-/g, "").slice(0, 24);
      const otherUuid = randomUUID();
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${otherUuid}, 'Other', ${"o-" + otherUuid.slice(0, 8)})
      `;
      await admin`
        INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
        VALUES ('companies', ${otherMongoId}, ${otherUuid})
      `;
      getTenantContext.mockResolvedValue({
        user: { id: randomUUID(), name: "Other", role: "Manager" },
        companyId: otherMongoId,
      });

      const { bills, pagination } = await billActions.listBillsForPage({});
      expect(bills).toHaveLength(0);
      expect(pagination.total).toBe(0);
    });
  });

  describe("stats", () => {
    it("sums the outstanding balance in SQL, not by adding strings", async () => {
      // Two approved bills, one part-paid, so unpaid and partial both matter.
      const a = await makeBill({ dueDate: daysFromNow(30) });
      const b = await makeBill({ dueDate: daysFromNow(30) });
      for (const bill of [a, b]) {
        await withTenant(companyUuid, async (tx) => {
          await billRepo.submitBill(tx, bill.id, randomUUID());
          await billRepo.approveBill(tx, bill.id, {
            apAccountId: accounts.ap,
            approvedById: approver,
          });
        });
      }
      await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        await tx`UPDATE bills SET amount_paid = 400 WHERE id = ${b.id}`;
      });

      const stats = await billActions.getBillsStats();
      expect(stats.byPaymentStatus.unpaid).toEqual({
        count: 1,
        balance: "1000.0000",
      });
      expect(stats.byPaymentStatus.partial).toEqual({
        count: 1,
        balance: "600.0000",
      });
      // The figure the card reads. Adding the two above in JavaScript would
      // concatenate: "1000.0000" + "600.0000" = "1000.0000600.0000".
      expect(stats.outstanding).toEqual({ count: 2, balance: "1600.0000" });
    });

    it("does not count a bill due TODAY as overdue", async () => {
      const dueToday = await makeBill({ dueDate: today() });
      const dueYesterday = await makeBill({ dueDate: daysFromNow(-1) });
      for (const bill of [dueToday, dueYesterday]) {
        await withTenant(companyUuid, async (tx) => {
          await billRepo.submitBill(tx, bill.id, randomUUID());
          await billRepo.approveBill(tx, bill.id, {
            apAccountId: accounts.ap,
            approvedById: approver,
          });
        });
      }

      const stats = await billActions.getBillsStats();
      // The Mongo facet tests `dueDate < new Date()` against a field holding
      // midnight, so the bill due today would be counted here for all but the
      // first instant of the day. Overdue means the day has passed.
      expect(stats.overdue.count).toBe(1);
      expect(stats.overdue.total).toBe("1000.0000");
    });

    it("counts submitted bills as pending approval", async () => {
      const bill = await makeBill();
      await billActions.submitBill(bill.id);

      const stats = await billActions.getBillsStats();
      expect(stats.pendingApproval).toEqual({ count: 1, total: "1000.0000" });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Create and edit
  // ───────────────────────────────────────────────────────────────────────────

  /** BillForm submits indexed line fields; this builds the same payload. */
  function billForm({ lines = [], ...fields }) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null) fd.set(k, String(v));
    }
    lines.forEach((line, i) => {
      for (const [k, v] of Object.entries(line)) {
        fd.set(`lines[${i}].${k}`, String(v ?? ""));
      }
    });
    return fd;
  }

  const validForm = (over = {}) =>
    billForm({
      supplierId,
      billDate: "2026-08-01",
      dueDate: "2026-08-31",
      supplierInvoiceNumber: "SUP-01",
      lines: [
        {
          description: "Diesel",
          accountId: accounts.expense,
          quantity: 10,
          unitPrice: 100,
          vatRate: 16,
          unit: "L",
        },
      ],
      ...over,
    });

  describe("create", () => {
    it("creates a draft from the form, with totals derived by trigger", async () => {
      const result = await billActions.createBill(null, validForm());
      expect(result.success).toBe(true);
      expect(result.billNumber).toMatch(/^BILL-/);

      const { bill } = await billActions.getBillById(result.billId);
      expect(bill.status).toBe("draft");
      expect(bill.supplier.name).toBe("Shell Kenya");
      // Nothing in the action computes an amount: the trigger does.
      expect(bill.amounts.subtotal).toBe("1000.0000");
      expect(bill.amounts.vatTotal).toBe("160.0000");
      expect(bill.amounts.total).toBe("1160.0000");
      expect(bill.lines[0].unit).toBe("L");
      // 0029: the creator, as they were named then.
      expect(bill.createdBy).toEqual({ name: "Ada Manager", role: "Manager" });
    });

    it("applies withholding when the form ticks it", async () => {
      const result = await billActions.createBill(
        null,
        validForm({ whtApplicable: "true", whtRate: 5 }),
      );
      expect(result.success).toBe(true);

      const { bill } = await billActions.getBillById(result.billId);
      // Withheld on the VAT-exclusive subtotal, the standard treatment (§9.8).
      expect(bill.amounts.whtAmount).toBe("50.0000");
      expect(bill.amounts.total).toBe("1160.0000");
      expect(bill.amounts.netPayable).toBe("1110.0000");
    });

    it("returns field errors rather than a constraint violation", async () => {
      const result = await billActions.createBill(
        null,
        billForm({ supplierId: "", billDate: "", dueDate: "", lines: [] }),
      );
      expect(result.success).toBe(false);
      expect(result.fieldErrors.supplierId).toBeDefined();
      expect(result.fieldErrors.lines).toBeDefined();
      // The typed values come back so the form can repopulate.
      expect(result.values).toBeDefined();
    });

    it("refuses a line charged to a revenue account", async () => {
      const revenue = randomUUID();
      await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        await tx`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
          VALUES (${revenue}, ${companyUuid}, '4000', 'Sales', 'revenue')
        `;
      });

      const result = await billActions.createBill(
        null,
        validForm({
          lines: [
            {
              description: "Wrong",
              accountId: revenue,
              quantity: 1,
              unitPrice: 1,
              vatRate: 0,
            },
          ],
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/expense or asset/i);
    });

    it("refuses a role that cannot raise bills", async () => {
      getTenantContext.mockResolvedValue({
        user: { id: randomUUID(), name: "Store", role: "Storekeeper" },
        companyId: mongoCompanyId,
      });
      const result = await billActions.createBill(null, validForm());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission/i);
    });
  });

  describe("edit", () => {
    it("replaces the lines and re-derives the totals", async () => {
      const created = await billActions.createBill(null, validForm());
      const result = await billActions.updateBill(
        created.billId,
        null,
        validForm({
          lines: [
            {
              description: "Diesel",
              accountId: accounts.expense,
              quantity: 5,
              unitPrice: 100,
              vatRate: 16,
            },
            {
              description: "Delivery",
              accountId: accounts.expense,
              quantity: 1,
              unitPrice: 200,
              vatRate: 0,
            },
          ],
        }),
      );
      expect(result.success).toBe(true);

      const { bill } = await billActions.getBillById(created.billId);
      expect(bill.lines).toHaveLength(2);
      expect(bill.lines.map((l) => l.lineNumber)).toEqual([1, 2]);
      expect(bill.amounts.subtotal).toBe("700.0000");
      expect(bill.amounts.vatTotal).toBe("80.0000");
    });

    it("returns a rejected bill to draft and clears the rejection", async () => {
      const created = await billActions.createBill(null, validForm());
      await withTenant(companyUuid, (tx) =>
        billRepo.submitBill(tx, created.billId, randomUUID()),
      );
      const fd = new FormData();
      fd.set("reason", "Wrong amount");
      await billActions.rejectBill(created.billId, null, fd);

      const result = await billActions.updateBill(created.billId, null, validForm());
      expect(result.success).toBe(true);

      const { bill } = await billActions.getBillById(created.billId);
      expect(bill.status).toBe("draft");
      // Leaving "rejected by Ada" on a bill that is a draft again describes a
      // state it is no longer in.
      expect(bill.rejectionReason).toBeNull();
      expect(bill.rejectedBy).toBeNull();
    });

    it("refuses to change the supplier, in terms", async () => {
      const other = randomUUID();
      await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        await tx`
          INSERT INTO parties (id, company_id, primary_type, is_supplier, name)
          VALUES (${other}, ${companyUuid}, 'supplier', true, 'Total Kenya')
        `;
      });
      const created = await billActions.createBill(null, validForm());

      const result = await billActions.updateBill(
        created.billId,
        null,
        validForm({ supplierId: other }),
      );
      // 0016 makes the supplier snapshot immutable; the action says so rather
      // than letting a trigger exception reach the user.
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/supplier .* cannot be changed/i);
    });

    it("refuses to edit an approved bill", async () => {
      const created = await billActions.createBill(null, validForm());
      await withTenant(companyUuid, async (tx) => {
        await billRepo.submitBill(tx, created.billId, randomUUID());
        await billRepo.approveBill(tx, created.billId, {
          apAccountId: accounts.ap,
          vatInputAccountId: accounts.vatInput,
          approvedById: approver,
        });
      });

      const result = await billActions.updateBill(created.billId, null, validForm());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Cannot edit a bill in approved status/);
    });
  });

  describe("payment", () => {
    async function approvedBill(over = {}) {
      const created = await billActions.createBill(null, validForm(over));
      await withTenant(companyUuid, async (tx) => {
        await billRepo.submitBill(tx, created.billId, randomUUID());
        await billRepo.approveBill(tx, created.billId, {
          apAccountId: accounts.ap,
          vatInputAccountId: accounts.vatInput,
          approvedById: approver,
        });
      });
      return created.billId;
    }

    function paymentForm(over = {}) {
      const fd = new FormData();
      fd.set("amount", "500");
      fd.set("paymentMethod", "bank_transfer");
      fd.set("accountId", accounts.bank);
      fd.set("paymentDate", "2026-08-20");
      fd.set("reference", "EFT-1");
      for (const [k, v] of Object.entries(over)) fd.set(k, String(v));
      return fd;
    }

    it("records, allocates and POSTS the payment in one transaction", async () => {
      const billId = await approvedBill();
      const result = await billActions.createBillPayment(billId, null, paymentForm());
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/^Payment PMT-/);

      const { bill } = await billActions.getBillById(billId);
      expect(bill.amounts.paid).toBe("500.0000");
      expect(bill.amounts.balance).toBe("660.0000");
      expect(bill.paymentStatus).toBe("partial");
      expect(bill.payments).toHaveLength(1);

      // The leg that did not exist: DR Accounts Payable, CR bank. Without it
      // the bill settles while the trial balance still shows the payable.
      const lines = await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        return tx`
          SELECT a.account_code, l.debit::text AS dr, l.credit::text AS cr
            FROM journal_lines l
            JOIN journal_entries e ON e.id = l.entry_id
            JOIN accounts a ON a.id = l.account_id
           WHERE e.entry_type = 'payment_made'
           ORDER BY a.account_code
        `;
      });
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ account_code: "1000", dr: "0.0000", cr: "500.0000" });
      expect(lines[1]).toMatchObject({ account_code: "2000", dr: "500.0000", cr: "0.0000" });
    });

    it("settles the bill exactly when paid in full", async () => {
      const billId = await approvedBill();
      const result = await billActions.createBillPayment(
        billId,
        null,
        paymentForm({ amount: "1160" }),
      );
      expect(result.success).toBe(true);

      const { bill } = await billActions.getBillById(billId);
      expect(bill.amounts.balance).toBe("0.0000");
      expect(bill.paymentStatus).toBe("paid");
    });

    it("refuses to overpay, to the cent", async () => {
      const billId = await approvedBill();
      // bill-actions.js:1438 guards with `amount > balance + 0.01`, so this
      // would be allowed there. CHECK (balance >= 0) is exact.
      const result = await billActions.createBillPayment(
        billId,
        null,
        paymentForm({ amount: "1160.01" }),
      );
      expect(result.success).toBe(false);

      const { bill } = await billActions.getBillById(billId);
      expect(bill.amounts.paid).toBe("0.0000");
      // And no orphan payment: the whole thing is one transaction.
      const pays = await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        return tx`SELECT 1 FROM payments`;
      });
      expect(pays).toHaveLength(0);
    });

    it("refuses to pay a bill that has not been approved", async () => {
      const created = await billActions.createBill(null, validForm());
      const result = await billActions.createBillPayment(
        created.billId,
        null,
        paymentForm(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/must be approved before/i);
    });

    it("returns a field error for a missing amount", async () => {
      const billId = await approvedBill();
      const result = await billActions.createBillPayment(
        billId,
        null,
        paymentForm({ amount: "0" }),
      );
      expect(result.success).toBe(false);
      expect(result.fieldErrors.amount).toMatch(/greater than zero/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Workflow
  // ───────────────────────────────────────────────────────────────────────────

  describe("submit and approve", () => {
    it("submits a draft, recording who did it by name", async () => {
      const bill = await makeBill();
      const result = await billActions.submitBill(bill.id);
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/submitted for approval/);

      const { bill: detail } = await billActions.getBillById(bill.id);
      expect(detail.status).toBe("submitted");
      expect(detail.submittedBy).toEqual({ name: "Ada Manager" });
      // A submitted bill is no longer editable.
      expect(detail.canEdit).toBe(false);
    });

    it("approves a submitted bill and posts a balanced entry", async () => {
      const bill = await makeBill({ vatRate: "16" });
      await withTenant(companyUuid, (tx) =>
        billRepo.submitBill(tx, bill.id, randomUUID()),
      );

      const result = await billActions.approveBill(bill.id);
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/approved and posted/);

      const rows = await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        return tx`
          SELECT SUM(l.debit)::text AS dr, SUM(l.credit)::text AS cr
            FROM journal_lines l
            JOIN journal_entries e ON e.id = l.entry_id
           WHERE e.status = 'posted'
        `;
      });
      // 1000 expense + 160 VAT input against 1160 payable.
      expect(rows[0].dr).toBe("1160.0000");
      expect(rows[0].cr).toBe("1160.0000");
    });

    it("refuses to approve a bill the same user submitted", async () => {
      const bill = await makeBill();
      // The submitter is the session user, and Manager is not an admin role.
      await billActions.submitBill(bill.id);

      const result = await billActions.approveBill(bill.id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cannot approve a bill you submitted/i);

      const { bills } = await billActions.listBillsForPage({});
      expect(bills[0].status).toBe("submitted");
    });

    it("lets a SuperAdmin approve their own submission, as an Admin can", async () => {
      // The reference tests `user.role !== "Admin"`, so a SuperAdmin who
      // submitted is refused while an Admin is not — the only place in the
      // codebase where SuperAdmin ranks below Admin. Both override here.
      for (const role of ["SuperAdmin", "Admin"]) {
        const userId = randomUUID();
        getTenantContext.mockResolvedValue({
          user: { id: userId, name: role, role },
          companyId: mongoCompanyId,
        });
        const bill = await makeBill();
        await billActions.submitBill(bill.id);
        const result = await billActions.approveBill(bill.id);
        expect(result.success, `${role} should be able to override`).toBe(true);
      }
    });

    it("refuses a role that cannot approve", async () => {
      const bill = await makeBill();
      await withTenant(companyUuid, (tx) =>
        billRepo.submitBill(tx, bill.id, randomUUID()),
      );
      getTenantContext.mockResolvedValue({
        user: { id: randomUUID(), name: "Storekeeper", role: "Storekeeper" },
        companyId: mongoCompanyId,
      });

      const result = await billActions.approveBill(bill.id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission/i);
    });

    it("names the missing system account rather than failing opaquely", async () => {
      await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        await tx`UPDATE accounts SET system_account = NULL WHERE id = ${accounts.ap}`;
      });
      const bill = await makeBill();
      await withTenant(companyUuid, (tx) =>
        billRepo.submitBill(tx, bill.id, randomUUID()),
      );

      const result = await billActions.approveBill(bill.id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Accounts Payable system account not configured/);
    });
  });

  describe("detail", () => {
    it("returns the shapes the detail page renders", async () => {
      const bill = await makeBill({
        supplierInvoiceNumber: "SUP-77",
        vatRate: "16",
      });

      const { bill: detail, error } = await billActions.getBillById(bill.id);
      expect(error).toBeNull();
      expect(detail.billNumber).toMatch(/^BILL-/);
      expect(detail.supplier).toMatchObject({ name: "Shell Kenya" });
      expect(detail.canEdit).toBe(true);

      const [line] = detail.lines;
      expect(line.description).toBe("Diesel");
      // The snapshots, not a join: what the line was charged to.
      expect(line.account).toMatchObject({ code: "5100", name: "Fuel", type: "expense" });
      // vat_rate is numeric(5,2) — a rate, not money.
      expect(line.vat).toEqual({ rate: "16.00", amount: "160.0000" });
      expect(line.lineTotal).toBe("1160.0000");
    });

    it("populates the VAT and withholding rows the page guards on", async () => {
      const bill = await makeBill({ vatRate: "16" });
      const { bill: detail } = await billActions.getBillById(bill.id);

      // bill-queries.js:88-89 projects amounts.vatTotal and amounts.whtAmount;
      // the model stores amounts.vat and amounts.wht. Both resolve to 0, so
      // the page's `vatTotal > 0` guard is never true and the VAT row on the
      // totals card has never rendered. It renders now.
      expect(detail.amounts.vatTotal).toBe("160.0000");
      expect(detail.amounts.subtotal).toBe("1000.0000");
      expect(detail.amounts.total).toBe("1160.0000");
      // Generated, not recomputed on the page as total - wht.
      expect(detail.amounts.netPayable).toBe("1160.0000");
      expect(detail.amounts.balance).toBe("1160.0000");
    });

    it("reads the payment history from the allocations, not an embedded copy", async () => {
      const bill = await makeBill();
      await withTenant(companyUuid, async (tx) => {
        await billRepo.submitBill(tx, bill.id, randomUUID());
        await billRepo.approveBill(tx, bill.id, {
          apAccountId: accounts.ap,
          approvedById: approver,
        });
      });

      const paymentId = randomUUID();
      await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        await tx`
          INSERT INTO payments (
            id, company_id, payment_number, payment_type, payment_date,
            payment_method, party_id, party_name_at_payment, amount,
            account_id, account_code_at_payment, account_name_at_payment,
            status, reference
          ) VALUES (
            ${paymentId}, ${companyUuid}, 'PAY-00001', 'made', '2026-08-15',
            'bank_transfer', ${supplierId}, 'Shell Kenya', 400,
            ${accounts.ap}, '2000', 'Accounts Payable', 'confirmed', 'EFT-9'
          )
        `;
        await tx`
          INSERT INTO payment_allocations (
            company_id, payment_id, document_type, document_id,
            document_number_at_allocation, original_amount, balance_before,
            amount_allocated
          ) VALUES (
            ${companyUuid}, ${paymentId}, 'bill', ${bill.id},
            ${bill.billNumber}, 1000, 1000, 400
          )
        `;
      });

      const { bill: detail } = await billActions.getBillById(bill.id);
      expect(detail.payments).toHaveLength(1);
      expect(detail.payments[0]).toMatchObject({
        paymentNumber: 'PAY-00001',
        amount: "400.0000",
        reference: "EFT-9",
      });
      // amount_paid is derived from the allocations by trigger (0016/0017),
      // so the history and the balance cannot disagree — the §8.2 correction.
      expect(detail.amounts.paid).toBe("400.0000");
      expect(detail.amounts.balance).toBe("600.0000");
      expect(detail.paymentStatus).toBe("partial");
    });

    it("carries who acted, since there is no users table to join to", async () => {
      const bill = await makeBill();
      await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        await tx`
          UPDATE bills
             SET created_by_name = 'Ada Manager', created_by_role = 'Manager'
           WHERE id = ${bill.id}
        `;
      });

      const { bill: detail } = await billActions.getBillById(bill.id);
      expect(detail.createdBy).toEqual({ name: "Ada Manager", role: "Manager" });
    });

    it("lists only approved bills still awaiting a goods receipt", async () => {
      // Approved the ordinary way: goods admitted, nothing outstanding.
      const direct = await makeBill();
      await withTenant(companyUuid, async (tx) => {
        await billRepo.submitBill(tx, direct.id, randomUUID());
        await billRepo.approveBill(tx, direct.id, {
          apAccountId: accounts.ap,
          approvedById: approver,
        });
      });

      // Three-way match: the purchase posted to GR/IR and the goods have not
      // arrived, so this one is awaiting receipt.
      const grni = randomUUID();
      const grniBill = await makeBill({
        lines: [
          {
            description: "Cement",
            accountId: accounts.inventory,
            quantity: "10",
            unitPrice: "100.0000",
            vatRate: "0",
            productId: null,
          },
        ],
      });
      await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        await tx`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
          VALUES (${grni}, ${companyUuid}, '2400', 'GR/IR Clearing', 'liability')
        `;
        await tx`
          UPDATE bills SET status = 'approved', used_grni = true,
                           inventory_moved = false
           WHERE id = ${grniBill.id}
        `;
      });

      const awaiting = await billActions.getBillsAwaitingGRN();
      expect(awaiting.map((b) => b._id)).toEqual([grniBill.id]);
      expect(awaiting[0].supplier.partyId).toBe(supplierId);
    });

    it("gives the GRN prefill a supplier id to work from", async () => {
      const bill = await makeBill();
      const { bill: detail } = await billActions.getBillById(bill.id);
      // The GRN page reads bill.supplier.partyId and bill.lines[].product.id.
      expect(detail.supplier.partyId).toBe(supplierId);
      expect(detail.supplier.name).toBe("Shell Kenya");
    });

    it("reads a bill in another tenant as absent, not forbidden", async () => {
      const bill = await makeBill();
      const otherMongoId = randomUUID().replace(/-/g, "").slice(0, 24);
      const otherUuid = randomUUID();
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${otherUuid}, 'Other', ${"o-" + otherUuid.slice(0, 8)})
      `;
      await admin`
        INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
        VALUES ('companies', ${otherMongoId}, ${otherUuid})
      `;
      getTenantContext.mockResolvedValue({
        user: { id: randomUUID(), name: "Other", role: "Manager" },
        companyId: otherMongoId,
      });

      const { bill: detail, error } = await billActions.getBillById(bill.id);
      // RLS filtered it out before the query saw it, so the page 404s rather
      // than confirming the row exists (§2.2).
      expect(detail).toBeNull();
      expect(error).toBe("Bill not found");
    });
  });

  describe("reject and delete", () => {
    it("rejects a submitted bill with a reason", async () => {
      const bill = await makeBill();
      await withTenant(companyUuid, (tx) =>
        billRepo.submitBill(tx, bill.id, randomUUID()),
      );

      const fd = new FormData();
      fd.set("reason", "Wrong supplier");
      const result = await billActions.rejectBill(bill.id, null, fd);
      expect(result.success).toBe(true);

      const { bill: detail } = await billActions.getBillById(bill.id);
      expect(detail.status).toBe("rejected");
      expect(detail.rejectionReason).toBe("Wrong supplier");
      // The 0029 snapshot: the page renders rejectedBy.name, and there is no
      // users table to resolve rejected_by_id against.
      expect(detail.rejectedBy).toEqual({ name: "Ada Manager" });
    });

    it("refuses to reject without a reason", async () => {
      const bill = await makeBill();
      await withTenant(companyUuid, (tx) =>
        billRepo.submitBill(tx, bill.id, randomUUID()),
      );
      const result = await billActions.rejectBill(bill.id, null, new FormData());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/rejection reason/i);
    });

    it("cancels an approved bill by reversing its entry, not deleting it", async () => {
      const bill = await makeBill();
      await withTenant(companyUuid, async (tx) => {
        await billRepo.submitBill(tx, bill.id, randomUUID());
        await billRepo.approveBill(tx, bill.id, {
          apAccountId: accounts.ap,
          approvedById: approver,
        });
      });

      const fd = new FormData();
      fd.set("reason", "Duplicate");
      const result = await billActions.cancelBill(bill.id, null, fd);
      expect(result.success).toBe(true);

      const { bill: detail } = await billActions.getBillById(bill.id);
      expect(detail.status).toBe("cancelled");
      expect(detail.cancelledBy).toEqual({ name: "Ada Manager" });

      // The original entry stands and a reversing one joins it, so the ledger
      // records what happened rather than pretending it did not.
      const entries = await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        return tx`
          SELECT SUM(l.debit)::text AS dr, SUM(l.credit)::text AS cr,
                 count(DISTINCT e.id)::int AS n
            FROM journal_lines l
            JOIN journal_entries e ON e.id = l.entry_id
        `;
      });
      expect(entries[0].n).toBe(2);
      // Net zero across both, and each side still ties.
      expect(entries[0].dr).toBe("2000.0000");
      expect(entries[0].cr).toBe("2000.0000");
    });

    it("deletes a draft, and its lines with it", async () => {
      const bill = await makeBill();
      const result = await billActions.deleteBill(bill.id);
      expect(result.success).toBe(true);

      const lines = await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        return tx`SELECT 1 FROM bill_lines WHERE bill_id = ${bill.id}`;
      });
      expect(lines).toHaveLength(0);
    });

    it("refuses to delete anything that has been submitted", async () => {
      const bill = await makeBill();
      await withTenant(companyUuid, (tx) =>
        billRepo.submitBill(tx, bill.id, randomUUID()),
      );

      const result = await billActions.deleteBill(bill.id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Only draft bills can be deleted/);

      const { bills } = await billActions.listBillsForPage({});
      expect(bills).toHaveLength(1);
    });

    it("returns a message rather than throwing for a bill in another tenant", async () => {
      const result = await billActions.deleteBill(randomUUID());
      expect(result.success).toBe(false);
      // RLS filters the row out before the repository sees it, so it reads as
      // absent rather than forbidden — invisible, not leaked.
      expect(result.error).toMatch(/Bill not found/);
    });
  });
});
