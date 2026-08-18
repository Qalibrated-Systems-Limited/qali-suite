"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedTenant } from "../tenant";
import { PARTY_MANAGE_ROLES } from "@/lib/utils/role-gates";
import * as partiesRepo from "../repositories/parties";

/**
 * Postgres-backed party actions — customers, suppliers and employees.
 *
 * THE ROLE MODEL IS THE ONE REAL DIFFERENCE. Mongo carries a four-valued
 * `type` (customer / supplier / both / employee); Postgres carries three
 * independent booleans plus a primary type (§5), because the roles ARE
 * independent and "both" is what an enum has to invent to say so. The forms
 * and lists still speak `type`, so it is translated at this boundary and
 * DERIVED on the way back — the two can never disagree, which a stored copy
 * of a function of three booleans eventually would.
 *
 * Money is strings end to end. Never Number() these values.
 */

export type ActionResult =
  | { success: true; partyId?: string; message?: string }
  | { success: false; error?: string; errors?: Record<string, string[]>; values?: unknown };

function toActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("permission") ||
    message.includes("Not authenticated") ||
    message.includes("not active") ||
    message.includes("Party not found") ||
    message.includes("must be a customer") ||
    message.includes("has not been migrated") ||
    // The one uniqueness rule on this table: an employee number is unique per
    // tenant where present. Tax PIN is only indexed, not unique — Mongo does
    // not enforce it either, and duplicates are real (a branch sharing a PIN).
    message.includes("parties_company_employee_number_uq")
  ) {
    return message;
  }
  console.error("Party action failed:", err);
  return "Something went wrong. Please try again.";
}

/** The form's four-valued type, mapped onto the three roles it means. */
function rolesFor(type: string) {
  return {
    isCustomer: type === "customer" || type === "both",
    isSupplier: type === "supplier" || type === "both",
    isEmployee: type === "employee",
    // "both" is not a primary type — it is the two flags. Customer is the
    // primary side by convention, matching how the Mongo list sorts them.
    primaryType: (type === "employee"
      ? "employee"
      : type === "supplier"
        ? "supplier"
        : "customer") as "customer" | "supplier" | "employee",
  };
}

const partySchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["customer", "supplier", "both", "employee"], {
    message: "Select a party type",
  }),
  displayName: z.string().optional(),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  taxPin: z.string().optional(),
  employeeNumber: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  isContractor: z.string().optional(),
  whtApplicable: z.string().optional(),
  whtRate: z.coerce.number().min(0).max(100).default(0),
  creditLimit: z.coerce.number().min(0).default(0),
  paymentTermsDays: z.coerce.number().int().min(0).default(30),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  notes: z.string().optional(),
});

const money = (n: number) => n.toFixed(4);
const blank = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

function readForm(formData: FormData) {
  const get = (k: string) => formData.get(k) ?? undefined;
  return {
    name: get("name"),
    type: get("type"),
    displayName: get("displayName"),
    email: get("email"),
    phone: get("phone"),
    taxPin: get("taxPin"),
    employeeNumber: get("employeeNumber"),
    department: get("department"),
    designation: get("designation"),
    isContractor: get("isContractor"),
    whtApplicable: get("whtApplicable"),
    whtRate: get("whtRate") ?? 0,
    creditLimit: get("creditLimit") ?? 0,
    paymentTermsDays: get("paymentTermsDays") ?? 30,
    bankName: get("bankName"),
    accountNumber: get("accountNumber"),
    notes: get("notes"),
  };
}

export async function createParty(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const raw = readForm(formData);
  const parsed = partySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      values: raw,
    };
  }
  const d = parsed.data;

  try {
    const party = await withAuthorizedTenant(
      [...PARTY_MANAGE_ROLES],
      async (tx, { user, companyId }) =>
        partiesRepo.createParty(tx, {
          companyId,
          name: d.name,
          ...rolesFor(d.type),
          displayName: blank(d.displayName),
          email: blank(d.email)?.toLowerCase() ?? null,
          phone: blank(d.phone),
          taxPin: blank(d.taxPin),
          creditLimit: money(d.creditLimit),
          paymentTermsDays: d.paymentTermsDays,
          employeeNumber: blank(d.employeeNumber),
          notes: blank(d.notes),
          createdById: user.id,
        }),
    );

    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    return {
      success: true,
      partyId: party.id,
      message: `${d.type.charAt(0).toUpperCase() + d.type.slice(1)} created successfully`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err), values: raw };
  }
}

