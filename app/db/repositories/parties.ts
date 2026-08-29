import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { parties } from "../schema";
import { likeContains, likePrefix } from "./sqlHelpers";

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
  notes?: string | null;
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
      notes: input.notes ?? null,
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
    const term = likeContains(opts.search);
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

/** Role filter, expressed on the booleans rather than on a stored label. */
function roleCondition(type?: string | null) {
  switch (type) {
    case "customer":
      return sql`p.is_customer`;
    case "supplier":
      return sql`p.is_supplier`;
    case "employee":
      return sql`p.is_employee`;
    case "both":
      return sql`p.is_customer AND p.is_supplier`;
    default:
      return null;
  }
}

/**
 * The parties, customers and suppliers list pages, in one round trip.
 *
 * Balance comes from `party_balances`, which derives it from the AR and AP
 * control accounts. Mongo reads `cachedBalance`, whose own field comment says
 * "Cached - NOT source of truth!" — and a cached balance is wrong for some row
 * at any moment unless something reconciles it, which is §8.4 exactly. The
 * shape keeps the name so the components do not change; the number is now
 * derived rather than remembered.
 *
 * Predicates are composed and the parameter is cast, not the column — same
 * reasoning as searchInvoices, and `count(*) OVER()` returns the page and its
 * total together.
 */
