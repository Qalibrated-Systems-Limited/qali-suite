/**
 * MongoDB -> PostgreSQL backfill for the accounting core.
 *
 * Usage:
 *   MONGODB_URI=... DIRECT_DATABASE_URL=... node app/db/backfill/backfill.mjs [--company <mongoId>]
 *
 * CONNECTION. Runs on DIRECT_DATABASE_URL — the privileged, unpooled one —
 * falling back to DATABASE_URL. This is not interchangeable with the
 * application's connection: the backfill provisions companies, and writes
 * _migration_id_map and _migration_rejects, none of which app_user may do
 * (migrations 0023, 0024). It also runs long transactions that transaction-mode
 * pooling would break.
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
 *
 * ORDER. There is no single-pass insert order: the references form cycles.
 * bill_lines -> weighbridge_tickets -> bills, and
 * stock_request_fulfilments -> item_checkouts -> stock_requests, and
 * invoice_lines -> item_checkouts -> invoices, and
 * stock_requests -> invoices -> item_checkouts -> stock_requests. Each cycle
 * is broken the way accounts.parent_id already is — insert with the
 * back-reference null, then UPDATE it once both sides exist. The sequence,
 * with the reason each step cannot move earlier:
 *
 *    1  companies              tenant root
 *    2  accounts (+ parents)   self-referential, two-pass
 *    3  fiscal_periods
 *    4  parties                journal_entries.party_id FK
 *    5  products               referenced by every line table
 *    6  weighbridge_tickets    pass 1: no invoice/bill refs yet
 *    7  journal_entries+lines  referenced by everything that posts
 *    8  stock_requests, _items, _approvals
 *                             pass 1: draft_invoice_id points at invoices
 *    9  item_checkouts         pass 1: request_id resolves, invoice refs do not
 *   10  invoices, invoice_lines, cogs_postings
 *   11  stock_movements        invoice_line_id now resolves
 *   12  stock_request_fulfilments   checkout_id and movement_id now resolve
 *   13  bills, bill_lines      bill_lines -> weighbridge_tickets now resolves
 *   14  credit_notes, credit_note_lines
 *   15  payments, payment_allocations   allocations name invoices AND bills
 *   16  tax_transactions       source doc may be an invoice, bill or entry
 *   17  stock_request_item_invoices
 *   18  checkout_reminders
 *   19  PASS 2 back-references:
 *          weighbridge_tickets.invoice_id / bill_id / linked_ticket_id
 *          item_checkouts.sale_invoice_id / failed_invoice_id
 *          stock_requests.draft_invoice_id
 *
 * Steps 1-8 are implemented. See docs/POSTGRES-MIGRATION-PLAN.md §9B.
 */
import postgres from "postgres";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

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

const newStats = () => ({
  companies: 0,
  accounts: 0,
  fiscalPeriods: 0,
  parties: 0,
  products: 0,
  weighbridgeTickets: 0,
  entries: 0,
  lines: 0,
  stockRequests: 0,
  stockRequestItems: 0,
  stockRequestApprovals: 0,
  rejected: 0,
});

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

