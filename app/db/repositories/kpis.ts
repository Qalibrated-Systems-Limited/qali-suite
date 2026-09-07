import { sql } from "drizzle-orm";
import { isUuid, anyOf } from "./sqlHelpers";
import type { Tx } from "../client";

/**
 * KPIs — 0097. Definitions, snapshots, and the nine formulas that fill them in.
 *
 * Contract with the layer above: every function takes a `tx` from
 * withTenant(), so RLS is active; nothing here reads the session or checks a
 * permission. MONEY COMES OUT AS A NUMBER, because the Mongo queries returned
 * numbers and the KPI screens do arithmetic on them — percentages against
 * target, deltas against the prior period — before rendering.
 *
 * ── WHY THIS IS NOT A TRANSCRIPTION ────────────────────────────────────────
 *
 * The nine auto formulas read the ledger, payroll, invoices and the employee
 * register. All four of those moved to Postgres, and the formulas did not:
 * `computeMonthlyRevenue` has been aggregating a Mongo JournalEntry collection
 * that stopped receiving entries, and returning 0 — which the board then paints
 * red against target and reports as the state of the business.
 *
 * So each formula is re-derived here against the real store, and three of them
 * come out to a DIFFERENT NUMBER than the Mongo one would have on the same
 * data. Those three are marked DEVIATION, with the reasoning at the formula.
 */

// ── Shapes ──────────────────────────────────────────────────────────────────

export const KPI_SOURCES = [
  "manual",
  "monthly_revenue",
  "monthly_payroll_cost",
  "ar_days_outstanding",
  "cash_position",
  "active_headcount",
  "gross_margin_percent",
  "opex_ratio",
  "payroll_to_revenue_ratio",
  "avg_order_value",
] as const;

export type KpiSource = (typeof KPI_SOURCES)[number];
export type KpiPeriodicity = "monthly" | "quarterly" | "yearly";

/** Every source except `manual` has a formula behind it. */
export const AUTO_SOURCES = KPI_SOURCES.filter(
  (s) => s !== "manual",
) as Exclude<KpiSource, "manual">[];

