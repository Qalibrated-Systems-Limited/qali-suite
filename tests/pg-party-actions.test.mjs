/**
 * Parties — customers, suppliers and employees — end to end through the
 * server actions.
 *
 * The thing under test that is not obvious: Mongo carries a four-valued `type`
 * (customer / supplier / both / employee), Postgres carries three independent
 * booleans and a primary type (§5). The forms still speak `type`, so it is
 * translated in and DERIVED out. Most of what follows is checking that the
 * translation holds in both directions, because a stored copy of a function of
 * three booleans is exactly the kind of thing that drifts.
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
const party = await import("@/app/db/actions/party-actions");
const invoiceActions = await import("@/app/db/actions/invoice-actions");

/** The id shape a real session carries. */
const objectId = () =>
  Array.from({ length: 24 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

suite("party actions (end to end)", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let userId;
  let acct;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  /** Builds the payload the parties form submits. */
  function form(fields) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null) fd.set(k, String(v));
    }
    return fd;
  }

  const make = (over = {}) =>
    party.createParty(null, form({ name: "Acme Ltd", type: "customer", ...over }));

  beforeEach(async () => {
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE _migration_id_map, entry_counters`;

    companyUuid = randomUUID();
    mongoCompanyId = objectId();
    userId = objectId();
    acct = { ar: randomUUID(), ap: randomUUID(), sales: randomUUID() };

    await admin`INSERT INTO companies (id, name, slug)
                VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
          (${acct.ar},    ${companyUuid}, '1200', 'Accounts Receivable', 'asset',     'accounts_receivable'),
          (${acct.ap},    ${companyUuid}, '2000', 'Accounts Payable',    'liability', 'accounts_payable'),
          (${acct.sales}, ${companyUuid}, '4000', 'Sales',               'revenue',   'sales_revenue')
      `;
    });

    getTenantContext.mockResolvedValue({
      user: { id: userId, name: "Ada Manager", role: "Admin" },
      companyId: mongoCompanyId,
      companyCode: "PILOT",
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The role model
  // ───────────────────────────────────────────────────────────────────────────

  describe("roles", () => {
    it("maps each form type onto the roles it means", async () => {
      const cases = [
        ["customer", { isCustomer: true, isSupplier: false, isEmployee: false }],
        ["supplier", { isCustomer: false, isSupplier: true, isEmployee: false }],
        ["both", { isCustomer: true, isSupplier: true, isEmployee: false }],
        ["employee", { isCustomer: false, isSupplier: false, isEmployee: true }],
      ];

      for (const [type, expected] of cases) {
        const created = await make({ name: `${type} co`, type });
        expect(created.success, created.error).toBe(true);

        const detail = await party.getPartyById(created.partyId);
        expect(
          {
            isCustomer: detail.isCustomer,
            isSupplier: detail.isSupplier,
            isEmployee: detail.isEmployee,
          },
          type,
        ).toEqual(expected);
        // And it reads back as the same four-valued type the form sent.
        expect(detail.type, type).toBe(type);
      }
    });

    it("shows a customer-and-supplier as 'both' without storing the word", async () => {
      const created = await make({ name: "Dual Traders", type: "both" });

      const [row] = await admin`
        SELECT primary_type::text, is_customer, is_supplier
          FROM parties WHERE id = ${created.partyId}
      `;
      // "both" is not a value the database holds — it is the two flags. An
      // enum has to invent a fourth value to say this; booleans just say it.
      expect(row.primary_type).toBe("customer");
      expect(row.is_customer).toBe(true);
      expect(row.is_supplier).toBe(true);

      const detail = await party.getPartyById(created.partyId);
      expect(detail.type).toBe("both");
    });

    it("keeps the primary type on a role the party still holds", async () => {
      const created = await make({ name: "Shell", type: "supplier" });
      // Dropping the supplier role from a supplier-primary party would leave
      // primary_type naming a role it no longer has, which the CHECK refuses.
      const updated = await party.convertPartyType(created.partyId, "customer");
      expect(updated.success, updated.error).toBe(true);

      const [row] = await admin`
        SELECT primary_type::text, is_supplier FROM parties WHERE id = ${created.partyId}
      `;
      expect(row.primary_type).toBe("customer");
      expect(row.is_supplier).toBe(false);
    });

    it("refuses a party that is nothing at all", async () => {
      const created = await make();
      const result = await party.updateParty(
        created.partyId,
        null,
        form({ name: "Acme Ltd", type: "" }),
      );
      expect(result.success).toBe(false);
      expect(result.errors.type).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns the shape the table renders", async () => {
      const created = await make({
        name: "Acme Ltd",
        displayName: "ACME",
        email: "AP@Acme.CO",
        phone: "0700",
        taxPin: "P051",
        creditLimit: 50000,
        paymentTermsDays: 45,
      });
      expect(created.success, created.error).toBe(true);

      const { parties, total, totalPages } = await party.getPartiesPaginated();
      expect({ total, totalPages }).toEqual({ total: 1, totalPages: 1 });

      const [row] = parties;
      expect(row._id).toBe(created.partyId);
      expect(row.name).toBe("Acme Ltd");
      expect(row.displayName).toBe("ACME");
      // Lower-cased on the way in, so a duplicate cannot hide behind casing.
      expect(row.email).toBe("ap@acme.co");
      expect(row.type).toBe("customer");
      expect(row.isActive).toBe(true);
      expect(row.creditTerms).toEqual({
        creditLimit: "50000.0000",
        paymentTermsDays: 45,
      });
    });

    it("filters by role using the booleans, not a stored label", async () => {
      await make({ name: "Only Customer", type: "customer" });
      await make({ name: "Only Supplier", type: "supplier" });
      await make({ name: "Dual", type: "both" });

      const customers = await party.getPartiesPaginated("", 1, "customer");
      expect(customers.parties.map((p) => p.name).sort()).toEqual([
        "Dual",
        "Only Customer",
      ]);

      const suppliers = await party.getPartiesPaginated("", 1, "supplier");
      expect(suppliers.parties.map((p) => p.name).sort()).toEqual([
        "Dual",
        "Only Supplier",
      ]);

      // Mongo asks `type IN ('customer','both')` for this; the flag just is.
      const both = await party.getPartiesPaginated("", 1, "both");
      expect(both.parties.map((p) => p.name)).toEqual(["Dual"]);
    });

    it("searches name, display name, email and tax pin", async () => {
      await make({ name: "Kisumu Traders", displayName: "KT", email: "buy@kt.co", taxPin: "P099" });
      await make({ name: "Nairobi Supplies", type: "supplier" });

      for (const q of ["isumu", "KT", "buy@", "P099"]) {
        const r = await party.getPartiesPaginated(q);
        expect(r.parties.map((p) => p.name), q).toEqual(["Kisumu Traders"]);
      }
      expect((await party.getPartiesPaginated("zzz")).total).toBe(0);
    });

    it("paginates, returning the page and its total together", async () => {
      for (let i = 0; i < 3; i++) await make({ name: `Party ${i}` });

      const first = await party.getPartiesPaginated("", 1, null, 2);
      expect(first.parties).toHaveLength(2);
      expect(first.total).toBe(3);
      expect(first.totalPages).toBe(2);

      const second = await party.getPartiesPaginated("", 2, null, 2);
      expect(second.parties).toHaveLength(1);
    });

    it("shows another tenant nothing", async () => {
      await make();
      const otherMongo = objectId();
      const otherUuid = randomUUID();
      await admin`INSERT INTO companies (id, name, slug)
                  VALUES (${otherUuid}, 'Other', ${"o-" + otherUuid.slice(0, 8)})`;
      await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                  VALUES ('companies', ${otherMongo}, ${otherUuid})`;
      getTenantContext.mockResolvedValue({
        user: { id: objectId(), name: "Other", role: "Admin" },
        companyId: otherMongo,
        companyCode: "OTHER",
      });

      const r = await party.getPartiesPaginated();
      expect(r.parties).toEqual([]);
      expect(r.total).toBe(0);
    });
  });

  describe("balances", () => {
    /** Posts a sale against the party, which is what a balance is made of. */
    async function postSale(partyId, amount) {
      await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        const [entry] = await tx`
          INSERT INTO journal_entries (
            company_id, entry_number, entry_date, entry_type, description,
            status, party_type, party_id
          ) VALUES (
            ${companyUuid}, ${"JE-" + randomUUID().slice(0, 8)}, '2026-08-01',
            'sale', 'Sale', 'posted', 'customer', ${partyId}
          ) RETURNING id
        `;
        await tx`
          INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit) VALUES
            (${companyUuid}, ${entry.id}, ${acct.ar},    1, ${amount}, 0),
            (${companyUuid}, ${entry.id}, ${acct.sales}, 2, 0, ${amount})
        `;
      });
    }

    it("derives the balance from the ledger rather than caching it", async () => {
      const created = await make({ name: "Acme Ltd" });
      await postSale(created.partyId, 12000);

      const { parties } = await party.getPartiesPaginated();
      // The field is still called cachedBalance because the components read
      // it. Mongo's own comment on that field says "Cached - NOT source of
      // truth!"; here it is computed from the AR control account every time,
      // so there is nothing to reconcile and nothing to drift.
      expect(parties[0].cachedBalance).toBe("12000.0000");

      const detail = await party.getPartyById(created.partyId);
      expect(detail.balance).toBe("12000.0000");
    });

    it("moves the balance when the ledger moves, with nothing to recompute", async () => {
      const created = await make({ name: "Acme Ltd" });
      await postSale(created.partyId, 100);
      await postSale(created.partyId, 250);

      const { parties } = await party.getPartiesPaginated();
      expect(parties[0].cachedBalance).toBe("350.0000");
    });

    it("reports the same figures on the cards as in the rows", async () => {
      const a = await make({ name: "Acme Ltd" });
      await make({ name: "Shell", type: "supplier" });
      await make({ name: "Staffer", type: "employee" });
      await postSale(a.partyId, 500);

      const stats = await party.getPartyStats();
      expect(stats.totalCustomers).toBe(1);
      expect(stats.totalSuppliers).toBe(1);
      expect(stats.totalEmployees).toBe(1);
      // Summed from the same derived balances the list shows, so a headline
      // cannot disagree with the rows under it.
      expect(stats.totalAR).toBe("500.0000");
      expect(stats.partiesWithBalance).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Writes
  // ───────────────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("keeps the note the form has always collected", async () => {
      const created = await make({ name: "Acme Ltd", notes: "Gate code 4471" });
      // parties had no `notes` column until 0032, so the form accepted this
      // and the database dropped it — the quietest kind of loss, because the
      // form says it worked.
      expect((await party.getPartyById(created.partyId)).notes).toBe("Gate code 4471");

      await party.updateParty(
        created.partyId,
        null,
        form({ name: "Acme Ltd", type: "customer", notes: "Ask for Jane" }),
      );
      expect((await party.getPartyById(created.partyId)).notes).toBe("Ask for Jane");
    });

    it("updates the details a form submits", async () => {
      const created = await make({ name: "Acme Ltd" });
      const result = await party.updateParty(
        created.partyId,
        null,
        form({
          name: "Acme Limited",
          type: "both",
          email: "new@acme.co",
          creditLimit: 90000,
          paymentTermsDays: 60,
          whtApplicable: "true",
          whtRate: 5,
          bankName: "Equity",
          accountNumber: "0123",
        }),
      );
      expect(result.success, result.error).toBe(true);

      const detail = await party.getPartyById(created.partyId);
      expect(detail.name).toBe("Acme Limited");
      expect(detail.type).toBe("both");
      expect(detail.creditTerms.creditLimit).toBe("90000.0000");
      expect(detail.creditTerms.paymentTermsDays).toBe(60);
      expect(detail.whtApplicable).toBe(true);
      expect(detail.paymentDetails.bankName).toBe("Equity");
    });

    it("deactivates and reactivates", async () => {
      const created = await make();
      await party.togglePartyStatus(created.partyId, false);
      expect((await party.getPartyById(created.partyId)).isActive).toBe(false);

      await party.togglePartyStatus(created.partyId, true);
      expect((await party.getPartyById(created.partyId)).isActive).toBe(true);
    });
  });

  describe("delete", () => {
    it("hard-deletes a party nothing refers to", async () => {
      const created = await make({ name: "Unused Ltd" });
      const result = await party.deleteParty(created.partyId);
      expect(result.success, result.error).toBe(true);
      expect(result.message).toMatch(/deleted/);
      expect(await party.getPartyById(created.partyId)).toBeNull();
    });

    it("deactivates instead when a document refers to it, and says which", async () => {
      const created = await make({ name: "Acme Ltd" });
      // A DRAFT invoice — no journal entry yet. Mongo counts journal entries
      // only, so it would hard-delete here and leave the invoice pointing at
      // nothing; the FK would refuse it anyway.
      await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        await tx`
          INSERT INTO invoices (company_id, invoice_number, invoice_date, customer_id, subtotal, total)
          VALUES (${companyUuid}, 'INV-1', '2026-08-01', ${created.partyId}, 100, 100)
        `;
      });

      const result = await party.deleteParty(created.partyId);
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/deactivated/);
      expect(result.message).toMatch(/1 invoice/);

      const detail = await party.getPartyById(created.partyId);
      expect(detail).not.toBeNull();
      expect(detail.isActive).toBe(false);
    });
  });

  describe("quick create", () => {
    it("creates a customer that can then actually be invoiced", async () => {
      const created = await party.quickCreateParty(
        form({ name: "Kisumu Traders", type: "customer", email: "AC@Kisumu.CO" }),
      );
      expect(created.success, created.error).toBe(true);
      expect(created.party.email).toBe("ac@kisumu.co");

      // The whole point: one implementation, so a party created inline from a
      // form is the same thing the parties page creates, in the same store.
      const fd = new FormData();
      fd.set(
        "invoiceData",
        JSON.stringify({
          customerId: created.party._id,
          invoiceDate: "2026-08-01",
          stockItems: [],
          serviceItems: [{ name: "Consulting", quantity: 1, unitPrice: 5000 }],
        }),
      );
      const invoice = await invoiceActions.createInvoicePg(null, fd);
      expect(invoice.success, invoice.error).toBe(true);
    });

    it("refuses a role gate it does not pass", async () => {
      getTenantContext.mockResolvedValue({
        user: { id: objectId(), name: "Store", role: "Storekeeper" },
        companyId: mongoCompanyId,
        companyCode: "PILOT",
      });
      const result = await make();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission/i);
    });
  });
});
