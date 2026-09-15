#!/usr/bin/env node
// ============================================================================
// CREATE THE FIRST SUPERADMIN — bootstrap for a fresh deployment
//
// WHY THIS HAS TO EXIST. There is no public signup route, by design. A Google
// sign-in for an address with no user record and no open invitation is refused
// outright (auth.ts: `if (!invite) return false`), and an invitation can only
// be raised from inside the app by someone already in it.
//
// So on an empty database nobody can log in, and there is no path from that
// state to a working one through the UI. This is that path — run once, then
// every further user is invited from the app.
//
// The predecessor of this script wrote a Mongo document. It was deleted with
// the rest of the Mongo layer, which left a fresh Postgres deployment with no
// way in at all.
//
// Usage:
//   node --env-file=.env scripts/create-admin.mjs "Ada Lovelace" ada@example.com
//   node --env-file=.env scripts/create-admin.mjs "Ada" ada@example.com --company "Acme Ltd"
//
// Prints a generated password unless one is supplied with --password.
// ============================================================================
import postgres from "postgres";
import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

// ── Arguments ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")),
);

const name = positional[0];
const email = positional[1]?.toLowerCase().trim();
const companyName = flag("company");
const givenPassword = flag("password");

if (!name || !email) {
  console.error(
    "Usage: node --env-file=.env scripts/create-admin.mjs <name> <email> " +
      "[--company <name>] [--password <password>]",
  );
  process.exit(1);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error(`Not an email address: ${email}`);
  process.exit(1);
}

// ── Connection ──────────────────────────────────────────────────────────────
// DIRECT first: this writes a user before any tenant exists to scope it to, so
// it must not run as the RLS-confined application role. It is also why this is
// a script and not an endpoint.
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Neither DIRECT_DATABASE_URL nor DATABASE_URL is set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  // ── Refuse to run twice ───────────────────────────────────────────────────
  // A second SuperAdmin is a normal thing to want, but it is invited from the
  // app. Reaching for this script again usually means somebody is locked out,
  // and silently minting another admin is the wrong answer to that.
  const [existingAdmin] = await sql`
    SELECT id, email FROM users WHERE role = 'SuperAdmin' LIMIT 1
  `;
  if (existingAdmin && !argv.includes("--force")) {
    console.error(
      `A SuperAdmin already exists (${existingAdmin.email}).\n\n` +
        "Invite further users from the app rather than running this again.\n" +
        "If you are locked out, pass --force to add another.",
    );
    process.exit(1);
  }

  const [existingUser] = await sql`
    SELECT id, role FROM users WHERE lower(email) = ${email} LIMIT 1
  `;
  if (existingUser) {
    console.error(
      `${email} already has a login (role: ${existingUser.role}).\n` +
        "Change its role from the app, or delete the row and re-run.",
    );
    process.exit(1);
  }

  const password = givenPassword ?? randomBytes(9).toString("base64url");
  // Cost 10 — what auth.ts's bcrypt.compare expects and what the app hashes at.
  const passwordHash = await bcrypt.hash(password, 10);
  const userId = randomUUID();

  // ── The company, if one was asked for ─────────────────────────────────────
  // Optional on purpose. A SuperAdmin is platform staff (0064) and holds a
  // grant for every company rather than belonging to one, so they can sign in
  // with no company at all and provision the first tenant from the UI.
  let companyId = null;
  if (companyName) {
    const slug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const [company] = await sql`
      INSERT INTO companies (id, name, slug)
      VALUES (${randomUUID()}, ${companyName}, ${slug})
      RETURNING id
    `;
    companyId = company.id;
    console.log(`Created company: ${companyName}`);
  }

  await sql`
    INSERT INTO users (id, name, email, role, status, auth_provider,
                       password_hash, home_company_id)
    VALUES (${userId}, ${name}, ${email}, 'SuperAdmin', 'active', 'credentials',
            ${passwordHash}, ${companyId})
  `;

  // A grant, not just the role. Access is a dated, revocable row — which is
  // what answers "who could open this company in March" (0033/0064).
  //
  // granted_via is 'primary', not a new value: 0033 constrains it to
  // ('primary','superadmin','invite','manual'), and this IS the home company.
  // 'superadmin' means the blanket grant every SuperAdmin holds over every
  // tenant, which queries single out with IS DISTINCT FROM.
  //
  // (This note lives here rather than as a -- comment inside the query: the
  // query is a template literal, and a backtick in an SQL comment ends it.)
  if (companyId) {
    await sql`
      INSERT INTO user_company_access (id, user_id, company_id, role, status,
                                       granted_via, granted_by_name)
      VALUES (${randomUUID()}, ${userId}, ${companyId}, 'SuperAdmin', 'active',
              'primary', 'create-admin script')
      ON CONFLICT DO NOTHING
    `;
  }

  console.log("\n────────────────────────────────────────────────");
  console.log("  SuperAdmin created");
  console.log("────────────────────────────────────────────────");
  console.log(`  Email:    ${email}`);
  if (!givenPassword) console.log(`  Password: ${password}`);
  console.log(`  Company:  ${companyName ?? "none — create one after signing in"}`);
  console.log("────────────────────────────────────────────────");
  console.log("\n  Sign in with these, then CHANGE THE PASSWORD and invite");
  console.log("  everyone else from the app. Do not run this script again.\n");
} catch (err) {
  console.error("Failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
