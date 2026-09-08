/**
 * Linking a login to an employee party.
 *
 * `app/mongodb/actions/link-user-action.js` set `party.userId` on a MONGO
 * party while every party screen reads Postgres — so the link appeared to save
 * and the page it returned to showed the employee still unlinked. And the
 * picker it chose from read the Mongo `users` collection, which stopped being
 * written when auth ported, so it had been EMPTY for every tenant.
 *
 * THE LINK IS THE GRANT. `parties.user_id` is `uuid` and `users.id` is `text`
 * — 0036 made the id text on purpose — so that column cannot hold a user id
 * and nothing in the Postgres layer has ever written it. The real seam is
 * `user_company_access.party_id`, which sign-in and the invite flow already
 * use.
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

const getTenantContext = vi.fn();
vi.mock("@/lib/utils/tenant-utils", () => ({
  getTenantContext: () => getTenantContext(),
  withTenantScope: (q) => q,
  tenantFilter: () => ({}),
  getCompanyIdForCreate: (_a, companyId) => companyId,
}));

const partyActions = await import("@/app/db/actions/party-actions");

suite("linking a login to an employee party", () => {
  let admin;
  let companyA, companyB, actorId;

  const form = (obj) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(obj)) fd.set(k, String(v));
    return fd;
  };

  const makeCompany = async (name) => {
    const id = randomUUID();
    await admin`INSERT INTO companies (id, name, slug)
                VALUES (${id}, ${name}, ${"s-" + id.slice(0, 8)})`;
    return id;
  };

  /** A party. `primary_type` and the role flag must agree — a CHECK says so. */
  const makeParty = async (companyId, { employee = true, name = "Wanjiku" } = {}) => {
    const id = randomUUID();
    if (employee) {
      await admin`INSERT INTO parties (id, company_id, primary_type, is_employee, name)
                  VALUES (${id}, ${companyId}, 'employee', true, ${name})`;
    } else {
      await admin`INSERT INTO parties (id, company_id, primary_type, is_customer, name)
                  VALUES (${id}, ${companyId}, 'customer', true, ${name})`;
    }
    return id;
  };

  /** A login is a user row PLUS a grant — membership is the grant (0036). */
  const makeUser = async (companyId, { name = "Somebody", role = "Admin" } = {}) => {
    const id = randomUUID();
    await admin`INSERT INTO users (id, name, email, role, status)
                VALUES (${id}, ${name},
                        ${randomUUID().slice(0, 8) + "@test.local"}, ${role}, 'active')`;
    await admin`INSERT INTO user_company_access
                  (user_id, company_id, role, status, granted_via, granted_by_name)
                VALUES (${id}, ${companyId}, ${role}, 'active', 'primary', 'Seed')`;
    return id;
  };

  const grantPartyOf = async (userId, companyId) => {
    const [r] = await admin`SELECT party_id::text AS party_id FROM user_company_access
                             WHERE user_id = ${userId} AND company_id = ${companyId}`;
    return r?.party_id ?? null;
  };

  const employeeUserOf = async (partyId) => {
    const [r] = await admin`SELECT user_id FROM employees WHERE party_id = ${partyId}`;
    return r?.user_id ?? null;
  };

  const makeEmployee = (companyId, partyId, num = "EMP-1") =>
    admin`INSERT INTO employees (company_id, party_id, employee_number,
                                 first_name, last_name, hire_date)
          VALUES (${companyId}, ${partyId}, ${num}, 'Wanjiku', 'Mwangi',
                  '2021-01-01'::date)`;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyA = await makeCompany("Pilot");
    companyB = await makeCompany("Rival");
    actorId = await makeUser(companyA, { name: "The Admin", role: "Admin" });

    getTenantContext.mockResolvedValue({
      user: { id: actorId, name: "The Admin", role: "Admin" },
      companyId: companyA,
      activeCompanyId: companyA,
      companyCode: null,
      isSuperAdmin: false,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("linking", () => {
    it("writes the link where the app actually reads it", async () => {
      // The headline defect: the Mongo action set `party.userId` on a Mongo
      // party, and the page it returned to reads Postgres.
      const party = await makeParty(companyA);
      const user = await makeUser(companyA, { name: "Wanjiku Mwangi" });

      const res = await partyActions.linkUserToParty(
        {},
        form({ partyId: party, userId: user }),
      );

      expect(res.success).toBe(true);
      expect(res.message).toMatch(/Wanjiku Mwangi/);
      expect(await grantPartyOf(user, companyA)).toBe(party);
    });

    it("reads back through getPartyLinkedUser", async () => {
      const party = await makeParty(companyA);
      const user = await makeUser(companyA, { name: "Wanjiku Mwangi" });
      await partyActions.linkUserToParty({}, form({ partyId: party, userId: user }));

      const linked = await partyActions.getPartyLinkedUser(party);
      expect(linked._id).toBe(user);
      expect(linked.name).toBe("Wanjiku Mwangi");
    });

    it("links the EMPLOYMENT record too, or the person signs in to nothing", async () => {
      // linkUserToPartyDirect's reasoning: leaving `employees.user_id` null
      // means no leave, no payslips, nowhere to clock in.
      const party = await makeParty(companyA);
      await makeEmployee(companyA, party);
      const user = await makeUser(companyA);

      await partyActions.linkUserToParty({}, form({ partyId: party, userId: user }));
      expect(await employeeUserOf(party)).toBe(user);
    });

    it("is fine when the party has no employment record", async () => {
      const party = await makeParty(companyA);
      const user = await makeUser(companyA);
      const res = await partyActions.linkUserToParty(
        {},
        form({ partyId: party, userId: user }),
      );
      expect(res.success).toBe(true);
    });

    it("is idempotent — linking the same pair again still succeeds", async () => {
      const party = await makeParty(companyA);
      const user = await makeUser(companyA);
      await partyActions.linkUserToParty({}, form({ partyId: party, userId: user }));
      const again = await partyActions.linkUserToParty(
        {},
        form({ partyId: party, userId: user }),
      );
      expect(again.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the three refusals, each a real confusion to prevent", () => {
    it("refuses a party that is not an employee", async () => {
      const customer = await makeParty(companyA, { employee: false, name: "Kerra" });
      const user = await makeUser(companyA);
      const res = await partyActions.linkUserToParty(
        {},
        form({ partyId: customer, userId: user }),
      );
      expect(res.success).toBe(false);
      expect(res.errors._form[0]).toMatch(/must be of type 'employee'/i);
    });

    it("refuses a login with no grant in THIS company", async () => {
      // `users` has no company column — membership is the grant. Without this
      // check the UPDATE would match no rows and report success.
      const party = await makeParty(companyA);
      const outsider = await makeUser(companyB);
      const res = await partyActions.linkUserToParty(
        {},
        form({ partyId: party, userId: outsider }),
      );
      expect(res.success).toBe(false);
      expect(res.errors._form[0]).toMatch(/User not found/i);
      expect(await grantPartyOf(outsider, companyB)).toBeNull();
    });

    it("refuses when the employee is already somebody else's", async () => {
      const party = await makeParty(companyA);
      const first = await makeUser(companyA, { name: "First Person" });
      const second = await makeUser(companyA, { name: "Second Person" });

      await partyActions.linkUserToParty({}, form({ partyId: party, userId: first }));
      const res = await partyActions.linkUserToParty(
        {},
        form({ partyId: party, userId: second }),
      );

      expect(res.success).toBe(false);
      expect(res.errors._form[0]).toMatch(/already linked to First Person/i);
      expect(await grantPartyOf(first, companyA)).toBe(party);
      expect(await grantPartyOf(second, companyA)).toBeNull();
    });

    it("refuses when the login is already on another employee", async () => {
      const partyOne = await makeParty(companyA, { name: "Wanjiku" });
      const partyTwo = await makeParty(companyA, { name: "Otieno" });
      const user = await makeUser(companyA);

      await partyActions.linkUserToParty({}, form({ partyId: partyOne, userId: user }));
      const res = await partyActions.linkUserToParty(
        {},
        form({ partyId: partyTwo, userId: user }),
      );

      expect(res.success).toBe(false);
      expect(res.errors._form[0]).toMatch(/already linked to employee party: Wanjiku/i);
      expect(await grantPartyOf(user, companyA)).toBe(partyOne);
    });

    it("asks for both ids rather than guessing", async () => {
      const missing = await partyActions.linkUserToParty({}, form({ partyId: "" }));
      expect(missing.success).toBe(false);
      expect(missing.errors.partyId).toBeTruthy();
      expect(missing.errors.userId).toBeTruthy();
    });

    it("reports a party that does not exist as not found", async () => {
      const user = await makeUser(companyA);
      const res = await partyActions.linkUserToParty(
        {},
        form({ partyId: randomUUID(), userId: user }),
      );
      expect(res.success).toBe(false);
      expect(res.errors._form[0]).toMatch(/Party not found/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("unlinking", () => {
    it("clears the grant and the employment record together", async () => {
      const party = await makeParty(companyA);
      await makeEmployee(companyA, party);
      const user = await makeUser(companyA);
      await partyActions.linkUserToParty({}, form({ partyId: party, userId: user }));

      const res = await partyActions.unlinkUserFromParty(party);

      expect(res.success).toBe(true);
      expect(await grantPartyOf(user, companyA)).toBeNull();
      expect(await employeeUserOf(party)).toBeNull();
      expect(await partyActions.getPartyLinkedUser(party)).toBeNull();
    });

    it("says so when there was nothing linked", async () => {
      const party = await makeParty(companyA);
      const res = await partyActions.unlinkUserFromParty(party);
      expect(res.success).toBe(false);
      expect(res.errors._form[0]).toMatch(/No user linked/i);
    });

    it("does not reach into another company's grants", async () => {
      const partyB = await makeParty(companyB);
      const userB = await makeUser(companyB);
      await admin`UPDATE user_company_access SET party_id = ${partyB}
                   WHERE user_id = ${userB} AND company_id = ${companyB}`;

      // Acting inside company A, against company B's party.
      const res = await partyActions.unlinkUserFromParty(partyB);

      expect(res.success).toBe(false);
      expect(await grantPartyOf(userB, companyB)).toBe(partyB);
    });
  });
});
