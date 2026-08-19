/**
 * Keeps a login in step with Postgres after Mongo writes it.
 *
 * RE-READS THE DOCUMENT rather than taking the fields the caller happened to
 * change. There are eleven places that write a user — create, role change,
 * status change, department sync from HR, invite acceptance, party linking —
 * and hand-mapping fields at each one is eleven chances to drift. This reads
 * what Mongo now says and writes that.
 *
 * NEVER THROWS. Mongo is still the writer of record for logins; Postgres holds
 * the identity that 47 actor columns point at (0031, 0036). A failure to
 * mirror is a stale name on an audit trail, which is worth logging and not
 * worth failing a user's password change over.
 */
export async function syncUserToPostgres(userId) {
  const id = String(userId ?? "").trim();
  if (!id) return;

  try {
    const { default: User, RETIRED_ROLES } = await import("@/app/models/user");
    // tokenVersion is `select: false` — it has to be asked for, and the
    // session-freshness check is the thing that reads it.
    const u = await User.findById(id).select("+tokenVersion").lean();
    if (!u) return;

    const { syncUser, linkUserToParty } = await import("@/app/db/userAdmin");

    await syncUser({
      id,
      name: u.name,
      email: u.email,
      // A document written before scripts/migrate-retired-roles.mjs ran still
      // holds a value 0039 dropped from the CHECK. Mapping it here beats the
      // alternative: this function never throws, so the insert would fail and
      // leave the row stale behind a logged error nobody reads.
      role: u.role ? (RETIRED_ROLES[u.role] ?? u.role) : null,
      status: u.status,
      department: u.department ?? null,
      avatar: u.avatar ?? null,
      authProvider: u.authProvider ?? null,
      companyId: u.companyId ? String(u.companyId) : null,
      tokenVersion: u.tokenVersion ?? 0,
      createdById: u.creator?.id ?? null,
      createdByName: u.creator?.name ?? null,
    });

    // "In THIS company, this login is that person." Only when both sides are
    // known: a user with no company has no grant to hang the link on.
    if (u.companyId) {
      await linkUserToParty({
        userId: id,
        sourceCompanyId: String(u.companyId),
        sourcePartyId: u.partyId ? String(u.partyId) : null,
      });
    }
  } catch (err) {
    console.error(`Could not mirror user ${id} to Postgres:`, err);
  }
}
