import { and, asc, desc, eq, sql } from "drizzle-orm";
import { anyOf, isUuid, likeContains, toDate } from "./sqlHelpers";
import type { Tx } from "../client";
import {
  assets,
  assetDepreciationSchedule,
  assetTransfers,
  assetImpairments,
  assetUsageReadings,
  assetDocuments,
  assetJournalEntries,
} from "../schema/assets";
import { createJournalEntry, reverseJournalEntry } from "./journal";

/**
 * Fixed assets (0056) — the register, and the three entries it raises.
 *
 *   postDepreciation   DR Depreciation Expense       CR Accumulated Depreciation
 *   impairAsset        DR Impairment Loss            CR Accumulated Depreciation
 *   disposeAsset       DR Bank (proceeds)            CR Fixed Asset (cost)
 *                      DR Accumulated Depreciation   CR Gain on disposal
 *                      DR Loss on disposal
 *
 * All three went into the Mongo ledger while every ledger screen read Postgres.
 *
 * Acquisition raises nothing, here or there: the bill posted DR Fixed Asset /
 * CR Accounts Payable when it was approved, and capitalising it into the
 * register is a bookkeeping record, not a second entry.
 *
 * Accounts are passed in — the same division bills, claims and goods receipts
 * draw. The action layer owns "which account is Depreciation Expense for this
 * tenant"; this owns what gets posted to it.
 */

export type MoneyString = string;

/** Mongo rounds depreciation to whole shillings. See decision 5 in 0056. */
const roundKes = (n: number) => Math.round(n);
const money = (n: number) => n.toFixed(4);

export interface ScheduleRow {
  period: string;
  year: number;
  month: number;
  depreciationAmount: string;
  accumulatedDepreciation: string;
  bookValue: string;
}

export interface ScheduleInput {
  acquisitionCost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  depreciationMethod: "straight_line" | "reducing_balance" | "none";
  depreciationRate: number;
  depreciationStartDate: string;
  depreciationConvention: "full_month" | "pro_rata";
}

/**
 * The depreciation schedule, one row per month.
 *
 * Transcribed from `asset.js:387` (`generateSchedule`) without changing the
 * arithmetic — including `Math.round` to whole shillings, and including the
 * true-up that forces the final month to the exact remaining depreciable
 * amount so the schedule always sums to `cost - salvage` however the rounding
 * fell. Reconciliation against the old behaviour is the test (§ rule 2).
 *
 * Pro rata charges the days actually held in the first month and bleeds the
 * remainder into an extra final month, which is why `totalMonths` can be
 * `usefulLifeMonths + 1`.
 */
