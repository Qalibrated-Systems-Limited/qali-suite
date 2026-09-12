"use server";

import { revalidatePath } from "next/cache";
import { unstable_update } from "@/auth";
import { listGrantedCompanies } from "../tenant";
import { getTenantContext } from "@/lib/utils/tenant-utils";

/**
 * The companies the signed-in user may switch into.
 *
 * Deliberately does NOT go through withAuthorizedTenant: that resolves an
 * active company, and this is the question you ask when you do not have one.
 * It is scoped to the user, so it answers before a tenant is chosen without
 * seeing any tenant's data — the only table visible under that scope is the
 * grants themselves, plus the names they point at (0034).
 *
 * THROUGH `listGrantedCompanies`, NOT `listAllowedCompanies`. This read used
 * to be the only path that could not seed, so on a user's first request after
 * signing in it answered "no companies" while the very next tenant read seeded
 * three and then refused to choose between them. The layout, believing there
 * was nothing to choose, rendered the page instead of the chooser — and the
 * page failed. A reload fixed it, because by then the write had happened.
 * See the note on `listGrantedCompanies`.
 */
export async function getSwitchableCompanies() {
  const { user, companyId, companyCode, activeCompanyId } =
    await getTenantContext();
  if (!user?.id) return { companies: [], activeCompanyId: null };

  const companies = await listGrantedCompanies(
    user as Parameters<typeof listGrantedCompanies>[0],
    companyId,
    companyCode,
  );

  return { companies, activeCompanyId: activeCompanyId ?? null };
}

/**
 * Moves this session onto another company.
 *
 * ON THE SERVER, NOT THROUGH useSession().update(). This app mounts no
 * <SessionProvider>, so any client hook into the session throws on render —
 * which would have taken down every page that renders SiteHeader. The session
 * is a cookie the server owns, so the server is where it is rewritten.
 *
 * Checked HERE against the grants, so the caller gets a reason rather than a
 * silent no-op. The JWT callback checks again before it writes, and the
 * Postgres gate checks again on every request that follows — three passes over
 * the same rows, because a stale one is what would let somebody read books
 * they were removed from.
 */
export async function switchCompany(companyId: string) {
  const { user } = await getTenantContext();
  if (!user?.id) return { ok: false as const, error: "Not authenticated" };

  const requested = String(companyId ?? "").trim();
  if (!requested) return { ok: false as const, error: "No company chosen." };

  const allowed = await listGrantedCompanies(
    user as Parameters<typeof listGrantedCompanies>[0],
    (user as { companyId?: unknown }).companyId,
    (user as { companyCode?: unknown }).companyCode,
  );
  const target = allowed.find((c) => c.id === requested);

  if (!target) {
    return {
      ok: false as const,
      error: "You do not have access to that company.",
    };
  }
  if (!target.isActive) {
    return {
      ok: false as const,
      error: `${target.name} is not active. Contact your administrator.`,
    };
  }

  await unstable_update({ activeCompanyId: target.id } as never);

  // Every page is scoped to the company that was active when it rendered, so
  // all of them are now stale — not just the one the switcher was clicked on.
  revalidatePath("/", "layout");
  return { ok: true as const, companyId: target.id, name: target.name };
}

/**
 * Opens a company from the platform admin list.
 *
 * The list carries the SOURCE company id, not the tenant uuid, so this
 * resolves it — and for a SuperAdmin it writes the grant first if it is not
 * there. A company provisioned before this person became platform staff has no
 * row for them, and refusing to open it would leave the only people who can
 * fix a tenant unable to enter it.
 *
 * The grant is still a ROW. They enter the company under the same policies as
 * anyone else in it; nothing here reads across tenants.
 */
export async function switchToCompanyBySourceId(sourceCompanyId: string) {
  const { auth } = await import("@/auth");
  const session = await auth();
  const user = session?.user as
    | { id?: string; name?: string; role?: string }
    | undefined;

  if (!user?.id) return { ok: false as const, error: "Not authenticated" };
  if (user.role !== "SuperAdmin") {
    return { ok: false as const, error: "Only a SuperAdmin can open another company." };
  }

  const { ensurePlatformGrant } = await import("../companyAccessAdmin");
  const companyId = await ensurePlatformGrant(String(sourceCompanyId), {
    id: String(user.id),
    name: user.name ?? null,
  });

  if (!companyId) {
    return {
      ok: false as const,
      error: "This company has not been set up in the ledger yet.",
    };
  }

  return switchCompany(companyId);
}
