/**
 * Technical work for technicians and technical managers.
 *
 * Technicians (Technical department, any role) carry out calibration jobs and
 * inspections assigned to them and submit the result; a technical manager who
 * did not do the work approves or returns it. A certificate number is issued
 * on approval, not when "passed" is typed.
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

const repo = await import("@/app/db/repositories/technical");
const reports = await import("@/app/db/repositories/workflowReports");
const access = await import("@/app/db/technicalAccess");
const permRepo = await import("@/app/db/repositories/rolePermissions");
const gates = await import("@/lib/utils/role-gates");

suite("technical work: assign, submit, approve", () => {
  let admin, client, db, co;
  const p = {};

  const inCo = (fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${co}, true)`);
      return fn(tx);
    });
  const actor = (k) => ({ id: p[k].id, name: p[k].name });
  const user = (k) => ({ id: p[k].id, name: p[k].name, role: p[k].role });

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
    await admin`INSERT INTO custom_roles (company_id, name, base_role) VALUES (${co}, 'Technical Manager', 'Manager')`;
    for (const [key, role, access_role, dept] of [
      ["tech", "Employee", "Employee", "Technical"],
      ["tech2", "Employee", "Employee", "Technical"],
      ["sales", "Employee", "Employee", "Sales"],
      ["tm", "Manager", "Technical Manager", "Technical"],
      ["mgr", "Manager", "Manager", "Operations"],
    ]) {
      const id = `u-${key}-${randomUUID().slice(0, 6)}`;
      await admin`INSERT INTO users (id, name, email, role, department, home_company_id)
                  VALUES (${id}, ${key}, ${key + id + "@x.co"}, ${role}, ${dept}, ${co})`;
      await admin`INSERT INTO user_company_access (user_id, company_id, role, status, granted_via)
                  VALUES (${id}, ${co}, ${access_role}, 'active', 'manual')`;
      p[key] = { id, name: key, role };
    }
  });

  it("a Technical-department Employee is a technician, not a manager; Sales is neither", async () => {
    const t = await inCo((tx) => access.technicalStanding(tx, user("tech"), co));
    expect(t).toMatchObject({ isTechnician: true, isManager: false });
    const s = await inCo((tx) => access.technicalStanding(tx, user("sales"), co));
    expect(s).toMatchObject({ isTechnician: false, isManager: false });
    const m = await inCo((tx) => access.technicalStanding(tx, user("mgr"), co));
    expect(m).toMatchObject({ isTechnician: true, isManager: true });
  });

  it("the team lists technicians and the custom Technical Manager as a manager", async () => {
    const team = await inCo((tx) => access.listTechnicalPeople(tx));
    const byName = Object.fromEntries(team.map((x) => [x.name, x]));
    expect(byName.tech.isManager).toBe(false);
    expect(byName.tm).toMatchObject({ isManager: true, title: "Technical Manager" });
    expect(byName.sales).toBeUndefined();
  });

  it("a custom Technical Manager can be named to sign off a report", async () => {
    const people = await inCo((tx) => reports.listSignoffUsers(tx, gates.WORKFLOW_REPORT_SIGNOFF_ROLES));
    expect(people.map((x) => x.name)).toContain("tm");
  });

  it("runs a calibration job from assignment to a certificate", async () => {
    const job = await inCo((tx) =>
      repo.createJob(tx, { companyId: co, clientName: "KPA", technicianId: p.tech.id, technicianName: "tech", createdByName: "tm" }),
    );
    await inCo((tx) => repo.startWork(tx, "job", job.id, actor("tech")));
    await expect(inCo((tx) => repo.submitWork(tx, "job", job.id, {}, actor("tech")))).rejects.toThrow(/passed or failed/);
    const sub = await inCo((tx) => repo.submitWork(tx, "job", job.id, { result: "passed" }, actor("tech")));
    expect(sub.status).toBe("submitted");
    expect(sub.certNumber).toBe("");

    const mine = await inCo((tx) => repo.getMyWork(tx, p.tm.id, true));
    expect(mine.approvalJobs.map((j) => j.id)).toContain(job.id);

    const ok = await inCo((tx) => repo.approveWork(tx, "job", job.id, actor("tm")));
    expect(ok.status).toBe("approved");
    expect(ok.approvedByName).toBe("tm");
    expect(ok.certNumber).toMatch(/CERT/);
  });

  it("nobody approves their own work, and the database refuses it too", async () => {
    const job = await inCo((tx) =>
      repo.createJob(tx, { companyId: co, clientName: "KPA", technicianId: p.mgr.id, technicianName: "mgr", createdByName: "mgr" }),
    );
    await inCo((tx) => repo.submitWork(tx, "job", job.id, { result: "failed" }, actor("mgr")));
    await expect(inCo((tx) => repo.approveWork(tx, "job", job.id, actor("mgr")))).rejects.toThrow(/carried out yourself/);
    await expect(
      admin`UPDATE calibration_jobs SET approved_by_id = ${p.mgr.id} WHERE id = ${job.id}`,
    ).rejects.toThrow(/approver_not_technician/);
  });

  it("returns an inspection with a reason, and it comes back to the inspector", async () => {
    const ins = await inCo((tx) =>
      repo.createInspection(tx, { companyId: co, clientName: "KenGen", inspectorId: p.tech2.id, inspectorName: "tech2", createdByName: "tm" }),
    );
    await inCo((tx) => repo.submitWork(tx, "inspection", ins.id, { ruling: "fail" }, actor("tech2")));
    await expect(inCo((tx) => repo.returnWork(tx, "inspection", ins.id, "  ", actor("tm")))).rejects.toThrow(/what needs fixing/);
    const back = await inCo((tx) => repo.returnWork(tx, "inspection", ins.id, "Photo of the tag missing", actor("tm")));
    expect(back).toMatchObject({ status: "returned", returnComment: "Photo of the tag missing" });

    const mine = await inCo((tx) => repo.getMyWork(tx, p.tech2.id, false));
    expect(mine.inspections.map((i) => i.id)).toContain(ins.id);

    const again = await inCo((tx) => repo.submitWork(tx, "inspection", ins.id, { ruling: "pass" }, actor("tech2")));
    expect(again).toMatchObject({ status: "submitted", returnComment: "", ruling: "pass" });
  });

  it("unassigned work submitted by a technician becomes theirs", async () => {
    const job = await inCo((tx) => repo.createJob(tx, { companyId: co, clientName: "KPC", createdByName: "tm" }));
    const sub = await inCo((tx) => repo.submitWork(tx, "job", job.id, { result: "passed" }, actor("tech")));
    expect(sub.technicianId).toBe(p.tech.id);
  });

  it("unticking 'Technical — manage & approve' on Manager takes approval away", async () => {
    await inCo((tx) => permRepo.setRoleKeys(tx, co, "Manager", ["TECHNICAL_WRITE_ROLES", "PROJECT_LOG_SIGNOFF_ROLES"]));
    const m = await inCo((tx) => access.technicalStanding(tx, user("mgr"), co));
    expect(m.isManager).toBe(false);
    expect(m.isTechnician).toBe(true);
  });
});
