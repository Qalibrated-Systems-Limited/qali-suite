"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { PARTY_MANAGE_ROLES } from "@/lib/utils/role-gates";
import * as partiesRepo from "../repositories/parties";
import {
  linkUserToPartyDirect,
  unlinkUserFromPartyDirect,
} from "../userAdmin";

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
    message.includes("No company selected") ||
    message.includes("No company has been set up") ||
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
/**
 * `_id` ALONGSIDE `id`, the same as `getEmployees` and `searchParties`.
 *
 * `listParties` returns raw rows, which carry `id` only — and these two did not
 * add the alias while their employee twin did. Every picker in this codebase
 * keys on `_id` (the Mongo shape the screens were written against), so a
 * supplier reached a `<option value={p._id}>` as `value={undefined}`. A React
 * option with no value submits its TEXT, so the project Team card posted the
 * supplier's NAME where a uuid was expected and `assignPartyToProject` answered
 * "Party not found" — which is to say a subcontractor could not be put on a
 * project roster at all, and the error blamed the data.
 *
 * `PaymentForm` reads `.id` and is unaffected; this only adds a field.
 */
export async function getCustomers(activeOnly = true) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await partiesRepo.listParties(tx, {
      role: "customer",
      activeOnly,
      limit: 200,
    });
    return rows.map((r) => ({ ...r, _id: r.id }));
  });
}

export async function getSuppliers(activeOnly = true) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await partiesRepo.listParties(tx, {
      role: "supplier",
      activeOnly,
      limit: 200,
    });
    return rows.map((r) => ({ ...r, _id: r.id }));
  });
}

export async function getEmployees(activeOnly = true) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await partiesRepo.listParties(tx, {
      role: "employee",
      activeOnly,
      limit: 200,
    });
    return rows.map((r) => ({ ...r, _id: r.id }));
  });
}

/**
 * The name-and-id picker feed — 0070.
 *
 * The Mongo twin reads the `parties` collection, which nothing has written to
 * since parties ported, so every client and PM dropdown built on it has been
 * empty. `_id` rides alongside `id` because the pickers key on it.
 */
export async function searchParties(
  searchTerm = "",
  type: "customer" | "supplier" | "employee" | null = null,
  limit = 50,
) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await partiesRepo.listParties(tx, {
      role: type ?? undefined,
      search: searchTerm || undefined,
      activeOnly: true,
      limit,
    });
    return rows.map((r) => ({ ...r, _id: r.id }));
  });
}

// ── Linking a login to an employee party ────────────────────────────────────

/**
 * Which login is attached to this employee party, if any.
 *
 * THE LINK IS THE GRANT, not `parties.user_id`. That column is `uuid` and
 * `users.id` is `text` — 0036 made it text deliberately ("every actor column
 * and user_company_access.user_id already" hold it that way) — so
 * `parties.user_id` CANNOT hold a user id, and nothing in the Postgres layer
 * has ever written it. It is a leftover of the Mongo shape.
 *
 * `user_company_access.party_id` is the real seam, and the one sign-in and the
 * invite flow already use (`linkUserToPartyDirect`, 0036). Its composite
 * foreign key on (party_id, company_id) is what stops a grant pointing at
 * another company's party.
 */
