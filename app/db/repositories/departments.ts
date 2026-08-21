import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { departments } from "../schema";

/**
 * Departments.
 *
 * See docs/POSTGRES-MIGRATION-PLAN.md §4.1 for the layering rule: all SQL for
 * departments lives here, and nothing here reads the session.
 *
 * Two departures from app/mongodb/actions/hr-department-actions.js:
 *
 * 1. THE COST CENTRE IS A REFERENCE. Mongo stores accountCode and accountName
 *    beside the id, so renaming the account leaves the department pointing at
 *    a name that no longer exists. Joined here (§8.6).
 *
 * 2. DELETING IS REFUSED, NOT SILENT. The source has no delete at all — only
 *    an isActive toggle — and deactivating a department with staff in it
 *    leaves those employees filed under something the pickers no longer offer.
 *    `deactivateDepartment` says how many are affected instead.
 */

export interface DepartmentInput {
  companyId: string;
  name: string;
  description?: string | null;
  parentDepartmentId?: string | null;
  costCenterAccountId?: string | null;
  headEmployeeId?: string | null;
  actor?: { id?: string | null; name?: string | null };
}

const trimmed = (v: string | null | undefined) => {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
};

/**
 * Next department code for the tenant: DEPT-00001.
 *
 * `next_entry_number` is the same race-free counter every other document uses
 * (0001). Mongo's ErpCounter did the job but the code was assembled in the
 * model; here the database hands back the finished string.
 */
async function nextDepartmentCode(tx: Tx, companyId: string): Promise<string> {
  const rows = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'DEPT') AS code`,
  )) as unknown as Array<{ code: string }>;
  return rows[0].code;
}

export async function createDepartment(tx: Tx, input: DepartmentInput) {
  const name = trimmed(input.name);
  if (!name) throw new Error("Department name is required");

  const code = await nextDepartmentCode(tx, input.companyId);

  const [created] = await tx
    .insert(departments)
    .values({
      companyId: input.companyId,
      code,
      name,
      description: trimmed(input.description),
      parentDepartmentId: input.parentDepartmentId || null,
      costCenterAccountId: input.costCenterAccountId || null,
      headEmployeeId: input.headEmployeeId || null,
      createdById: input.actor?.id ?? null,
      createdByName: input.actor?.name ?? null,
    })
    .returning();

  return created;
}

export interface UpdateDepartmentInput extends Partial<DepartmentInput> {
  id: string;
}

export async function updateDepartment(tx: Tx, input: UpdateDepartmentInput) {
  const name = trimmed(input.name);
  if (input.name !== undefined && !name) {
    throw new Error("Department name is required");
  }

  const [updated] = await tx
    .update(departments)
    .set({
      ...(name ? { name } : {}),
      ...(input.description !== undefined
        ? { description: trimmed(input.description) }
        : {}),
      ...(input.parentDepartmentId !== undefined
        ? { parentDepartmentId: input.parentDepartmentId || null }
        : {}),
      ...(input.costCenterAccountId !== undefined
        ? { costCenterAccountId: input.costCenterAccountId || null }
        : {}),
      ...(input.headEmployeeId !== undefined
        ? { headEmployeeId: input.headEmployeeId || null }
        : {}),
      lastModifiedById: input.actor?.id ?? null,
      lastModifiedByName: input.actor?.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(departments.id, input.id))
    .returning();

  if (!updated) throw new Error("Department not found");
  return updated;
}

export interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  parentDepartmentId: string | null;
  parentName: string | null;
  costCenterAccountId: string | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  headEmployeeId: string | null;
  headName: string | null;
  headEmployeeNumber: string | null;
  /** Headcount excluding people who have left. */
  employeeCount: number;
  payrollCost: number;
}

/**
 * The list, with the two numbers the page actually shows.
 *
 * Headcount and payroll cost are computed in the query rather than by fetching
 * every employee — the Mongo page runs one countDocuments per department,
 * which is a query per row.
 */
export async function listDepartments(
  tx: Tx,
  opts: {
    search?: string;
    isActive?: boolean | null;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ rows: DepartmentRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const filters = [sql`TRUE`];
  if (opts.search?.trim()) {
    const like = `%${opts.search.trim()}%`;
    filters.push(sql`(d.name ILIKE ${like} OR d.code ILIKE ${like})`);
  }
  if (opts.isActive === true) filters.push(sql`d.is_active`);
  if (opts.isActive === false) filters.push(sql`NOT d.is_active`);
  const where = sql.join(filters, sql` AND `);

  const rows = (await tx.execute(sql`
    SELECT d.id, d.code, d.name, d.description, d.is_active,
           d.parent_department_id, p.name AS parent_name,
           d.cost_center_account_id, a.account_code, a.account_name,
           d.head_employee_id, h.full_name AS head_name,
           h.employee_number AS head_employee_number,
           COALESCE(staff.headcount, 0)    AS employee_count,
           COALESCE(staff.payroll_cost, 0) AS payroll_cost,
           COUNT(*) OVER ()                AS total
      FROM departments d
      LEFT JOIN departments p ON p.id = d.parent_department_id
      LEFT JOIN accounts a    ON a.id = d.cost_center_account_id
      LEFT JOIN employees h   ON h.id = d.head_employee_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS headcount,
               COALESCE(SUM(e.gross_salary), 0) AS payroll_cost
          FROM employees e
         WHERE e.department_id = d.id
           AND e.status <> 'terminated'
      ) staff ON TRUE
     WHERE ${where}
     ORDER BY d.name
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    rows: rows.map(mapDepartment),
    total: rows.length ? Number(rows[0].total) : 0,
  };
}

