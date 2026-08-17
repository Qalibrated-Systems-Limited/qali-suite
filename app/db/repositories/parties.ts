import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { parties } from "../schema";

/**
 * Customers, suppliers and employees.
 *
 * Roles are independent booleans here rather than the Mongo four-valued enum,
 * so "customers" is `is_customer = true` instead of
 * `type IN ('customer','both')`. See docs/POSTGRES-MIGRATION-PLAN.md §5.
 */

export interface CreatePartyInput {
  companyId: string;
  name: string;
  primaryType: "customer" | "supplier" | "employee" | "other";
  isCustomer?: boolean;
  isSupplier?: boolean;
  isEmployee?: boolean;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  taxPin?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  country?: string;
  creditLimit?: string;
  paymentTermsDays?: number;
  employeeNumber?: string | null;
  createdById?: string | null;
}

export async function createParty(tx: Tx, input: CreatePartyInput) {
  // The primary type must be a role the party actually holds — a CHECK
  // enforces it, so default the matching flag rather than letting a caller
  // trip the constraint with an obvious combination.
  const [created] = await tx
    .insert(parties)
    .values({
      companyId: input.companyId,
      name: input.name,
      primaryType: input.primaryType,
      isCustomer: input.isCustomer ?? input.primaryType === "customer",
      isSupplier: input.isSupplier ?? input.primaryType === "supplier",
      isEmployee: input.isEmployee ?? input.primaryType === "employee",
      displayName: input.displayName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      taxPin: input.taxPin ?? null,
      addressLine1: input.addressLine1 ?? null,
      city: input.city ?? null,
      country: input.country ?? "Kenya",
      creditLimit: input.creditLimit ?? "0",
      paymentTermsDays: input.paymentTermsDays ?? 30,
      // Empty string would collide under the partial unique index, which
      // deliberately excludes '' — normalise it away.
      employeeNumber: input.employeeNumber || null,
      createdById: input.createdById ?? null,
    })
    .returning();

  return created;
}

export async function getParty(tx: Tx, partyId: string) {
  const [party] = await tx.select().from(parties).where(eq(parties.id, partyId));
  return party ?? null;
}

export async function listParties(
  tx: Tx,
  opts: {
    role?: "customer" | "supplier" | "employee";
    search?: string;
    activeOnly?: boolean;
    limit?: number;
  } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const conditions = [];

  if (opts.activeOnly !== false) conditions.push(eq(parties.isActive, true));
  if (opts.role === "customer") conditions.push(eq(parties.isCustomer, true));
  if (opts.role === "supplier") conditions.push(eq(parties.isSupplier, true));
  if (opts.role === "employee") conditions.push(eq(parties.isEmployee, true));

  if (opts.search) {
    const term = `%${opts.search}%`;
    conditions.push(
      or(
        ilike(parties.name, term),
        ilike(parties.email, term),
        ilike(parties.taxPin, term),
      )!,
    );
  }

  return tx
    .select()
    .from(parties)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(parties.name))
    .limit(limit);
}

/**
 * Balance from the party_balances view — derived from the AR/AP control
 * accounts, never stored. Positive = they owe us, negative = we owe them.
 *
 * Replaces Party.cachedBalance, whose own comment reads
 * "Cached - NOT source of truth!".
 */
export async function getPartyBalance(tx: Tx, partyId: string) {
  const [row] = (await tx.execute(sql`
    SELECT party_id, name, primary_type, balance
      FROM party_balances WHERE party_id = ${partyId}
  `)) as unknown as Array<{
    party_id: string;
    name: string;
    primary_type: string;
    balance: string;
  }>;
  return row ?? null;
}

export async function deactivateParty(tx: Tx, partyId: string) {
  const [updated] = await tx
    .update(parties)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(parties.id, partyId))
    .returning();

  if (!updated) throw new Error("Party not found");
  return updated;
}
