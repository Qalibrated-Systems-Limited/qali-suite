import { eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { intercompanyContracts, intercompanyTransactions } from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * Inter-Company repository — 0113. `tx` is already RLS-scoped; no companyId
 * filtering, no session/role logic (that is intercompany-actions.ts).
 *
 * A contract's "collected", "outstanding" and status are DERIVED from its
 * transactions — the sum of what was actually collected against the fee — never
 * stored, so the balance cannot drift from the ledger of movements.
 */

type Actor = { id?: string | null; name?: string | null };

async function nextNumber(tx: Tx, companyId: string) {
  const [{ n }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'IC') AS n`,
  )) as unknown as Array<{ n: string }>;
  return n;
}

function deriveStatus(fee: number, collected: number) {
  if (fee <= 0) return "settled";
  if (collected >= fee) return "settled";
  if (collected > 0) return "partial";
  return "outstanding";
}

// ── Contracts ─────────────────────────────────────────────────────────────────
export async function listContracts(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT
      c.*,
      COALESCE((
        SELECT SUM(t.amount) FROM intercompany_transactions t
         WHERE t.contract_id = c.id AND t.status = 'collected'
      ), 0)::float8 AS collected
    FROM intercompany_contracts c
    ORDER BY c.created_at DESC
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const fee = Number(r.fee ?? 0);
    const collected = Number(r.collected ?? 0);
    return {
      id: String(r.id),
      _id: String(r.id),
      contractNumber: String(r.contract_number ?? ""),
      sisterCompany: String(r.sister_company ?? ""),
      contractType: String(r.contract_type ?? ""),
      contractValue: Number(r.contract_value ?? 0),
      fee,
      minRequired: Number(r.min_required ?? 0),
      currency: String(r.currency ?? "KES"),
      collected,
      outstanding: Math.max(fee - collected, 0),
      status: deriveStatus(fee, collected),
      notes: String(r.notes ?? ""),
    };
  });
}

export async function getContractById(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(intercompanyContracts).where(eq(intercompanyContracts.id, id));
  return row ?? null;
}

export async function createContract(
  tx: Tx,
  input: {
    companyId: string;
    sisterCompany: string;
    contractType?: string;
    contractValue?: number;
    fee?: number;
    minRequired?: number;
    currency?: string;
    notes?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const contractNumber = await nextNumber(tx, input.companyId);
  const [row] = await tx
    .insert(intercompanyContracts)
    .values({
      companyId: input.companyId,
      contractNumber,
      sisterCompany: input.sisterCompany.trim(),
      contractType: input.contractType ?? "mgmt_fee",
      contractValue: input.contractValue ?? 0,
      fee: input.fee ?? 0,
      minRequired: input.minRequired ?? 0,
      currency: input.currency ?? "KES",
      notes: input.notes?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedById: input.createdById ?? null,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function updateContract(tx: Tx, id: string, patch: Record<string, unknown>, actor: Actor) {
  if (!isUuid(id)) return null;
  const set: Record<string, unknown> = {
    lastModifiedById: actor?.id ?? null,
    lastModifiedByName: actor?.name || "System",
    updatedAt: new Date(),
  };
  for (const k of ["sisterCompany", "contractType", "contractValue", "fee", "minRequired", "currency", "notes"]) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  const [row] = await tx.update(intercompanyContracts).set(set).where(eq(intercompanyContracts.id, id)).returning();
  return row ?? null;
}

export async function deleteContract(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(intercompanyContracts).where(eq(intercompanyContracts.id, id)).returning({ id: intercompanyContracts.id });
  return rows.length > 0;
}

// ── Transactions ──────────────────────────────────────────────────────────────
export async function listTransactions(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT t.*, c.sister_company, c.contract_number
      FROM intercompany_transactions t
      JOIN intercompany_contracts c ON c.id = t.contract_id
     ORDER BY t.txn_date DESC, t.created_at DESC
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    _id: String(r.id),
    contractId: String(r.contract_id),
    sisterCompany: String(r.sister_company ?? ""),
    contractNumber: String(r.contract_number ?? ""),
    txnDate: r.txn_date ? new Date(r.txn_date as string).toISOString() : null,
    transactionType: String(r.transaction_type ?? ""),
    amount: Number(r.amount ?? 0),
    status: String(r.status ?? ""),
    reference: String(r.reference ?? ""),
  }));
}

export async function createTransaction(
  tx: Tx,
  input: {
    companyId: string;
    contractId: string;
    txnDate: string;
    transactionType?: string | null;
    amount?: number;
    status?: string;
    reference?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const [row] = await tx
    .insert(intercompanyTransactions)
    .values({
      companyId: input.companyId,
      contractId: input.contractId,
      txnDate: input.txnDate,
      transactionType: input.transactionType?.trim() ?? "",
      amount: input.amount ?? 0,
      status: input.status ?? "invoiced",
      reference: input.reference?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function setTransactionStatus(tx: Tx, id: string, status: string, actor: Actor) {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .update(intercompanyTransactions)
    .set({
      status,
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name || "System",
      updatedAt: new Date(),
    })
    .where(eq(intercompanyTransactions.id, id))
    .returning();
  return row ?? null;
}

export async function deleteTransaction(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(intercompanyTransactions).where(eq(intercompanyTransactions.id, id)).returning({ id: intercompanyTransactions.id });
  return rows.length > 0;
}

// ── Stats ────────────────────────────────────────────────────────────────────
export async function getICStats(tx: Tx) {
  const [f] = (await tx.execute(sql`
    SELECT COALESCE(SUM(fee), 0)::float8 AS total_fees FROM intercompany_contracts
  `)) as unknown as Array<{ total_fees: number }>;
  const [c] = (await tx.execute(sql`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE status = 'collected'), 0)::float8 AS collected,
      count(*)::int AS txns
    FROM intercompany_transactions
  `)) as unknown as Array<{ collected: number; txns: number }>;
  const totalFees = f?.total_fees ?? 0;
  const collected = c?.collected ?? 0;
  return {
    totalFees,
    collected,
    outstanding: Math.max(totalFees - collected, 0),
    transactions: c?.txns ?? 0,
  };
}
