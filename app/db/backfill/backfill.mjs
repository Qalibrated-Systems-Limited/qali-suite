/**
 * MongoDB -> PostgreSQL backfill for the accounting core.
 *
 * Usage:
 *   MONGODB_URI=... DATABASE_URL=... node app/db/backfill/backfill.mjs [--company <mongoId>]
 *
 * Design notes that matter:
 *
 * MONEY. Mongo stores debits/credits as float64. Converting each value
 * independently with toFixed(4) would hide the very drift we need to find, so
 * every amount is converted to an exact integer count of 1/10000 units and
 * summed as integers. If a source entry's debits and credits do not sum equal
 * at that exactness, it is NOT rounded into balance — it goes to
 * _migration_rejects for an accounting decision. Silently fixing it would
 * destroy the evidence that the old system had drifted.
 *
 * IDs. ObjectIds cannot be converted to UUIDs. Pass 1 allocates a UUID per
 * document into _migration_id_map; pass 2 resolves foreign keys through it.
 * Re-running is safe: existing mappings are reused, so a failed run can be
 * resumed rather than restarted.
 *
 * TENANCY. Each company's data is written inside its own transaction with
 * app.company_id set, so the backfill goes through exactly the same RLS path
 * the application does. A bug that would leak across tenants at runtime fails
 * here too.
 */
import postgres from "postgres";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";

const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_URL = process.env.DATABASE_URL;

if (!MONGODB_URI || !DATABASE_URL) {
  console.error("Both MONGODB_URI and DATABASE_URL must be set.");
  process.exit(1);
}

const onlyCompany = (() => {
  const i = process.argv.indexOf("--company");
  return i > -1 ? process.argv[i + 1] : null;
})();

// ── exact money helpers ──────────────────────────────────────────────────────
const SCALE = 10000; // numeric(19,4)

/** float -> exact integer count of 1/10000 units */
function toScaled(v) {
  const n = Number(v) || 0;
  return Math.round(n * SCALE);
}

/** integer 1/10000 units -> string suitable for numeric(19,4) */
function toMoney(scaled) {
  const neg = scaled < 0;
  const abs = Math.abs(scaled);
  const s = `${Math.floor(abs / SCALE)}.${String(abs % SCALE).padStart(4, "0")}`;
  return neg ? `-${s}` : s;
}

const toDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// ── main ─────────────────────────────────────────────────────────────────────
const mongo = new MongoClient(MONGODB_URI);
const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

const stats = {
  companies: 0,
  accounts: 0,
  fiscalPeriods: 0,
  parties: 0,
  entries: 0,
  lines: 0,
  rejected: 0,
};

/**
 * `db` must be the CURRENT connection — the transaction handle when inside
 * sql.begin(), never the outer pool. The pool is opened with max: 1 so that a
 * migration cannot interleave with itself; borrowing a second connection from
 * inside a transaction therefore deadlocks rather than merely being slow.
 */
async function mapId(db, collection, oldId) {
  const key = String(oldId);
  const [existing] = await db`
    SELECT new_uuid FROM _migration_id_map
     WHERE collection = ${collection} AND old_object_id = ${key}
  `;
  if (existing) return existing.new_uuid;

  const uuid = randomUUID();
  await db`
    INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
    VALUES (${collection}, ${key}, ${uuid})
    ON CONFLICT (collection, old_object_id) DO NOTHING
  `;
  const [row] = await db`
    SELECT new_uuid FROM _migration_id_map
     WHERE collection = ${collection} AND old_object_id = ${key}
  `;
  return row.new_uuid;
}

async function reject(db, collection, oldId, reason, detail) {
  stats.rejected++;
  await db`
    INSERT INTO _migration_rejects (collection, old_object_id, reason, detail)
    VALUES (${collection}, ${String(oldId)}, ${reason}, ${db.json(detail ?? {})})
  `;
}

/**
 * Resolves a Mongo party ObjectId to its Postgres uuid, but ONLY if the party
 * row actually exists.
 *
 * Since migration 0006 journal_entries.party_id carries a composite FK, so an
 * id that maps in _migration_id_map but has no corresponding row — a party
 * deleted from Mongo after entries referenced it — would abort the entry. The
 * entry is worth more than the party attribution, so the reference is dropped
 * and the entry is kept.
 */
async function resolvePartyId(db, oldPartyId) {
  const uuid = await mapId(db, "parties", oldPartyId);
  const [row] = await db`SELECT 1 AS ok FROM parties WHERE id = ${uuid}`;
  return row ? uuid : null;
}