export async function getPartyLinkedUser(partyId: string) {
  try {
    return await withAuthorizedTenant([], async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT u.id, u.name, u.email
          FROM user_company_access a
          JOIN users u ON u.id = a.user_id
         WHERE a.party_id = ${partyId}::uuid
         LIMIT 1
      `)) as unknown as Array<Record<string, unknown>>;
      if (!rows[0]) return null;
      return {
        _id: String(rows[0].id),
        id: String(rows[0].id),
        name: String(rows[0].name ?? ""),
        email: String(rows[0].email ?? ""),
      };
    });
  } catch {
    return null;
  }
}

/**
 * Attach a login to an employee party.
 *
 * The Mongo original set `party.userId` on a MONGO party while every party
 * screen reads Postgres — so the link appeared to save and the page it
 * returned to showed the party still unlinked.
 *
 * The three refusals it made are kept, because each is a real confusion to
 * prevent: the party must exist and be an employee, the login must exist in
 * this company, and neither may already be spoken for.
 */
export async function linkUserToParty(
  _prevState: unknown,
  formData: FormData,
): Promise<{ success: boolean; message?: string; errors?: Record<string, string[]> }> {
  const partyId = String(formData.get("partyId") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();

  const errors: Record<string, string[]> = {};
  if (!partyId) errors.partyId = ["Party ID is required"];
  if (!userId) errors.userId = ["User ID is required"];
  if (Object.keys(errors).length) return { success: false, errors };

  try {
    return await withAuthorizedTenant(
      [...PARTY_MANAGE_ROLES],
      async (tx, { companyId }) => {
        const [party] = (await tx.execute(sql`
          SELECT id, name, primary_type, is_employee
            FROM parties WHERE id = ${partyId}::uuid
        `)) as unknown as Array<Record<string, unknown>>;
        if (!party) {
          return { success: false, errors: { _form: ["Party not found"] } };
        }
        if (party.primary_type !== "employee" && party.is_employee !== true) {
          return {
            success: false,
            errors: { _form: ["Party must be of type 'employee'"] },
          };
        }

        /*
         * The login has to hold a grant IN THIS COMPANY. A user row alone is
         * not enough — `users` has no company column, and membership is the
         * grant (0036). Without this check the update below would match no
         * rows and report success.
         */
        const [grant] = (await tx.execute(sql`
          SELECT a.id, a.party_id::text AS party_id, u.name
            FROM user_company_access a
            JOIN users u ON u.id = a.user_id
           WHERE a.user_id = ${userId}
             AND a.company_id = ${companyId}::uuid
        `)) as unknown as Array<Record<string, unknown>>;
        if (!grant) {
          return { success: false, errors: { _form: ["User not found"] } };
        }

        const [takenByOther] = (await tx.execute(sql`
          SELECT u.name
            FROM user_company_access a
            JOIN users u ON u.id = a.user_id
           WHERE a.party_id = ${partyId}::uuid
             AND a.user_id <> ${userId}
           LIMIT 1
        `)) as unknown as Array<Record<string, unknown>>;
        if (takenByOther) {
          return {
            success: false,
            errors: {
              _form: [
                `This employee is already linked to ${takenByOther.name}.`,
              ],
            },
          };
        }

        if (grant.party_id && String(grant.party_id) !== partyId) {
          const [other] = (await tx.execute(sql`
            SELECT name FROM parties WHERE id = ${String(grant.party_id)}::uuid
          `)) as unknown as Array<Record<string, unknown>>;
          return {
            success: false,
            errors: {
              _form: [
                `User is already linked to employee party: ${other?.name ?? "another party"}`,
              ],
            },
          };
        }

        /*
         * THE WRITE IS PRIVILEGED, AND HAS TO BE. `user_company_access` lets a
         * person write their OWN grant (0033's `own_grants`) and only READ a
         * colleague's (0037's `visible_within_company`, which is FOR SELECT).
         * An administrator linking somebody else is precisely the case those
         * policies decline — so on the tenant connection the UPDATE matches
         * zero rows and reports success. A test caught exactly that.
         *
         * Every check above ran inside the tenant scope, under RLS, so what is
         * handed to the privileged write has already been proved to belong to
         * this company. `linkUserToPartyDirect` also sets `employees.user_id`,
         * which the Mongo original never did: without it the person signs in
         * and is told they have no employee record — no leave, no payslips,
         * nowhere to clock in.
         */
        await linkUserToPartyDirect({ userId, companyId, partyId });

        revalidatePath("/dashboard/parties");
        revalidatePath(`/dashboard/parties/${partyId}`);
        return {
          success: true,
          message: `User ${grant.name} successfully linked to ${party.name}`,
        };
      },
    );
  } catch (error) {
    return {
      success: false,
      errors: { _form: [userMessage(error, "Failed to link user to party")] },
    };
  }
}

/** Detach whichever login is on this party, and its employment record with it. */
export async function unlinkUserFromParty(
  partyId: string,
): Promise<{ success: boolean; message?: string; errors?: Record<string, string[]> }> {
  if (!partyId) {
    return { success: false, errors: { _form: ["Party not found"] } };
  }
  try {
    return await withAuthorizedTenant(
      [...PARTY_MANAGE_ROLES],
      async (tx, { companyId }) => {
        /*
         * Confirm INSIDE the tenant scope that this party is ours and that
         * something is actually linked — RLS is what makes that a real check —
         * and only then let the privileged write clear it. Same reasoning as
         * the link above: an administrator clearing a colleague's grant is a
         * write `own_grants` and `visible_within_company` decline.
         */
        const [linked] = (await tx.execute(sql`
          SELECT a.user_id
            FROM user_company_access a
            JOIN parties p ON p.id = a.party_id
           WHERE a.party_id = ${partyId}::uuid
           LIMIT 1
        `)) as unknown as Array<Record<string, unknown>>;

        if (!linked) {
          return {
            success: false,
            errors: { _form: ["No user linked to this party"] },
          };
        }

        await unlinkUserFromPartyDirect({ companyId, partyId });

        revalidatePath("/dashboard/parties");
        revalidatePath(`/dashboard/parties/${partyId}`);
        return { success: true, message: "User unlinked successfully" };
      },
    );
  } catch (error) {
    return {
      success: false,
      errors: { _form: [userMessage(error, "Failed to unlink user")] },
    };
  }
}
