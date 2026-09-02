/**
 * MODULE TIERS AND DEPENDENCY DIRECTION — the module manifest.
 *
 * This application is multi-tenant and carries industry modules alongside the
 * general ERP — the Technical module (sheet reports, ISO 17025 calibration, ISO
 * 17020 inspection) is the first. How a general core and an industry module
 * share one codebase is a question every ERP answers eventually, and the three
 * obvious comparisons answer it the same way:
 *
 *   - **Odoo** — everything is an addon with a `__manifest__.py` declaring
 *     `depends`. Core, OCA, industry and custom addons sit side by side and a
 *     database INSTALLS a subset. Nobody forks `base`.
 *   - **SAP** — core, plus industry solutions and country localisations, joined
 *     at defined extension points. The rule that governs it: never modify core.
 *   - **Dynamics NAV / Business Central** — extensions, each an app with an id
 *     and a `dependencies` list. Worth dwelling on: NAV USED to customise by
 *     merging code into the base objects, every upgrade became a three-way
 *     merge, and Microsoft rebuilt the whole extensibility model to stop it.
 *
 * We got a small taste of NAV's old model on 2026-09-02: three days of parallel
 * work, eight commits each side, four colliding migration numbers whose journal
 * timestamps ALSO collided, and one page needing a hand-merge. That is the
 * argument for this file — one codebase, declared modules, one-way
 * dependencies.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * **Dependencies point one way. A vertical may import from core; core may never
 * import from a vertical.** `local/no-core-imports-vertical` enforces it —
 * today the boundary holds by luck, and a lint rule is what makes it hold by
 * construction.
 *
 * ── And the other half, which is not code ───────────────────────────────────
 *
 * If it varies by TENANT it is a row, not a branch. Sheet codes are a column
 * value, a retention percentage is a `project_contracts` row, project types are
 * `project_types` rows a tenant adds without a migration. Nothing here should
 * ever need a branch on which tenant is logged in.
 */

/** Everything not claimed by a vertical below is CORE. */
export const TIERS = Object.freeze({
  CORE: "core",
  VERTICAL: "vertical",
  LOCALISATION: "localisation",
});

/**
 * Industry verticals — and the naming matters.
 *
 * Named for the INDUSTRY it serves, never for a tenant. Calibration is ISO
 * 17025 and inspection is ISO 17020: any calibration laboratory or inspection
 * body needs exactly these tables. A module named after one organisation never
 * gets generalised; naming it for the industry keeps the option open.
 *
 * `paths` is what the lint rule reads. A path is a directory prefix or an exact
 * file.
 */
export const VERTICALS = Object.freeze([
  Object.freeze({
    id: "technical",
    label: "Technical — sheets, calibration and inspection",
    industry: "Calibration (ISO 17025) and inspection (ISO 17020) bodies",
    depends: Object.freeze(["projects"]),
    paths: Object.freeze([
      "app/dashboard/technical",
      "app/dashboard/calibration",
      "app/dashboard/inspection",
      "app/db/schema/technical.ts",
      "app/db/repositories/technical.ts",
      "app/db/actions/technical-actions.ts",
      "app/db/schema/workflowReports.ts",
      "app/db/repositories/workflowReports.ts",
      "app/db/actions/workflow-report-actions.ts",
    ]),
  }),
]);

/**
 * Files that may reference a vertical despite not being one.
 *
 * `app/db/schema/index.ts` is a BARREL: it re-exports every schema module so
 * drizzle can see the whole set, and that is a build concern rather than a
 * dependency. Excluding it is not a hole — nothing gains access to a vertical's
 * behaviour by being re-exported alongside it.
 */
export const BOUNDARY_EXEMPT = Object.freeze(["app/db/schema/index.ts"]);

/**
 * Two classification calls made when this file was written, recorded because
 * the next person will ask:
 *
 * `app/db/actions/programme-actions.js` is CORE, not vertical, even though it
 * arrived with the Technical work. It parses a spreadsheet into
 * `project_tasks` — importing a programme from MS Project or Excel is what
 * every contractor does, and nothing in it is specific to calibration.
 *
 * `workflow_reports` is listed as vertical and is the weaker call. The RECORD
 * is generic — a project report with a draft → submitted → reviewed → approved
 * trail — and it may well be promoted to core once something outside Technical
 * reads it. It is here because today the Technical module is its only reader
 * and its `type` column holds that module's sheet codes. Mis-filing a vertical
 * as core lets industry-specific detail leak into the general modules;
 * mis-filing core as vertical only means it is gated for now. When in doubt,
 * vertical.
 */
export function tierOfPath(filePath) {
  const p = String(filePath).replace(/\\/g, "/");
  if (BOUNDARY_EXEMPT.some((e) => p.endsWith(e))) return TIERS.CORE;
  for (const v of VERTICALS) {
    if (v.paths.some((dir) => p.includes(dir))) return TIERS.VERTICAL;
  }
  return TIERS.CORE;
}

/** The vertical owning a path, or null. */
export function verticalOfPath(filePath) {
  const p = String(filePath).replace(/\\/g, "/");
  return VERTICALS.find((v) => v.paths.some((dir) => p.includes(dir))) ?? null;
}
