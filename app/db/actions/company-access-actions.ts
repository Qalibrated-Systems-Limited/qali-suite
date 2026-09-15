"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  listCompanyMembers,
  grantCompanyAccess,
  revokeCompanyAccess,
} from "../companyAccessAdmin";

/**
 * The SuperAdmin's surface onto "who may operate in this company".
 *
 * A SUPERADMIN IS NOT AN EXEMPTION FROM TENANCY, IT IS A CHOICE OF TENANT
 * (see tenant.ts). That is what these actions are for: a SuperAdmin does not
 * read across companies, they hold a grant for each one and enter them one at
 * a time. Handing somebody else that grant is the platform-level act, and it
 * is the only cross-tenant thing here.
 *
 * Every one of these refuses anyone but a SuperAdmin. The admin pages check
 * too, but a page check is a check on what is DRAWN; a server action is
 * callable directly and has to defend itself.
 */
async function requireSuperAdmin() {
  const session = await auth();
  const user = session?.user as
    | { id?: string; name?: string; role?: string }
    | undefined;
  if (!user?.id) throw new Error("Not authenticated");
  if (user.role !== "SuperAdmin") {
    throw new Error("Only a SuperAdmin can change who may enter a company.");
  }
  return user;
}

export interface CompanyMemberRow {
  userId: string;
  name: string | null;
  email: string | null;
  globalRole: string | null;
  /** Role for THIS company; null means the global role applies. */
  role: string | null;
  status: string;
  grantedVia: string;
  grantedByName: string | null;
  createdAt: string;
}

/**
 * Who holds a grant for this company, with the names to show for them.
 *
 * The grants carry a user id and nothing else, so the person behind the id is
 * looked up separately — one query for the whole page, not one per row.
 *
 * POSTGRES since 0102. This read MONGO under a comment saying "there is no
 * users table in Postgres yet (0031)"; 0036 added one and `upsertUser` has
 * filled it from every sign-in since, so the grants came from Postgres and the
 * names beside them came from a different store.
 */
export async function getCompanyMembers(
  sourceCompanyId: string,
): Promise<CompanyMemberRow[]> {
  await requireSuperAdmin();

  const grants = await listCompanyMembers(String(sourceCompanyId));
  if (!grants.length) return [];

  const { getUsersByIds } = await import("../userAdmin");

  // No ObjectId-shape filter any more: ids are `text` in Postgres, so an id
  // from a source that is not a user matches nothing instead of throwing on a
  // cast.
  const users = await getUsersByIds(grants.map((g) => g.userId));
  const byId = new Map(users.map((u) => [u.id, u]));

  return grants.map((g) => {
    const u = byId.get(g.userId);
    return {
      userId: g.userId,
      name: u?.name ?? null,
      email: u?.email ?? null,
      globalRole: u?.role ?? null,
      role: g.role,
      status: g.status,
      grantedVia: g.grantedVia,
      grantedByName: g.grantedByName,
      createdAt: g.createdAt.toISOString(),
    };
  });
}

/**
 * The users a SuperAdmin can pick from when adding somebody.
 *
 * Anyone active, not only this company's own users: moving a person between
 * companies, or giving an accountant access to two, is the case the grants
 * table exists for. Capped, and searched server-side, because the user list
 * grows without bound and a dropdown that loads all of it is a page that stops
 * loading.
 */
export async function searchGrantableUsers(term: string) {
  await requireSuperAdmin();

  const { searchGrantableUsers: search } = await import("../userAdmin");
  return search(term);
}

export async function grantCompanyAccessAction(input: {
  sourceCompanyId: string;
  userId: string;
  role?: string | null;
}) {
  const admin = await requireSuperAdmin();

  const result = await grantCompanyAccess({
    sourceCompanyId: String(input.sourceCompanyId),
    userId: String(input.userId),
    role: input.role ?? null,
    grantedById: admin.id ?? null,
    grantedByName: admin.name ?? null,
  });

  if (!result.granted) {
    return {
      ok: false as const,
      error:
        result.reason === "not-provisioned"
          ? "This company has not been set up in the ledger yet. Open it once, then try again."
          : "No user chosen.",
    };
  }

  revalidatePath(`/dashboard/admin/companies/${input.sourceCompanyId}`);
  return { ok: true as const };
}

export async function revokeCompanyAccessAction(input: {
  sourceCompanyId: string;
  userId: string;
}) {
  await requireSuperAdmin();

  const result = await revokeCompanyAccess(
    String(input.sourceCompanyId),
    String(input.userId),
  );
  if (!result.revoked) {
    return { ok: false as const, error: "This company has no ledger tenant." };
  }

  // Takes effect on their NEXT request: the gate re-reads the grants every
  // time rather than trusting the session, so there is no token to wait out.
  revalidatePath(`/dashboard/admin/companies/${input.sourceCompanyId}`);
  return { ok: true as const };
}