export interface KpiInput {
  companyId?: string;
  name: string;
  description?: string;
  category: string;
  source?: string;
  unit?: string;
  periodicity?: string;
  target: number;
  targetDirection?: string;
  onTargetThreshold?: number | null;
  nearTargetThreshold?: number | null;
  statusLabelOnTarget?: string | null;
  statusLabelNearTarget?: string | null;
  statusLabelOffTarget?: string | null;
  ownerEmployeeId?: string | null;
  ownerName?: string | null;
  ownerEmployeeNumber?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const nullableNum = (v: unknown) => (v == null ? null : num(v));

const trimOrNull = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

// ── Period arithmetic ───────────────────────────────────────────────────────

/**
 * The storage coordinate for a period.
 *
 * A quarterly snapshot sits on the END of its quarter (3/6/9/12) and a yearly
 * one on December, which is how one unique index over (year, month) serves
 * all three periodicities without two rows ever meaning the same period.
 *
 * In Mongo this lived only here, in the action layer, and
 * `kpi_snapshots_period_shape` now enforces it in the database too — so a
 * writer that forgets to call this is rejected rather than quietly storing a
 * second truth for a quarter already recorded.
 */
export function normalisePeriod(
  periodicity: string,
  periodYear: number,
  periodMonth: number,
) {
  if (periodicity === "yearly") {
    return { periodYear, periodMonth: 12, periodQuarter: 4 };
  }
  if (periodicity === "quarterly") {
    const quarter = Math.ceil(periodMonth / 3);
    return { periodYear, periodMonth: quarter * 3, periodQuarter: quarter };
  }
  return { periodYear, periodMonth, periodQuarter: null as number | null };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * `[start, end)` for a NORMALISED period, as ISO dates and as month ordinals.
 *
 * Dates rather than JS `Date` objects: `journal_entries.entry_date` and
 * `invoices.invoice_date` are `date` columns, and a Date built in local time
 * and sent as a timestamp shifts the boundary by the machine's offset — which
 * in Nairobi (+03) moves the first three hours of the 1st into the previous
 * month. The Mongo formulas built local Dates and had exactly that skew.
 *
 * The ordinals are for payroll, which is filed by (period_year, period_month)
 * and not by a date at all.
 */
export function periodBounds(
  periodicity: string,
  periodYear: number,
  periodMonth: number,
) {
  let startYear = periodYear;
  let startMonth = periodMonth;
  let months = 1;

  if (periodicity === "yearly") {
    startMonth = 1;
    months = 12;
  } else if (periodicity === "quarterly") {
    startMonth = periodMonth - 2; // periodMonth is end-of-quarter
    months = 3;
  }

  const endOrdinalRaw = startYear * 12 + (startMonth - 1) + months;
  const endYear = Math.floor(endOrdinalRaw / 12);
  const endMonth = (endOrdinalRaw % 12) + 1;

  return {
    start: `${startYear}-${pad2(startMonth)}-01`,
    /** Exclusive. */
    end: `${endYear}-${pad2(endMonth)}-01`,
    startOrdinal: startYear * 12 + startMonth,
    /** Exclusive. */
    endOrdinal: startYear * 12 + startMonth + months,
  };
}

/** The period before this one, on its own periodicity. Rolls the year. */
export function priorPeriod(
  periodicity: string,
  periodYear: number,
  periodMonth: number,
) {
  if (periodicity === "yearly")
    return { periodYear: periodYear - 1, periodMonth: 12 };
  if (periodicity === "quarterly") {
    const m = periodMonth - 3;
    return m < 1
      ? { periodYear: periodYear - 1, periodMonth: 12 }
      : { periodYear, periodMonth: m };
  }
  return periodMonth === 1
    ? { periodYear: periodYear - 1, periodMonth: 12 }
    : { periodYear, periodMonth: periodMonth - 1 };
}

/** Same period, last year. */
export function yoyPeriod(periodYear: number, periodMonth: number) {
  return { periodYear: periodYear - 1, periodMonth };
}

/** Percentage change, or null when there is nothing to compare against. */
export function pctChange(current: number, prior: number | null | undefined) {
  if (prior == null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

// ── Serialisers ─────────────────────────────────────────────────────────────

/**
 * The shape the KPI screens already render — `_id`, `customThresholds`,
 * `statusLabels`, `owner` — so a screen moves over by changing an import path
 * and nothing else.
 */
function toScreenKpi(r: Record<string, unknown>) {
  return {
    _id: String(r.id),
    id: String(r.id),
    name: String(r.name),
    description: (r.description as string) ?? "",
    category: r.category as string,
    source: r.source as string,
    unit: r.unit as string,
    periodicity: r.periodicity as string,
    target: num(r.target),
    targetDirection: r.target_direction as string,
    customThresholds: {
      onTargetThreshold: nullableNum(r.on_target_threshold),
      nearTargetThreshold: nullableNum(r.near_target_threshold),
    },
    statusLabels: {
      onTarget: (r.status_label_on_target as string) || null,
      nearTarget: (r.status_label_near_target as string) || null,
      offTarget: (r.status_label_off_target as string) || null,
    },
    /**
     * `name` prefers the employee record over the stored snapshot, so a KPI
     * owned by somebody who has since been renamed shows the current name.
     * That is the whole reason `owner_employee_id` exists — see the schema.
     */
    owner:
      r.owner_employee_id || r.owner_name || r.owner_employee_number
        ? {
            employeeId: r.owner_employee_id ? String(r.owner_employee_id) : null,
            name:
              (r.owner_current_name as string) ||
              (r.owner_name as string) ||
              null,
            employeeNumber:
              (r.owner_current_number as string) ||
              (r.owner_employee_number as string) ||
              null,
          }
        : null,
    isActive: r.is_active === true,
    createdAt: r.created_at ? String(r.created_at) : null,
    updatedAt: r.updated_at ? String(r.updated_at) : null,
  };
}

function toScreenSnapshot(r: Record<string, unknown>) {
  return {
    _id: String(r.id),
    kpiId: String(r.kpi_id),
    periodicity: (r.periodicity as string) ?? "monthly",
    periodYear: Number(r.period_year),
    periodMonth: Number(r.period_month),
    periodQuarter: r.period_quarter == null ? null : Number(r.period_quarter),
    actualValue: num(r.actual_value),
    targetAtTime: num(r.target_at_time),
    source: r.source as string,
    notes: (r.notes as string) ?? "",
    recordedBy: r.recorded_by_name
      ? { name: r.recorded_by_name as string, id: (r.recorded_by_id as string) ?? null }
      : null,
    createdAt: r.created_at ? String(r.created_at) : null,
  };
}

/** Every column the screens read, with the owner resolved through the FK. */
const KPI_COLUMNS = sql`
  k.*,
  e.full_name       AS owner_current_name,
  e.employee_number AS owner_current_number
`;

const KPI_FROM = sql`
  FROM kpis k
  LEFT JOIN employees e ON e.id = k.owner_employee_id
`;

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * The board: every KPI with its latest actual and a short series behind it.
 *
 * Two queries, as Mongo did, but the series is cut per KPI by a window rather
 * than by a global `limit(seriesLength × kpiCount)`. The global cap relied on
 * every KPI having at least `seriesLength` snapshots to be fair; a company
 * where the first KPI alphabetically has three years of history and the last
 * has two months would have had its budget eaten before the sort reached the
 * end.
 */
export async function listKpis(
  tx: Tx,
  opts: {
    category?: string | null;
    includeInactive?: boolean;
    seriesLength?: number;
  } = {},
) {
  const seriesLength = Math.min(Math.max(opts.seriesLength ?? 12, 1), 60);

  const filters = [sql`TRUE`];
  if (!opts.includeInactive) filters.push(sql`k.is_active = true`);
  if (opts.category) filters.push(sql`k.category = ${opts.category}::kpi_category`);

  const rows = (await tx.execute(sql`
    SELECT ${KPI_COLUMNS}
    ${KPI_FROM}
     WHERE ${sql.join(filters, sql` AND `)}
     ORDER BY k.category, k.name
  `)) as unknown as Array<Record<string, unknown>>;

  if (rows.length === 0) return [];

  const ids = rows.map((r) => String(r.id));
  const snapshots = (await tx.execute(sql`
    SELECT * FROM (
      SELECT s.*,
             row_number() OVER (
               PARTITION BY s.kpi_id
               ORDER BY s.period_year DESC, s.period_month DESC
             ) AS rn
        FROM kpi_snapshots s
       WHERE s.kpi_id = ${anyOf(ids, "uuid[]")}
    ) ranked
     WHERE rn <= ${seriesLength}
     ORDER BY kpi_id, period_year DESC, period_month DESC
  `)) as unknown as Array<Record<string, unknown>>;

  const byKpi = new Map<string, Array<Record<string, unknown>>>();
  for (const s of snapshots) {
    const key = String(s.kpi_id);
    if (!byKpi.has(key)) byKpi.set(key, []);
    byKpi.get(key)!.push(s);
  }

  return rows.map((r) => {
    const series = byKpi.get(String(r.id)) ?? [];
    const latest = series[0] ?? null;
    const prior = series[1] ?? null;

    return {
      ...toScreenKpi(r),
      latestSnapshot: latest ? toScreenSnapshot(latest) : null,
      priorDeltaPct:
        latest && prior
          ? pctChange(num(latest.actual_value), num(prior.actual_value))
          : null,
      /** Chronological, oldest first — the sparkline reads it left to right. */
      series: series
        .slice()
        .reverse()
        .map((s) => ({
          periodYear: Number(s.period_year),
          periodMonth: Number(s.period_month),
          actualValue: num(s.actual_value),
          targetAtTime: num(s.target_at_time),
        })),
    };
  });
}

export async function getKpi(tx: Tx, kpiId: string) {
  if (!isUuid(kpiId)) return null;
  const [row] = (await tx.execute(sql`
    SELECT ${KPI_COLUMNS} ${KPI_FROM} WHERE k.id = ${kpiId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  return row ? toScreenKpi(row) : null;
}

/**
 * The detail page: the definition, its snapshots, and each snapshot's change
 * against the prior period and against the same period last year.
 *
 * A wider window than `limit` is pulled so the OLDEST visible row still has
 * its comparators — a year of look-back past the bottom of the table.
 */
export async function getKpiWithSnapshots(
  tx: Tx,
  kpiId: string,
  opts: { limit?: number } = {},
) {
  const kpi = await getKpi(tx, kpiId);
  if (!kpi) return null;

  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 120);

  const rows = (await tx.execute(sql`
    SELECT * FROM kpi_snapshots
     WHERE kpi_id = ${kpiId}::uuid
     ORDER BY period_year DESC, period_month DESC
     LIMIT ${limit + 12}
  `)) as unknown as Array<Record<string, unknown>>;

  const byKey = new Map(
    rows.map((s) => [`${s.period_year}-${s.period_month}`, s]),
  );

  const visible = rows.slice(0, limit);

  const snapshots = visible.map((s) => {
    const periodicity = (s.periodicity as string) || kpi.periodicity;
    const year = Number(s.period_year);
    const month = Number(s.period_month);
    const p = priorPeriod(periodicity, year, month);
    const y = yoyPeriod(year, month);
    const priorSnap = byKey.get(`${p.periodYear}-${p.periodMonth}`);
    const yoySnap = byKey.get(`${y.periodYear}-${y.periodMonth}`);

    return {
      ...toScreenSnapshot(s),
      priorDeltaPct: priorSnap
        ? pctChange(num(s.actual_value), num(priorSnap.actual_value))
        : null,
      yoyDeltaPct: yoySnap
        ? pctChange(num(s.actual_value), num(yoySnap.actual_value))
        : null,
    };
  });

  return {
    ...kpi,
    snapshots,
    chartSeries: visible
      .slice()
      .reverse()
      .map((s) => ({
        periodYear: Number(s.period_year),
        periodMonth: Number(s.period_month),
        actualValue: num(s.actual_value),
        targetAtTime: num(s.target_at_time),
      })),
  };
}

/** Dashboard widget: the first `limit` active KPIs, each with its latest. */
export async function getKpiSummary(tx: Tx, opts: { limit?: number } = {}) {
  const all = await listKpis(tx, { includeInactive: false });
  return all.slice(0, Math.max(opts.limit ?? 6, 1));
}

// ── Writes ──────────────────────────────────────────────────────────────────

function ownerColumns(input: KpiInput) {
  const employeeId =
    input.ownerEmployeeId && isUuid(input.ownerEmployeeId)
      ? input.ownerEmployeeId
      : null;
  return {
    employeeId,
    name: trimOrNull(input.ownerName),
    employeeNumber: trimOrNull(input.ownerEmployeeNumber),
  };
}

export async function createKpi(tx: Tx, input: KpiInput) {
  const owner = ownerColumns(input);
  const [row] = (await tx.execute(sql`
    INSERT INTO kpis (
      company_id, name, description, category, source, unit, periodicity,
      target, target_direction, on_target_threshold, near_target_threshold,
      status_label_on_target, status_label_near_target, status_label_off_target,
      owner_employee_id, owner_name, owner_employee_number,
      created_by_id, created_by_name
    ) VALUES (
      ${input.companyId ?? null}::uuid,
      ${input.name.trim()},
      ${input.description ?? ""},
      ${input.category}::kpi_category,
      ${input.source ?? "manual"}::kpi_source,
      ${input.unit ?? "currency"}::kpi_unit,
      ${input.periodicity ?? "monthly"}::kpi_periodicity,
      ${String(input.target)}::numeric,
      ${input.targetDirection ?? "higher_is_better"}::kpi_target_direction,
      ${input.onTargetThreshold == null ? null : String(input.onTargetThreshold)}::numeric,
      ${input.nearTargetThreshold == null ? null : String(input.nearTargetThreshold)}::numeric,
      ${trimOrNull(input.statusLabelOnTarget)},
      ${trimOrNull(input.statusLabelNearTarget)},
      ${trimOrNull(input.statusLabelOffTarget)},
      ${owner.employeeId}::uuid, ${owner.name}, ${owner.employeeNumber},
      ${input.actorId ?? null}, ${input.actorName ?? "System"}
    )
    RETURNING id
  `)) as unknown as Array<Record<string, unknown>>;

  return { id: String(row.id) };
}

export async function updateKpi(tx: Tx, kpiId: string, input: KpiInput) {
  if (!isUuid(kpiId)) throw new Error("KPI not found");
  const owner = ownerColumns(input);

  const [row] = (await tx.execute(sql`
    UPDATE kpis SET
      name = ${input.name.trim()},
      description = ${input.description ?? ""},
      category = ${input.category}::kpi_category,
      source = ${input.source ?? "manual"}::kpi_source,
      unit = ${input.unit ?? "currency"}::kpi_unit,
      periodicity = ${input.periodicity ?? "monthly"}::kpi_periodicity,
      target = ${String(input.target)}::numeric,
      target_direction = ${input.targetDirection ?? "higher_is_better"}::kpi_target_direction,
      on_target_threshold = ${input.onTargetThreshold == null ? null : String(input.onTargetThreshold)}::numeric,
      near_target_threshold = ${input.nearTargetThreshold == null ? null : String(input.nearTargetThreshold)}::numeric,
      status_label_on_target = ${trimOrNull(input.statusLabelOnTarget)},
      status_label_near_target = ${trimOrNull(input.statusLabelNearTarget)},
      status_label_off_target = ${trimOrNull(input.statusLabelOffTarget)},
      owner_employee_id = ${owner.employeeId}::uuid,
      owner_name = ${owner.name},
      owner_employee_number = ${owner.employeeNumber},
      last_modified_by_id = ${input.actorId ?? null},
      last_modified_by_name = ${input.actorName ?? null},
      updated_at = now()
    WHERE id = ${kpiId}::uuid
    RETURNING id
  `)) as unknown as Array<Record<string, unknown>>;

  if (!row) throw new Error("KPI not found");
  return { id: String(row.id) };
}

/**
 * The inline "edit target" affordance.
 *
 * Deliberately touches nothing else. Snapshots already recorded keep the
 * `target_at_time` they were judged against; only the next one uses this.
 */
export async function setKpiTarget(
  tx: Tx,
  kpiId: string,
  target: number,
  actor: { id?: string | null; name?: string | null } = {},
) {
  if (!isUuid(kpiId)) throw new Error("KPI not found");
  const [row] = (await tx.execute(sql`
    UPDATE kpis
       SET target = ${String(target)}::numeric,
           last_modified_by_id = ${actor.id ?? null},
           last_modified_by_name = ${actor.name ?? null},
           updated_at = now()
     WHERE id = ${kpiId}::uuid
    RETURNING id
  `)) as unknown as Array<Record<string, unknown>>;
  if (!row) throw new Error("KPI not found");
  return { id: String(row.id) };
}

export async function setKpiActive(
  tx: Tx,
  kpiId: string,
  isActive: boolean,
  actor: { id?: string | null; name?: string | null } = {},
) {
  if (!isUuid(kpiId)) throw new Error("KPI not found");
  const [row] = (await tx.execute(sql`
    UPDATE kpis
       SET is_active = ${isActive},
           last_modified_by_id = ${actor.id ?? null},
           last_modified_by_name = ${actor.name ?? null},
           updated_at = now()
     WHERE id = ${kpiId}::uuid
    RETURNING id
  `)) as unknown as Array<Record<string, unknown>>;
  if (!row) throw new Error("KPI not found");
  return { id: String(row.id) };
}

/**
 * Write one actual for one period.
 *
 * The upsert targets `kpi_snapshots_period_uq` — recording March twice
 * corrects March rather than appending a second March. `target_at_time` is
 * re-frozen from the KPI's target at the moment of the write, which is what
 * the Mongo `$set` did and is right: a correction entered today is judged
 * against today's target, and the row says so.
 */
export async function recordSnapshot(
  tx: Tx,
  kpiId: string,
  input: {
    periodYear: number;
    periodMonth: number;
    actualValue: number;
    /** Undefined means "leave whatever is there" — see the upsert below. */
    notes?: string;
    source?: "manual" | "auto";
  },
  actor: { id?: string | null; name?: string | null } = {},
) {
  if (!isUuid(kpiId)) throw new Error("KPI not found");

  const [kpi] = (await tx.execute(sql`
    SELECT id, company_id, periodicity, target FROM kpis WHERE id = ${kpiId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  if (!kpi) throw new Error("KPI not found");

  const p = normalisePeriod(
    String(kpi.periodicity),
    input.periodYear,
    input.periodMonth,
  );

  const [row] = (await tx.execute(sql`
    INSERT INTO kpi_snapshots (
      company_id, kpi_id, periodicity, period_year, period_month, period_quarter,
      actual_value, target_at_time, source, notes, recorded_by_id, recorded_by_name
    ) VALUES (
      ${String(kpi.company_id)}::uuid, ${kpiId}::uuid,
      ${String(kpi.periodicity)}::kpi_periodicity,
      ${p.periodYear}, ${p.periodMonth}, ${p.periodQuarter},
      ${String(input.actualValue)}::numeric,
      ${String(kpi.target)}::numeric,
      ${input.source ?? "manual"}::kpi_snapshot_source,
      ${input.notes ?? ""},
      ${actor.id ?? null}, ${actor.name ?? null}
    )
    ON CONFLICT (company_id, kpi_id, period_year, period_month) DO UPDATE SET
      periodicity = EXCLUDED.periodicity,
      period_quarter = EXCLUDED.period_quarter,
      actual_value = EXCLUDED.actual_value,
      target_at_time = EXCLUDED.target_at_time,
      source = EXCLUDED.source,
      /* A recompute must not silently erase the note somebody left explaining
         the number. Only a caller that passed one overwrites it. */
      notes = COALESCE(${input.notes ?? null}, kpi_snapshots.notes),
      recorded_by_id = EXCLUDED.recorded_by_id,
      recorded_by_name = EXCLUDED.recorded_by_name,
      updated_at = now()
    RETURNING id, period_year, period_month, actual_value
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    id: String(row.id),
    periodYear: Number(row.period_year),
    periodMonth: Number(row.period_month),
    actualValue: num(row.actual_value),
  };
}

/** Returns the KPI the snapshot belonged to, so the caller can navigate back. */
export async function deleteSnapshot(tx: Tx, snapshotId: string) {
  if (!isUuid(snapshotId)) throw new Error("Snapshot not found");
  const [row] = (await tx.execute(sql`
    DELETE FROM kpi_snapshots WHERE id = ${snapshotId}::uuid RETURNING kpi_id
  `)) as unknown as Array<Record<string, unknown>>;
  if (!row) throw new Error("Snapshot not found");
  return { kpiId: String(row.kpi_id) };
}

/**
 * Seed from the curated template library.
 *
 * ON CONFLICT DO NOTHING against `kpis_name_uq`, rather than the read-then-diff
 * the Mongo action did. Two people pressing the button at the same moment both
 * read an empty list and both insert; the company gets two Monthly Revenues
 * that diverge from their first snapshot on. The database decides now.
 *
 * Returns what was created and what was already there, because the dialog
 * reports both and an honest "3 created, 8 already existed" is the point.
 */
export async function seedKpisFromTemplates(
  tx: Tx,
  companyId: string,
  templates: Array<{
    name: string;
    description?: string;
    category: string;
    source: string;
    unit: string;
    periodicity: string;
    target: number;
    targetDirection: string;
  }>,
  actor: { id?: string | null; name?: string | null } = {},
) {
  const created: Array<{ _id: string; name: string }> = [];
  const skipped: string[] = [];

  for (const t of templates) {
    const [row] = (await tx.execute(sql`
      INSERT INTO kpis (
        company_id, name, description, category, source, unit, periodicity,
        target, target_direction, created_by_id, created_by_name
      ) VALUES (
        ${companyId}::uuid, ${t.name}, ${t.description ?? ""},
        ${t.category}::kpi_category, ${t.source}::kpi_source,
        ${t.unit}::kpi_unit, ${t.periodicity}::kpi_periodicity,
        ${String(t.target)}::numeric,
        ${t.targetDirection}::kpi_target_direction,
        ${actor.id ?? null}, ${actor.name ?? "System"}
      )
      ON CONFLICT DO NOTHING
      RETURNING id, name
    `)) as unknown as Array<Record<string, unknown>>;

    if (row) created.push({ _id: String(row.id), name: String(row.name) });
    else skipped.push(t.name);
  }

  return { created, skipped };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE FORMULAS
//
// Each takes the tenant transaction and a NORMALISED period, and returns a
// number. Three are marked DEVIATION: they compute something different from
// the Mongo original, on purpose, and say why at the formula.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What counts as cost of sales.
 *
 * DEVIATION. Mongo matched `systemAccount IN ('cogs', 'cost_of_sales')` — one
 * seeded account, 5100, plus a name that was never seeded at all. The standard
 * chart puts project materials, subcontractors, equipment hire, project
 * transport and site expenses at 5410–5490 under `sub_type = 'direct_cost'`,
 * and for a contracting business that is nearly all of the cost of sales.
 *
 * Excluding them made Gross Margin ≈ 100% — a green tile on a job that lost
 * money — and simultaneously inflated the Operating Expense Ratio, which is
 * sold in the template library as "the defensive twin of Revenue" and counts
 * every expense that is NOT cost of sales. One predicate serves both, so the
 * two ratios stay complementary instead of double-counting the same shilling.
 */
/*
 * COALESCE, and it is not decoration. `a.system_account IN (...)` is NULL —
 * not false — for the accounts that carry no system handle, which is most of
 * them. NULL is falsy in a WHERE, so the POSITIVE use (gross margin) looks
 * fine; the NEGATED one below is `NOT NULL`, which is NULL, which excludes
 * the row. Rent has no system account, so the opex ratio came out at zero
 * with expenses posted against it. Caught by a test, not by reading.
 */
const COGS_ACCOUNTS = sql`(
  COALESCE(a.sub_type, '') IN ('cogs', 'direct_cost')
  OR COALESCE(a.system_account, '') IN ('cogs', 'cost_of_sales')
)`;

/** Posted movement on a set of accounts over `[start, end)`. */
async function ledgerMovement(
  tx: Tx,
  where: ReturnType<typeof sql>,
  start: string,
  end: string,
  side: "credit_minus_debit" | "debit_minus_credit",
) {
  const formula =
    side === "debit_minus_credit"
      ? sql`l.debit - l.credit`
      : sql`l.credit - l.debit`;

  const [row] = (await tx.execute(sql`
    SELECT COALESCE(SUM(${formula}), 0)::float8 AS total
      FROM journal_lines l
      JOIN journal_entries je ON je.id = l.entry_id
      JOIN accounts a ON a.id = l.account_id
     WHERE je.status = 'posted'
       AND je.entry_date >= ${start}::date
       AND je.entry_date <  ${end}::date
       AND a.is_active = true
       AND ${where}
  `)) as unknown as Array<Record<string, unknown>>;

  return num(row?.total);
}

/** Balance on a set of accounts as of `asOf` (exclusive), on its normal side. */
async function ledgerBalanceAsOf(
  tx: Tx,
  where: ReturnType<typeof sql>,
  asOf: string,
  side: "credit_minus_debit" | "debit_minus_credit",
) {
  const formula =
    side === "debit_minus_credit"
      ? sql`l.debit - l.credit`
      : sql`l.credit - l.debit`;

  const [row] = (await tx.execute(sql`
    SELECT COALESCE(SUM(${formula}), 0)::float8 AS balance
      FROM journal_lines l
      JOIN journal_entries je ON je.id = l.entry_id
      JOIN accounts a ON a.id = l.account_id
     WHERE je.status = 'posted'
       AND je.entry_date < ${asOf}::date
       AND a.is_active = true
       AND ${where}
  `)) as unknown as Array<Record<string, unknown>>;

  return num(row?.balance);
}

const REVENUE_ACCOUNTS = sql`a.account_type = 'revenue'`;

async function periodRevenue(tx: Tx, start: string, end: string) {
  return ledgerMovement(tx, REVENUE_ACCOUNTS, start, end, "credit_minus_debit");
}

/**
 * Payroll cost for the period: gross plus the employer's own contributions.
 *
 * DEVIATION — TWO OF THEM, AND THE FIRST WAS A SILENT BUG.
 *
 * Mongo matched `status IN ('paid','approved','posted')` AND `paidAt` inside
 * the window. `paid_at` is only stamped when a run is PAID, so an approved run
 * had a null there and fell out of the range test regardless: the `approved`
 * in that list never selected anything, and `posted` is not even a reachable
 * status (0048 dropped it). The filter said three states and meant one.
 *
 * Second, and the reason to change rather than reproduce it: payroll is
 * matched here to the period it was EARNED IN — `period_year` /
 * `period_month` — not to the month the cash left. March's payroll is March's
 * cost even when it is paid on 4 April, and a company that pays late would
 * otherwise show a month with no payroll followed by a month with two. It also
 * puts this on the same accrual basis as `monthly_revenue`, which is read
 * straight off posted journal entries — and `payroll_to_revenue_ratio` divides
 * one by the other, so a mismatch there is a ratio of two different months.
 */
async function payrollCost(
  tx: Tx,
  startOrdinal: number,
  endOrdinal: number,
) {
  const [row] = (await tx.execute(sql`
    SELECT COALESCE(SUM(
             total_gross + total_employer_nssf + total_employer_ahl
           ), 0)::float8 AS total
      FROM payroll_runs
     WHERE status IN ('approved', 'paid')
       AND (period_year * 12 + period_month) >= ${startOrdinal}
       AND (period_year * 12 + period_month) <  ${endOrdinal}
  `)) as unknown as Array<Record<string, unknown>>;
  return num(row?.total);
}

/**
 * Compute one actual.
 *
 * `source` must be an auto source; `manual` has no formula and the caller is
 * expected to have said so with a better message than this can give.
 */
export async function computeKpiActual(
  tx: Tx,
  source: string,
  periodicity: string,
  periodYear: number,
  periodMonth: number,
): Promise<number> {
  const { start, end, startOrdinal, endOrdinal } = periodBounds(
    periodicity,
    periodYear,
    periodMonth,
  );

  switch (source) {
    case "monthly_revenue":
      return periodRevenue(tx, start, end);

    case "monthly_payroll_cost":
      return payrollCost(tx, startOrdinal, endOrdinal);

    /**
     * DSO — the open receivable divided by the daily revenue rate.
     *
     * The receivable is measured on the AR control account by
     * `system_account`, not by code: the code is a label a company chooses and
     * 2100 is somebody's WHT Payable.
     */
    case "ar_days_outstanding": {
      const ar = await ledgerBalanceAsOf(
        tx,
        sql`a.system_account = 'accounts_receivable'`,
        end,
        "debit_minus_credit",
      );
      if (ar <= 0) return 0;

      const revenue = await periodRevenue(tx, start, end);
      if (revenue <= 0) return 0;

      const days = Math.round(
        (Date.parse(end) - Date.parse(start)) / 86_400_000,
      );
      return (ar * days) / revenue;
    }

    /**
     * Cash at the end of the period.
     *
     * DEVIATION. Mongo matched five `systemAccount` values — 'cash',
     * 'petty_cash', 'cash_at_bank', 'bank_main', 'mpesa' — of which the chart
     * seeds three; 'cash' and 'bank_main' were never written by the Postgres
     * seeder at all. Worse, `system_account` is UNIQUE per company, so the
     * SECOND bank account a company opens can never carry one: a business
     * banking with two banks had half its cash invisible to this tile.
     *
     * `sub_type IN ('cash','bank','mpesa')` is the classification the account
     * form already sets, it holds for as many accounts as a company has, and
     * it is exactly what the executive overview's cash tile uses — so the two
     * numbers on the two pages now agree, which they did not.
     */
    case "cash_position":
      return ledgerBalanceAsOf(
        tx,
        sql`a.sub_type IN ('cash', 'bank', 'mpesa')`,
        end,
        "debit_minus_credit",
      );

    /**
     * Headcount is the CURRENT count, not an as-of one — the Mongo comment
     * says so and the reasoning holds: an as-of figure would need
     * `employment_events` replayed, and for an SMB reporting last month the
     * current status is a fair proxy. It is the one formula that ignores the
     * period, which is why re-running it for an old month overwrites that
     * month with today's number.
     */
    case "active_headcount": {
      const [row] = (await tx.execute(sql`
        SELECT COUNT(*)::int AS n FROM employees
         WHERE status IN ('active', 'probation')
      `)) as unknown as Array<Record<string, unknown>>;
      return num(row?.n);
    }

    case "gross_margin_percent": {
      const revenue = await periodRevenue(tx, start, end);
      if (revenue <= 0) return 0;
      const cogs = await ledgerMovement(
        tx,
        COGS_ACCOUNTS,
        start,
        end,
        "debit_minus_credit",
      );
      return ((revenue - cogs) / revenue) * 100;
    }

    /** Everything expensed that is not cost of sales, over revenue. */
    case "opex_ratio": {
      const revenue = await periodRevenue(tx, start, end);
      if (revenue <= 0) return 0;
      const opex = await ledgerMovement(
        tx,
        sql`a.account_type = 'expense' AND NOT ${COGS_ACCOUNTS}`,
        start,
        end,
        "debit_minus_credit",
      );
      return (opex / revenue) * 100;
    }

    case "payroll_to_revenue_ratio": {
      const [payroll, revenue] = await Promise.all([
        payrollCost(tx, startOrdinal, endOrdinal),
        periodRevenue(tx, start, end),
      ]);
      if (revenue <= 0) return 0;
      return (payroll / revenue) * 100;
    }

    /**
     * AOV is deliberately measured on INVOICES, not on the ledger: it is the
     * average of what was billed per document, and the ledger has no notion of
     * a document count. `sent` and `completed` are the two statuses that mean
     * the invoice left the building; draft and cancelled are not orders.
     */
    case "avg_order_value": {
      const [row] = (await tx.execute(sql`
        SELECT COALESCE(SUM(total), 0)::float8 AS revenue,
               COUNT(*)::int                   AS count
          FROM invoices
         WHERE status IN ('sent', 'completed')
           AND invoice_date >= ${start}::date
           AND invoice_date <  ${end}::date
      `)) as unknown as Array<Record<string, unknown>>;
      const count = num(row?.count);
      return count === 0 ? 0 : num(row?.revenue) / count;
    }

    default:
      throw new Error(`Unsupported auto source: ${source}`);
  }
}

/**
 * Compute and store, in one transaction.
 *
 * The period is interpreted through the KPI's own periodicity, so a caller
 * passing month 5 on a quarterly KPI gets Q2 — which is the behaviour the
 * detail page's "recompute" button relies on.
 */
export async function computeAndRecordSnapshot(
  tx: Tx,
  kpiId: string,
  periodYear: number,
  periodMonth: number,
  actor: { id?: string | null; name?: string | null } = {},
) {
  if (!isUuid(kpiId)) throw new Error("KPI not found");

  const [kpi] = (await tx.execute(sql`
    SELECT id, periodicity, source FROM kpis WHERE id = ${kpiId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  if (!kpi) throw new Error("KPI not found");

  if (kpi.source === "manual") {
    throw new Error(
      "This KPI is manual-entry; auto-compute is not available for it.",
    );
  }

  const periodicity = String(kpi.periodicity);
  const p = normalisePeriod(periodicity, periodYear, periodMonth);

  const actualValue = await computeKpiActual(
    tx,
    String(kpi.source),
    periodicity,
    p.periodYear,
    p.periodMonth,
  );

  return recordSnapshot(
    tx,
    kpiId,
    {
      periodYear: p.periodYear,
      periodMonth: p.periodMonth,
      actualValue,
      source: "auto",
    },
    actor,
  );
}
