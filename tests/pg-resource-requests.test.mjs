/**
 * Technicians, vehicles and equipment are requested for work and approved by
 * the technical manager, who sees whether each is free.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));

const repo = await import("@/app/db/repositories/resourceRequests");
const svc = await import("@/app/db/resourceRequestsService");
const helpdesk = await import("@/app/db/repositories/helpdesk");

suite("resource requests", () => {
  let admin, client, db, co;
  const u = {};

  const inCo = (fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${co}, true)`);
      return fn(tx);
    });
  const user = (k) => ({ id: u[k].id, name: k, role: u[k].role });

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, entry_counters CASCADE`;
    co = randomUUID();
    await admin`INSERT INTO companies (id, name, slug) VALUES (${co}, 'Lab', ${"lab-" + co.slice(0, 8)})`;
    for (const [key, role, dept] of [["tech", "Employee", "Technical"], ["desk", "Manager", "Customer Service"], ["tm", "Manager", "Technical"]]) {
      const id = `u-${key}-${randomUUID().slice(0, 6)}`;
      await admin`INSERT INTO users (id, name, email, role, department, home_company_id) VALUES (${id}, ${key}, ${key + id + "@x.co"}, ${role}, ${dept}, ${co})`;
      await admin`INSERT INTO user_company_access (user_id, company_id, role, status, granted_via) VALUES (${id}, ${co}, ${role}, 'active', 'manual')`;
      u[key] = { id, role };
    }
    // The desk user is a Manager by role, so the technical-manager check would
    // call them a manager; make them HR-free help desk staff instead.
    await admin`UPDATE users SET role = 'Store Manager' WHERE id = ${u.desk.id}`;
    await admin`UPDATE user_company_access SET role = 'Store Manager' WHERE user_id = ${u.desk.id}`;
    u.desk.role = "Store Manager";
    // Tom is on approved leave 10–12 Dec.
    const party = randomUUID();
    await admin`INSERT INTO parties (id, company_id, primary_type, name, is_employee) VALUES (${party}, ${co}, 'employee', 'tech', true)`;
    const emp = randomUUID();
    await admin`INSERT INTO employees (id, company_id, party_id, user_id, employee_number, first_name, last_name, hire_date, national_id, kra_pin)
                VALUES (${emp}, ${co}, ${party}, ${u.tech.id}, 'E-1', 'Tom', 'Tech', '2025-01-01', '12345678', 'A000000000Z')`;
    const lt = randomUUID();
    await admin`INSERT INTO leave_types (id, company_id, code, name) VALUES (${lt}, ${co}, 'AL', 'Annual')`;
    await admin`INSERT INTO leave_requests (company_id, leave_number, employee_id, leave_type_id, from_date, to_date, total_days, status)
                VALUES (${co}, 'LV-1', ${emp}, ${lt}, '2026-12-10', '2026-12-12', 3, 'approved')`;
  });

  const ask = (k, extra = {}) =>
    inCo((tx) =>
      svc.createResourceRequestIn(tx, user(k), co, {
        resourceType: "technician", resourceId: u.tech.id, sourceType: "other",
        sourceRef: "W-1", sourceTitle: "Silo", startDate: "2026-12-01", endDate: "2026-12-03", notes: "", ...extra,
      }),
    );

  it("assigning a Technical-department technician needs approval unless a technical manager assigns", async () => {
    expect(await inCo((tx) => svc.needsResourceApproval(tx, user("desk"), co, u.tech.id))).toBe(true);
    expect(await inCo((tx) => svc.needsResourceApproval(tx, user("tm"), co, u.tech.id))).toBe(false);
    // A manager is not a "technician resource" themselves.
    expect(await inCo((tx) => svc.needsResourceApproval(tx, user("desk"), co, u.tm.id))).toBe(false);
  });

  it("shows leave and existing bookings as reasons it is not free", async () => {
    const free = await inCo((tx) => repo.availability(tx, "technician", u.tech.id, "2026-12-01", "2026-12-03"));
    expect(free.blockers).toEqual([]);
    const onLeave = await inCo((tx) => repo.availability(tx, "technician", u.tech.id, "2026-12-11", "2026-12-15"));
    expect(onLeave.blockers.join(" ")).toMatch(/leave/);

    const first = await ask("desk");
    await inCo((tx) => repo.decideRequest(tx, first.id, "approved", "", { id: u.tm.id, name: "tm" }));
    const clash = await inCo((tx) => repo.availability(tx, "technician", u.tech.id, "2026-12-02", "2026-12-02"));
    expect(clash.blockers.join(" ")).toMatch(/Already booked/);
  });

  it("a rejection must say why, and a decided request cannot be decided again", async () => {
    const r = await ask("desk");
    await expect(inCo((tx) => repo.decideRequest(tx, r.id, "rejected", "  ", { id: u.tm.id, name: "tm" }))).rejects.toThrow(/why/);
    await inCo((tx) => repo.decideRequest(tx, r.id, "rejected", "Tom is on the KenGen shutdown", { id: u.tm.id, name: "tm" }));
    await expect(inCo((tx) => repo.decideRequest(tx, r.id, "approved", "", { id: u.tm.id, name: "tm" }))).rejects.toThrow(/already/);
  });

  it("approving a ticket request assigns the ticket to the technician", async () => {
    const tid = randomUUID();
    await admin`INSERT INTO helpdesk_tickets (id, company_id, ticket_number, title) VALUES (${tid}, ${co}, 'TKT-9', 'Scale offline')`;
    const r = await ask("desk", { sourceType: "ticket", sourceId: tid, sourceRef: "TKT-9" });
    const decided = await inCo((tx) => repo.decideRequest(tx, r.id, "approved", "", { id: u.tm.id, name: "tm" }));
    const applied = await inCo((tx) => svc.applyApproval(tx, decided, user("tm")));
    expect(applied).toBe("ticket assigned");
    const t = await inCo((tx) => helpdesk.getTicketById(tx, tid));
    expect(t.assignedToUserId).toBe(u.tech.id);
  });

  it("names the resource from the register, never from the form", async () => {
    await expect(ask("desk", { resourceId: "u-nobody" })).rejects.toThrow(/technical team/);
  });
});