async function run() {
  await mongo.connect();
  const db = mongo.db();

  const companyFilter = onlyCompany ? { _id: { $oid: onlyCompany } } : {};
  const companies = await db
    .collection("companies")
    .find(onlyCompany ? { _id: companyFilter._id.$oid } : {})
    .toArray()
    .catch(() => []);

  // Fall back to deriving tenants from the accounts collection when there is
  // no companies collection (older single-tenant databases).
  const companyIds = companies.length
    ? companies.map((c) => c._id)
    : await db.collection("accounts").distinct("companyId");

  console.log(`Found ${companyIds.length} company/companies to migrate.`);

  for (const oldCompanyId of companyIds) {
    const companyDoc = companies.find(
      (c) => String(c._id) === String(oldCompanyId),
    );
    const companyUuid = await mapId(sql, "companies", oldCompanyId);

    await sql.begin(async (tx) => {
      // Companies is the tenant root and is not itself under RLS.
      await tx`
        INSERT INTO companies (id, name, slug, base_currency)
        VALUES (
          ${companyUuid},
          ${companyDoc?.name ?? `Company ${String(oldCompanyId).slice(-6)}`},
          ${companyDoc?.slug ?? String(oldCompanyId)},
          ${companyDoc?.baseCurrency ?? "KES"}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      stats.companies++;

      // Everything below is tenant-scoped; go through the same RLS path the
      // app uses rather than around it.
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;

      // ── accounts (pass 1: rows, pass 2: parents) ─────────────────────────
      const accounts = await db
        .collection("accounts")
        .find({ companyId: oldCompanyId })
        .toArray();

      for (const a of accounts) {
        const id = await mapId(tx, "accounts", a._id);
        await tx`
          INSERT INTO accounts (
            id, company_id, account_code, account_name, account_type, sub_type,
            level, can_post, system_account, currency, is_active, description,
            taxable, default_tax_rate
          ) VALUES (
            ${id}, ${companyUuid}, ${String(a.accountCode).toUpperCase()},
            ${a.accountName}, ${a.accountType}, ${a.subType ?? null},
            ${a.level ?? 0}, ${a.canPost ?? true}, ${a.systemAccount ?? null},
            ${a.currency ?? "KES"}, ${a.isActive ?? true}, ${a.description ?? null},
            ${a.taxable ?? false}, ${String(a.defaultTaxRate ?? 0)}
          )
          ON CONFLICT (id) DO NOTHING
        `;
        stats.accounts++;
      }

      // Parents resolved after all rows exist, so insert order does not matter.
      for (const a of accounts) {
        if (!a.parentAccount) continue;
        const id = await mapId(tx, "accounts", a._id);
        const parentId = await mapId(tx, "accounts", a.parentAccount);
        await tx`UPDATE accounts SET parent_id = ${parentId} WHERE id = ${id}`;
      }

      // ── fiscal periods ───────────────────────────────────────────────────
      const periods = await db
        .collection("fiscalperiods")
        .find({ companyId: oldCompanyId })
        .toArray()
        .catch(() => []);

      for (const p of periods) {
        const id = await mapId(tx, "fiscalPeriods", p._id);
        await tx`
          INSERT INTO fiscal_periods (
            id, company_id, year, month, period_name, period_code,
            start_date, end_date, status
          ) VALUES (
            ${id}, ${companyUuid}, ${p.year}, ${p.month}, ${p.periodName},
            ${String(p.periodCode).toUpperCase()},
            ${toDate(p.startDate)}, ${toDate(p.endDate)},
            ${p.status ?? "open"}
          )
          ON CONFLICT (id) DO NOTHING
        `;
        stats.fiscalPeriods++;
      }

      // ── parties ──────────────────────────────────────────────────────────
      // MUST run before journal entries: since migration 0006,
      // journal_entries.party_id carries a composite FK to (id, company_id) on
      // this table, so an entry naming an unmigrated party is rejected.
      const partyDocs = await db
        .collection("parties")
        .find({ companyId: oldCompanyId })
        .toArray()
        .catch(() => []);

      for (const p of partyDocs) {
        const id = await mapId(tx, "parties", p._id);

        // Mongo models role as a four-valued enum where "both" means customer
        // AND supplier; Postgres uses independent booleans (see
        // app/db/schema/parties.ts).
        const isCustomer = p.type === "customer" || p.type === "both";
        const isSupplier = p.type === "supplier" || p.type === "both";
        const isEmployee = p.type === "employee";
        const primaryType =
          p.type === "both" ? "customer" : (p.type ?? "other");

        await tx`
          INSERT INTO parties (
            id, company_id, primary_type, is_customer, is_supplier, is_employee,
            name, display_name, email, phone, tax_pin,
            address_line1, address_line2, city, postal_code, country,
            employee_number, department, designation, is_contractor,
            wht_applicable, wht_rate, default_currency,
            credit_limit, payment_terms_days,
            bank_name, bank_account_number, bank_branch, bank_swift_code,
            is_active
          ) VALUES (
            ${id}, ${companyUuid}, ${primaryType},
            ${isCustomer}, ${isSupplier}, ${isEmployee},
            ${p.name}, ${p.displayName ?? null}, ${p.email ?? null},
            ${p.phone ?? null}, ${p.taxPin ?? null},
            ${p.address?.line1 ?? null}, ${p.address?.line2 ?? null},
            ${p.address?.city ?? null}, ${p.address?.postalCode ?? null},
            ${p.address?.country ?? "Kenya"},
            ${p.employeeNumber || null}, ${p.department ?? null},
            ${p.designation ?? null}, ${p.isContractor ?? false},
            ${p.whtApplicable ?? false}, ${String(p.whtRate ?? 0)},
            ${p.defaultCurrency ?? "KES"},
            ${toMoney(toScaled(p.creditTerms?.creditLimit))},
            ${p.creditTerms?.paymentTermsDays ?? 30},
            ${p.paymentDetails?.bankName ?? null},
            ${p.paymentDetails?.accountNumber ?? null},
            ${p.paymentDetails?.branch ?? null},
            ${p.paymentDetails?.swiftCode ?? null},
            ${p.isActive ?? true}
          )
          ON CONFLICT (id) DO NOTHING
        `;
        stats.parties++;
      }

      // ── journal entries + lines ──────────────────────────────────────────
      const entries = await db
        .collection("journalentries")
        .find({ companyId: oldCompanyId })
        .toArray();

      for (const e of entries) {
        const lines = Array.isArray(e.lines) ? e.lines : [];

        // Exact integer arithmetic — this is the drift detector.
        let debitSum = 0;
        let creditSum = 0;
        for (const l of lines) {
          debitSum += toScaled(l.debit);
          creditSum += toScaled(l.credit);
        }

        const isPosted = e.status === "posted" || e.status === "reversed";

        if (isPosted && lines.length < 2) {
          await reject(tx, "journalentries", e._id, "fewer_than_two_lines", {
            entryNumber: e.entryNumber,
            lineCount: lines.length,
          });
          continue;
        }

        if (isPosted && debitSum !== creditSum) {
          await reject(tx, "journalentries", e._id, "unbalanced_in_source", {
            entryNumber: e.entryNumber,
            entryDate: e.entryDate,
            debits: toMoney(debitSum),
            credits: toMoney(creditSum),
            variance: toMoney(debitSum - creditSum),
          });
          continue;
        }

        const id = await mapId(tx, "journalEntries", e._id);

        // Nested savepoint: a row the database refuses must not abort the whole
        // company's transaction.
        try {
          await tx.savepoint(async (sp) => {
            // Resolve the party BEFORE the insert. journal_entries carries
            // CHECK ((party_type IS NULL) = (party_id IS NULL)), so an entry
            // naming a party that was never migrated — deleted since, or
            // belonging to a collection this run did not cover — must drop BOTH
            // columns together, not just the id.
            const partyId = e.party?.id
              ? await resolvePartyId(sp, e.party.id)
              : null;
            const partyType = partyId ? (e.party?.type ?? null) : null;

            await sp`
              INSERT INTO journal_entries (
                id, company_id, entry_number, entry_date, entry_type,
                description, reference, notes, party_type, party_id, due_date,
                status, posted_at, is_fully_paid, amount_paid, amount_outstanding
              ) VALUES (
                ${id}, ${companyUuid}, ${e.entryNumber}, ${toDate(e.entryDate)},
                ${e.entryType}, ${e.description}, ${e.reference ?? null},
                ${e.notes ?? null},
                ${partyType},
                ${partyId},
                ${toDate(e.dueDate)}, ${e.status ?? "draft"},
                ${e.postedAt ? new Date(e.postedAt) : null},
                ${e.isFullyPaid ?? false},
                ${toMoney(toScaled(e.amountPaid))},
                ${toMoney(toScaled(e.amountOutstanding))}
              )
              ON CONFLICT (id) DO NOTHING
            `;

            let n = 0;
            for (const l of lines) {
              n++;
              const accountId = await mapId(sp, "accounts", l.accountId);
              await sp`
                INSERT INTO journal_lines (
                  company_id, entry_id, account_id, line_number,
                  debit, credit, description
                ) VALUES (
                  ${companyUuid}, ${id}, ${accountId}, ${n},
                  ${toMoney(toScaled(l.debit))}, ${toMoney(toScaled(l.credit))},
                  ${l.description ?? null}
                )
              `;
              stats.lines++;
            }
          });
          stats.entries++;
        } catch (err) {
          await reject(tx, "journalentries", e._id, "rejected_by_target", {
            entryNumber: e.entryNumber,
            error: err.message,
          });
        }
      }
    });

    console.log(`  ✓ company ${String(oldCompanyId)} migrated`);
  }
}

try {
  await run();
  console.log("\n── Backfill summary ─────────────────────────");
  for (const [k, v] of Object.entries(stats)) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }
  if (stats.rejected > 0) {
    console.log(
      `\n  ⚠ ${stats.rejected} document(s) quarantined. Inspect with:\n` +
        `    SELECT reason, count(*) FROM _migration_rejects GROUP BY reason;`,
    );
  }
} catch (err) {
  console.error("Backfill failed:", err);
  process.exitCode = 1;
} finally {
  await mongo.close();
  await sql.end();
}
