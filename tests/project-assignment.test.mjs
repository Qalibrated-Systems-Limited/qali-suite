/**
 * Project assignment (labor roster) lifecycle.
 *
 * The HR-free bridge between projects and people: assign a Party to a project,
 * update/remove, and keep it tenant-scoped + unique per project. Assigning
 * posts no cost — this test covers the roster mechanics only.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import Party from "@/app/models/parties";
import ProjectAssignment from "@/app/models/projectAssignment";
import { seedTenant } from "./helpers/fixtures.mjs";

const { ObjectId } = mongoose.Types;
const ctx = { companyId: null, isSuperAdmin: false, user: null };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/tenant-utils", () => ({
  getTenantContext: vi.fn(async () => ({ ...ctx })),
  withTenantScope: (q, companyId, isSuperAdmin) =>
    isSuperAdmin ? q : { ...q, companyId: new ObjectId(companyId) },
  getCompanyIdForCreate: (explicit, userCompanyId) => explicit || userCompanyId,
}));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));
vi.mock("@/lib/plan-gate", () => ({ requirePlanAccess: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { assignPartyToProject, updateProjectAssignment, removePartyFromProject } =
  await import("@/app/mongodb/actions/project-assignment-actions.js");
const { getProjectAssignments } = await import(
  "@/app/mongodb/queries/projectQueries.js"
);

// Minimal Project (the actions only check existence + tenant).
async function seedProject(companyId, n = 0) {
  const Project = mongoose.model("Project");
  return Project.create({
    companyId,
    name: `Otho Got Kachulo ${n}`,
    projectNumber: `PRJ-${Date.now()}-${n}`,
    status: "active",
  });
}

async function seedWorker(companyId, name) {
  return Party.create({
    companyId,
    type: "employee",
    name,
    code: `EMP-${new ObjectId().toString().slice(-6)}`,
  });
}

describe("project assignment lifecycle", () => {
  let tenant, project, worker;

  beforeEach(async () => {
    tenant = await seedTenant();
    ctx.companyId = tenant.company._id.toString();
    ctx.isSuperAdmin = false;
    ctx.user = { name: tenant.user.name, id: tenant.user._id.toString(), role: "Admin" };
    project = await seedProject(tenant.company._id);
    worker = await seedWorker(tenant.company._id, "Juma Otieno");
  });

  it("assigns a party and lists it on the roster", async () => {
    const res = await assignPartyToProject(project._id.toString(), {
      partyId: worker._id.toString(),
      role: "Site Foreman",
      rate: { amount: 1500, unit: "day" },
    });
    expect(res.success).toBe(true);

    const roster = await getProjectAssignments(project._id.toString());
    expect(roster).toHaveLength(1);
    expect(roster[0].party.name).toBe("Juma Otieno");
    expect(roster[0].role).toBe("Site Foreman");
    expect(roster[0].rate.amount).toBe(1500);
    expect(roster[0].status).toBe("active");
  });

  it("is idempotent — re-assigning reactivates, never duplicates", async () => {
    const id = project._id.toString();
    await assignPartyToProject(id, { partyId: worker._id.toString(), role: "Mason" });
    await removePartyFromProject(
      (await ProjectAssignment.findOne({ projectId: project._id }))._id.toString(),
    );
    // Re-assign the same party.
    await assignPartyToProject(id, { partyId: worker._id.toString(), role: "Foreman" });

    const all = await ProjectAssignment.find({ projectId: project._id });
    expect(all).toHaveLength(1); // same row reused
    expect(all[0].status).toBe("active");
    expect(all[0].role).toBe("Foreman");
  });

  it("updates role/rate", async () => {
    await assignPartyToProject(project._id.toString(), { partyId: worker._id.toString(), role: "Laborer" });
    const a = await ProjectAssignment.findOne({ projectId: project._id });

    const res = await updateProjectAssignment(a._id.toString(), {
      role: "Senior Mason",
      rate: { amount: 2000, unit: "day" },
    });
    expect(res.success).toBe(true);

    const updated = await ProjectAssignment.findById(a._id).lean();
    expect(updated.role).toBe("Senior Mason");
    expect(updated.rate.amount).toBe(2000);
  });

  it("soft-removes — drops off the roster but keeps the row", async () => {
    await assignPartyToProject(project._id.toString(), { partyId: worker._id.toString() });
    const a = await ProjectAssignment.findOne({ projectId: project._id });

    await removePartyFromProject(a._id.toString());

    const roster = await getProjectAssignments(project._id.toString());
    expect(roster).toHaveLength(0); // removed excluded
    const row = await ProjectAssignment.findById(a._id).lean();
    expect(row.status).toBe("removed");
    expect(row.removedAt).toBeTruthy();
  });

  it("won't assign a party from another tenant", async () => {
    const other = await seedTenant({
      company: { name: "Other Co", code: "OTH", email: "other@test.co", kraPin: "P059999999Z" },
    });
    const foreignWorker = await seedWorker(other.company._id, "Outsider");

    const res = await assignPartyToProject(project._id.toString(), {
      partyId: foreignWorker._id.toString(),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/party not found/i);
  });
});
