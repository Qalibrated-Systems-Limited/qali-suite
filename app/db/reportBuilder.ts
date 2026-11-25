import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "./client";
import { reportModule } from "@/lib/reports/catalog";

/**
 * The report builder's engine. A dataset is a whitelisted table; its columns
 * come from information_schema, so nothing here names a column by hand. Every
 * identifier in a query is one of those discovered names, quoted with
 * sql.identifier; every value is a bound parameter. Rows are read through the
 * caller's tenant transaction, so RLS confines them to the company.
 */

export type ColumnType = "text" | "number" | "date" | "boolean";
export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

const HIDDEN = /^(company_id)$|password|hash|secret|token|api_key|_key$/i;
const SKIP_TYPES = new Set(["ARRAY", "jsonb", "json", "bytea", "tsvector"]);
const ACRONYMS: Record<string, string> = { id: "ID", grn: "GRN", ncr: "NCR", po: "PO", vat: "VAT", kra: "KRA", sku: "SKU", url: "URL", ip: "IP", car: "CAR", sla: "SLA", hse: "HSE", ppe: "PPE" };

export function labelFor(key: string) {
  const words = key.split("_").map((w) => ACRONYMS[w] ?? w);
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function typeOf(dataType: string): ColumnType {
  if (/int|numeric|double|real|decimal/.test(dataType)) return "number";
  if (/date|timestamp/.test(dataType)) return "date";
  if (dataType === "boolean") return "boolean";
  return "text";
}

export function datasetOf(moduleId: string, datasetId: string) {
  const m = reportModule(moduleId);
  return m?.datasets.find((d) => d.id === datasetId) ?? null;
}

export async function columnsOf(tx: Tx, table: string): Promise<ReportColumn[]> {
  const rows = (await tx.execute(sql`
    SELECT column_name AS name, data_type AS type
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table}
     ORDER BY ordinal_position
  `)) as unknown as Array<{ name: string; type: string }>;
  return rows
    .filter((r) => !HIDDEN.test(r.name) && !SKIP_TYPES.has(r.type))
    .map((r) => ({ key: r.name, label: labelFor(r.name), type: typeOf(r.type) }));
}

export interface ReportFilter {
  column: string;
  op: "eq" | "neq" | "contains" | "gt" | "lt" | "empty" | "not_empty";
  value?: string;
}
export interface ReportDefinition {
  module: string;
  dataset: string;
  columns: string[];
  filters?: ReportFilter[];
  dateColumn?: string | null;
  from?: string | null;
  to?: string | null;
  groupBy?: string | null;
  sort?: { column: string; dir: "asc" | "desc" } | null;
  limit?: number;
}

function selectExpr(c: ReportColumn): SQL {
  const id = sql.identifier(c.key);
  if (c.type === "number") return sql`${id}::float8`;
  if (c.type === "text") return sql`${id}::text`;
  return sql`${id}`;
}

function filterExpr(c: ReportColumn, f: ReportFilter): SQL | null {
  const id = sql.identifier(c.key);
  const v = String(f.value ?? "");
  switch (f.op) {
    case "empty":
      return c.type === "text" ? sql`(${id} IS NULL OR ${id}::text = '')` : sql`${id} IS NULL`;
    case "not_empty":
      return c.type === "text" ? sql`(${id} IS NOT NULL AND ${id}::text <> '')` : sql`${id} IS NOT NULL`;
    case "contains":
      return sql`${id}::text ILIKE ${"%" + v.replace(/[%_\\]/g, (m) => "\\" + m) + "%"}`;
    case "eq":
      if (c.type === "number") return Number.isFinite(Number(v)) ? sql`${id} = ${Number(v)}` : null;
      if (c.type === "boolean") return sql`${id} = ${/^(true|yes|1)$/i.test(v)}`;
      if (c.type === "date") return sql`${id}::date = ${v}::date`;
      return sql`lower(${id}::text) = lower(${v})`;
    case "neq":
      if (c.type === "number") return Number.isFinite(Number(v)) ? sql`${id} IS DISTINCT FROM ${Number(v)}` : null;
      if (c.type === "date") return sql`${id}::date IS DISTINCT FROM ${v}::date`;
      return sql`lower(${id}::text) IS DISTINCT FROM lower(${v})`;
    case "gt":
      if (c.type === "number") return Number.isFinite(Number(v)) ? sql`${id} > ${Number(v)}` : null;
      if (c.type === "date") return sql`${id}::date > ${v}::date`;
      return sql`${id}::text > ${v}`;
    case "lt":
      if (c.type === "number") return Number.isFinite(Number(v)) ? sql`${id} < ${Number(v)}` : null;
      if (c.type === "date") return sql`${id}::date < ${v}::date`;
      return sql`${id}::text < ${v}`;
    default:
      return null;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function runReport(tx: Tx, def: ReportDefinition) {
  const ds = datasetOf(def.module, def.dataset);
  if (!ds) throw new Error("Choose a dataset from this module.");
  const all = await columnsOf(tx, ds.table);
  if (!all.length) throw new Error("This dataset is not available yet.");
  const byKey = new Map(all.map((c) => [c.key, c]));

  let cols = (def.columns ?? []).map((k) => byKey.get(k)).filter((c): c is ReportColumn => Boolean(c));
  if (!cols.length) cols = all.slice(0, 8);

  /*
   * The company's rows only — RLS does this, and so does this line, so a
   * connection that bypasses RLS (an owner, a superuser) still cannot read
   * another company's data through the builder. A table with no company key
   * is not reportable at all.
   */
  const [{ scoped }] = (await tx.execute(sql`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = ${ds.table} AND column_name = 'company_id') AS scoped
  `)) as unknown as Array<{ scoped: boolean }>;
  if (!scoped) throw new Error("This dataset cannot be reported on.");
  const where: SQL[] = [sql`company_id = NULLIF(current_setting('app.company_id', true), '')::uuid`];
  const dateCol = byKey.get(def.dateColumn || "") ?? byKey.get("created_at") ?? all.find((c) => c.type === "date");
  if (dateCol && dateCol.type === "date") {
    if (def.from && DATE_RE.test(def.from)) where.push(sql`${sql.identifier(dateCol.key)} >= ${def.from}::date`);
    if (def.to && DATE_RE.test(def.to)) where.push(sql`${sql.identifier(dateCol.key)} < (${def.to}::date + 1)`);
  }
  for (const f of def.filters ?? []) {
    const c = byKey.get(f.column);
    if (!c) continue;
    const e = filterExpr(c, f);
    if (e) where.push(e);
  }
  const whereSql = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
  const table = sql.identifier(ds.table);
  const limit = Math.min(Math.max(Number(def.limit) || 1000, 1), 5000);

  const group = def.groupBy ? byKey.get(def.groupBy) : null;
  if (group) {
    const sums = cols.filter((c) => c.type === "number" && c.key !== group.key);
    const gexpr = group.type === "date" ? sql`${sql.identifier(group.key)}::date::text` : sql`${sql.identifier(group.key)}::text`;
    const rows = (await tx.execute(sql`
      SELECT ${gexpr} AS ${sql.identifier(group.key)}, count(*)::int AS "count"
             ${sums.length ? sql`, ${sql.join(sums.map((c) => sql`COALESCE(sum(${sql.identifier(c.key)}), 0)::float8 AS ${sql.identifier(c.key)}`), sql`, `)}` : sql``}
        FROM ${table} ${whereSql}
       GROUP BY 1
       ORDER BY 2 DESC, 1
       LIMIT ${limit}
    `)) as unknown as Array<Record<string, unknown>>;
    const columns: ReportColumn[] = [
      group,
      { key: "count", label: "Count", type: "number" },
      ...sums.map((c) => ({ ...c, label: `Total ${c.label.toLowerCase()}` })),
    ];
    return { columns, rows, grouped: true, dataset: ds, available: all, truncated: rows.length >= limit };
  }

  const sort = def.sort && byKey.get(def.sort.column);
  const order = sort
    ? sql`ORDER BY ${sql.identifier(sort.key)} ${def.sort!.dir === "asc" ? sql`ASC` : sql`DESC`} NULLS LAST`
    : dateCol
      ? sql`ORDER BY ${sql.identifier(dateCol.key)} DESC NULLS LAST`
      : sql``;
  const rows = (await tx.execute(sql`
    SELECT ${sql.join(cols.map((c) => sql`${selectExpr(c)} AS ${sql.identifier(c.key)}`), sql`, `)}
      FROM ${table} ${whereSql} ${order}
     LIMIT ${limit}
  `)) as unknown as Array<Record<string, unknown>>;
  return { columns: cols, rows, grouped: false, dataset: ds, available: all, truncated: rows.length >= limit };
}
