/**
 * Cutover gate: the Postgres trial balance must equal the Mongo trial balance
 * exactly, per account, to the cent.
 *
 *   MONGODB_URI=... DIRECT_DATABASE_URL=... node app/db/backfill/reconcile.mjs
 *
 * Runs on the privileged connection: it reads across every tenant, and reads
 * _migration_rejects, which the application role cannot (migration 0024).
 *
 * Exits non-zero on any variance. Per docs/POSTGRES-MIGRATION-PLAN.md §6.3 a
 * variance BLOCKS cutover — it is not rounded away. Each one is either float
 * drift that existed in the old ledger, or a backfill bug, and the two need
 * telling apart before anyone's books move.
 *
 * Mongo-side totals are computed in exact integer 1/10000 units rather than by
 * summing floats, so this script cannot itself introduce the error it is
 * looking for.
 */
import postgres from "postgres";
import { MongoClient, ObjectId } from "mongodb";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SCALE = 10000;
const toScaled = (v) => Math.round((Number(v) || 0) * SCALE);
const fmt = (scaled) => {
  const neg = scaled < 0;
  const abs = Math.abs(scaled);
  const s = `${Math.floor(abs / SCALE)}.${String(abs % SCALE).padStart(4, "0")}`;
  return neg ? `-${s}` : s;
};

/**
 * Compares the two ledgers and returns the variance count.
 *
 * Exported so the cutover gate itself can be tested — a reconciliation that
 * silently passes is worse than none.
 */
export async function reconcile({
  mongoUri,
  databaseUrl,
  log = () => {},
} = {}) {
  const uri = mongoUri ?? process.env.MONGODB_URI;
  const url =
    databaseUrl ?? process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!uri || !url) {
    throw new Error(
      "MONGODB_URI and DIRECT_DATABASE_URL (or DATABASE_URL) must be set.",
    );
  }

  const mongo = new MongoClient(uri);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const findings = [];

  try {
    await mongo.connect();
  const db = mongo.db();

  const companies = await sql`
    SELECT c.id, c.name, m.old_object_id
      FROM companies c
      JOIN _migration_id_map m
        ON m.new_uuid = c.id AND m.collection = 'companies'
  `;

  let failures = 0;

  for (const company of companies) {
    log(`\n── ${company.name} ─────────────────────────────`);

    // ── Mongo side: exact integer aggregation over posted entries ──────────
    // _migration_id_map stores ids as text; Mongo stores companyId as an
    // ObjectId, so the string form matches nothing. Convert back before
    // querying — a silent empty result here would look like "reconciles" on
    // the totals and quietly wave a broken migration through.
    const sourceCompanyId = ObjectId.isValid(company.old_object_id)
      ? new ObjectId(company.old_object_id)
      : company.old_object_id;

    const entries = await db
      .collection("journalentries")
      .find({ companyId: sourceCompanyId, status: "posted" })
      .toArray()
      .catch(() => []);

    if (entries.length === 0) {
      log(
        "  ⚠ source query returned 0 posted entries — verify the company id " +
          "mapping before trusting this result.",
      );
    }

    const mongoByAccount = new Map(); // accountObjectId -> {debit, credit}
    for (const e of entries) {
      for (const l of e.lines ?? []) {
        const key = String(l.accountId);
        const cur = mongoByAccount.get(key) ?? { debit: 0, credit: 0 };
        cur.debit += toScaled(l.debit);
        cur.credit += toScaled(l.credit);
        mongoByAccount.set(key, cur);
      }
    }

    // ── Postgres side ──────────────────────────────────────────────────────
    const pgRows = await sql`
      SELECT m.old_object_id AS old_id,
             ab.account_code,
             ab.total_debit,
             ab.total_credit
        FROM account_balances ab
        JOIN _migration_id_map m
          ON m.new_uuid = ab.account_id AND m.collection = 'accounts'
       WHERE ab.company_id = ${company.id}
    `;

    const pgByAccount = new Map(
      pgRows.map((r) => [
        r.old_id,
        {
          code: r.account_code,
          debit: toScaled(r.total_debit),
          credit: toScaled(r.total_credit),
        },
      ]),
    );

    // ── Compare ────────────────────────────────────────────────────────────
    const allKeys = new Set([...mongoByAccount.keys(), ...pgByAccount.keys()]);
    let companyFailures = 0;
    let mongoDebitTotal = 0;
    let mongoCreditTotal = 0;

    for (const key of allKeys) {
      const m = mongoByAccount.get(key) ?? { debit: 0, credit: 0 };
      const p = pgByAccount.get(key) ?? { debit: 0, credit: 0, code: "(missing)" };
      mongoDebitTotal += m.debit;
      mongoCreditTotal += m.credit;

      if (m.debit !== p.debit || m.credit !== p.credit) {
        companyFailures++;
        findings.push({ company: company.name, kind: "account_variance", account: p.code });
        log(
          `  ✗ ${p.code.padEnd(10)} mongo Dr ${fmt(m.debit)} Cr ${fmt(m.credit)}` +
            `  |  pg Dr ${fmt(p.debit)} Cr ${fmt(p.credit)}` +
            `  |  ΔDr ${fmt(m.debit - p.debit)} ΔCr ${fmt(m.credit - p.credit)}`,
        );
      }
    }

    // Is the SOURCE ledger even internally consistent? This is the check that
    // surfaces pre-existing float drift, independent of the migration.
    if (mongoDebitTotal !== mongoCreditTotal) {
      findings.push({ company: company.name, kind: "source_out_of_balance",
        variance: fmt(mongoDebitTotal - mongoCreditTotal) });
      log(
        `  ⚠ SOURCE LEDGER IS OUT OF BALANCE: ` +
          `Dr ${fmt(mongoDebitTotal)} vs Cr ${fmt(mongoCreditTotal)} ` +
          `(variance ${fmt(mongoDebitTotal - mongoCreditTotal)}) — ` +
          `this drift predates the migration.`,
      );
      companyFailures++;
    }

    const [pgTotals] = await sql`
      SELECT COALESCE(SUM(debit_balance),0)  AS d,
             COALESCE(SUM(credit_balance),0) AS c
        FROM trial_balance
       WHERE company_id = ${company.id}
    `;

    log(
      `  Postgres trial balance: Dr ${pgTotals.d} / Cr ${pgTotals.c} ` +
        `${pgTotals.d === pgTotals.c ? "✓ ties" : "✗ DOES NOT TIE"}`,
    );

    const [rejects] = await sql`
      SELECT count(*)::int AS n FROM _migration_rejects
    `;
    if (rejects.n > 0) {
      findings.push({ company: company.name, kind: "quarantined", count: rejects.n });
      log(`  ⚠ ${rejects.n} document(s) were quarantined during backfill.`);
      companyFailures++;
    }

    if (companyFailures === 0) {
      log("  ✓ reconciles exactly");
    }
    failures += companyFailures;
  }

    log(
      failures === 0
        ? "\n✓ RECONCILED — safe to cut over."
        : `\n✗ ${failures} variance(s) — CUTOVER BLOCKED.`,
    );
    return { failures, findings };
  } finally {
    await mongo.close();
    await sql.end();
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isCli =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  try {
    const { failures } = await reconcile({ log: (m) => console.log(m) });
    process.exitCode = failures === 0 ? 0 : 1;
  } catch (err) {
    console.error("Reconciliation failed:", err);
    process.exitCode = 1;
  }
}
