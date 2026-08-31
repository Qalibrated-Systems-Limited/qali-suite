/**
 * `getWorkspaceContext` — which project the eight module pages are showing.
 *
 * No database: the resolution this pins is plain logic over the switcher's
 * list, and the point of the file is the case that has been got wrong twice.
 *
 * A `?project=` that names a project this tenant does not have USED TO FALL
 * THROUGH to `projects[0]`. A saved link to a completed job's diary opened a
 * different project's diary, under the right page title and with the wrong
 * records. A pass before this one added a `notFound` flag for exactly that and
 * left the fallback in place beside it — so the flag was written, no page read
 * it, and the wrong project still rendered. Both halves are pinned here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const session = { value: { user: { id: "u1", name: "Ann", role: "Admin" } } };

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => session.value }));
vi.mock("next/navigation", () => ({
  redirect: (to) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const listed = [
  { _id: "p-live", id: "p-live", projectNumber: "PRJ-1", name: "Nakuru Depot", status: "active" },
  { _id: "p-done", id: "p-done", projectNumber: "PRJ-2", name: "Old Road", status: "completed" },
];

const getProjectsForWorkspace = vi.fn(async () => listed);
const getProjectById = vi.fn(async (id) => ({
  ...listed.find((p) => p.id === id),
  contractValue: 1_000_000,
  startDate: "2026-01-01",
  endDate: "2026-06-30",
}));

vi.mock("@/app/db/actions/project-actions", () => ({
  getProjectsForWorkspace: (...a) => getProjectsForWorkspace(...a),
  getProjectById: (...a) => getProjectById(...a),
}));

const { getWorkspaceContext } = await import("@/app/dashboard/projects/lib/workspace");

describe("the workspace context", () => {
  beforeEach(() => {
    session.value = { user: { id: "u1", name: "Ann", role: "Admin" } };
    getProjectsForWorkspace.mockClear();
    getProjectById.mockClear();
  });

  it("selects the first project when the link names none", async () => {
    const ctx = await getWorkspaceContext({});
    expect(ctx.project.id).toBe("p-live");
    expect(ctx.notFound).toBe(false);
  });

  it("honours a ?project= that names a finished job", async () => {
    const ctx = await getWorkspaceContext({ project: "p-done" });
    expect(ctx.project.id).toBe("p-done");
    expect(ctx.notFound).toBe(false);
  });

  it("shows NO project — never another one — when the link names one this tenant lacks", async () => {
    const ctx = await getWorkspaceContext({ project: "p-someone-elses" });
    expect(ctx.notFound).toBe(true);
    expect(ctx.project).toBeNull();
    // The whole point: not `projects[0]`.
    expect(ctx.projects.map((p) => p.id)).toEqual(["p-live", "p-done"]);
  });

  it("does not fetch the full project unless a page asks for it", async () => {
    // `getProjectById` runs the live actuals, the effective budget and the WBS
    // roll-up. Six of the eight pages read nothing that is not already on the
    // switcher row, and the Forms Register — a static reference table — was
    // paying for a financial aggregation on every render.
    await getWorkspaceContext({});
    expect(getProjectById).not.toHaveBeenCalled();

    const ctx = await getWorkspaceContext({}, { detail: true });
    expect(getProjectById).toHaveBeenCalledWith("p-live");
    expect(ctx.project.contractValue).toBe(1_000_000);
  });

  it("does not fetch anything for a role that cannot see projects", async () => {
    session.value = { user: { id: "u2", name: "Sam", role: "Store Keeper" } };
    const ctx = await getWorkspaceContext({ project: "p-live" });
    expect(ctx.denied).toBe(true);
    expect(ctx.project).toBeNull();
    expect(getProjectsForWorkspace).not.toHaveBeenCalled();
  });

  it("sends a signed-out reader to the login page", async () => {
    session.value = null;
    await expect(getWorkspaceContext({})).rejects.toThrow("REDIRECT:/login");
  });
});
