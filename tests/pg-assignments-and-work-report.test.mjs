/**
 * Everything assigned to a person, from every source, and the periodic work
 * report over tasks and tickets.
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

const { listAssignmentsFor } = await import("@/app/db/repositories/myAssignments");
const { getWorkReport, periodRange } = await import("@/app/db/repositories/workReport");

suite("assigned work across the application", () => {
  let admin, client, db, co, other;
  const u = {};

  const inCo = (c, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${c}, true)`);
      return fn(tx);
    });

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
    other = randomUUID();
    for (const c of [co, other]) {
      await admin`INSERT INTO companies (id, name, slug) VALUES (${c}, 'C', ${"c-" + c.slice(0, 8)})`;
    }
    for (const key of ["tech", "boss"]) {
      const id = `u-${key}-${randomUUID().slice(0, 6)}`;
      await admin`INSERT INTO users (id, name, email, role, department, home_company_id)
                  VALUES (${id}, ${key}, ${key + id + "@x.co"}, 'Employee', 'Technical', ${co})`;
      u[key] = id;
    }
    const T = u.tech;
    await admin`INSERT INTO tasks (company_id, task_number, title, assigned_to_user_id, assignee_name, due_date)
                VALUES (${co}, 'TSK-1', 'Order spares', ${T}, 'tech', CURRENT_DATE - 2)`;
    await admin`INSERT INTO tasks (company_id, task_number, title, assigned_to_user_id, status, completed_at)
                VALUES (${co}, 'TSK-2', 'Done already', ${T}, 'completed', now())`;
    await admin`INSERT INTO helpdesk_tickets (company_id, ticket_number, title, assigned_to_user_id, assignee_name, status,
                                              resolution_due_at, category_name, customer_name)
                VALUES (${co}, 'TKT-1', 'Weighbridge not printing', ${T}, 'tech', 'assigned', now() + interval '1 day', 'Equipment', 'KPA')`;
    await admin`INSERT INTO helpdesk_tickets (company_id, ticket_number, title, status, created_at, resolved_at, resolution_due_at)
                VALUES (${co}, 'TKT-2', 'Resolved in time', 'resolved', now() - interval '2 days', now() - interval '1 day', now())`;
    const party = randomUUID();
    // parties.user_id is a uuid; a login whose id is a uuid is linked to its party.
    const partyUser = randomUUID();
    await admin`INSERT INTO users (id, name, email, role, home_company_id) VALUES (${partyUser}, 'crew', ${partyUser + '@x.co'}, 'Employee', ${co})`;
    u.crew = partyUser;
    await admin`INSERT INTO parties (id, company_id, primary_type, name, is_employee, user_id)
                VALUES (${party}, ${co}, 'employee', 'tech', true, ${partyUser})`;
    const project = randomUUID();
    await admin`INSERT INTO projects (id, company_id, project_number, name) VALUES (${project}, ${co}, 'PRJ-7', 'Silo')`;
    await admin`INSERT INTO project_tasks (company_id, project_id, title, assigned_party_id, assigned_name, path, planned_end)
                VALUES (${co}, ${project}, 'Install load cells', ${party}, 'tech', '1', CURRENT_DATE + 3)`;
    await admin`INSERT INTO calibration_jobs (company_id, job_number, client_name, technician_id, technician_name)
                VALUES (${co}, 'JOB-1', 'KenGen', ${T}, 'tech')`;
    await admin`INSERT INTO workflow_reports (company_id, project_id, report_number, title, summary, status, assigned_reviewer_id,
                                              submitted_at, submitted_by_name)
                VALUES (${co}, ${project}, 'TR-1', 'Weekly', 'x', 'submitted', ${T}, now(), 'boss')`;
    // Another company's ticket for the same person must not leak in.
    await admin`INSERT INTO helpdesk_tickets (company_id, ticket_number, title, assigned_to_user_id)
                VALUES (${other}, 'TKT-X', 'Other company', ${T})`;
  });

  it("lists open work from every source, each marked with its source", async () => {
    const items = await inCo(co, (tx) => listAssignmentsFor(tx, u.tech));
    const bySource = Object.fromEntries(items.map((i) => [i.source, i]));
    expect(Object.keys(bySource).sort()).toEqual(["calibration", "report", "task", "ticket"]);
    expect(bySource.task).toMatchObject({ ref: "TSK-1", overdue: true });
    expect(bySource.ticket).toMatchObject({ ref: "TKT-1", detail: "Equipment · KPA" });
    expect(bySource.report.detail).toMatch(/supervisor/);
    expect(items.map((i) => i.ref)).not.toContain("TSK-2");
    expect(items.map((i) => i.ref)).not.toContain("TKT-X");
    expect(items[0].overdue).toBe(true); // late work first
  });

  it("a project task reaches the person whose login is linked to the assigned party", async () => {
    const items = await inCo(co, (tx) => listAssignmentsFor(tx, u.crew));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "project", ref: "PRJ-7", title: "Install load cells", detail: "Silo" });
  });

  it("someone with nothing assigned sees nothing", async () => {
    expect(await inCo(co, (tx) => listAssignmentsFor(tx, u.boss))).toEqual([]);
  });

  it("reports the week by source, by person and the help desk SLA", async () => {
    const { from, to } = periodRange("week");
    const r = await inCo(co, (tx) => getWorkReport(tx, from, to));
    const s = Object.fromEntries(r.bySource.map((x) => [x.source, x]));
    expect(s.Tasks).toMatchObject({ assigned: 2, completed: 1, open: 1, overdue: 1 });
    expect(s["Help desk"]).toMatchObject({ assigned: 2, completed: 1, open: 1 });
    expect(r.tickets).toMatchObject({ slaMet: 1, slaMeasured: 1, resolved: 1 });
    const tech = r.byPerson.find((p) => p.userId === u.tech);
    expect(tech.overdue).toBe(1);
    expect(tech.completed).toBe(1);
  });

  it("the privileged weekly run is filtered to one company", async () => {
    const { from, to } = periodRange("week");
    const r = await getWorkReport(drizzle(admin), from, to, other);
    const s = Object.fromEntries(r.bySource.map((x) => [x.source, x]));
    expect(s["Help desk"].open).toBe(1);
    expect(s.Tasks.assigned).toBe(0);
  });

  it("a custom period includes its end date", () => {
    expect(periodRange("custom", "2026-11-01", "2026-11-30")).toMatchObject({ from: "2026-11-01", to: "2026-12-01" });
  });
});
