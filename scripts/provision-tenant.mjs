#!/usr/bin/env node
// ============================================
// PROVISION A TENANT — DEVELOPMENT CONVENIENCE
// ============================================
// Stands up a second (third, fourth) company so multi-tenant behaviour can
// actually be exercised: the company switcher becomes a menu, RLS has real
// rows on both sides, and resolveActingCompany's "No company selected. You have
// access to N" path becomes reachable. With ONE tenant a missing scope and a
// correct scope are indistinguishable, which is how a cross-tenant customer
// picker survived to be noticed in the UI.
//
// app/db/provisioning.ts IS CANONICAL. This mirrors it for the dev database
// because that module is TypeScript behind an "@/" alias and there is no TS
// runner here. It reuses lib/chart-of-accounts.js rather than restating the
// accounts, so the one thing most likely to drift cannot. If provisioning.ts
// grows a step, this needs it too — real onboarding must keep going through
// the app.
//
// Usage:
//   node --env-file=.env scripts/provision-tenant.mjs "Acme Trading" [slug]
//
// Grants every existing SuperAdmin access, matching what provisioning does.
// ============================================

import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { completeTenant } from "./lib/complete-tenant.mjs";

const name = process.argv[2];
if (!name) {
  console.error('Usage: node --env-file=.env scripts/provision-tenant.mjs "Company Name" [slug]');
  process.exit(1);
}
const slug = (process.argv[3] || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const companyId = randomUUID();
// The Mongo-shaped id the session still carries, and what _migration_id_map
// keys on. A real onboarding writes Mongo's _id here; a dev tenant invents one.
const sourceId = randomUUID().replace(/-/g, "").slice(0, 24);

try {
  const [existing] = await sql`SELECT id FROM companies WHERE slug = ${slug}`;
  if (existing) {
    console.log(`A company with slug "${slug}" already exists (${existing.id}).`);
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`INSERT INTO companies (id, name, slug) VALUES (${companyId}, ${name}, ${slug})`;
    await tx`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
             VALUES ('companies', ${sourceId}, ${companyId})`;

    // The rest is provisioning's, shared with create-admin and repair-tenant.
    // This used to be an inline copy that had drifted: no settings row, and no
    // ltree `path` / `level` on the chart.
    const done = await completeTenant(tx, companyId);
    for (const line of done) console.log(`  ${line}`);
  });

  const [{ n: accounts }] = await sql`SELECT COUNT(*)::int n FROM accounts WHERE company_id = ${companyId}`;
  const [{ n: periods }] = await sql`SELECT COUNT(*)::int n FROM fiscal_periods WHERE company_id = ${companyId}`;
  console.log(`\nProvisioned "${name}"`);
  console.log(`  id      ${companyId}`);
  console.log(`  slug    ${slug}`);
  console.log(`  source  ${sourceId}`);
  console.log(`  seeded  ${accounts} accounts, ${periods} fiscal periods`);
  console.log(`\nReload the dashboard — the switcher is now a menu.`);
} catch (err) {
  console.error("Provisioning failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