export function buildSchedule(input: ScheduleInput): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  if (input.depreciationMethod === "none" || input.usefulLifeMonths === 0) {
    return rows;
  }

  const depreciable = input.acquisitionCost - (input.salvageValue || 0);
  const start = new Date(`${input.depreciationStartDate}T00:00:00Z`);
  let month = start.getUTCMonth() + 1;
  let year = start.getUTCFullYear();
  let accumulated = 0;

  const push = (amount: number, bookValue: number) => {
    rows.push({
      period: `${year}-${String(month).padStart(2, "0")}`,
      year,
      month,
      depreciationAmount: money(amount),
      accumulatedDepreciation: money(accumulated),
      bookValue: money(bookValue),
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  };

  if (input.depreciationMethod === "straight_line") {
    let firstFraction = 1;
    if (input.depreciationConvention === "pro_rata") {
      const startDay = start.getUTCDate();
      const daysInStartMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (startDay > 1 && daysInStartMonth > 0) {
        firstFraction = (daysInStartMonth - startDay + 1) / daysInStartMonth;
      }
    }
    const needsExtraMonth = firstFraction < 1;
    const totalMonths = input.usefulLifeMonths + (needsExtraMonth ? 1 : 0);
    const monthlyRaw = depreciable / input.usefulLifeMonths;
    const fullMonth = roundKes(monthlyRaw);

    for (let i = 0; i < totalMonths; i++) {
      let amount: number;
      if (i === totalMonths - 1) {
        // Always true the last month up to the exact depreciable amount.
        amount = depreciable - accumulated;
      } else if (i === 0 && firstFraction < 1) {
        amount = roundKes(monthlyRaw * firstFraction);
      } else {
        amount = fullMonth;
      }
      if (amount < 0) amount = 0;
      if (accumulated + amount > depreciable) amount = depreciable - accumulated;

      accumulated += amount;
      push(
        amount,
        Math.max(input.salvageValue || 0, input.acquisitionCost - accumulated),
      );
    }
    return rows;
  }

  // Reducing balance.
  //
  // DELIBERATE CORRECTION TO MONGO. `asset.js` uses `depreciationRate / 12`,
  // which compounds to LESS than the stated annual rate — a 25% asset loses
  // 22.33% in its first year, a 37.5% one loses 31.68%. These rates are the
  // KRA wear-and-tear classes, and KRA computes wear-and-tear annually on the
  // reducing balance, so book depreciation was running about 11% under the tax
  // computation it is named after.
  //
  // The monthly rate that actually compounds to `r` over twelve months is
  // 1 - (1 - r)^(1/12). See 0056.
  let remaining = input.acquisitionCost;
  const monthlyRate = 1 - Math.pow(1 - input.depreciationRate, 1 / 12);
  for (let i = 0; i < input.usefulLifeMonths; i++) {
    let amount = roundKes(remaining * monthlyRate);
    if (remaining - amount < (input.salvageValue || 0)) {
      amount = Math.max(0, remaining - (input.salvageValue || 0));
    }
    if (amount <= 0) break;
    accumulated += amount;
    remaining -= amount;
    push(amount, remaining);
  }
  return rows;
}

/**
 * Revises the REMAINING schedule after an impairment.
 *
 * `asset.js:508` (`applyImpairment`) — IFRS revised carrying amount: the new
 * book value less salvage, spread over the months still pending, on the same
 * horizon. Posted months are not touched, which is a filter there and a
 * trigger here.
 */
export function reviseSchedule(input: {
  pendingCount: number;
  bookValue: number;
  salvageValue: number;
  accumulatedDepreciation: number;
  depreciationMethod: "straight_line" | "reducing_balance" | "none";
  depreciationRate: number;
}): Array<{ depreciationAmount: string; accumulatedDepreciation: string; bookValue: string; skip: boolean }> {
  const out: Array<{
    depreciationAmount: string;
    accumulatedDepreciation: string;
    bookValue: string;
    skip: boolean;
  }> = [];

  const newDepreciable = Math.max(0, input.bookValue - (input.salvageValue || 0));
  if (input.pendingCount === 0 || newDepreciable === 0) {
    for (let i = 0; i < input.pendingCount; i++) {
      out.push({
        depreciationAmount: money(0),
        accumulatedDepreciation: money(input.accumulatedDepreciation),
        bookValue: money(input.bookValue),
        skip: true,
      });
    }
    return out;
  }

  if (input.depreciationMethod === "straight_line") {
    const newMonthly = roundKes(newDepreciable / input.pendingCount);
    let acc = input.accumulatedDepreciation;
    let bv = input.bookValue;
    let distributed = 0;
    for (let i = 0; i < input.pendingCount; i++) {
      const isLast = i === input.pendingCount - 1;
      let amount = isLast ? newDepreciable - distributed : newMonthly;
      if (amount < 0) amount = 0;
      distributed += amount;
      acc += amount;
      bv -= amount;
      out.push({
        depreciationAmount: money(amount),
        accumulatedDepreciation: money(acc),
        bookValue: money(Math.max(input.salvageValue || 0, bv)),
        skip: false,
      });
    }
    return out;
  }

  let bv = input.bookValue;
  let acc = input.accumulatedDepreciation;
  // Same correction as buildSchedule — see there.
  const monthlyRate = 1 - Math.pow(1 - input.depreciationRate, 1 / 12);
  for (let i = 0; i < input.pendingCount; i++) {
    let amount = roundKes(bv * monthlyRate);
    if (bv - amount < (input.salvageValue || 0)) {
      amount = Math.max(0, bv - (input.salvageValue || 0));
    }
    acc += amount;
    bv -= amount;
    out.push({
      depreciationAmount: money(amount),
      accumulatedDepreciation: money(acc),
      bookValue: money(bv),
      skip: amount === 0,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

const ASSET_SELECT = sql`
  a.id, a.company_id, a.asset_number, a.name, a.description, a.category,
  a.status, a.serial_number, a.model, a.manufacturer, a.registration_number,
  a.location, a.department, a.assigned_to_party_id,
  a.acquisition_date, a.acquisition_cost, a.currency,
  a.source_type, a.source_id, a.source_reference,
  a.depreciation_method, a.useful_life_months, a.salvage_value,
  a.depreciation_rate, a.depreciation_start_date, a.depreciation_convention,
  a.kra_class,
  a.asset_account_id, a.accumulated_depreciation_account_id,
  a.depreciation_expense_account_id,
  a.disposed_at, a.disposed_by_name, a.disposal_method, a.disposal_amount,
  a.disposal_notes, a.usage_unit, a.photo_url,
  a.insurance_provider, a.insurance_policy_number, a.insurance_expiry_date,
  a.insurance_premium, a.inspection_last_date, a.inspection_next_due_date,
  a.notes, a.created_by_id, a.created_by_name, a.created_at, a.updated_at,
  s.accumulated_depreciation, s.book_value, s.posted_depreciation,
  s.impairment_total, s.pending_depreciation, s.periods_posted,
  s.periods_pending, s.periods_missed, s.last_posted_period,
  s.next_pending_period, s.current_usage, s.last_reading_at,
  p.name AS assigned_to_name
`;

const ASSET_FROM = sql`
  FROM assets a
  JOIN asset_state s ON s.asset_id = a.id
  LEFT JOIN parties p ON p.id = a.assigned_to_party_id
`;

export type Asset = ReturnType<typeof mapAsset>;

function mapAsset(r: Record<string, unknown>) {
  const s = (k: string) => (r[k] as string) ?? null;
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    _id: String(r.id),
    id: String(r.id),
    companyId: String(r.company_id),
    assetNumber: String(r.asset_number),
    name: String(r.name),
    description: s("description"),
    category: String(r.category),
    status: String(r.status),
    serialNumber: s("serial_number"),
    model: s("model"),
    manufacturer: s("manufacturer"),
    registrationNumber: s("registration_number"),
    location: s("location"),
    department: s("department"),
    assignedToPartyId: s("assigned_to_party_id"),
    assignedToName: s("assigned_to_name"),
    acquisitionDate: s("acquisition_date"),
    acquisitionCost: n("acquisition_cost"),
    currency: String(r.currency),
    sourceType: String(r.source_type),
    sourceId: s("source_id"),
    sourceReference: s("source_reference"),
    depreciationMethod: String(r.depreciation_method),
    usefulLifeMonths: n("useful_life_months"),
    salvageValue: n("salvage_value"),
    depreciationRate: n("depreciation_rate"),
    depreciationStartDate: s("depreciation_start_date"),
    depreciationConvention: String(r.depreciation_convention),
    kraClass: String(r.kra_class),
    /** The detail page reads these nested, as the Mongo document had them. */
    glMapping: {
      assetAccount: s("asset_account_id"),
      accumulatedDepreciationAccount: s("accumulated_depreciation_account_id"),
      depreciationExpenseAccount: s("depreciation_expense_account_id"),
    },
    disposedAt: toDate(r.disposed_at),
    disposedBy: r.disposed_by_name ? { name: s("disposed_by_name") } : null,
    disposalMethod: s("disposal_method"),
    disposalAmount: n("disposal_amount"),
    disposalNotes: s("disposal_notes"),
    usageUnit: String(r.usage_unit),
    photoUrl: s("photo_url"),
    insurance: {
      provider: s("insurance_provider"),
      policyNumber: s("insurance_policy_number"),
      expiryDate: s("insurance_expiry_date"),
      premium: r.insurance_premium != null ? n("insurance_premium") : null,
    },
    inspection: {
      lastDate: s("inspection_last_date"),
      nextDueDate: s("inspection_next_due_date"),
    },
    notes: s("notes"),
    createdById: s("created_by_id"),
    createdBy: r.created_by_name ? { name: s("created_by_name") } : null,
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),

    /**
     * Derived — see `asset_state`. In Mongo these were stored columns set from
     * the schedule ROW being posted, so an asset could claim depreciation the
     * ledger had never seen.
     */
    accumulatedDepreciation: n("accumulated_depreciation"),
    bookValue: n("book_value"),
    postedDepreciation: n("posted_depreciation"),
    impairmentTotal: n("impairment_total"),
    pendingDepreciation: n("pending_depreciation"),
    periodsPosted: n("periods_posted"),
    periodsPending: n("periods_pending"),
    /** Months still pending that are OLDER than one already posted. */
    periodsMissed: n("periods_missed"),
    lastPostedPeriod: s("last_posted_period"),
    nextPendingPeriod: s("next_pending_period"),
    currentUsage: r.current_usage != null ? n("current_usage") : 0,
    lastReadingAt: toDate(r.last_reading_at),
  };
}

export async function getAsset(tx: Tx, assetId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(assetId)) return null;
  const rows = (await tx.execute(sql`
    SELECT ${ASSET_SELECT} ${ASSET_FROM} WHERE a.id = ${assetId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.length ? mapAsset(rows[0]) : null;
}

export interface ListAssetsOptions {
  status?: string | string[];
  category?: string;
  search?: string;
  assignedToPartyId?: string;
  limit?: number;
  offset?: number;
}

/** No `company_id` filter, and none is needed — RLS. The limit is clamped. */
export async function listAssets(tx: Tx, opts: ListAssetsOptions = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const statuses =
    typeof opts.status === "string" ? [opts.status] : (opts.status ?? []);

  const where = sql`WHERE TRUE
    ${statuses.length ? sql`AND a.status = ${anyOf(statuses, "asset_status[]")}` : sql``}
    ${opts.category ? sql`AND a.category = ${opts.category}::asset_category` : sql``}
    ${opts.assignedToPartyId ? sql`AND a.assigned_to_party_id = ${opts.assignedToPartyId}::uuid` : sql``}
    ${
      opts.search
        ? sql`AND (a.asset_number ILIKE ${likeContains(opts.search)}
                OR a.name ILIKE ${likeContains(opts.search)}
                OR a.serial_number ILIKE ${likeContains(opts.search)}
                OR a.registration_number ILIKE ${likeContains(opts.search)})`
        : sql``
    }`;

  const rows = (await tx.execute(sql`
    SELECT ${ASSET_SELECT} ${ASSET_FROM} ${where}
     ORDER BY a.asset_number
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;

  const totals = (await tx.execute(sql`
    SELECT COUNT(*)::int AS total ${ASSET_FROM} ${where}
  `)) as unknown as Array<{ total: number }>;

  return { assets: rows.map(mapAsset), total: totals[0]?.total ?? 0 };
}

export async function listSchedule(tx: Tx, assetId: string) {
  const rows = (await tx.execute(sql`
    SELECT s.*, j.entry_number
      FROM asset_depreciation_schedule s
      LEFT JOIN journal_entries j ON j.id = s.journal_entry_id
     WHERE s.asset_id = ${assetId}::uuid
     ORDER BY s.year, s.month
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    _id: String(r.id),
    period: String(r.period),
    year: Number(r.year),
    month: Number(r.month),
    depreciationAmount: Number(r.depreciation_amount),
    accumulatedDepreciation: Number(r.accumulated_depreciation),
    bookValue: Number(r.book_value),
    status: String(r.status),
    journalEntryId: (r.journal_entry_id as string) ?? null,
    entryNumber: (r.entry_number as string) ?? null,
    postedAt: toDate(r.posted_at),
  }));
}

/** The detail page: the asset and everything hanging off it. */
export async function getAssetDetail(tx: Tx, assetId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(assetId)) return null;
  const asset = await getAsset(tx, assetId);
  if (!asset) return null;

  const schedule = await listSchedule(tx, assetId);

  const transfers = await tx
    .select()
    .from(assetTransfers)
    .where(eq(assetTransfers.assetId, assetId))
    .orderBy(desc(assetTransfers.transferredAt));

  const impairments = await tx
    .select()
    .from(assetImpairments)
    .where(eq(assetImpairments.assetId, assetId))
    .orderBy(desc(assetImpairments.impairedAt));

  const usageReadings = await tx
    .select()
    .from(assetUsageReadings)
    .where(eq(assetUsageReadings.assetId, assetId))
    .orderBy(desc(assetUsageReadings.recordedAt))
    .limit(50);

  const documents = await tx
    .select()
    .from(assetDocuments)
    .where(eq(assetDocuments.assetId, assetId))
    .orderBy(asc(assetDocuments.uploadedAt));

  return {
    ...asset,
    depreciationSchedule: schedule,
    transfers,
    impairments,
    usageReadings,
    documents,
  };
}

/** The header strip: totals by status, in one pass. */
export async function getAssetTotals(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT COUNT(*)::int                                              AS count,
           COUNT(*) FILTER (WHERE status = 'active')::int             AS active,
           COUNT(*) FILTER (WHERE status = 'disposed')::int           AS disposed,
           COALESCE(SUM(acquisition_cost), 0)::float8                 AS total_cost,
           COALESCE(SUM(accumulated_depreciation), 0)::float8         AS total_depreciation,
           COALESCE(SUM(book_value) FILTER (
             WHERE status NOT IN ('disposed', 'written_off')
           ), 0)::float8                                              AS total_book_value,
           -- Months anybody has skipped. Non-zero means the register and the
           -- ledger are about to disagree; in Mongo nothing could see this.
           COALESCE(SUM(periods_missed), 0)::int                      AS periods_missed
      FROM asset_state
  `)) as unknown as Array<Record<string, unknown>>;

  const r = rows[0] ?? {};
  return {
    count: Number(r.count ?? 0),
    active: Number(r.active ?? 0),
    disposed: Number(r.disposed ?? 0),
    totalCost: Number(r.total_cost ?? 0),
    totalDepreciation: Number(r.total_depreciation ?? 0),
    totalBookValue: Number(r.total_book_value ?? 0),
    periodsMissed: Number(r.periods_missed ?? 0),
  };
}

/** Assets with a pending schedule row for this period. */
export async function listPendingDepreciation(tx: Tx, period: string) {
  const rows = (await tx.execute(sql`
    SELECT ${ASSET_SELECT} ${ASSET_FROM}
     WHERE a.status = 'active'
       AND EXISTS (
         SELECT 1 FROM asset_depreciation_schedule s2
          WHERE s2.asset_id = a.id AND s2.period = ${period} AND s2.status = 'pending'
       )
     ORDER BY a.asset_number
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(mapAsset);
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

async function nextAssetNumber(tx: Tx, companyId: string) {
  const [{ asset_number }] = (await tx.execute(
    sql`SELECT next_entry_number(
      ${companyId}::uuid,
      document_prefix(${companyId}::uuid, 'asset')
    ) AS asset_number`,
  )) as unknown as Array<{ asset_number: string }>;
  return asset_number;
}

async function linkEntry(
  tx: Tx,
  input: {
    companyId: string;
    assetId: string;
    journalEntryId: string;
    purpose: "depreciation" | "impairment" | "disposal";
    period?: string | null;
  },
) {
  await tx.insert(assetJournalEntries).values({
    companyId: input.companyId,
    assetId: input.assetId,
    journalEntryId: input.journalEntryId,
    purpose: input.purpose,
    period: input.period ?? null,
  });
}

export interface CreateAssetInput {
  companyId: string;
  name: string;
  category: string;
  acquisitionDate: string;
  acquisitionCost: MoneyString;
  depreciationStartDate?: string | null;
  depreciationMethod?: "straight_line" | "reducing_balance" | "none";
  usefulLifeMonths?: number;
  salvageValue?: MoneyString;
  depreciationRate?: MoneyString;
  depreciationConvention?: "full_month" | "pro_rata";
  kraClass?: string;
  description?: string | null;
  serialNumber?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  registrationNumber?: string | null;
  location?: string | null;
  department?: string | null;
  assignedToPartyId?: string | null;
  currency?: string;
  usageUnit?: "km" | "miles" | "hours";
  sourceType?: "bill" | "journal" | "manual";
  sourceId?: string | null;
  sourceReference?: string | null;
  assetAccountId?: string | null;
  accumulatedDepreciationAccountId?: string | null;
  depreciationExpenseAccountId?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
}

/**
 * Registers an asset and lays out its depreciation schedule.
 *
 * Posts NOTHING. The bill this was capitalised from already posted DR Fixed
 * Asset / CR Accounts Payable when it was approved; raising a second entry
 * here would double the asset on the balance sheet.
 */
export async function createAsset(tx: Tx, input: CreateAssetInput) {
  const assetNumber = await nextAssetNumber(tx, input.companyId);
  const acquisitionDate = input.acquisitionDate;
  const startDate = input.depreciationStartDate || acquisitionDate;

  const [asset] = await tx
    .insert(assets)
    .values({
      companyId: input.companyId,
      assetNumber,
      name: input.name,
      description: input.description ?? null,
      category: input.category as never,
      serialNumber: input.serialNumber ?? null,
      model: input.model ?? null,
      manufacturer: input.manufacturer ?? null,
      registrationNumber: input.registrationNumber ?? null,
      location: input.location ?? null,
      department: input.department ?? null,
      assignedToPartyId: input.assignedToPartyId ?? null,
      acquisitionDate,
      acquisitionCost: input.acquisitionCost,
      currency: input.currency ?? "KES",
      sourceType: input.sourceType ?? "manual",
      sourceId: input.sourceId ?? null,
      sourceReference: input.sourceReference ?? null,
      depreciationMethod: (input.depreciationMethod ?? "straight_line") as never,
      usefulLifeMonths: input.usefulLifeMonths ?? 60,
      salvageValue: input.salvageValue ?? "0",
      depreciationRate: input.depreciationRate ?? "0",
      depreciationStartDate: startDate,
      depreciationConvention: (input.depreciationConvention ??
        "full_month") as never,
      kraClass: (input.kraClass ?? "none") as never,
      assetAccountId: input.assetAccountId ?? null,
      accumulatedDepreciationAccountId:
        input.accumulatedDepreciationAccountId ?? null,
      depreciationExpenseAccountId: input.depreciationExpenseAccountId ?? null,
      usageUnit: (input.usageUnit ?? "km") as never,
      photoUrl: input.photoUrl ?? null,
      notes: input.notes ?? null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
    })
    .returning();

  await regenerateSchedule(tx, asset.id);
  return asset;
}

/**
 * Lays out (or re-lays) the schedule from the asset's current terms.
 *
 * Refuses once anything has been posted: a schedule with history in it is
 * revised by `applyImpairment`, never rebuilt, because rebuilding would move
 * months the ledger has already seen.
 */
export async function regenerateSchedule(tx: Tx, assetId: string) {
  const [a] = (await tx.execute(sql`
    SELECT acquisition_cost, salvage_value, useful_life_months,
           depreciation_method::text AS depreciation_method,
           depreciation_rate, depreciation_start_date::text AS start_date,
           depreciation_convention::text AS convention, company_id
      FROM assets WHERE id = ${assetId}::uuid
  `)) as unknown as Array<Record<string, string>>;
  if (!a) throw new Error("Asset not found");

  const [{ posted }] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS posted FROM asset_depreciation_schedule
     WHERE asset_id = ${assetId}::uuid AND status = 'posted'
  `)) as unknown as Array<{ posted: number }>;
  if (posted > 0) {
    throw new Error(
      "This asset already has depreciation posted; its schedule can no longer be rebuilt.",
    );
  }

  await tx
    .delete(assetDepreciationSchedule)
    .where(eq(assetDepreciationSchedule.assetId, assetId));

  const rows = buildSchedule({
    acquisitionCost: Number(a.acquisition_cost),
    salvageValue: Number(a.salvage_value),
    usefulLifeMonths: Number(a.useful_life_months),
    depreciationMethod: a.depreciation_method as ScheduleInput["depreciationMethod"],
    depreciationRate: Number(a.depreciation_rate),
    depreciationStartDate: a.start_date,
    depreciationConvention:
      a.convention as ScheduleInput["depreciationConvention"],
  });

  if (!rows.length) return [];

  await tx.insert(assetDepreciationSchedule).values(
    rows.map((r) => ({
      companyId: a.company_id,
      assetId,
      period: r.period,
      year: r.year,
      month: r.month,
      depreciationAmount: r.depreciationAmount,
      accumulatedDepreciation: r.accumulatedDepreciation,
      bookValue: r.bookValue,
    })),
  );
  return rows;
}

export interface DepreciationAccounts {
  depreciationExpenseAccountId: string;
  accumulatedDepreciationAccountId: string;
}

/**
 * Posts one asset's depreciation for one period.
 *
 *   DR Depreciation Expense
 *   CR Accumulated Depreciation
 *
 * The entry is dated the last day of the period, as Mongo dates it.
 */
export async function postDepreciationForAsset(
  tx: Tx,
  assetId: string,
  period: string,
  accounts: DepreciationAccounts,
  by: { id?: string | null; name?: string | null },
) {
  const asset = await getAsset(tx, assetId);
  if (!asset) throw new Error("Asset not found");

  const [row] = (await tx.execute(sql`
    SELECT id, depreciation_amount FROM asset_depreciation_schedule
     WHERE asset_id = ${assetId}::uuid AND period = ${period} AND status = 'pending'
  `)) as unknown as Array<{ id: string; depreciation_amount: string }>;
  if (!row) return null;

  const amount = row.depreciation_amount;
  if (Number(amount) <= 0) {
    // Nothing to post; mark it done so the month does not sit pending forever.
    await tx.execute(sql`
      UPDATE asset_depreciation_schedule SET status = 'skipped'
       WHERE id = ${row.id}::uuid
    `);
    return null;
  }

  const [year, month] = period.split("-").map((v) => parseInt(v, 10));
  // Last day of the period, in UTC — `Date.UTC(y, m, 0)` is the 0th of the
  // NEXT month, which is the last of this one.
  const entryDate = new Date(Date.UTC(year, month, 0))
    .toISOString()
    .slice(0, 10);

  const entry = await createJournalEntry(tx, {
    companyId: asset.companyId,
    entryDate,
    entryType: "depreciation",
    description: `Monthly depreciation — ${asset.name} (${asset.assetNumber}) — ${period}`,
    reference: asset.assetNumber,
    sourceType: "fixed_asset",
    sourceId: asset.id,
    lines: [
      {
        accountId: accounts.depreciationExpenseAccountId,
        debit: amount,
        description: `Depreciation — ${asset.name} (${asset.assetNumber}) — ${period}`,
      },
      {
        accountId: accounts.accumulatedDepreciationAccountId,
        credit: amount,
        description: `Accumulated depreciation — ${asset.name} (${asset.assetNumber}) — ${period}`,
      },
    ],
    createdById: by.id ?? null,
    postImmediately: true,
  });

  await tx.execute(sql`
    UPDATE asset_depreciation_schedule
       SET status = 'posted', journal_entry_id = ${entry.id}::uuid, posted_at = now()
     WHERE id = ${row.id}::uuid
  `);

  await linkEntry(tx, {
    companyId: asset.companyId,
    assetId: asset.id,
    journalEntryId: entry.id,
    purpose: "depreciation",
    period,
  });

  return { entry, amount };
}

export interface ImpairmentAccounts {
  impairmentLossAccountId: string;
  accumulatedDepreciationAccountId: string;
}

/**
 * Writes an asset down, and revises what is left of its schedule.
 *
 *   DR Impairment Loss           (an expense)
 *   CR Accumulated Depreciation
 *
 * The remaining months are re-spread over the same horizon — IFRS revised
 * carrying amount, `asset.js:508`. Posted months are untouched, which was a
 * filter in JavaScript and is a trigger here.
 */
export async function impairAsset(
  tx: Tx,
  assetId: string,
  input: {
    amount: MoneyString;
    reason: string;
    impairedAt?: string | null;
    accounts: ImpairmentAccounts;
    by: { id?: string | null; name?: string | null };
  },
) {
  const asset = await getAsset(tx, assetId);
  if (!asset) throw new Error("Asset not found");
  if (asset.status === "disposed" || asset.status === "written_off") {
    throw new Error(
      `Asset ${asset.assetNumber} is ${asset.status}, so it cannot be impaired.`,
    );
  }

  const amount = Number(input.amount);
  if (amount <= 0) throw new Error("An impairment must be more than nothing.");
  if (amount > asset.bookValue - asset.salvageValue) {
    throw new Error(
      `An impairment of ${amount} would take ${asset.assetNumber} below its salvage value. Its book value is ${asset.bookValue}.`,
    );
  }

  const impairedAt = input.impairedAt
    ? new Date(input.impairedAt)
    : new Date();
  const description = `Impairment — ${asset.name} (${asset.assetNumber})`;

  const entry = await createJournalEntry(tx, {
    companyId: asset.companyId,
    entryDate: impairedAt.toISOString().slice(0, 10),
    entryType: "impairment",
    description,
    reference: asset.assetNumber,
    sourceType: "fixed_asset",
    sourceId: asset.id,
    lines: [
      {
        accountId: input.accounts.impairmentLossAccountId,
        debit: input.amount,
        description,
      },
      {
        accountId: input.accounts.accumulatedDepreciationAccountId,
        credit: input.amount,
        description,
      },
    ],
    createdById: input.by.id ?? null,
    postImmediately: true,
  });

  await tx.insert(assetImpairments).values({
    companyId: asset.companyId,
    assetId: asset.id,
    impairedAt,
    amount: input.amount,
    reason: input.reason,
    journalEntryId: entry.id,
    impairedById: input.by.id ?? null,
    impairedByName: input.by.name ?? null,
  });

  await linkEntry(tx, {
    companyId: asset.companyId,
    assetId: asset.id,
    journalEntryId: entry.id,
    purpose: "impairment",
  });

  // Re-spread what is left. Read AFTER the impairment row lands so the new
  // book value is the derived one, not one computed here.
  const pending = (await tx.execute(sql`
    SELECT id FROM asset_depreciation_schedule
     WHERE asset_id = ${assetId}::uuid AND status = 'pending'
     ORDER BY year, month
  `)) as unknown as Array<{ id: string }>;

  const after = await getAsset(tx, assetId);
  const revised = reviseSchedule({
    pendingCount: pending.length,
    bookValue: after!.bookValue,
    salvageValue: after!.salvageValue,
    accumulatedDepreciation: after!.accumulatedDepreciation,
    depreciationMethod: after!.depreciationMethod as ScheduleInput["depreciationMethod"],
    depreciationRate: after!.depreciationRate,
  });

  for (let i = 0; i < pending.length; i++) {
    const r = revised[i];
    await tx.execute(sql`
      UPDATE asset_depreciation_schedule
         SET depreciation_amount = ${r.depreciationAmount}::numeric,
             accumulated_depreciation = ${r.accumulatedDepreciation}::numeric,
             book_value = ${r.bookValue}::numeric,
             status = ${r.skip ? "skipped" : "pending"}::depreciation_period_status
       WHERE id = ${pending[i].id}::uuid
    `);
  }

  return { entry, asset: await getAsset(tx, assetId) };
}

export interface DisposalAccounts {
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  bankAccountId?: string | null;
  gainAccountId?: string | null;
  lossAccountId?: string | null;
}

/**
 * Retires an asset and clears it off the balance sheet.
 *
 *   DR Bank                      proceeds, where it was sold for something
 *   DR Accumulated Depreciation  the balance built up against it
 *   DR Loss on disposal          where the proceeds fell short of book value
 *   CR Fixed Asset               the original cost, in full
 *   CR Gain on disposal          where they exceeded it
 *
 * The gain or loss is proceeds less book value, and book value is derived —
 * so a disposal cannot be computed against depreciation the ledger never saw.
 * `asset_journal_entries_disposal_once` makes a second disposal impossible;
 * in Mongo the entry ids were an unconstrained array and a repeat would have
 * credited the asset cost twice.
 */
export async function disposeAsset(
  tx: Tx,
  assetId: string,
  input: {
    disposalMethod: "sold" | "scrapped" | "donated" | "lost" | "stolen";
    disposalAmount?: MoneyString;
    disposalDate?: string | null;
    notes?: string | null;
    accounts: DisposalAccounts;
    by: { id?: string | null; name?: string | null };
  },
) {
  const asset = await getAsset(tx, assetId);
  if (!asset) throw new Error("Asset not found");
  if (asset.status === "disposed" || asset.status === "written_off") {
    throw new Error(`Asset ${asset.assetNumber} has already been disposed of.`);
  }

  const proceeds =
    input.disposalMethod === "sold" ? Number(input.disposalAmount ?? 0) : 0;
  const cost = asset.acquisitionCost;
  const accumDep = asset.accumulatedDepreciation;
  const bookValue = asset.bookValue;
  const gainOrLoss = proceeds - bookValue;

  const disposalDate = input.disposalDate
    ? new Date(input.disposalDate)
    : new Date();
  const refLabel = `${asset.name} (${asset.assetNumber})`;

  const lines: Array<{
    accountId: string;
    debit?: string;
    credit?: string;
    description: string;
  }> = [];

  if (proceeds > 0) {
    if (!input.accounts.bankAccountId) {
      throw new Error(
        "A sale needs the account the proceeds were received into.",
      );
    }
    lines.push({
      accountId: input.accounts.bankAccountId,
      debit: proceeds.toFixed(4),
      description: `Proceeds from disposal — ${refLabel}`,
    });
  }
  if (accumDep > 0) {
    lines.push({
      accountId: input.accounts.accumulatedDepreciationAccountId,
      debit: accumDep.toFixed(4),
      description: `Remove accumulated depreciation — ${refLabel}`,
    });
  }
  if (gainOrLoss < 0) {
    if (!input.accounts.lossAccountId) {
      throw new Error("A disposal at a loss needs a loss-on-disposal account.");
    }
    lines.push({
      accountId: input.accounts.lossAccountId,
      debit: Math.abs(gainOrLoss).toFixed(4),
      description: `Loss on disposal — ${refLabel}`,
    });
  }
  if (cost > 0) {
    lines.push({
      accountId: input.accounts.assetAccountId,
      credit: cost.toFixed(4),
      description: `Dispose fixed asset cost — ${refLabel}`,
    });
  }
  if (gainOrLoss > 0) {
    if (!input.accounts.gainAccountId) {
      throw new Error("A disposal at a gain needs a gain-on-disposal account.");
    }
    lines.push({
      accountId: input.accounts.gainAccountId,
      credit: gainOrLoss.toFixed(4),
      description: `Gain on disposal — ${refLabel}`,
    });
  }

  if (lines.length < 2) {
    throw new Error(
      "There is nothing to post for this disposal — the asset has no cost, no depreciation and no proceeds.",
    );
  }

  const entry = await createJournalEntry(tx, {
    companyId: asset.companyId,
    entryDate: disposalDate.toISOString().slice(0, 10),
    entryType: "asset_disposal",
    description: `Asset disposal — ${refLabel} — ${input.disposalMethod}`,
    reference: asset.assetNumber,
    sourceType: "fixed_asset",
    sourceId: asset.id,
    lines,
    createdById: input.by.id ?? null,
    postImmediately: true,
  });

  await linkEntry(tx, {
    companyId: asset.companyId,
    assetId: asset.id,
    journalEntryId: entry.id,
    purpose: "disposal",
  });

  // Months after the disposal will never be charged; say so rather than
  // leaving them pending for a month-end run to trip over.
  await tx.execute(sql`
    UPDATE asset_depreciation_schedule
       SET status = 'skipped'
     WHERE asset_id = ${assetId}::uuid AND status = 'pending'
  `);

  const [updated] = await tx
    .update(assets)
    .set({
      status: "disposed",
      disposedAt: disposalDate,
      disposedById: input.by.id ?? null,
      disposedByName: input.by.name ?? null,
      disposalMethod: input.disposalMethod,
      disposalAmount: proceeds.toFixed(4),
      disposalNotes: input.notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, assetId))
    .returning();

  return { asset: updated, entry, gainOrLoss, bookValue, accumDep };
}

/** Location, department or custodian change. Append-only history. */
export async function transferAsset(
  tx: Tx,
  assetId: string,
  input: {
    toLocation?: string | null;
    toDepartment?: string | null;
    toAssignedToName?: string | null;
    toAssignedToPartyId?: string | null;
    transferredAt?: string | null;
    reason?: string | null;
    by: { id?: string | null; name?: string | null };
  },
) {
  const asset = await getAsset(tx, assetId);
  if (!asset) throw new Error("Asset not found");

  await tx.insert(assetTransfers).values({
    companyId: asset.companyId,
    assetId,
    transferredAt: input.transferredAt
      ? new Date(input.transferredAt)
      : new Date(),
    fromLocation: asset.location,
    toLocation: input.toLocation ?? asset.location,
    fromDepartment: asset.department,
    toDepartment: input.toDepartment ?? asset.department,
    fromAssignedToName: asset.assignedToName,
    toAssignedToName: input.toAssignedToName ?? asset.assignedToName,
    reason: input.reason ?? null,
    transferredById: input.by.id ?? null,
    transferredByName: input.by.name ?? null,
  });

  const [updated] = await tx
    .update(assets)
    .set({
      location: input.toLocation ?? asset.location,
      department: input.toDepartment ?? asset.department,
      assignedToPartyId:
        input.toAssignedToPartyId !== undefined
          ? input.toAssignedToPartyId
          : asset.assignedToPartyId,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, assetId))
    .returning();

  return updated;
}

/** An odometer or hours-meter reading. `current_usage` is derived from these. */
export async function recordUsageReading(
  tx: Tx,
  assetId: string,
  input: {
    reading: MoneyString;
    recordedAt?: string | null;
    source?: string | null;
    sourceKind?: string | null;
    sourceRefId?: string | null;
    notes?: string | null;
    by: { id?: string | null; name?: string | null };
  },
) {
  const asset = await getAsset(tx, assetId);
  if (!asset) throw new Error("Asset not found");

  const [row] = await tx
    .insert(assetUsageReadings)
    .values({
      companyId: asset.companyId,
      assetId,
      recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date(),
      reading: input.reading,
      unit: asset.usageUnit as never,
      source: input.source ?? "manual",
      sourceKind: input.sourceKind ?? null,
      sourceRefId: input.sourceRefId ?? null,
      notes: input.notes ?? null,
      recordedById: input.by.id ?? null,
      recordedByName: input.by.name ?? null,
    })
    .returning();

  return row;
}

export interface UpdateAssetInput {
  name?: string;
  description?: string | null;
  category?: string;
  status?: string;
  serialNumber?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  registrationNumber?: string | null;
  location?: string | null;
  department?: string | null;
  assignedToPartyId?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
  kraClass?: string;
  assetAccountId?: string | null;
  accumulatedDepreciationAccountId?: string | null;
  depreciationExpenseAccountId?: string | null;
  insuranceProvider?: string | null;
  insurancePolicyNumber?: string | null;
  insuranceExpiryDate?: string | null;
  insurancePremium?: MoneyString | null;
  inspectionLastDate?: string | null;
  inspectionNextDueDate?: string | null;
  /** Changing any of these re-lays the schedule — only while nothing is posted. */
  acquisitionCost?: MoneyString;
  salvageValue?: MoneyString;
  usefulLifeMonths?: number;
  depreciationMethod?: "straight_line" | "reducing_balance" | "none";
  depreciationRate?: MoneyString;
  depreciationStartDate?: string;
  depreciationConvention?: "full_month" | "pro_rata";
  lastModifiedById?: string | null;
  lastModifiedByName?: string | null;
}

/** Fields that change what the schedule looks like. */
const SCHEDULE_FIELDS = [
  "acquisitionCost",
  "salvageValue",
  "usefulLifeMonths",
  "depreciationMethod",
  "depreciationRate",
  "depreciationStartDate",
  "depreciationConvention",
] as const;

export async function updateAsset(
  tx: Tx,
  assetId: string,
  input: UpdateAssetInput,
) {
  const existing = await getAsset(tx, assetId);
  if (!existing) throw new Error("Asset not found");

  const touchesSchedule = SCHEDULE_FIELDS.some(
    (f) => input[f] !== undefined,
  );
  if (touchesSchedule && existing.periodsPosted > 0) {
    throw new Error(
      `Asset ${existing.assetNumber} already has depreciation posted, so its cost, life and method can no longer be changed. Impair it instead.`,
    );
  }

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    lastModifiedById: input.lastModifiedById ?? null,
    lastModifiedByName: input.lastModifiedByName ?? null,
  };
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === "lastModifiedById" || key === "lastModifiedByName") continue;
    patch[key] = value;
  }

  const [updated] = await tx
    .update(assets)
    .set(patch)
    .where(eq(assets.id, assetId))
    .returning();

  if (touchesSchedule) await regenerateSchedule(tx, assetId);
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The rollforward: opening, additions, depreciation, disposals, closing.
 *
 * Everything here is a sum over what actually happened — additions from the
 * acquisition date, depreciation from POSTED schedule rows, disposals from the
 * disposal date. Nothing reads a stored running total, so the report cannot
 * disagree with the ledger it is summarising.
 */
export async function getAssetRollforward(
  tx: Tx,
  opts: { startDate: string; endDate: string },
) {
  const rows = (await tx.execute(sql`
    WITH bounds AS (
      SELECT ${opts.startDate}::date AS start_date, ${opts.endDate}::date AS end_date
    ),
    dep AS (
      SELECT s.asset_id,
             SUM(s.depreciation_amount) FILTER (
               WHERE make_date(s.year, s.month, 1) < (SELECT start_date FROM bounds)
             )                                              AS dep_before,
             SUM(s.depreciation_amount) FILTER (
               WHERE make_date(s.year, s.month, 1)
                     BETWEEN (SELECT start_date FROM bounds) AND (SELECT end_date FROM bounds)
             )                                              AS dep_during
        FROM asset_depreciation_schedule s
       WHERE s.status = 'posted'
       GROUP BY s.asset_id
    ),
    imp AS (
      SELECT i.asset_id,
             SUM(i.amount) FILTER (WHERE i.impaired_at::date < (SELECT start_date FROM bounds)) AS imp_before,
             SUM(i.amount) FILTER (
               WHERE i.impaired_at::date BETWEEN (SELECT start_date FROM bounds) AND (SELECT end_date FROM bounds)
             )                                              AS imp_during
        FROM asset_impairments i
       GROUP BY i.asset_id
    )
    SELECT a.id, a.asset_number, a.name, a.category::text AS category,
           a.acquisition_date, a.acquisition_cost,
           a.status::text AS status, a.disposed_at,

           -- Cost brought forward: nil if it was acquired inside the window.
           (CASE WHEN a.acquisition_date < (SELECT start_date FROM bounds)
                 THEN a.acquisition_cost ELSE 0 END)::float8         AS opening_cost,
           (CASE WHEN a.acquisition_date BETWEEN (SELECT start_date FROM bounds)
                                             AND (SELECT end_date FROM bounds)
                 THEN a.acquisition_cost ELSE 0 END)::float8         AS additions,
           (CASE WHEN a.disposed_at IS NOT NULL
                  AND a.disposed_at::date BETWEEN (SELECT start_date FROM bounds)
                                              AND (SELECT end_date FROM bounds)
                 THEN a.acquisition_cost ELSE 0 END)::float8         AS disposals,

           COALESCE(dep.dep_before, 0)::float8 + COALESCE(imp.imp_before, 0)::float8
                                                                    AS opening_depreciation,
           COALESCE(dep.dep_during, 0)::float8                      AS depreciation_charge,
           COALESCE(imp.imp_during, 0)::float8                      AS impairment_charge
      FROM assets a
      LEFT JOIN dep ON dep.asset_id = a.id
      LEFT JOIN imp ON imp.asset_id = a.id
     WHERE a.acquisition_date <= (SELECT end_date FROM bounds)
     ORDER BY a.category, a.asset_number
  `)) as unknown as Array<Record<string, unknown>>;

  const mapped = rows.map((r) => {
    const n = (k: string) => Number(r[k] ?? 0);
    const openingCost = n("opening_cost");
    const additions = n("additions");
    const disposals = n("disposals");
    const openingDep = n("opening_depreciation");
    const charge = n("depreciation_charge") + n("impairment_charge");
    const closingCost = openingCost + additions - disposals;
    // Depreciation leaves with the asset it belonged to.
    const closingDep = disposals > 0 ? 0 : openingDep + charge;
    return {
      id: String(r.id),
      assetNumber: String(r.asset_number),
      name: String(r.name),
      category: String(r.category),
      status: String(r.status),
      acquisitionDate: String(r.acquisition_date),
      openingCost,
      additions,
      disposals,
      closingCost,
      openingDepreciation: openingDep,
      depreciationCharge: n("depreciation_charge"),
      impairmentCharge: n("impairment_charge"),
      closingDepreciation: closingDep,
      openingNetBookValue: openingCost - openingDep,
      closingNetBookValue: closingCost - closingDep,
    };
  });

  const totals = mapped.reduce(
    (t, r) => ({
      openingCost: t.openingCost + r.openingCost,
      additions: t.additions + r.additions,
      disposals: t.disposals + r.disposals,
      closingCost: t.closingCost + r.closingCost,
      openingDepreciation: t.openingDepreciation + r.openingDepreciation,
      depreciationCharge: t.depreciationCharge + r.depreciationCharge,
      impairmentCharge: t.impairmentCharge + r.impairmentCharge,
      closingDepreciation: t.closingDepreciation + r.closingDepreciation,
      openingNetBookValue: t.openingNetBookValue + r.openingNetBookValue,
      closingNetBookValue: t.closingNetBookValue + r.closingNetBookValue,
    }),
    {
      openingCost: 0, additions: 0, disposals: 0, closingCost: 0,
      openingDepreciation: 0, depreciationCharge: 0, impairmentCharge: 0,
      closingDepreciation: 0, openingNetBookValue: 0, closingNetBookValue: 0,
    },
  );

  return { rows: mapped, totals, period: opts };
}


/**
 * Undoes a posted month: reverses the entry, and returns the row to pending.
 *
 * Only the MOST RECENT posted period, as Mongo allows — cancelling an earlier
 * one would leave a hole in the middle of the schedule, which is the shape
 * decision 1 exists to prevent.
 *
 * The reversing entry stays in the ledger, so that period nets to zero there;
 * `asset_state` stops counting the row because it is no longer posted. Both
 * sides move together and neither is rewritten.
 */
export async function cancelDepreciationPosting(
  tx: Tx,
  assetId: string,
  period: string,
  input: { reason?: string | null; by: { id?: string | null; name?: string | null } },
) {
  const asset = await getAsset(tx, assetId);
  if (!asset) throw new Error("Asset not found");

  const posted = (await tx.execute(sql`
    SELECT id, period, journal_entry_id FROM asset_depreciation_schedule
     WHERE asset_id = ${assetId}::uuid AND status = 'posted'
     ORDER BY year DESC, month DESC
  `)) as unknown as Array<{ id: string; period: string; journal_entry_id: string }>;

  if (!posted.length) {
    throw new Error("No posted depreciation entries exist for this asset");
  }
  if (posted[0].period !== period) {
    throw new Error(
      `Can only cancel the most recent posted period. The most recent is ${posted[0].period}.`,
    );
  }

  const target = posted[0];
  const reversal = await reverseJournalEntry(
    tx,
    target.journal_entry_id,
    input.by.id ?? "system",
    input.reason || `Cancel depreciation for ${period}`,
  );

  await tx.execute(sql`
    UPDATE asset_depreciation_schedule
       SET status = 'pending', journal_entry_id = NULL, posted_at = NULL
     WHERE id = ${target.id}::uuid
  `);

  // The link row named an entry that is now reversed; the reversal is the
  // record, and the period may be posted again.
  await tx.execute(sql`
    DELETE FROM asset_journal_entries
     WHERE asset_id = ${assetId}::uuid
       AND journal_entry_id = ${target.journal_entry_id}::uuid
  `);

  return { reversal, asset: await getAsset(tx, assetId) };
}

/**
 * What has been spent ON this asset, from the bills side.
 *
 * Bill lines carry `asset_id` — a tag put there when the bill was entered, so
 * fuel, servicing and repairs can be attributed to the vehicle they were for.
 * The expenses half of this lives in Mongo until expenses move; the caller
 * merges them.
 */
export async function listAssetBillCosts(tx: Tx, assetId: string) {
  const rows = (await tx.execute(sql`
    SELECT b.id            AS bill_id,
           b.bill_number,
           b.bill_date::text AS bill_date,
           b.status::text   AS bill_status,
           b.payment_status::text AS payment_status,
           b.supplier_name_at_bill AS supplier_name,
           l.description    AS line_description,
           l.line_total,
           a.account_code, a.account_name
      FROM bill_lines l
      JOIN bills b    ON b.id = l.bill_id
      LEFT JOIN accounts a ON a.id = l.account_id
     WHERE l.asset_id = ${String(assetId)}
       AND b.status <> 'cancelled'
     ORDER BY b.bill_date DESC
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const amount = Number(r.line_total ?? 0);
    return {
      source: "bill" as const,
      billId: String(r.bill_id),
      billNumber: String(r.bill_number),
      billDate: (r.bill_date as string) ?? null,
      billStatus: String(r.bill_status),
      paymentStatus: (r.payment_status as string) ?? null,
      supplierName: (r.supplier_name as string) ?? "—",
      lineDescription: (r.line_description as string) ?? "",
      accountName: (r.account_name as string) ?? "",
      accountCode: (r.account_code as string) ?? "",
      amount,
      lineTotal: amount,
    };
  });
}

/**
 * Fleet analytics: every in-service asset with its readings inside a window.
 *
 * The Mongo version is one aggregation with a `$filter` over the embedded
 * `usageReadings` array, projecting only the readings in range to keep the
 * payload small for an asset with hundreds of them. Here the readings are
 * rows, so it is a join with a WHERE — and only the two that matter (the
 * first and last in the window) are needed to derive distance, so that is all
 * this returns.
 */
export async function listFleetUsage(
  tx: Tx,
  opts: { category?: string; since: string; until: string },
) {
  const rows = (await tx.execute(sql`
    WITH win AS (
      SELECT r.asset_id,
             MIN(r.reading) FILTER (WHERE r.rn_first = 1) AS first_reading,
             MIN(r.reading) FILTER (WHERE r.rn_last = 1)  AS last_reading,
             COUNT(*)::integer                            AS reading_count
        FROM (
          SELECT ur.asset_id, ur.reading,
                 ROW_NUMBER() OVER (PARTITION BY ur.asset_id ORDER BY ur.recorded_at ASC,  ur.id ASC)  AS rn_first,
                 ROW_NUMBER() OVER (PARTITION BY ur.asset_id ORDER BY ur.recorded_at DESC, ur.id DESC) AS rn_last
            FROM asset_usage_readings ur
           WHERE ur.recorded_at >= ${opts.since}::timestamptz
             AND ur.recorded_at <= ${opts.until}::timestamptz
        ) r
       GROUP BY r.asset_id
    )
    SELECT a.id, a.asset_number, a.name, a.category::text AS category,
           a.status::text AS status, a.registration_number, a.usage_unit::text AS usage_unit,
           s.book_value, a.acquisition_cost, s.current_usage, s.last_reading_at,
           w.first_reading, w.last_reading, COALESCE(w.reading_count, 0) AS reading_count
      FROM assets a
      JOIN asset_state s ON s.asset_id = a.id
      LEFT JOIN win w ON w.asset_id = a.id
     WHERE a.status IN ('active', 'idle', 'in_maintenance')
       ${opts.category ? sql`AND a.category = ${opts.category}::asset_category` : sql``}
     ORDER BY a.asset_number
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const first = r.first_reading != null ? Number(r.first_reading) : null;
    const last = r.last_reading != null ? Number(r.last_reading) : null;
    return {
      _id: String(r.id),
      id: String(r.id),
      assetNumber: String(r.asset_number),
      name: String(r.name),
      category: String(r.category),
      status: String(r.status),
      registrationNumber: (r.registration_number as string) ?? null,
      usageUnit: String(r.usage_unit),
      bookValue: Number(r.book_value ?? 0),
      acquisitionCost: Number(r.acquisition_cost ?? 0),
      currentUsage: r.current_usage != null ? Number(r.current_usage) : 0,
      lastReadingAt: toDate(r.last_reading_at),
      readingCount: Number(r.reading_count ?? 0),
      /** Distance covered inside the window, not the odometer figure. */
      windowDistance:
        first != null && last != null && last > first ? last - first : null,
    };
  });
}

export async function countFleetAssets(tx: Tx, category?: string) {
  const rows = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM assets
     WHERE status IN ('active', 'idle', 'in_maintenance')
       ${category ? sql`AND category = ${category}::asset_category` : sql``}
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/** Spend per asset from the bills side, inside a window. */
export async function sumAssetBillCosts(
  tx: Tx,
  opts: { assetIds: string[]; since: string; until: string },
) {
  if (!opts.assetIds.length) return new Map<string, number>();
  const rows = (await tx.execute(sql`
    SELECT l.asset_id, SUM(l.line_total)::float8 AS total
      FROM bill_lines l
      JOIN bills b ON b.id = l.bill_id
     WHERE l.asset_id = ${anyOf(opts.assetIds, "text[]")}
       AND b.status <> 'cancelled'
       AND b.bill_date BETWEEN ${opts.since}::date AND ${opts.until}::date
     GROUP BY l.asset_id
  `)) as unknown as Array<{ asset_id: string; total: number }>;

  return new Map(rows.map((r) => [String(r.asset_id), Number(r.total ?? 0)]));
}
