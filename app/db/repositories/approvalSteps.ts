import { sql } from "drizzle-orm";
import type { Tx } from "../client";
import { isUuid } from "./sqlHelpers";
import { DEFAULT_APPROVAL_STEPS, STEP_APPROVAL_TYPES } from "@/lib/business-rules";

/**
 * Approval chains — the steps a stock change passes, who signed each, and the
 * lines they confirmed. RLS-scoped `tx`; who may act is decided in
 * approval-actions.ts.
 */

export type Step = { label: string; roles: string[] };

export function isStepType(type: string) {
  return (STEP_APPROVAL_TYPES as readonly string[]).includes(type);
}

export function defaultSteps(type: string): Step[] {
  const d = (DEFAULT_APPROVAL_STEPS as Record<string, readonly Step[]>)[type];
  return d ? d.map((s) => ({ label: s.label, roles: [...s.roles] })) : [];
}

/** The company's chain for a type: its own if set, else the default. */
export async function stepsFor(tx: Tx, type: string): Promise<Step[]> {
  if (!isStepType(type)) return [];
  const rows = (await tx.execute(sql`
    SELECT label, roles FROM approval_step_policies WHERE type = ${type} ORDER BY step_no
  `)) as unknown as Array<{ label: string; roles: string[] }>;
  return rows.length ? rows.map((r) => ({ label: r.label, roles: r.roles })) : defaultSteps(type);
}

/** Every chained type with its current steps, and whether it is customised. */
export async function allPolicies(tx: Tx) {
  const out: Array<{ type: string; custom: boolean; steps: Step[]; updatedByName: string | null }> = [];
  for (const type of STEP_APPROVAL_TYPES) {
    const rows = (await tx.execute(sql`
      SELECT label, roles, updated_by_name AS "by" FROM approval_step_policies WHERE type = ${type} ORDER BY step_no
    `)) as unknown as Array<{ label: string; roles: string[]; by: string }>;
    out.push({
      type,
      custom: rows.length > 0,
      steps: rows.length ? rows.map((r) => ({ label: r.label, roles: r.roles })) : defaultSteps(type),
      updatedByName: rows[0]?.by ?? null,
    });
  }
  return out;
}

export async function savePolicy(tx: Tx, companyId: string, type: string, steps: Step[], byName: string) {
  await tx.execute(sql`DELETE FROM approval_step_policies WHERE type = ${type}`);
  let n = 0;
  for (const s of steps) {
    n += 1;
    await tx.execute(sql`
      INSERT INTO approval_step_policies (company_id, type, step_no, label, roles, updated_by_name)
      VALUES (${companyId}::uuid, ${type}, ${n}, ${s.label},
              ARRAY[${sql.join(s.roles.map((r) => sql`${r}`), sql`, `)}]::text[], ${byName})
    `);
  }
}

export async function resetPolicy(tx: Tx, type: string) {
  await tx.execute(sql`DELETE FROM approval_step_policies WHERE type = ${type}`);
}

export interface StepDecision {
  stepNo: number;
  stepLabel: string;
  decidedById: string;
  decidedByName: string;
  decidedByRole: string | null;
  note: string;
  confirmedLines: string[];
  decidedAt: string;
}

export async function decisionsFor(tx: Tx, approvalId: string): Promise<StepDecision[]> {
  if (!isUuid(approvalId)) return [];
  const rows = (await tx.execute(sql`
    SELECT step_no AS "stepNo", step_label AS "stepLabel", decided_by_id AS "decidedById",
           decided_by_name AS "decidedByName", decided_by_role AS "decidedByRole", note,
           confirmed_lines AS "confirmedLines", decided_at AS "decidedAt"
      FROM approval_step_decisions WHERE approval_id = ${approvalId}::uuid ORDER BY step_no
  `)) as unknown as Array<Omit<StepDecision, "decidedAt"> & { decidedAt: unknown }>;
  return rows.map((r) => ({
    ...r,
    decidedAt: r.decidedAt instanceof Date ? r.decidedAt.toISOString() : String(r.decidedAt),
  }));
}

/** Record a signature on the current step. */
export async function recordStep(
  tx: Tx,
  input: {
    companyId: string;
    approvalId: string;
    stepNo: number;
    stepLabel: string;
    by: { id: string; name: string; role: string | null };
    note: string;
    confirmedLines: string[];
  },
) {
  await tx.execute(sql`
    INSERT INTO approval_step_decisions
      (company_id, approval_id, step_no, step_label, decided_by_id, decided_by_name, decided_by_role, note, confirmed_lines)
    VALUES (${input.companyId}::uuid, ${input.approvalId}::uuid, ${input.stepNo}, ${input.stepLabel},
            ${input.by.id}, ${input.by.name}, ${input.by.role}, ${input.note},
            ${JSON.stringify(input.confirmedLines)}::jsonb)
  `);
}

/**
 * Move a request to its next step. Only from the step the caller saw, and only
 * while it is still waiting: two approvers on the same step cannot both
 * advance it.
 */
export async function advance(tx: Tx, approvalId: string, fromStep: number, next: Step) {
  const rows = (await tx.execute(sql`
    UPDATE approval_requests
       SET current_step = current_step + 1,
           current_step_label = ${next.label},
           current_step_roles = ARRAY[${sql.join(next.roles.map((r) => sql`${r}`), sql`, `)}]::text[],
           updated_at = now()
     WHERE id = ${approvalId}::uuid AND status = 'submitted' AND current_step = ${fromStep}
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  if (!rows.length) throw new Error("Someone else has just acted on this step — refresh to see where it is.");
}

export interface PreviewLine {
  id: string;
  sku: string;
  name: string;
  unit: string;
  systemQuantity: number;
  physicalQuantity: number;
  change: number;
  unitCost: number;
  value: number;
  reason: string;
}

/** The lines an approver must tick: what the request will change. */
export async function previewLines(tx: Tx, targetKind: string, targetId: string): Promise<PreviewLine[]> {
  if ((targetKind !== "InventoryAdjustment" && targetKind !== "StockAdjustment") || !isUuid(targetId)) return [];
  const rows = (await tx.execute(sql`
    SELECT id::text AS id, product_sku_at_adjustment AS sku, product_name_at_adjustment AS name,
           product_unit_at_adjustment AS unit,
           system_quantity::float8 AS "systemQuantity", physical_quantity::float8 AS "physicalQuantity",
           adjustment_quantity::float8 AS change, unit_cost::float8 AS "unitCost",
           adjustment_value::float8 AS value, reason
      FROM stock_adjustment_lines WHERE adjustment_id = ${targetId}::uuid
     ORDER BY created_at, id
  `)) as unknown as PreviewLine[];
  return rows;
}
