// ============================================
// COMPLETE A TENANT — what provisioning does after the company row exists
// ============================================
//
// app/db/provisioning.ts IS CANONICAL. This mirrors its steps for the scripts
// in this folder, which run under plain `node` with no TypeScript runner and no
// "@/" alias, so they cannot import that module.
//
// WHY THIS FILE EXISTS. Two scripts inserted a company row and stopped there,
// and each had drifted from provisioning in its own way:
//
//   * `create-admin.mjs` — DEPLOYMENT.md's Step 5, i.e. how every production
//     database gets its first company — inserted the row and NOTHING ELSE. No
//     `company_settings`, no chart of accounts, no fiscal periods. The first
//     page to read the settings threw "This company has no settings. It was
//     created outside provisioning — contact support", which is exactly what
//     /dashboard/settings/approvals did on erp.qalisuite.com.
//
//   * `provision-tenant.mjs` carried its own copy of the chart and period
//     seeding, written before provisioning grew the settings row and before it
//     set `accounts.path` and `level`. Its own header said "if provisioning.ts
//     grows a step, this needs it too" — and it did, and it didn't.
//
// One copy now, used by both scripts and by `repair-tenant.mjs`. Every step is
// IDEMPOTENT — it checks before it writes — so running it against a company
// that is already complete changes nothing, and running it against a
// half-built one finishes the job.
//
// If provisioning.ts grows a step, this needs it too. It is one file now.

import { randomUUID } from "node:crypto";
import { getStandardChartOfAccounts } from "../../lib/chart-of-accounts.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * What a company is missing, without changing anything.
 *
 * @returns {{ settings: boolean, accounts: number, periods: number, superadminGrants: number, superadmins: number }}
 */
export async function inspectTenant(sql, companyId) {
  const [{ settings }] = await sql`
    SELECT EXISTS (SELECT 1 FROM company_settings WHERE company_id = ${companyId}) AS settings`;
  const [{ n: accounts }] = await sql`
    SELECT count(*)::int AS n FROM accounts WHERE company_id = ${companyId}`;
  const [{ n: periods }] = await sql`
    SELECT count(*)::int AS n FROM fiscal_periods WHERE company_id = ${companyId}`;
  const [{ n: superadmins }] = await sql`
    SELECT count(*)::int AS n FROM users WHERE role = 'SuperAdmin'`;
  const [{ n: superadminGrants }] = await sql`
    SELECT count(*)::int AS n
      FROM user_company_access a JOIN users u ON u.id = a.user_id
     WHERE a.company_id = ${companyId} AND u.role = 'SuperAdmin'`;
  return { settings, accounts, periods, superadminGrants, superadmins };
}

/**
 * Bring a company up to what provisioning would have created.
 *
 * Runs inside the caller's transaction (`tx` is a postgres.js transaction
 * handle), so a failure part-way leaves the company exactly as it was.
 *
 * @returns {string[]} one line per step that actually wrote something
 */
export async function completeTenant(tx, companyId, { fiscalYearStart = new Date() } = {}) {
  const done = [];
  const before = await inspectTenant(tx, companyId);

  // ── Settings ────────────────────────────────────────────────────────────
  // Every column is NOT NULL with a default, so the bare row IS the default
  // configuration — the same single-column insert provisioning makes.
  if (!before.settings) {
    await tx`INSERT INTO company_settings (company_id) VALUES (${companyId})
             ON CONFLICT (company_id) DO NOTHING`;
    done.push("created company_settings (defaults)");
  }

  // ── Chart of accounts ───────────────────────────────────────────────────
  // Only when the company has NONE. A company with even one account has a
  // chart somebody chose, and seeding the standard one on top of it would
  // duplicate codes and fail — or worse, succeed beside theirs.
  if (before.accounts === 0) {
    const defs = getStandardChartOfAccounts();
    const idByCode = new Map();

    for (const a of defs) {
      const id = randomUUID();
      idByCode.set(a.accountCode, id);
      await tx`
        INSERT INTO accounts (
          id, company_id, account_code, account_name, account_type, sub_type,
          can_post, system_account, description, is_active, level
        ) VALUES (
          ${id}, ${companyId}, ${a.accountCode}, ${a.accountName},
          ${a.accountType}, ${a.subType ?? null},
          ${a.canPost !== false}, ${a.systemAccount ?? null},
          ${a.description ?? null}, true, 0
        )`;
    }

    // Roots first: a child's ltree path is built from its parent's.
    await tx`UPDATE accounts SET path = account_code::ltree
              WHERE company_id = ${companyId} AND path IS NULL`;

    const parents = new Set();
    for (const a of defs) {
      if (!a.parentCode) continue;
      const parentId = idByCode.get(a.parentCode);
      const childId = idByCode.get(a.accountCode);
      if (!parentId || !childId) continue;
      parents.add(a.parentCode);
      await tx`
        UPDATE accounts c
           SET parent_id = ${parentId},
               level = COALESCE(p.level + 1, 1),
               path = COALESCE(p.path, ${a.parentCode}::ltree) || ${a.accountCode}::ltree
          FROM accounts p
         WHERE c.id = ${childId} AND p.id = ${parentId}`;
    }
    // A parent with children is structural, not postable.
    for (const code of parents) {
      await tx`UPDATE accounts SET can_post = false
                WHERE id = ${idByCode.get(code)} AND can_post = true`;
    }
    done.push(`seeded chart of accounts (${defs.length} accounts)`);
  }

  // ── Fiscal periods ──────────────────────────────────────────────────────
  // Twelve months from the start given; only the first is open. Same rule as
  // provisioning: opening all twelve lets a posting land in a month nobody has
  // reached yet.
  if (before.periods === 0) {
    const start = new Date(fiscalYearStart);
    const year = start.getFullYear();
    for (let i = 0; i < 12; i++) {
      const ps = new Date(year, start.getMonth() + i, 1);
      const pe = new Date(year, start.getMonth() + i + 1, 0);
      const py = ps.getFullYear();
      const pm = ps.getMonth() + 1;
      await tx`
        INSERT INTO fiscal_periods (
          company_id, period_code, period_name, year, month,
          start_date, end_date, status
        ) VALUES (
          ${companyId}, ${`${py}-${String(pm).padStart(2, "0")}`},
          ${`${MONTHS[ps.getMonth()]} ${py}`}, ${py}, ${pm},
          ${iso(ps)}, ${iso(pe)}, ${i === 0 ? "open" : "future"}
        )
        ON CONFLICT DO NOTHING`;
    }
    done.push("seeded 12 fiscal periods (first open)");
  }

  // ── SuperAdmin grants ───────────────────────────────────────────────────
  // Every SuperAdmin holds every company, as a dated, revocable row.
  if (before.superadminGrants < before.superadmins) {
    const admins = await tx`SELECT id, name FROM users WHERE role = 'SuperAdmin'`;
    for (const u of admins) {
      await tx`
        INSERT INTO user_company_access (user_id, company_id, granted_via,
                                         granted_by_id, granted_by_name)
        VALUES (${u.id}, ${companyId}, 'superadmin', ${u.id}, ${u.name})
        ON CONFLICT DO NOTHING`;
    }
    done.push(`granted ${admins.length} SuperAdmin(s)`);
  }

  return done;
}
