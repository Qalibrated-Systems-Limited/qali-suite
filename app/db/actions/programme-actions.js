"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";
import { projectTasks } from "../schema";
import * as repo from "../repositories/projects";

/**
 * Programme import — 0079-adjacent (no schema change).
 *
 * Reads a .csv or .xlsx programme of works and turns it into the project's WBS:
 * one SUMMARY task per Section, one child task per Activity under it. Reuses the
 * `project_tasks` model exactly as the Programme Gantt and Milestone Tracker
 * already read it, so an imported programme renders with no other work.
 *
 * Columns (header row optional; matched case-insensitively, else positional):
 *   Section | Activity | Start | End | % (percent complete)
 * A blank Section carries the previous one forward, the way a printed
 * programme only writes the phase on its first line.
 */

const MAX_ROWS = 2000;

function toISODate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const str = String(v).trim();
  if (!str) return null;
  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = `20${y}`;
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
  }
  const dt = new Date(str);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

function toPercent(v) {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace("%", "").trim());
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function statusFor(pct) {
  if (pct >= 100) return "done";
  if (pct > 0) return "in_progress";
  return "todo";
}

/** Minimal CSV row split — handles quoted fields containing commas. */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function rowsFromFile(file) {
  const name = (file.name || "").toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = buffer.toString("utf8").replace(/\r\n?/g, "\n");
    return text.split("\n").filter((l) => l.trim() !== "").map(splitCsvLine);
  }

  // xlsx via the already-installed exceljs (CJS interop-safe)
  const mod = await import("exceljs");
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow((row) => {
    const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(vals.map((c) => (c && typeof c === "object" && "text" in c ? c.text : c)));
  });
  return rows;
}

function mapColumns(headerRow) {
  const lower = headerRow.map((c) => String(c ?? "").toLowerCase().trim());
  const find = (...names) => lower.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const idx = {
    section: find("section", "phase", "group"),
    activity: find("activity", "task", "description", "item"),
    start: find("start", "from"),
    end: find("end", "finish", "to"),
    percent: find("percent", "%", "progress", "complete"),
  };
  const looksLikeHeader = idx.section !== -1 || idx.activity !== -1;
  return { idx, looksLikeHeader };
}

export async function importProgrammeFile(projectId, formData) {
  if (!projectId) return { error: "No project selected" };
  const file = formData.get("file");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return { error: "Choose a .csv or .xlsx file" };
  }

  let raw;
  try {
    raw = await rowsFromFile(file);
  } catch {
    return { error: "Could not read that file — is it a valid .csv or .xlsx?" };
  }
  if (!raw.length) return { error: "The file has no rows" };
  if (raw.length > MAX_ROWS) return { error: `Too many rows (max ${MAX_ROWS})` };

  const { idx, looksLikeHeader } = mapColumns(raw[0]);
  const dataRows = looksLikeHeader ? raw.slice(1) : raw;
  const col = {
    section: idx.section !== -1 ? idx.section : 0,
    activity: idx.activity !== -1 ? idx.activity : 1,
    start: idx.start !== -1 ? idx.start : 2,
    end: idx.end !== -1 ? idx.end : 3,
    percent: idx.percent !== -1 ? idx.percent : 4,
  };

  // Build sections in first-seen order; a blank section carries the last one.
  const order = [];
  const byName = new Map();
  let current = "Programme";
  for (const r of dataRows) {
    const section = String(r[col.section] ?? "").trim();
    const activity = String(r[col.activity] ?? "").trim();
    if (section) current = section;
    if (!activity && !section) continue;
    if (!byName.has(current)) {
      byName.set(current, []);
      order.push(current);
    }
    if (activity) {
      byName.get(current).push({
        title: activity.slice(0, 300),
        plannedStart: toISODate(r[col.start]),
        plannedEnd: toISODate(r[col.end]),
        percent: toPercent(r[col.percent]),
      });
    }
  }

  if (!order.length) return { error: "No activities found — check the columns (Section, Activity, Start, End, %)." };

  try {
    const counts = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES,
      async (tx, { user, companyId }) => {
        const project = await repo.getProjectById(tx, projectId);
        if (!project) throw new Error("Project not found");
        if (project.status === "closed") throw new Error("A closed project's programme cannot be changed.");

        const actorId = user?.id ?? null;
        const actorName = user?.name || "Import";
        let sections = 0;
        let activities = 0;

        for (let si = 0; si < order.length; si++) {
          const name = order[si];
          const acts = byName.get(name);
          const [parent] = await tx
            .insert(projectTasks)
            .values({
              companyId,
              projectId,
              title: name.slice(0, 300),
              status: "todo",
              sortOrder: si * 1000,
              createdById: actorId,
              createdByName: actorName,
            })
            .returning({ id: projectTasks.id });
          sections++;

          for (let ai = 0; ai < acts.length; ai++) {
            const a = acts[ai];
            await tx.insert(projectTasks).values({
              companyId,
              projectId,
              parentTaskId: parent.id,
              title: a.title,
              status: statusFor(a.percent),
              plannedStart: a.plannedStart,
              plannedEnd: a.plannedEnd,
              progressPercent: a.percent,
              sortOrder: ai,
              createdById: actorId,
              createdByName: actorName,
            });
            activities++;
          }
        }
        return { sections, activities };
      },
    );

    revalidatePath("/dashboard/projects/programme");
    revalidatePath("/dashboard/projects/milestones");
    revalidatePath(`/dashboard/projects/${projectId}`);
    return {
      success: true,
      message: `Imported ${counts.activities} activities across ${counts.sections} section${counts.sections === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
