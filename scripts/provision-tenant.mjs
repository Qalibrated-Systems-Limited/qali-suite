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
import { getStandardChartOfAccounts } from "../lib/chart-of-accounts.js";

const MONTHS = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

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

    // Chart of accounts, two passes: the table is self-referential, so a child
    // can be defined before its parent.
    const defs = getStandardChartOfAccounts();
    const idByCode = new Map();
    for (const a of defs) {
      const id = randomUUID();
      idByCode.set(a.accountCode, id);
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name,
                              account_type, sub_type, system_account, can_post)
        VALUES (${id}, ${companyId}, ${a.accountCode}, ${a.accountName},
                ${a.accountType}, ${a.subType ?? null},
                ${a.systemAccount ?? null}, true)`;
    }
    for (const a of defs) {
      if (!a.parentCode) continue;
      const parentId = idByCode.get(a.parentCode);
      if (!parentId) continue;
      await tx`UPDATE accounts SET parent_id = ${parentId}
                WHERE id = ${idByCode.get(a.accountCode)}`;
      // A parent with a child is structural — posting to "Current Assets"
      // rather than an account under it is how a chart stops meaning anything.
      await tx`UPDATE accounts SET can_post = false WHERE id = ${parentId}`;
    }

    // Twelve monthly periods from today's year start; the first is open.
    const start = new Date();
    const year = start.getFullYear();
    for (let i = 0; i < 12; i++) {
      const ps = new Date(year, i, 1);
      const pe = new Date(year, i + 1, 0);
      const iso = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      await tx`
        INSERT INTO fiscal_periods (company_id, period_code, period_name, year,
                                    month, start_date, end_date, status)
        VALUES (${companyId}, ${`${year}-${String(i + 1).padStart(2, "0")}`},
                ${`${MONTHS[i]} ${year}`}, ${year}, ${i + 1},
                ${iso(ps)}, ${iso(pe)}, ${i === 0 ? "open" : "future"})
        ON CONFLICT DO NOTHING`;
    }

    // Every SuperAdmin holds every company — a dated, revocable row rather
    // than a role check, which is what answers "who could open this in March".
    const admins = await tx`SELECT id, name FROM users WHERE role = 'SuperAdmin'`;
    for (const u of admins) {
      await tx`
        INSERT INTO user_company_access (user_id, company_id, granted_via,
                                         granted_by_id, granted_by_name)
        VALUES (${u.id}, ${companyId}, 'superadmin', ${u.id}, ${u.name})
        ON CONFLICT DO NOTHING`;
    }
    console.log(`Granted ${admins.length} SuperAdmin(s) access.`);
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
