#!/usr/bin/env node
// ============================================
// BACKFILL LOGINS INTO POSTGRES
// ============================================
// syncUserToPostgres only fires when Mongo WRITES a user, so every login that
// predates the port was never mirrored — the users table was empty while people
// were signed in. Anything keyed on it silently did nothing: provisionCompany's
// "grant every existing SuperAdmin the new company" granted nobody, and the
// foreign keys 0036 defers cannot land until this has run.
//
// Carries the bcrypt hash verbatim (0043). A bcrypt string carries its own
// algorithm, cost and salt, so comparing against it in Postgres is the same
// operation as in Mongo: nobody's password changes and nobody is asked to reset.
//
// Idempotent — an upsert per user, so re-running converges. Only supplied
// fields are written, so it will not blank a column Postgres already knows.
//
// Usage:
//   node --env-file=.env scripts/backfill-users-to-pg.mjs [--dry-run]
// ============================================

import mongoose from "mongoose";
import postgres from "postgres";

const DRY = process.argv.includes("--dry-run");
const MONGODB_URI = process.env.MONGODB_URI;
const PG_URL = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!MONGODB_URI || !PG_URL) {
  console.error("Both MONGODB_URI and DIRECT_DATABASE_URL must be set.");
  process.exit(1);
}

await mongoose.connect(MONGODB_URI);
const sql = postgres(PG_URL, { max: 1, onnotice: () => {} });

console.log(`\n=== Backfilling logins ${DRY ? "(DRY RUN)" : ""} ===`);