export async function getDepartment(
  tx: Tx,
  id: string,
): Promise<DepartmentRow | null> {
  const rows = (await tx.execute(sql`
    SELECT d.id, d.code, d.name, d.description, d.is_active,
           d.parent_department_id, p.name AS parent_name,
           d.cost_center_account_id, a.account_code, a.account_name,
           d.head_employee_id, h.full_name AS head_name,
           h.employee_number AS head_employee_number,
           COALESCE(staff.headcount, 0)    AS employee_count,
           COALESCE(staff.payroll_cost, 0) AS payroll_cost,
           1 AS total
      FROM departments d
      LEFT JOIN departments p ON p.id = d.parent_department_id
      LEFT JOIN accounts a    ON a.id = d.cost_center_account_id
      LEFT JOIN employees h   ON h.id = d.head_employee_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS headcount,
               COALESCE(SUM(e.gross_salary), 0) AS payroll_cost
          FROM employees e
         WHERE e.department_id = d.id
           AND e.status <> 'terminated'
      ) staff ON TRUE
     WHERE d.id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.length ? mapDepartment(rows[0]) : null;
}

function mapDepartment(r: Record<string, unknown>): DepartmentRow {
  return {
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    description: (r.description as string) ?? null,
    isActive: Boolean(r.is_active),
    parentDepartmentId: (r.parent_department_id as string) ?? null,
    parentName: (r.parent_name as string) ?? null,
    costCenterAccountId: (r.cost_center_account_id as string) ?? null,
    costCenterCode: (r.account_code as string) ?? null,
    costCenterName: (r.account_name as string) ?? null,
    headEmployeeId: (r.head_employee_id as string) ?? null,
    headName: (r.head_name as string) ?? null,
    headEmployeeNumber: (r.head_employee_number as string) ?? null,
    employeeCount: Number(r.employee_count ?? 0),
    payrollCost: Number(r.payroll_cost ?? 0),
  };
}

/** For pickers: the active departments, cheapest possible shape. */
export async function listActiveDepartments(tx: Tx) {
  return tx
    .select({
      id: departments.id,
      code: departments.code,
      name: departments.name,
    })
    .from(departments)
    .where(eq(departments.isActive, true))
    .orderBy(asc(departments.name));
}

/**
 * Deactivating hides a department from every picker, and the source does it
 * without a word about the people still filed under it — who then show a
 * department that cannot be re-selected on their own edit form.
 *
 * The count comes back so the caller can say so.
 */
export async function setDepartmentActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actor?: { id?: string | null; name?: string | null },
) {
  const [affected] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS staff
      FROM employees
     WHERE department_id = ${id}::uuid AND status <> 'terminated'
  `)) as unknown as Array<{ staff: number }>;

  const [updated] = await tx
    .update(departments)
    .set({
      isActive,
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(departments.id, id))
    .returning();

  if (!updated) throw new Error("Department not found");
  return { department: updated, staffAffected: Number(affected?.staff ?? 0) };
}

/**
 * Removing one outright.
 *
 * Allowed only when nothing points at it. The foreign keys would refuse
 * anyway; refusing here means the message names the reason instead of quoting
 * a constraint.
 */
export async function deleteDepartment(tx: Tx, id: string) {
  const [counts] = (await tx.execute(sql`
    SELECT (SELECT COUNT(*) FROM employees   WHERE department_id = ${id}::uuid)::int AS staff,
           (SELECT COUNT(*) FROM departments WHERE parent_department_id = ${id}::uuid)::int AS children
  `)) as unknown as Array<{ staff: number; children: number }>;

  if (Number(counts.staff) > 0) {
    throw new Error(
      `This department still has ${counts.staff} employee(s). Move them first, or deactivate the department instead.`,
    );
  }
  if (Number(counts.children) > 0) {
    throw new Error(
      `This department has ${counts.children} sub-department(s). Reassign or remove them first.`,
    );
  }

  const [deleted] = await tx
    .delete(departments)
    .where(eq(departments.id, id))
    .returning({ id: departments.id });

  if (!deleted) throw new Error("Department not found");
  return { deleted: true };
}
