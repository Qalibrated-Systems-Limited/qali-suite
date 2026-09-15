import { sql } from "drizzle-orm";
import { anyOf, isUuid } from "./sqlHelpers";
import type { Tx } from "../client";

/**
 * The approval engine — 0101.
 *
 * Contract with the layer above: every function takes a `tx` from
 * withTenant(), so RLS is active; nothing here reads the session or decides
 * who may approve. That decision is `canApproveType` in lib/business-rules.js,
 * made in the action where the role is known.
 *
 * ── The lease ──────────────────────────────────────────────────────────────
 *
 * Two approvers pressing at the same moment must not both apply the payload —
 * that is a doubled price change, or a supplier paid twice. Mongo needed an
 * explicit `findOneAndUpdate({status:'submitted'}, {$set:{status:'applying'}})`
 * and a long comment explaining it. Here it is `UPDATE … WHERE status =
 * 'submitted' RETURNING id`: zero rows means somebody else won.
 *
 * The claim is DELIBERATELY NOT in the caller's transaction — see `claim`.
 */

export type ApprovalStatus =
  | "submitted"
  | "applying"
  | "approved"
  | "rejected"
  | "cancelled";

const iso = (v: unknown) =>
  v == null ? null : new Date(String(v)).toISOString();

/** The shape the approvals screens already render. */
function toScreenApproval(r: Record<string, unknown>) {
  return {
    _id: String(r.id),
    id: String(r.id),
    requestNumber: String(r.request_number),
    type: r.type as string,
    status: r.status as string,
    targetRef: {
      kind: r.target_kind as string,
      id: String(r.target_id),
      label: (r.target_label as string) ?? "",
    },
    payload: (r.payload as Record<string, unknown>) ?? {},
    context: (r.context as Record<string, unknown>) ?? {},
    reason: (r.reason as string) ?? "",
    requesterNote: (r.requester_note as string) ?? "",
    requiredApproverRoles: (r.required_approver_roles as string[]) ?? [],
    submittedBy: {
      id: (r.submitted_by_id as string) ?? "",
      name: (r.submitted_by_name as string) ?? "",
      role: (r.submitted_by_role as string) ?? null,
      submittedAt: iso(r.submitted_at),
    },
    decision: r.decision_action
      ? {
          action: r.decision_action as string,
          by: {
            id: (r.decided_by_id as string) ?? null,
            name: (r.decided_by_name as string) ?? "",
            role: (r.decided_by_role as string) ?? null,
          },
          at: iso(r.decided_at),
          note: (r.decision_note as string) ?? "",
        }
      : null,
    appliedAt: iso(r.applied_at),
    appliedRef: r.applied_kind
      ? { kind: r.applied_kind as string, id: String(r.applied_id) }
      : null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

// ── Submit ──────────────────────────────────────────────────────────────────

export interface SubmitApprovalInput {
  companyId: string;
  type: string;
  targetKind: string;
  targetId: string;
  targetLabel?: string | null;
  payload?: Record<string, unknown>;
  context?: Record<string, unknown>;
  reason?: string;
  requesterNote?: string;
  requiredApproverRoles: string[];
  submittedById: string;
  submittedByName: string;
  submittedByRole?: string | null;
}

export async function submitApproval(tx: Tx, input: SubmitApprovalInput) {
  if (input.requiredApproverRoles.length === 0) {
    throw new Error(`No approver matrix for type "${input.type}".`);
  }

  const [{ request_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'APR') AS request_number`,
  )) as unknown as Array<{ request_number: string }>;

  const [row] = (await tx.execute(sql`
    INSERT INTO approval_requests (
      company_id, request_number, type, status,
      target_kind, target_id, target_label,
      payload, context, reason, requester_note, required_approver_roles,
      submitted_by_id, submitted_by_name, submitted_by_role
    ) VALUES (
      ${input.companyId}::uuid, ${request_number},
      ${input.type}::approval_type, 'submitted',
      ${input.targetKind}::approval_target_kind, ${String(input.targetId)},
      ${input.targetLabel ?? null},
      ${JSON.stringify(input.payload ?? {})}::jsonb,
      ${JSON.stringify(input.context ?? {})}::jsonb,
      ${input.reason ?? ""}, ${input.requesterNote ?? ""},
      ${sql`ARRAY[${sql.join(
        input.requiredApproverRoles.map((r) => sql`${r}`),
        sql`, `,
      )}]::text[]`},
      ${input.submittedById}, ${input.submittedByName},
      ${input.submittedByRole ?? null}
    )
    RETURNING *
  `)) as unknown as Array<Record<string, unknown>>;

  return toScreenApproval(row);
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getApproval(tx: Tx, approvalId: string) {
  if (!isUuid(approvalId)) return null;
  const [row] = (await tx.execute(sql`
    SELECT * FROM approval_requests WHERE id = ${approvalId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  return row ? toScreenApproval(row) : null;
}

/**
 * The queue: everything at `status` that this role may decide.
 *
 * The type filter is the whole of "my queue" — a Store Manager sees stock
 * adjustments and not price changes. An empty `types` returns nothing rather
 * than everything, which is the safe direction for a screen about authority.
 */
export async function listQueue(
  tx: Tx,
  types: string[],
  status: ApprovalStatus = "submitted",
  limit = 100,
) {
  if (types.length === 0) return [];
  const rows = (await tx.execute(sql`
    SELECT * FROM approval_requests
     WHERE status = ${status}::approval_status
       AND type = ${anyOf(types, "approval_type[]")}
     ORDER BY created_at DESC
     LIMIT ${Math.min(Math.max(limit, 1), 500)}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(toScreenApproval);
}

/** How many are waiting that this role may decide. */
export async function countQueue(tx: Tx, types: string[]) {
  if (types.length === 0) return 0;
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM approval_requests
     WHERE status = 'submitted'
       AND type = ${anyOf(types, "approval_type[]")}
  `)) as unknown as Array<Record<string, unknown>>;
  return Number(row?.n ?? 0);
}

/** What one person raised, whatever became of it. */
export async function listSubmittedBy(
  tx: Tx,
  submittedById: string,
  limit = 20,
) {
  const rows = (await tx.execute(sql`
    SELECT * FROM approval_requests
     WHERE submitted_by_id = ${submittedById}
     ORDER BY created_at DESC
     LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(toScreenApproval);
}

/** The open request holding a given document, if there is one. */
export async function findOpenForTarget(
  tx: Tx,
  targetKind: string,
  targetId: string,
) {
  const [row] = (await tx.execute(sql`
    SELECT * FROM approval_requests
     WHERE target_kind = ${targetKind}::approval_target_kind
       AND target_id = ${String(targetId)}
       AND status IN ('submitted', 'applying')
     LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  return row ? toScreenApproval(row) : null;
}

// ── The lease ───────────────────────────────────────────────────────────────

/**
 * Claim a submitted request for application.
 *
 * Returns the request if this caller won the race, null if somebody else did.
 *
 * THE CLAIM MUST COMMIT ON ITS OWN, which is why the action runs this in its
 * own `withTenant` rather than inside the transaction that applies the
 * payload. Two concurrent claims inside two open transactions do not see each
 * other's uncommitted row: the second blocks on the row lock, and when the
 * first commits it re-evaluates `WHERE status = 'submitted'`, finds it false
 * and returns zero rows. That is the guarantee — but only because the first
 * transaction ENDS. Nest the claim inside the long apply transaction and the
 * second approver waits for the whole application instead, which is the same
 * answer far more slowly, and holds a row lock across a ledger posting.
 */
export async function claim(tx: Tx, approvalId: string) {
  if (!isUuid(approvalId)) return null;
  const [row] = (await tx.execute(sql`
    UPDATE approval_requests
       SET status = 'applying', updated_at = now()
     WHERE id = ${approvalId}::uuid
       AND status = 'submitted'
    RETURNING *
  `)) as unknown as Array<Record<string, unknown>>;
  return row ? toScreenApproval(row) : null;
}

/** Hand a claimed request back, so a failed apply can be retried. */
export async function releaseClaim(tx: Tx, approvalId: string) {
  await tx.execute(sql`
    UPDATE approval_requests
       SET status = 'submitted', updated_at = now()
     WHERE id = ${approvalId}::uuid AND status = 'applying'
  `);
}

/**
 * Reset leases stranded by a crash between the claim and the finalise.
 *
 * Cross-tenant by nature — it is a cron sweep, not a request — so it takes an
 * explicit company filter of none. The partial index on `updated_at WHERE
 * status = 'applying'` is what keeps it from scanning the table.
 */
export async function reapStaleLeases(tx: Tx, staleMinutes = 10) {
  const rows = (await tx.execute(sql`
    UPDATE approval_requests
       SET status = 'submitted', updated_at = now()
     WHERE status = 'applying'
       AND updated_at < now() - ${`${staleMinutes} minutes`}::interval
    RETURNING id
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.length;
}

// ── Decisions ───────────────────────────────────────────────────────────────

interface Decider {
  id?: string | null;
  name?: string | null;
  role?: string | null;
}

/**
 * Finalise a claimed request as approved, recording what the applier produced.
 *
 * `approval_requests_decision_pair` refuses this if the decider is missing, so
 * an approval with no approver on it is not a row this table can hold.
 */
export async function finaliseApproved(
  tx: Tx,
  approvalId: string,
  by: Decider,
  applied: { kind?: string | null; id?: string | null; at?: Date } = {},
  note = "",
) {
  const [row] = (await tx.execute(sql`
    UPDATE approval_requests
       SET status = 'approved',
           decision_action = 'approved',
           decided_by_id = ${by.id ?? null},
           decided_by_name = ${by.name ?? "System"},
           decided_by_role = ${by.role ?? null},
           decided_at = now(),
           decision_note = ${note},
           applied_at = ${(applied.at ?? new Date()).toISOString()}::timestamptz,
           applied_kind = ${applied.kind ?? null},
           applied_id = ${applied.id == null ? null : String(applied.id)},
           updated_at = now()
     WHERE id = ${approvalId}::uuid AND status = 'applying'
    RETURNING *
  `)) as unknown as Array<Record<string, unknown>>;
  if (!row) throw new Error("This request is no longer being applied.");
  return toScreenApproval(row);
}

/** Reject or cancel — the two terminal states that apply nothing. */
export async function decide(
  tx: Tx,
  approvalId: string,
  action: "rejected" | "cancelled",
  by: Decider,
  note = "",
) {
  if (!isUuid(approvalId)) throw new Error("Approval not found.");

  const [row] = (await tx.execute(sql`
    UPDATE approval_requests
       SET status = ${action}::approval_status,
           decision_action = ${action}::approval_status,
           decided_by_id = ${by.id ?? null},
           decided_by_name = ${by.name ?? "System"},
           decided_by_role = ${by.role ?? null},
           decided_at = now(),
           decision_note = ${note},
           updated_at = now()
     WHERE id = ${approvalId}::uuid
       AND status = 'submitted'
    RETURNING *
  `)) as unknown as Array<Record<string, unknown>>;

  if (!row) {
    /*
     * Say WHICH of the two it was. "Not found" for a request that is simply
     * already decided sends people looking for a missing row.
     */
    const current = await getApproval(tx, approvalId);
    if (!current) throw new Error("Approval not found.");
    if (current.status === "applying") {
      throw new Error(
        "Another approver is processing this request — please refresh.",
      );
    }
    throw new Error(`Already ${current.status}; it cannot be re-decided.`);
  }

  return toScreenApproval(row);
}