export async function updateParty(
  partyId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const raw = readForm(formData);
  const parsed = partySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      values: raw,
    };
  }
  const d = parsed.data;

  try {
    await withAuthorizedTenant(
      [...PARTY_MANAGE_ROLES],
      async (tx, { user }) =>
        partiesRepo.updateParty(tx, partyId, {
          name: d.name,
          ...rolesFor(d.type),
          displayName: blank(d.displayName),
          email: blank(d.email)?.toLowerCase() ?? null,
          phone: blank(d.phone),
          taxPin: blank(d.taxPin),
          creditLimit: money(d.creditLimit),
          paymentTermsDays: d.paymentTermsDays,
          employeeNumber: blank(d.employeeNumber),
          department: blank(d.department),
          designation: blank(d.designation),
          whtApplicable: d.whtApplicable === "true" || d.whtApplicable === "on",
          whtRate: money(d.whtRate),
          bankName: blank(d.bankName),
          bankAccountNumber: blank(d.accountNumber),
          notes: blank(d.notes),
          lastModifiedById: user.id,
        }),
    );

    revalidatePath("/dashboard/parties");
    revalidatePath(`/dashboard/parties/${partyId}`);
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    return { success: true, partyId, message: "Party updated successfully" };
  } catch (err) {
    return { success: false, error: toActionError(err), values: raw };
  }
}

/**
 * Creates a customer or supplier inline from a form's picker.
 *
 * Shared with the invoice and bill forms — this is the one that used to write
 * to Mongo while the document was written to Postgres, so a party created here
 * could not then be invoiced.
 */
export async function quickCreateParty(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "customer");

  if (!name) return { success: false as const, error: "Name is required" };
  if (!["customer", "supplier", "both"].includes(type)) {
    return { success: false as const, error: "Invalid party type" };
  }

  try {
    const party = await withAuthorizedTenant(
      [...PARTY_MANAGE_ROLES],
      async (tx, { user, companyId }) =>
        partiesRepo.createParty(tx, {
          companyId,
          name,
          ...rolesFor(type),
          email: blank(formData.get("email"))?.toLowerCase() ?? null,
          phone: blank(formData.get("phone")),
          createdById: user.id,
        }),
    );

    revalidatePath("/dashboard/parties");
    return {
      success: true as const,
      party: {
        _id: party.id,
        name: party.displayName || party.name,
        email: party.email ?? "",
        phone: party.phone ?? "",
        taxPin: party.taxPin ?? "",
        address: "",
      },
    };
  } catch (err) {
    return { success: false as const, error: toActionError(err) };
  }
}

/**
 * Deletes a party, or deactivates it if anything refers to it.
 *
 * The decision is the repository's, because it is a question about references
 * rather than about permission — and it counts every table that holds one,
 * not just journal entries.
 */
export async function deleteParty(partyId: string): Promise<ActionResult> {
  try {
    const result = await withAuthorizedTenant([...PARTY_MANAGE_ROLES], (tx) =>
      partiesRepo.deletePartyOrDeactivate(tx, partyId),
    );

    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    return { success: true, message: result.message };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function togglePartyStatus(
  partyId: string,
  isActive: boolean,
): Promise<ActionResult> {
  try {
    const party = await withAuthorizedTenant([...PARTY_MANAGE_ROLES], (tx) =>
      partiesRepo.setPartyActive(tx, partyId, isActive),
    );

    revalidatePath("/dashboard/parties");
    revalidatePath(`/dashboard/parties/${partyId}`);
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    return {
      success: true,
      partyId,
      message: `${party.name} ${isActive ? "activated" : "deactivated"}`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Adds or removes a role.
 *
 * Mongo calls this "convert", which is what a four-valued enum makes it look
 * like: customer becomes both becomes supplier. With independent booleans it
 * is what it always was — granting a role, and keeping the primary type on one
 * the party still holds.
 */
export async function convertPartyType(
  partyId: string,
  newType: string,
): Promise<ActionResult> {
  if (!["customer", "supplier", "both", "employee"].includes(newType)) {
    return { success: false, error: "Invalid party type" };
  }

  try {
    await withAuthorizedTenant([...PARTY_MANAGE_ROLES], (tx, { user }) =>
      partiesRepo.updateParty(tx, partyId, {
        ...rolesFor(newType),
        lastModifiedById: user.id,
      }),
    );

    revalidatePath("/dashboard/parties");
    revalidatePath(`/dashboard/parties/${partyId}`);
    return { success: true, partyId, message: `Party is now ${newType}` };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The parties, customers and suppliers lists — one query, three pages.
 *
 * No companyId is passed anywhere: RLS supplies it, and omitting it returns
 * nothing rather than another tenant's customer list (§2.2).
 */
export async function getPartiesPaginated(
  query = "",
  page = 1,
  type: string | null = null,
  perPage = 10,
) {
  return withAuthorizedTenant([], (tx) =>
    partiesRepo.searchParties(tx, { query, page, type, perPage }),
  );
}

export async function getPartyStats() {
  return withAuthorizedTenant([], (tx) => partiesRepo.getPartyStats(tx));
}

export async function getPartyById(partyId: string) {
  return withAuthorizedTenant([], (tx) =>
    partiesRepo.getPartyDetail(tx, partyId),
  );
}

/** Type-filtered lists for pickers that want everything, not a page. */
export async function getCustomers(activeOnly = true) {
  return withAuthorizedTenant([], (tx) =>
    partiesRepo.listParties(tx, { role: "customer", activeOnly, limit: 200 }),
  );
}

export async function getSuppliers(activeOnly = true) {
  return withAuthorizedTenant([], (tx) =>
    partiesRepo.listParties(tx, { role: "supplier", activeOnly, limit: 200 }),
  );
}