async function reject(db, stats, collection, oldId, reason, detail) {
  stats.rejected++;
  // One row per rejected document, not one per attempt. A resumed run
  // re-examines everything, and without this the same unbalanced entry
  // accumulates a reject row each time — inflating the count the cutover gate
  // reads and making a stable migration look progressively worse.
  await db`
    DELETE FROM _migration_rejects
     WHERE collection = ${collection} AND old_object_id = ${String(oldId)}
  `;
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

async function run({ mongo, sql, stats, onlyCompany, log }) {
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

  log(`Found ${companyIds.length} company/companies to migrate.`);

  for (const oldCompanyId of companyIds) {
    const companyDoc = companies.find(
      (c) => String(c._id) === String(oldCompanyId),
    );
    const companyUuid = await mapId(sql, "companies", oldCompanyId);

    await sql.begin(async (tx) => {
      // Scope FIRST. Since migration 0024 `companies` is itself under RLS,
      // keyed on its own id, with a WITH CHECK — so the tenant root has to be
      // inserted inside its own scope. Setting it up front also means the
      // backfill does not depend on connecting as a role that bypasses RLS; it
      // goes through the same path the application does, as the note above says.
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;

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

      // ── products ─────────────────────────────────────────────────────────
      // No dependencies beyond the company, and invoice/bill/stock lines all
      // reference these, so they go early.
      const productDocs = await db
        .collection("products")
        .find({ companyId: oldCompanyId })
        .toArray()
        .catch(() => []);

      for (const pr of productDocs) {
        const id = await mapId(tx, "products", pr._id);

        // Mongo carries BOTH `status` (active/inactive/discontinued) and an
        // `isActive` boolean. Postgres keeps only the boolean, so the three
        // states flatten to two: anything not "active" is inactive. The
        // distinction between discontinued and merely inactive is not carried,
        // and nothing outside a service-layer filter type reads it.
        const isActive =
          pr.isActive !== false && (pr.status ?? "active") === "active";

        await tx`
          INSERT INTO products (
            id, company_id, sku, name, description, category, unit,
            product_type, quantity_on_hand, quantity_committed,
            quantity_on_hold, reorder_level, cost_price, last_purchase_cost,
            costing_method, selling_price, wholesale_price, is_active
          ) VALUES (
            ${id}, ${companyUuid}, ${String(pr.SKU ?? "").toUpperCase()},
            ${pr.name}, ${pr.description ?? null}, ${pr.category ?? null},
            ${pr.unit ?? "pcs"}, ${pr.type ?? "Inventory Item"},
            ${toMoney(toScaled(pr.inventory?.quantityOnHand))},
            ${toMoney(toScaled(pr.inventory?.quantityCommitted))},
            ${toMoney(toScaled(pr.inventory?.quantityOnHold))},
            ${toMoney(toScaled(pr.inventory?.reorderLevel))},
            ${toMoney(toScaled(pr.costing?.costPrice))},
            ${toMoney(toScaled(pr.costing?.lastPurchaseCost))},
            ${pr.costing?.costingMethod ?? "average"},
            ${toMoney(toScaled(pr.pricing?.sellingPrice))},
            ${toMoney(toScaled(pr.pricing?.wholesalePrice))},
            ${isActive}
          )
          ON CONFLICT (id) DO NOTHING
        `;
        stats.products++;
      }

      // ── weighbridge tickets (pass 1) ─────────────────────────────────────
      // Invoice lines and bill lines both reference these, so they land before
      // either. Their own invoice_id/bill_id/linked_ticket_id point the other
      // way and are filled in pass 2, once those rows exist — the same
      // two-pass shape accounts.parent_id uses.
      const wbDocs = await db
        .collection("weighbridgeTickets")
        .find({ companyId: oldCompanyId })
        .toArray()
        .catch(() => []);

      const INBOUND = new Set(["purchase", "transfer_in", "customer_return"]);

      for (const t of wbDocs) {
        const id = await mapId(tx, "weighbridgeTickets", t._id);

        // Mongo requires transactionType AND direction and constrains neither
        // against the other, so a purchase could be recorded as outbound.
        // Postgres pairs them with a CHECK. Where the source disagrees, the
        // ticket is quarantined rather than silently re-pointed: direction is
        // what the stock side reads, and guessing which field is right would
        // move inventory the wrong way.
        const expected = INBOUND.has(t.transactionType) ? "inbound" : "outbound";
        if (t.direction && t.direction !== expected) {
          await reject(tx, stats, "weighbridgeTickets", t._id,
            "direction_contradicts_transaction_type", {
              ticketNumber: t.ticketNumber,
              transactionType: t.transactionType,
              direction: t.direction,
              expected,
            });
          continue;
        }

        // net_weight is GENERATED as abs(first - second) and is never written.
        // A ticket calling itself completed on one weighing has no net at all,
        // and the target refuses it — as it should, so it is surfaced here.
        if (t.status === "completed" && (t.firstWeight == null || t.secondWeight == null)) {
          await reject(tx, stats, "weighbridgeTickets", t._id,
            "completed_without_both_weighings", {
              ticketNumber: t.ticketNumber,
              firstWeight: t.firstWeight ?? null,
              secondWeight: t.secondWeight ?? null,
            });
          continue;
        }

        const wbPartyId = t.partyId ? await mapId(tx, "parties", t.partyId) : null;
        const [partyExists] = wbPartyId
          ? await tx`SELECT 1 AS ok FROM parties WHERE id = ${wbPartyId}`
          : [null];

        try {
          await tx.savepoint(async (sp) => {
            await sp`
              INSERT INTO weighbridge_tickets (
                id, company_id, ticket_number, external_ref, transaction_type,
                direction, vehicle_reg, driver_name, driver_phone,
                product_id, product_name_at_ticket, product_code_at_ticket,
                party_id, party_name_at_ticket,
                first_weight, second_weight, weight_unit,
                first_weight_recorded_at, second_weight_recorded_at,
                status, ticket_date, internal_ref,
                purchase_order_ref, invoice_ref, invoice_item_fulfilled,
                bill_ref, transfer_ref, transfer_cleared,
                completed_at, voided_at, void_reason, notes, warnings
              ) VALUES (
                ${id}, ${companyUuid}, ${t.ticketNumber}, ${t.externalRef ?? null},
                ${t.transactionType}, ${expected},
                ${t.vehicleReg ?? null}, ${t.driverName ?? null}, ${t.driverPhone ?? null},
                ${t.productId ? await mapId(sp, "products", t.productId) : null},
                ${t.productName ?? null}, ${t.productCode ?? null},
                ${partyExists ? wbPartyId : null}, ${t.partyName ?? null},
                ${t.firstWeight == null ? null : toMoney(toScaled(t.firstWeight))},
                ${t.secondWeight == null ? null : toMoney(toScaled(t.secondWeight))},
                ${t.weightUnit ?? "kg"},
                ${t.firstWeightRecordedAt ? new Date(t.firstWeightRecordedAt) : null},
                ${t.secondWeightRecordedAt ? new Date(t.secondWeightRecordedAt) : null},
                ${t.status ?? "pending"}, ${toDate(t.createdAt)}, ${t.internalRef ?? null},
                ${t.purchaseOrderRef ?? null}, ${t.invoiceRef ?? null},
                ${t.invoiceItemFulfilled ?? false},
                ${t.billRef ?? null}, ${t.transferRef ?? null},
                ${t.transferCleared ?? false},
                ${t.completedAt ? new Date(t.completedAt) : null},
                ${t.voidedAt ? new Date(t.voidedAt) : null},
                ${t.voidReason ?? null}, ${t.notes || null},
                ${t.warnings?.length ? t.warnings : null}
              )
              ON CONFLICT (id) DO NOTHING
            `;
          });
          stats.weighbridgeTickets++;
        } catch (err) {
          await reject(tx, stats, "weighbridgeTickets", t._id, "rejected_by_target", {
            ticketNumber: t.ticketNumber,
            error: err.message,
          });
        }
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
          await reject(tx, stats, "journalentries", e._id, "fewer_than_two_lines", {
            entryNumber: e.entryNumber,
            lineCount: lines.length,
          });
          continue;
        }

        if (isPosted && debitSum !== creditSum) {
          await reject(tx, stats, "journalentries", e._id, "unbalanced_in_source", {
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
              // ON CONFLICT is what makes the resume promise in the header
              // true. Without it a re-run hits journal_lines_entry_line_uq,
              // the savepoint rolls back, and an entry that migrated perfectly
              // well the first time is quarantined as rejected_by_target — so
              // a cutover retried after any transient failure would report a
              // pile of phantom rejects and block itself.
              await sp`
                INSERT INTO journal_lines (
                  company_id, entry_id, account_id, line_number,
                  debit, credit, description
                ) VALUES (
                  ${companyUuid}, ${id}, ${accountId}, ${n},
                  ${toMoney(toScaled(l.debit))}, ${toMoney(toScaled(l.credit))},
                  ${l.description ?? null}
                )
                ON CONFLICT (entry_id, line_number) DO NOTHING
              `;
            }
          });
          // Counted only once the savepoint has committed. Incrementing inside
          // it credited the lines of an entry that then failed and was
          // quarantined, so the reported line count over-stated what moved.
          stats.entries++;
          stats.lines += lines.length;
        } catch (err) {
          await reject(tx, stats, "journalentries", e._id, "rejected_by_target", {
            entryNumber: e.entryNumber,
            error: err.message,
          });
        }
      }

      // ── stock requests + items + approvals ───────────────────────────────
      // Items reference products (step 5); the request references parties
      // (step 4). Nothing here needs an invoice, a movement or a checkout —
      // except draft_invoice_id, which points AT invoices (step 10). A `sale`
      // request raises a draft invoice at fulfilment and records it, so the
      // request points forward at a document that points back at it: the third
      // cycle in the header's ORDER, found here, and left for pass 2.
      const requestDocs = await db
        .collection("stockrequests")
        .find({ companyId: oldCompanyId })
        .toArray()
        .catch(() => []);

      // The two types that have no external customer. Creation writes
      // customer.id as "" for these — not null — so "absent" is the empty
      // string as often as it is undefined.
      const CUSTOMERLESS = new Set(["internal", "employee_borrow"]);

      for (const r of requestDocs) {
        const rawCustomerId = r.customer?.id ? String(r.customer.id).trim() : "";
        const customerId = rawCustomerId
          ? await resolvePartyId(tx, rawCustomerId)
          : null;

        // A journal entry that names a vanished party keeps the entry and drops
        // the attribution. A request cannot: since 0022 the customer is a real
        // FK, and stock_requests_customer_required_unless_internal makes it
        // mandatory for the customer-facing types. So it is quarantined with
        // the reason named, rather than migrated as if it were internal.
        if (!CUSTOMERLESS.has(r.requestType) && !customerId) {
          await reject(tx, stats, "stockrequests", r._id,
            rawCustomerId ? "customer_not_migrated" : "customer_missing", {
              requestNumber: r.requestNumber,
              requestType: r.requestType,
              customerId: rawCustomerId || null,
              customerName: r.customer?.name ?? null,
            });
          continue;
        }

        const items = Array.isArray(r.items) ? r.items : [];
        const history = Array.isArray(r.approvalHistory) ? r.approvalHistory : [];

        // approver_name_at_action is NOT NULL: a row that cannot say who acted
        // is not an audit record, and half a request's history is worse than a
        // named reject. In practice the array is always empty — creation writes
        // [] and nothing appends to it; the approver snapshot lives on the
        // request itself — so this quarantines malformed legacy data only.
        const badApproval = history.find((h) => !h.approverName || !h.action);
        if (badApproval) {
          await reject(tx, stats, "stockrequests", r._id,
            "approval_history_incomplete", {
              requestNumber: r.requestNumber,
              approverName: badApproval.approverName ?? null,
              action: badApproval.action ?? null,
            });
          continue;
        }

        const id = await mapId(tx, "stockRequests", r._id);

        // requester.id, approver.id, rejectedBy.id and the creator are User
        // ids, and `users` is not in this migration — so they are dropped, the
        // same as they are for journal entries, and the name snapshots carry
        // who did what.
        //
        // project_id and cost_code_id are deferred references: `projects` and
        // `project_cost_codes` are not ported and neither column has an FK.
        // The id map is what makes them resolve if those tables ever land, so
        // the reference is preserved rather than dropped; the number and name
        // snapshots are what anything reads today.
        //
        // total_value is NOT written: it is derived from the items by trigger.
        try {
          await tx.savepoint(async (sp) => {
            await sp`
              INSERT INTO stock_requests (
                id, company_id, request_number, request_type, status, priority,
                customer_id, customer_name_at_request, customer_email_at_request,
                customer_phone_at_request, customer_address_at_request,
                customer_tax_pin_at_request,
                requester_id, requester_name_at_request, requester_department,
                requester_email, requester_phone,
                approved_by_id, approved_by_name_at_approval, approved_at,
                approval_comments, approval_conditions,
                rejected_by_id, rejected_at, rejection_reason,
                cancelled_at, cancellation_reason,
                notes, required_by_date,
                draft_invoice_number_at_creation, draft_invoice_created_at,
                project_id, project_number_at_request, project_name_at_request,
                cost_code_id, cost_code_at_request,
                created_by_id, requested_at, created_at, updated_at
              ) VALUES (
                ${id}, ${companyUuid}, ${r.requestNumber}, ${r.requestType},
                ${r.status ?? "pending"}, ${r.priority ?? "normal"},
                ${customerId}, ${r.customer?.name || null},
                ${r.customer?.email || null}, ${r.customer?.phone || null},
                ${r.customer?.address || null}, ${r.customer?.taxPin || null},
                ${null}, ${r.requester?.name}, ${r.requester?.department},
                ${r.requester?.email || null}, ${r.requester?.phone || null},
                ${null}, ${r.approver?.name || null},
                ${r.approver?.approvedAt ? new Date(r.approver.approvedAt) : null},
                ${r.approver?.comments || null}, ${r.approver?.conditions || null},
                ${null}, ${r.rejectedAt ? new Date(r.rejectedAt) : null},
                ${r.rejectionReason || null},
                ${r.cancelledAt ? new Date(r.cancelledAt) : null},
                ${r.cancellationReason || null},
                ${r.notes || null}, ${toDate(r.requiredByDate)},
                ${r.draftInvoice?.invoiceNumber || null},
                ${r.draftInvoice?.createdAt ? new Date(r.draftInvoice.createdAt) : null},
                ${r.projectId ? await mapId(sp, "projects", r.projectId) : null},
                ${r.project?.projectNumber || null}, ${r.project?.name || null},
                ${r.costCodeId ? await mapId(sp, "projectCostCodes", r.costCodeId) : null},
                ${r.costCode?.code || null},
                ${null}, ${r.createdAt ? new Date(r.createdAt) : new Date()},
                ${r.createdAt ? new Date(r.createdAt) : new Date()},
                ${r.updatedAt ? new Date(r.updatedAt) : new Date()}
              )
              ON CONFLICT (id) DO NOTHING
            `;

            let n = 0;
            for (const it of items) {
              n++;
              // Subdocuments carry their own _id, and steps 12 and 17 resolve
              // fulfilments and invoiced quantities through it. Legacy rows
              // without one fall back to a key derived from the request, so a
              // re-run maps to the same uuid rather than duplicating the line.
              const itemId = await mapId(
                sp,
                "stockRequestItems",
                it._id ?? `${String(r._id)}#${n}`,
              );

              // THE ONE VALUE THAT CANNOT BE CARRIED LITERALLY.
              //
              // Creation writes approvedQuantity: 0 to mean "not approved
              // yet", and every reader in the source resolves the target as
              // `approvedQuantity || requestedQuantity` — model, actions and
              // UI alike — so a stored 0 is never read as an approved zero,
              // even though the approve action can write one. NULL is what the
              // source behaves as, and it is what the target's
              // COALESCE(approved_quantity, requested_quantity) expects.
              //
              // Carrying the literal 0 would set the target to zero for every
              // pending request: remaining_to_fulfil would read 0 with nothing
              // issued, total_value would compute as 0, and step 12 would then
              // fail the over-fulfilment trigger on every request that had any
              // stock issued against it.
              const approvedQuantity =
                Number(it.approvedQuantity) > 0
                  ? toMoney(toScaled(it.approvedQuantity))
                  : null;

              await sp`
                INSERT INTO stock_request_items (
                  id, company_id, request_id, line_number,
                  product_id, product_name_at_request, sku_at_request,
                  stock_at_request, requested_quantity, approved_quantity,
                  unit_price, unit, purpose, purpose_details,
                  requires_return, expected_return_date, notes, created_at
                ) VALUES (
                  ${itemId}, ${companyUuid}, ${id}, ${n},
                  ${await mapId(sp, "products", it.productId)},
                  ${it.productName}, ${String(it.SKU ?? "").toUpperCase()},
                  ${toMoney(toScaled(it.currentStock))},
                  ${toMoney(toScaled(it.requestedQuantity))},
                  ${approvedQuantity},
                  ${toMoney(toScaled(it.unitPrice))}, ${it.unit || "pcs"},
                  ${it.purpose ?? null}, ${it.purposeDetails || null},
                  ${it.requiresReturn ?? false},
                  ${toDate(it.expectedReturnDate)}, ${it.notes || null},
                  ${r.createdAt ? new Date(r.createdAt) : new Date()}
                )
                ON CONFLICT (id) DO NOTHING
              `;
              // total_fulfilled, invoiced_quantity, fulfilment_status and the
              // request's total_value and status are the five values §9.9
              // records as maintained by hand. None is written here: they are
              // derived by trigger from the fulfilment and invoice rows that
              // arrive at steps 12 and 17.
            }

            for (const h of history) {
              await sp`
                INSERT INTO stock_request_approvals (
                  id, company_id, request_id, approver_id,
                  approver_name_at_action, action, comments, acted_at
                ) VALUES (
                  ${await mapId(sp, "stockRequestApprovals", h._id ?? `${String(r._id)}#${h.timestamp}`)},
                  ${companyUuid}, ${id}, ${null},
                  ${h.approverName}, ${h.action}, ${h.comments || null},
                  ${h.timestamp ? new Date(h.timestamp) : new Date()}
                )
                ON CONFLICT (id) DO NOTHING
              `;
            }

            // Inserting the items fires recalc_request, which stamps
            // updated_at = now(). Restore what the source recorded: this is an
            // audit field, and "when the backfill ran" is not an answer to
            // "when was this request last touched".
            if (r.updatedAt) {
              await sp`
                UPDATE stock_requests SET updated_at = ${new Date(r.updatedAt)}
                 WHERE id = ${id}
              `;
            }
          });
          stats.stockRequests++;
          stats.stockRequestItems += items.length;
          stats.stockRequestApprovals += history.length;
        } catch (err) {
          await reject(tx, stats, "stockrequests", r._id, "rejected_by_target", {
            requestNumber: r.requestNumber,
            error: err.message,
          });
        }
      }
    });

    log(`  ✓ company ${String(oldCompanyId)} migrated`);
  }
}

/**
 * Runs the backfill and returns its stats.
 *
 * Exported so it can be tested: this is the script that decides whether real
 * books move, and until there was a test for it a change to the database role
 * broke it silently.
 */
export async function backfill({
  mongoUri,
  databaseUrl,
  onlyCompany = null,
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
  const stats = newStats();

  try {
    await run({ mongo, sql, stats, onlyCompany, log });
    return stats;
  } finally {
    await mongo.close();
    await sql.end();
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isCli =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  const i = process.argv.indexOf("--company");
  try {
    const stats = await backfill({
      onlyCompany: i > -1 ? process.argv[i + 1] : null,
      log: (m) => console.log(m),
    });
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
  }
}