export async function searchParties(
  tx: Tx,
  opts: {
    query?: string;
    type?: string | null;
    page?: number;
    perPage?: number;
    activeOnly?: boolean;
  } = {},
) {
  const perPage = Math.min(opts.perPage ?? 10, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const offset = (page - 1) * perPage;
  const q = (opts.query ?? "").trim();

  const where = [];
  const role = roleCondition(opts.type);
  if (role) where.push(role);
  if (opts.activeOnly) where.push(sql`p.is_active`);
  if (q) {
    where.push(sql`(
      p.name ILIKE ${likeContains(q)}
      OR p.display_name ILIKE ${likeContains(q)}
      OR p.email ILIKE ${likePrefix(q)}
      OR p.tax_pin ILIKE ${likePrefix(q)}
    )`);
  }
  const clause = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

  const rows = (await tx.execute(sql`
    SELECT p.id, p.name, p.display_name, p.email, p.phone, p.tax_pin,
           p.is_customer, p.is_supplier, p.is_employee, p.is_active,
           p.primary_type::text AS primary_type,
           p.credit_limit::text  AS credit_limit,
           p.payment_terms_days,
           p.employee_number, p.department, p.designation,
           COALESCE(b.balance, 0)::text AS balance,
           CASE
             WHEN p.is_customer AND p.is_supplier THEN 'both'
             WHEN p.is_supplier THEN 'supplier'
             WHEN p.is_employee THEN 'employee'
             WHEN p.is_customer THEN 'customer'
             ELSE p.primary_type::text
           END AS type,
           count(*) OVER() AS total_count
      FROM parties p
      LEFT JOIN party_balances b ON b.party_id = p.id
      ${clause}
     ORDER BY p.name
     LIMIT ${perPage} OFFSET ${offset}
  `)) as unknown as Array<Record<string, string | boolean | number>>;

  const total = rows.length ? Number(rows[0].total_count) : 0;

  return {
    parties: rows.map((r) => ({
      _id: r.id,
      id: r.id,
      name: r.name,
      displayName: r.display_name,
      type: r.type,
      email: r.email,
      phone: r.phone,
      taxPin: r.tax_pin,
      isCustomer: r.is_customer,
      isSupplier: r.is_supplier,
      isEmployee: r.is_employee,
      isActive: r.is_active,
      employeeNumber: r.employee_number,
      department: r.department,
      designation: r.designation,
      // Named as the components read it, derived rather than cached.
      cachedBalance: r.balance,
      balance: r.balance,
      creditTerms: {
        creditLimit: r.credit_limit,
        paymentTermsDays: r.payment_terms_days,
      },
    })),
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    page,
  };
}

/**
 * The six figures the stats cards read.
 *
 * AR and AP are summed from the SAME derived balances the list shows, so the
 * headline and the rows cannot disagree — which two independent aggregations
 * over a cached column could, and did.
 */
export async function getPartyStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT count(*) FILTER (WHERE p.is_customer AND p.is_active)::int AS customers,
           count(*) FILTER (WHERE p.is_supplier AND p.is_active)::int AS suppliers,
           count(*) FILTER (WHERE p.is_employee AND p.is_active)::int AS employees,
           COALESCE(SUM(b.balance) FILTER (WHERE b.balance > 0), 0)::text  AS total_ar,
           COALESCE(ABS(SUM(b.balance) FILTER (WHERE b.balance < 0)), 0)::text AS total_ap,
           count(*) FILTER (WHERE b.balance <> 0)::int AS with_balance
      FROM parties p
      LEFT JOIN party_balances b ON b.party_id = p.id
  `)) as unknown as Array<Record<string, string | number>>;

  return {
    totalCustomers: Number(row.customers),
    totalSuppliers: Number(row.suppliers),
    totalEmployees: Number(row.employees),
    totalAR: row.total_ar,
    totalAP: row.total_ap,
    partiesWithBalance: Number(row.with_balance),
  };
}

/** One party, with its derived balance and role label. */
export async function getPartyDetail(tx: Tx, partyId: string) {
  const [row] = (await tx.execute(sql`
    SELECT p.*,
           COALESCE(b.balance, 0)::text AS balance,
           CASE
             WHEN p.is_customer AND p.is_supplier THEN 'both'
             WHEN p.is_supplier THEN 'supplier'
             WHEN p.is_employee THEN 'employee'
             WHEN p.is_customer THEN 'customer'
             ELSE p.primary_type::text
           END AS type
      FROM parties p
      LEFT JOIN party_balances b ON b.party_id = p.id
     WHERE p.id = ${partyId}
  `)) as unknown as Array<Record<string, unknown>>;

  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    type: row.type,
    email: row.email,
    phone: row.phone,
    taxPin: row.tax_pin,
    isCustomer: row.is_customer,
    isSupplier: row.is_supplier,
    isEmployee: row.is_employee,
    isActive: row.is_active,
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      city: row.city,
      postalCode: row.postal_code,
      country: row.country,
    },
    employeeNumber: row.employee_number,
    department: row.department,
    designation: row.designation,
    isContractor: row.is_contractor,
    whtApplicable: row.wht_applicable,
    whtRate: String(row.wht_rate ?? "0"),
    defaultCurrency: row.default_currency,
    creditTerms: {
      creditLimit: String(row.credit_limit ?? "0"),
      paymentTermsDays: row.payment_terms_days,
    },
    paymentDetails: {
      bankName: row.bank_name,
      accountNumber: row.bank_account_number,
      branch: row.bank_branch,
      swiftCode: row.bank_swift_code,
    },
    notes: row.notes,
    // The linked user, still a Mongo id — users are not ported (§10).
    userId: row.user_id,
    cachedBalance: row.balance,
    balance: row.balance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UpdatePartyInput {
  name?: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  taxPin?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  isCustomer?: boolean;
  isSupplier?: boolean;
  isEmployee?: boolean;
  primaryType?: "customer" | "supplier" | "employee" | "other";
  creditLimit?: string;
  paymentTermsDays?: number;
  employeeNumber?: string | null;
  department?: string | null;
  designation?: string | null;
  notes?: string | null;
  whtApplicable?: boolean;
  whtRate?: string;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankBranch?: string | null;
  bankSwiftCode?: string | null;
  lastModifiedById?: string | null;
}

export async function updateParty(
  tx: Tx,
  partyId: string,
  input: UpdatePartyInput,
) {
  const [existing] = await tx.select().from(parties).where(eq(parties.id, partyId));
  if (!existing) throw new Error("Party not found");

  const isCustomer = input.isCustomer ?? existing.isCustomer;
  const isSupplier = input.isSupplier ?? existing.isSupplier;
  const isEmployee = input.isEmployee ?? existing.isEmployee;

  // A party has to be SOMETHING. Postgres has a CHECK that the primary type is
  // a role actually held, and clearing every role would trip it with a message
  // about a constraint rather than about the form.
  if (!isCustomer && !isSupplier && !isEmployee) {
    throw new Error("A party must be a customer, a supplier or an employee");
  }

  // Keep the primary type on a role the party still holds — dropping the
  // supplier role from a supplier-primary party would otherwise fail the CHECK.
  let primaryType = input.primaryType ?? existing.primaryType;
  const holds = { customer: isCustomer, supplier: isSupplier, employee: isEmployee };
  if (primaryType !== "other" && !holds[primaryType as keyof typeof holds]) {
    primaryType = isCustomer ? "customer" : isSupplier ? "supplier" : "employee";
  }

  const [updated] = await tx
    .update(parties)
    .set({
      name: input.name ?? existing.name,
      displayName: input.displayName ?? existing.displayName,
      email: input.email ?? existing.email,
      phone: input.phone ?? existing.phone,
      taxPin: input.taxPin ?? existing.taxPin,
      addressLine1: input.addressLine1 ?? existing.addressLine1,
      addressLine2: input.addressLine2 ?? existing.addressLine2,
      city: input.city ?? existing.city,
      postalCode: input.postalCode ?? existing.postalCode,
      country: input.country ?? existing.country,
      isCustomer,
      isSupplier,
      isEmployee,
      primaryType,
      creditLimit: input.creditLimit ?? existing.creditLimit,
      paymentTermsDays: input.paymentTermsDays ?? existing.paymentTermsDays,
      employeeNumber: input.employeeNumber || existing.employeeNumber,
      department: input.department ?? existing.department,
      designation: input.designation ?? existing.designation,
      notes: input.notes ?? existing.notes,
      whtApplicable: input.whtApplicable ?? existing.whtApplicable,
      whtRate: input.whtRate ?? existing.whtRate,
      bankName: input.bankName ?? existing.bankName,
      bankAccountNumber: input.bankAccountNumber ?? existing.bankAccountNumber,
      bankBranch: input.bankBranch ?? existing.bankBranch,
      bankSwiftCode: input.bankSwiftCode ?? existing.bankSwiftCode,
      lastModifiedById: input.lastModifiedById ?? existing.lastModifiedById,
      updatedAt: new Date(),
    })
    .where(eq(parties.id, partyId))
    .returning();

  return updated;
}

export async function setPartyActive(tx: Tx, partyId: string, isActive: boolean) {
  const [updated] = await tx
    .update(parties)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(parties.id, partyId))
    .returning();

  if (!updated) throw new Error("Party not found");
  return updated;
}

/** Every table that holds a reference to a party, and what it is called. */
const REFERENCING = [
  ["invoices", "customer_id", "invoice"],
  ["bills", "supplier_id", "bill"],
  ["credit_notes", "customer_id", "credit note"],
  ["payments", "party_id", "payment"],
  ["journal_entries", "party_id", "journal entry"],
  ["stock_movements", "issued_to_id", "stock movement"],
  ["stock_requests", "customer_id", "stock request"],
  ["tax_transactions", "party_id", "tax transaction"],
] as const;

/**
 * Deletes a party, or deactivates it if anything refers to it.
 *
 * Mongo counts journal entries and, for employees, HR records. That misses
 * every other reference: a party named on an invoice but with no journal entry
 * yet — a draft — is hard-deleted there, leaving the invoice pointing at
 * nothing. Here the FKs would refuse it anyway, so the check counts EVERY
 * referencing table and the message says which.
 *
 * HR is not in this count because it is not in Postgres (§10). The Mongo
 * action still runs its own HR checks, so an employee with leave or payroll
 * records is deactivated by that half before this one is reached.
 */
export async function deletePartyOrDeactivate(tx: Tx, partyId: string) {
  const [party] = await tx.select().from(parties).where(eq(parties.id, partyId));
  if (!party) throw new Error("Party not found");

  const counts: Array<{ label: string; n: number }> = [];
  for (const [table, column, label] of REFERENCING) {
    const [row] = (await tx.execute(sql`
      SELECT count(*)::int AS n
        FROM ${sql.identifier(table)}
       WHERE ${sql.identifier(column)} = ${partyId}
    `)) as unknown as Array<{ n: number }>;
    if (row.n) counts.push({ label, n: row.n });
  }

  if (counts.length) {
    await tx
      .update(parties)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(parties.id, partyId));

    const detail = counts
      .map((c) => `${c.n} ${c.label}${c.n === 1 ? "" : "s"}`)
      .join(", ");
    return {
      deleted: false as const,
      name: party.name,
      message: `${party.name} deactivated — ${detail} reference it`,
    };
  }

  await tx.delete(parties).where(eq(parties.id, partyId));
  return {
    deleted: true as const,
    name: party.name,
    message: `${party.name} deleted`,
  };
}
