// ============================================
// REPAIR A TENANT — finish a company that was created outside provisioning
// ============================================
//
// A company made by an older `create-admin.mjs` has a `companies` row and
// nothing else: no settings, no chart of accounts, no fiscal periods. The first
// page that reads settings throws "This company has no settings. It was created
// outside provisioning — contact support".
//
// DRY RUN BY DEFAULT. It prints what each company is missing and changes
// nothing until you pass --apply. Every step is idempotent, so running it twice,
// or against a company that is already complete, changes nothing.
//
// Usage (on the server, from the app directory):
//
//   node --env-file=.env scripts/repair-tenant.mjs                 # every company, report only
//   node --env-file=.env scripts/repair-tenant.mjs --apply         # every company, fix
//   node --env-file=.env scripts/repair-tenant.mjs <company-uuid> --apply
//
// Uses DIRECT_DATABASE_URL: it writes across RLS-scoped tables, as provisioning
// does.

import postgres from "postgres";
import { inspectTenant, completeTenant } from "./lib/complete-tenant.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = args.find((a) => !a.startsWith("--")) ?? null;

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_DATABASE_URL is not set — run with --env-file=.env");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

const describe = (s) => {
  const missing = [];
  if (!s.settings) missing.push("settings");
  if (s.accounts === 0) missing.push("chart of accounts");
  if (s.periods === 0) missing.push("fiscal periods");
  if (s.superadminGrants < s.superadmins) missing.push("SuperAdmin grants");
  return missing;
};

try {
  const companies = only
    ? await sql`SELECT id, name FROM companies WHERE id = ${only}::uuid`
    : await sql`SELECT id, name FROM companies ORDER BY created_at`;

  if (!companies.length) {
    console.log(only ? `No company with id ${only}.` : "No companies.");
    process.exit(only ? 1 : 0);
  }

  let broken = 0;
  for (const c of companies) {
    const state = await inspectTenant(sql, c.id);
    const missing = describe(state);

    if (!missing.length) {
      console.log(`✓ ${c.name} — complete (${state.accounts} accounts, ${state.periods} periods)`);
      continue;
    }
    broken += 1;

    if (!apply) {
      console.log(`✗ ${c.name} (${c.id}) — missing: ${missing.join(", ")}`);
      continue;
    }

    const done = await sql.begin((tx) => completeTenant(tx, c.id));
    console.log(`✓ ${c.name} — repaired: ${done.join("; ")}`);
  }

  if (broken && !apply) {
    console.log(`\n${broken} compan${broken === 1 ? "y needs" : "ies need"} repair. Re-run with --apply to fix.`);
  }
} catch (err) {
  console.error("Repair failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
