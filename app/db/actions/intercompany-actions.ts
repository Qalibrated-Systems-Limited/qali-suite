"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { INTERCOMPANY_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/intercompany";

/**
 * Inter-Company actions — 0113. Zod validates, `withAuthorizedTenant` scopes and
 * gates, the repository does the SQL. Reads open to any member; writes need
 * INTERCOMPANY_WRITE_ROLES (group finance).
 */

const WRITE = INTERCOMPANY_WRITE_ROLES as unknown as string[];
const TYPES = ["mgmt_fee", "shared_services", "royalty", "license", "loan", "other"] as const;
const TXN_STATUS = ["invoiced", "collected", "overdue", "written_off"] as const;

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name || "Unknown User" };
}
function s(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v : "";
}
function bump() {
  revalidatePath("/dashboard/inter-company");
}

export async function getInterCompanyData() {
  return withAuthorizedTenant([], async (tx) => {
    const [contracts, transactions, stats] = await Promise.all([
      repo.listContracts(tx),
      repo.listTransactions(tx),
      repo.getICStats(tx),
    ]);
    return { contracts, transactions, stats };
  });
}

// ── contracts ──────────────────────────────────────────────────────────────────
const contractSchema = z.object({
  sisterCompany: z.string().trim().min(1, "A sister company is required").max(200),
  contractType: z.enum(TYPES).optional(),
  contractValue: z.coerce.number().min(0).optional(),
  fee: z.coerce.number().min(0).optional(),
  minRequired: z.coerce.number().min(0).optional(),
  currency: z.string().trim().max(8).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function createContract(prevState: unknown, formData: FormData) {
  const parsed = contractSchema.safeParse({
    sisterCompany: s(formData.get("sisterCompany")),
    contractType: s(formData.get("contractType")) || undefined,
    contractValue: s(formData.get("contractValue")) || 0,
    fee: s(formData.get("fee")) || 0,
    minRequired: s(formData.get("minRequired")) || 0,
    currency: s(formData.get("currency")) || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createContract(tx, {
        companyId,
        ...parsed.data,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.contractNumber} created` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function updateContract(id: string, patch: Record<string, unknown>) {
  const parsed = contractSchema.partial().safeParse(patch);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.updateContract(tx, id, parsed.data, actorFrom(user)),
    );
    if (!row) return { error: "Contract not found." };
    bump();
    return { success: true, message: `${row.contractNumber} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteContract(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteContract(tx, id));
    if (!ok) return { error: "Contract not found." };
    bump();
    return { success: true, message: "Contract deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── transactions ────────────────────────────────────────────────────────────
const txnSchema = z.object({
  contractId: z.string().trim().min(1, "Choose a contract"),
  txnDate: z.string().trim().min(1, "A date is required"),
  transactionType: z.string().trim().max(120).optional(),
  amount: z.coerce.number().min(0),
  status: z.enum(TXN_STATUS).optional(),
  reference: z.string().trim().max(120).optional(),
});

export async function recordTransaction(prevState: unknown, formData: FormData) {
  const parsed = txnSchema.safeParse({
    contractId: s(formData.get("contractId")),
    txnDate: s(formData.get("txnDate")),
    transactionType: s(formData.get("transactionType")),
    amount: s(formData.get("amount")) || 0,
    status: s(formData.get("status")) || undefined,
    reference: s(formData.get("reference")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createTransaction(tx, {
        companyId,
        ...parsed.data,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: "Transaction recorded" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setTransactionStatus(id: string, status: string) {
  if (!TXN_STATUS.includes(status as (typeof TXN_STATUS)[number])) return { error: "Unknown status." };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.setTransactionStatus(tx, id, status, actorFrom(user)),
    );
    if (!row) return { error: "Transaction not found." };
    bump();
    return { success: true, message: "Updated" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteTransaction(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteTransaction(tx, id));
    if (!ok) return { error: "Transaction not found." };
    bump();
    return { success: true, message: "Transaction deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
