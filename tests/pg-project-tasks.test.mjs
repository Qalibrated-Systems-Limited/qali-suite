/**
 * The work breakdown, and the end of the typed percentage — 0071.
 *
 * `projects.progress_percent` is a slider. The module's own gap list calls it
 * item one, and Procore, Candy and MS Project all derive progress instead —
 * a typed number is how a project reports 90% complete for four months.
 *
 * What is asserted here is mostly the shape of the lie the schema now refuses:
 * a summary task carrying a percentage its children do not support, a task at
 * 100% nobody marked done, an unweighted average that makes "order the cable"
 * worth as much as "lay 8km of subbase".
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
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { userMessage } = await import("@/app/db/errors");
const repo = await import("@/app/db/repositories/projects");

const failsWith = async (fn, pattern) => {
  const err = await fn().then(
    () => {
      throw new Error("expected a rejection");
    },
    (e) => e,
  );
  expect(userMessage(err)).toMatch(pattern);
};

suite("the work breakdown", () => {
  let admin, client, db;
  let companyA, project, otherProject, worker;
  const actor = { id: null, name: "Test User" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const task = (over = {}) =>
    inA((tx) =>
      repo.createTask(tx, {
        companyId: companyA,
        projectId: over.projectId ?? project,
        title: over.title ?? "Task",
        createdByName: "Seed",
        ...over,
      }),
    );

  const progressOf = () => inA((tx) => repo.getProjectProgress(tx, project));
  const tree = () => inA((tx) => repo.listProjectTasks(tx, project));

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, {
      max: 1,
      onnotice: () => {},
    });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyA = randomUUID();
    worker = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;
    await asTenant(companyA, (tx) =>
      tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_employee, name)
        VALUES (${worker}, ${companyA}, 'employee', true, 'Jane Site')`),
    );

    project = (
      await inA((tx) =>
        repo.createProject(tx, {
          companyId: companyA,
          name: "Otho Road",
          budgetAmount: "1000.0000",
          progressPercent: 35,
          createdByName: "Seed",
        }),
      )
    ).id;
    otherProject = (
      await inA((tx) =>
        repo.createProject(tx, {
          companyId: companyA,
          name: "Bridge",
          createdByName: "Seed",
        }),
      )
    ).id;
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("where the number comes from", () => {
    it("falls back to the typed percentage while there is no WBS", async () => {
      const p = await progressOf();
      expect(p).toMatchObject({ percent: 35, source: "typed", taskCount: 0 });
    });

    it("takes over the moment a task exists", async () => {
      await task({ title: "Earthworks", estimatedHours: "10.00" });
      const p = await progressOf();
      // 35 was somebody's opinion. One task at 0% is the measured answer.
      expect(p).toMatchObject({ percent: 0, source: "tasks", taskCount: 1 });
    });

    it("weights by hours rather than counting heads", async () => {
      // The unweighted answer is 50. The weighted one is 10, and the weighted
      // one is right: 8km of subbase is not one task's worth of a project.
      const small = await task({ title: "Order cable", estimatedHours: "1.00" });
      await task({ title: "Lay subbase", estimatedHours: "9.00" });

      await inA((tx) =>
        repo.setTaskProgress(tx, small.id, { status: "done" }, actor),
      );

      expect((await progressOf()).percent).toBe(10);
    });

    it("lets an explicit weight beat the hours", async () => {
      const a = await task({ title: "A", estimatedHours: "1.00", weight: "3.0000" });
      await task({ title: "B", estimatedHours: "9.00", weight: "1.0000" });
      await inA((tx) => repo.setTaskProgress(tx, a.id, { status: "done" }, actor));
      expect((await progressOf()).percent).toBe(75);
    });

    it("gives equal shares when nobody estimated anything", async () => {
      const a = await task({ title: "A" });
      await task({ title: "B" });
      await task({ title: "C" });
      await task({ title: "D" });
      await inA((tx) => repo.setTaskProgress(tx, a.id, { status: "done" }, actor));
      expect((await progressOf()).percent).toBe(25);
    });

    it("leaves cancelled work out of the average entirely", async () => {
      // Not completed, and not outstanding either.
      const a = await task({ title: "A" });
      const b = await task({ title: "B" });
      await inA((tx) => repo.setTaskProgress(tx, a.id, { status: "done" }, actor));
      expect((await progressOf()).percent).toBe(50);

      await inA((tx) => repo.setTaskProgress(tx, b.id, { status: "cancelled" }, actor));
      expect((await progressOf()).percent).toBe(100);
    });

    it("counts only the leaves, never a summary twice", async () => {
      const parent = await task({ title: "Earthworks" });
      const cut = await task({ title: "Cut", parentTaskId: parent.id, estimatedHours: "80.00" });
      await task({ title: "Fill", parentTaskId: parent.id, estimatedHours: "20.00" });

      await inA((tx) =>
        repo.setTaskProgress(tx, cut.id, { progressPercent: 50 }, actor),
      );
      // (80×50 + 20×0) / 100. The summary contributes nothing of its own.
      expect((await progressOf()).percent).toBe(40);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("a summary task has no progress of its own", () => {
    it("refuses a percentage typed onto a parent", async () => {
      const parent = await task({ title: "Earthworks" });
      await task({ title: "Cut", parentTaskId: parent.id });

      await failsWith(
        () =>
          inA((tx) =>
            repo.setTaskProgress(tx, parent.id, { progressPercent: 90 }, actor),
          ),
        /has subtasks, so its progress comes from them/i,
      );
    });

    it("refuses it however the row is written", async () => {
      const parent = await task({ title: "Earthworks" });
      await task({ title: "Cut", parentTaskId: parent.id });
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE project_tasks SET progress_percent = 90, status = 'in_progress'
               WHERE id = ${parent.id}`),
          ),
        /has subtasks/i,
      );
    });

    it("demotes a task that had progress when it is broken down", async () => {
      // Without this the 60% sits in a column nothing reads, for ever.
      const t = await task({ title: "Drainage" });
      await inA((tx) => repo.setTaskProgress(tx, t.id, { progressPercent: 60 }, actor));

      await task({ title: "Culverts", parentTaskId: t.id });

      const [row] = await admin`
        SELECT progress_percent, status FROM project_tasks WHERE id = ${t.id}`;
      expect(row.progress_percent).toBe(0);
      expect(row.status).toBe("in_progress");
    });

    it("rolls a completed breakdown up to a done summary on read", async () => {
      const parent = await task({ title: "Earthworks" });
      const cut = await task({ title: "Cut", parentTaskId: parent.id });
      const fill = await task({ title: "Fill", parentTaskId: parent.id });
      await inA((tx) => repo.setTaskProgress(tx, cut.id, { status: "done" }, actor));
      await inA((tx) => repo.setTaskProgress(tx, fill.id, { status: "done" }, actor));

      const rows = await tree();
      const summary = rows.find((r) => r.title === "Earthworks");
      // Stored as 0 and read as 100 — the number is the children's.
      expect(summary.progressPercent).toBe(0);
      expect(summary.rolledUpProgress).toBe(100);
      expect(summary.childCount).toBe(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("done means 100 and 100 means done", () => {
    it("refuses done at anything else", async () => {
      const t = await task();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE project_tasks SET status = 'done', progress_percent = 50
               WHERE id = ${t.id}`),
          ),
        /done at 100%/i,
      );
    });

    it("refuses 100 without done", async () => {
      const t = await task();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE project_tasks SET progress_percent = 100, status = 'in_progress'
               WHERE id = ${t.id}`),
          ),
        /done at 100%/i,
      );
    });

    it("moves the pair together whichever half is given", async () => {
      const t = await task();

      let row = await inA((tx) =>
        repo.setTaskProgress(tx, t.id, { progressPercent: 100 }, actor),
      );
      expect(row.status).toBe("done");

      row = await inA((tx) => repo.setTaskProgress(tx, t.id, { status: "todo" }, actor));
      expect(row.progressPercent).toBe(0);
      expect(row.actualStart).toBeNull();
    });

    it("asks for a number when a completed task is reopened", async () => {
      // The one case that cannot be derived: 0 throws away what was done and
      // 99 is a fiction, so it asks rather than inventing.
      const t = await task();
      await inA((tx) => repo.setTaskProgress(tx, t.id, { status: "done" }, actor));

      await failsWith(
        () =>
          inA((tx) =>
            repo.setTaskProgress(tx, t.id, { status: "in_progress" }, actor),
          ),
        /needs the percentage it is now at/i,
      );

      const row = await inA((tx) =>
        repo.setTaskProgress(
          tx,
          t.id,
          { status: "in_progress", progressPercent: 70 },
          actor,
        ),
      );
      expect(row.status).toBe("in_progress");
      expect(row.progressPercent).toBe(70);
      expect(row.actualEnd).toBeNull();
    });

    it("stamps the start when work begins and the finish when it ends", async () => {
      const t = await task();
      let row = await inA((tx) =>
        repo.setTaskProgress(tx, t.id, { progressPercent: 20 }, actor),
      );
      expect(row.status).toBe("in_progress");
      expect(row.actualStart).toBeTruthy();
      expect(row.actualEnd).toBeNull();

      row = await inA((tx) => repo.setTaskProgress(tx, t.id, { status: "done" }, actor));
      expect(row.actualEnd).toBeTruthy();
    });

    it("refuses a finish date on work that is still running", async () => {
      const t = await task();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE project_tasks SET actual_end = CURRENT_DATE, status = 'in_progress'
               WHERE id = ${t.id}`),
          ),
        /done or cancelled carries a finish date/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the tree", () => {
    it("refuses a cycle", async () => {
      const parent = await task({ title: "Earthworks" });
      const child = await task({ title: "Cut", parentTaskId: parent.id });
      await failsWith(
        () => inA((tx) => repo.updateTask(tx, parent.id, { parentTaskId: child.id })),
        /cannot be moved beneath itself/i,
      );
    });

    it("moves the descendants when a branch moves", async () => {
      const a = await task({ title: "A" });
      const b = await task({ title: "B", parentTaskId: a.id });
      const c = await task({ title: "C", parentTaskId: b.id });
      const d = await task({ title: "D" });

      await inA((tx) => repo.updateTask(tx, b.id, { parentTaskId: d.id }));

      const rows = await tree();
      const byTitle = Object.fromEntries(rows.map((r) => [r.title, r]));
      expect(byTitle.B.depth).toBe(1);
      // The Mongo hook this pattern replaces re-pathed the saved row only, so
      // the grandchild would have been stranded under a parent that had moved.
      expect(byTitle.C.depth).toBe(2);
      expect(byTitle.C.parentTaskId).toBe(b.id);
      expect(byTitle.A.childCount).toBe(0);
      expect(byTitle.D.childCount).toBe(1);
      void c;
    });

    it("keeps a subtask in its parent's project", async () => {
      const parent = await task({ title: "Earthworks" });
      await failsWith(
        () => task({ title: "Foreign", projectId: otherProject, parentTaskId: parent.id }),
        /same project as the task above it/i,
      );
    });

    it("will not delete a summary task out from under its subtasks", async () => {
      const parent = await task({ title: "Earthworks" });
      await task({ title: "Cut", parentTaskId: parent.id });
      await failsWith(() => inA((tx) => repo.deleteTask(tx, parent.id)), /.+/);
    });

    it("orders siblings by sort order, depth-first", async () => {
      const b = await task({ title: "B", sortOrder: 2 });
      const a = await task({ title: "A", sortOrder: 1 });
      await task({ title: "A2", parentTaskId: a.id, sortOrder: 1 });
      await task({ title: "A1", parentTaskId: a.id, sortOrder: 0 });
      void b;

      expect((await tree()).map((r) => r.title)).toEqual(["A", "A1", "A2", "B"]);
    });

    it("goes with the project", async () => {
      await task({ title: "Earthworks" });
      await inA((tx) => repo.deleteProject(tx, project));
      const [row] = await admin`SELECT COUNT(*)::int AS n FROM project_tasks`;
      expect(row.n).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the rest of the shape", () => {
    it("refuses a weightless task", async () => {
      await failsWith(
        () => task({ weight: "0.0000" }),
        /more than zero/i,
      );
    });

    it("refuses an assignee with no name", async () => {
      await failsWith(
        () => task({ assignedPartyId: worker }),
        /needs that person's name/i,
      );
    });

    it("refuses a finish planned before its start", async () => {
      await failsWith(
        () => task({ plannedStart: "2026-09-10", plannedEnd: "2026-09-01" }),
        /cannot fall before the planned start/i,
      );
    });

    it("does not show one company another's tasks", async () => {
      await task({ title: "Earthworks" });
      const other = randomUUID();
      await admin`INSERT INTO companies (id, name, slug)
        VALUES (${other}, 'Rival', ${"r-" + other.slice(0, 8)})`;
      expect(await asTenant(other, (tx) => repo.listProjectTasks(tx, project))).toHaveLength(0);
    });
  });
});