try {
  // The raw collection, not the model: the model applies the enum that 0039
  // narrowed, and a document still holding a retired role would throw on read
  // rather than be carried and mapped.
  const docs = await mongoose.connection
    .collection("users")
    .find({}, { projection: { name: 1, email: 1, role: 1, status: 1, department: 1,
      avatar: 1, authProvider: 1, companyId: 1, tokenVersion: 1, creator: 1,
      password: 1, resetPasswordToken: 1, resetPasswordExpire: 1 } })
    .toArray();

  console.log(`${docs.length} login(s) in Mongo`);

  const RETIRED = { Technician: "Employee", CEO: "Viewer", User: "Employee", HR: "HR Manager" };
  let written = 0, withPassword = 0, unmapped = 0;

  for (const d of docs) {
    const id = String(d._id);
    const role = RETIRED[d.role] ?? d.role ?? "Employee";
    const status = String(d.status ?? "").toLowerCase() === "inactive" ? "inactive" : "active";
    const email = d.email ? String(d.email).toLowerCase().trim() : `${id}@unknown.invalid`;

    // The tenant, if it has been provisioned. A login is not worth failing over
    // an unprovisioned company — the mapping is filled in when it exists.
    let homeCompanyId = null;
    if (d.companyId) {
      const [m] = await sql`SELECT new_uuid FROM _migration_id_map
                             WHERE collection = 'companies' AND old_object_id = ${String(d.companyId)}`;
      homeCompanyId = m?.new_uuid ?? null;
      if (!homeCompanyId) unmapped++;
    }

    if (d.password) withPassword++;

    if (DRY) {
      console.log(`  would write ${email} (${role}${d.password ? ", password" : ", no password"})`);
      continue;
    }

    await sql`
      INSERT INTO users (id, name, email, role, status, department, avatar,
                         auth_provider, home_company_id, token_version,
                         created_by_id, created_by_name, password_hash,
                         reset_password_token, reset_password_expire)
      VALUES (${id}, ${d.name ?? "Unknown user"}, ${email}, ${role}, ${status},
              ${d.department ?? null}, ${d.avatar ?? null},
              ${d.authProvider ?? "credentials"}, ${homeCompanyId},
              ${d.tokenVersion ?? 0}, ${d.creator?.id ?? null},
              ${d.creator?.name ?? null}, ${d.password ?? null},
              ${d.resetPasswordToken ?? null},
              ${d.resetPasswordExpire ? new Date(d.resetPasswordExpire) : null})
      ON CONFLICT (id) DO UPDATE SET
        name            = COALESCE(EXCLUDED.name, users.name),
        email           = COALESCE(EXCLUDED.email, users.email),
        role            = COALESCE(EXCLUDED.role, users.role),
        status          = COALESCE(EXCLUDED.status, users.status),
        department      = COALESCE(EXCLUDED.department, users.department),
        avatar          = COALESCE(EXCLUDED.avatar, users.avatar),
        auth_provider   = COALESCE(EXCLUDED.auth_provider, users.auth_provider),
        home_company_id = COALESCE(EXCLUDED.home_company_id, users.home_company_id),
        token_version   = COALESCE(EXCLUDED.token_version, users.token_version),
        password_hash   = COALESCE(EXCLUDED.password_hash, users.password_hash),
        updated_at      = now()`;
    written++;
  }

  // ── Pending invitations ────────────────────────────────────────────────
  // Carried so an invite emailed before the cutover still works after it. Only
  // the ones still open: an accepted invite is history, and its user already
  // exists; a cancelled one should not be resurrected by a backfill.
  const inviteDocs = await mongoose.connection
    .collection("invites")
    .find({ status: "pending" })
    .toArray();
  console.log(`${inviteDocs.length} pending invitation(s) in Mongo`);

  let invitesWritten = 0, invitesSkipped = 0;
  for (const iv of inviteDocs) {
    const [m] = await sql`SELECT new_uuid FROM _migration_id_map
                           WHERE collection = 'companies' AND old_object_id = ${String(iv.companyId)}`;
    if (!m?.new_uuid) {
      // An invite into a tenant that does not exist here cannot be honoured.
      invitesSkipped++;
      continue;
    }
    const role = RETIRED[iv.role] ?? iv.role ?? "Employee";
    if (DRY) {
      console.log(`  would write invite ${iv.email} -> ${role}`);
      continue;
    }
    await sql`
      INSERT INTO invites (company_id, email, role, token, status, expires_at,
                           invited_by_id, invited_by_name)
      VALUES (${m.new_uuid}, ${String(iv.email).toLowerCase().trim()}, ${role},
              ${iv.token}, 'pending',
              ${iv.expiresAt ? new Date(iv.expiresAt) : new Date(Date.now() + 7 * 864e5)},
              ${iv.invitedBy?.id ?? "unknown"}, ${iv.invitedBy?.name ?? "Unknown"})
      ON CONFLICT (token) DO NOTHING`;
    invitesWritten++;
  }

  if (!DRY) {
    console.log(`invites        ${invitesWritten} written${invitesSkipped ? `, ${invitesSkipped} skipped (tenant not provisioned)` : ""}`);
    // Every SuperAdmin holds every company — the standing access §9D describes,
    // as dated rows. Without users in this table, provisioning granted nobody.
    const admins = await sql`SELECT id, name FROM users WHERE role = 'SuperAdmin'`;
    const companies = await sql`SELECT id FROM companies`;
    let grants = 0;
    for (const u of admins) {
      for (const c of companies) {
        const r = await sql`
          INSERT INTO user_company_access (user_id, company_id, granted_via,
                                           granted_by_id, granted_by_name)
          VALUES (${u.id}, ${c.id}, 'superadmin', ${u.id}, ${u.name})
          ON CONFLICT DO NOTHING RETURNING id`;
        grants += r.length;
      }
    }
    console.log(`\nwritten        ${written}`);
    console.log(`with password  ${withPassword}`);
    console.log(`grants added   ${grants} (${admins.length} SuperAdmin(s) x ${companies.length} company/ies)`);
    if (unmapped) console.log(`WARNING: ${unmapped} login(s) name a company with no Postgres tenant yet.`);
  }
} catch (err) {
  console.error("Backfill failed:", err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
  await sql.end();
}
