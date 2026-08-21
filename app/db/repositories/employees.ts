import { eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  employees,
  employeeDocuments,
  employmentEvents,
  salaryChanges,
  parties,
} from "../schema";

/**
 * Employees — the HR master record.
 *
 * `employees` owns the employment relationship; `parties` keeps the financial
 * identity the ledger references. Migration 0045 has the reasoning and the
 * trigger that keeps the party row in step, which is what replaces the four
 * hand-written sync blocks in hr-employee-actions.js.
 *
 * Everything here takes a transaction and returns plain data. Nothing reads
 * the session, and nothing writes a company_id filter — RLS does that (see
 * docs/BUILDING-ON-POSTGRES.md).
 */

export type EmployeeStatus =
  | "active"
  | "probation"
  | "on_leave"
  | "suspended"
  | "terminated";

const trimmed = (v: unknown) => {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
};

const money = (v: unknown) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return n.toFixed(4);
};

/** EMP-00001. The same race-free counter every other document uses (0001). */
async function nextEmployeeNumber(tx: Tx, companyId: string): Promise<string> {
  const rows = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'EMP') AS number`,
  )) as unknown as Array<{ number: string }>;
  return rows[0].number;
}

export interface CreateEmployeeInput {
  companyId: string;
  firstName: string;
  lastName: string;
  /** Optional; generated when absent. Unique per company, both here and on the party. */
  employeeNumber?: string | null;
  /** Identity, which lives on the party. */
  email?: string | null;
  phone?: string | null;

  dateOfBirth?: string | null;
  gender?: string | null;
  nationalId?: string | null;
  kraPin?: string | null;
  nssfNumber?: string | null;
  shaNumber?: string | null;
  passportNumber?: string | null;
  nationality?: string | null;

  departmentId?: string | null;
  designation?: string | null;
  employmentType?: string | null;
  hireDate: string;
  managerId?: string | null;
  workLocation?: string | null;
  jobGrade?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  contractType?: string | null;

  basicSalary?: number | string | null;
  allowanceHousing?: number | string | null;
  allowanceTransport?: number | string | null;
  allowanceMedical?: number | string | null;
  allowanceOther?: number | string | null;
  paymentMethod?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  bankBranch?: string | null;
  mpesaNumber?: string | null;

  emergencyName?: string | null;
  emergencyRelationship?: string | null;
  emergencyPhone?: string | null;

  /** Link an existing login. */
  userId?: string | null;
  /** Attach to an existing party instead of creating one. */
  partyId?: string | null;
  notes?: string | null;
  actor?: { id?: string | null; name?: string | null };
}

/**
 * Creates the party and the employee together.
 *
 * The source does this in a Mongo transaction and then, separately, seeds
 * leave balances with a second save. Here it is one statement pair inside the
 * caller's transaction: either both rows exist or neither does, with no
 * half-created employee who has a financial identity and no HR record.
 *
 * The 'hire' event is written here rather than by the action, so an employee
 * created through the API has the same history as one created through the
 * form.
 */
export async function createEmployee(tx: Tx, input: CreateEmployeeInput) {
  const firstName = trimmed(input.firstName);
  const lastName = trimmed(input.lastName);
  if (!firstName) throw new Error("First name is required");
  if (!lastName) throw new Error("Last name is required");
  if (!input.hireDate) throw new Error("Hire date is required");

  const employeeNumber =
    trimmed(input.employeeNumber) ??
    (await nextEmployeeNumber(tx, input.companyId));
  const fullName = `${firstName} ${lastName}`;

  let partyId = input.partyId ?? null;
  if (!partyId) {
    const [party] = await tx
      .insert(parties)
      .values({
        companyId: input.companyId,
        name: fullName,
        primaryType: "employee",
        isEmployee: true,
        email: trimmed(input.email),
        phone: trimmed(input.phone),
        employeeNumber,
        createdById: input.actor?.id ?? null,
      })
      .returning({ id: parties.id });
    partyId = party.id;
  }

  const [created] = await tx
    .insert(employees)
    .values({
      companyId: input.companyId,
      partyId,
      userId: trimmed(input.userId),
      employeeNumber,
      firstName,
      lastName,
      dateOfBirth: trimmed(input.dateOfBirth),
      gender: trimmed(input.gender),
      nationalId: trimmed(input.nationalId),
      kraPin: trimmed(input.kraPin)?.toUpperCase() ?? null,
      nssfNumber: trimmed(input.nssfNumber),
      shaNumber: trimmed(input.shaNumber),
      passportNumber: trimmed(input.passportNumber),
      nationality: trimmed(input.nationality) ?? "Kenyan",
      departmentId: trimmed(input.departmentId),
      designation: trimmed(input.designation),
      employmentType: trimmed(input.employmentType) ?? "full_time",
      // Every new employee starts on probation, as in the source.
      status: "probation",
      hireDate: input.hireDate,
      contractStart: trimmed(input.contractStart),
      contractEnd: trimmed(input.contractEnd),
      contractType: trimmed(input.contractType),
      managerId: trimmed(input.managerId),
      workLocation: trimmed(input.workLocation),
      jobGrade: trimmed(input.jobGrade),
      basicSalary: money(input.basicSalary),
      allowanceHousing: money(input.allowanceHousing),
      allowanceTransport: money(input.allowanceTransport),
      allowanceMedical: money(input.allowanceMedical),
      allowanceOther: money(input.allowanceOther),
      paymentMethod: trimmed(input.paymentMethod) ?? "bank",
      bankName: trimmed(input.bankName),
      bankAccount: trimmed(input.bankAccount),
      bankBranch: trimmed(input.bankBranch),
      mpesaNumber: trimmed(input.mpesaNumber),
      emergencyName: trimmed(input.emergencyName),
      emergencyRelationship: trimmed(input.emergencyRelationship),
      emergencyPhone: trimmed(input.emergencyPhone),
      notes: trimmed(input.notes),
      createdById: input.actor?.id ?? null,
      createdByName: input.actor?.name ?? null,
    })
    .returning();

  await tx.insert(employmentEvents).values({
    companyId: input.companyId,
    employeeId: created.id,
    eventType: "hire",
    field: "status",
    newValue: "probation",
    effectiveDate: input.hireDate,
    changedById: input.actor?.id ?? null,
    changedByName: input.actor?.name ?? null,
  });

  return created;
}

export interface UpdateEmployeeInput {
  id: string;
  companyId: string;
  firstName?: string;
  lastName?: string;
  employeeNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  nationalId?: string | null;
  kraPin?: string | null;
  nssfNumber?: string | null;
  shaNumber?: string | null;
  passportNumber?: string | null;
  nationality?: string | null;
  departmentId?: string | null;
  designation?: string | null;
  employmentType?: string | null;
  managerId?: string | null;
  workLocation?: string | null;
  jobGrade?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  contractType?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  emergencyName?: string | null;
  emergencyRelationship?: string | null;
  emergencyPhone?: string | null;
  emergencyAlternatePhone?: string | null;
  notes?: string | null;
  actor?: { id?: string | null; name?: string | null };
}

/**
 * Edits everything except pay, which has its own path because it is
 * finance-sensitive and writes a history record.
 *
 * ABSENT MEANS ABSENT. The source treats an empty field as "keep the old
 * value" — `formData.get("designation") || profile.employment.designation` —
 * so clearing a designation, a job grade or a work location is IMPOSSIBLE
 * through the form: submitting a blank silently restores what was there. Here
 * a key that is present is applied, including when it is empty; a key that is
 * absent is left alone. `shiftStart`/`shiftEnd` already worked this way in the
 * source, which is what made the inconsistency visible.
 *
 * A department, designation, grade or employment-type change is recorded as an
 * employment event — the source only records confirmations and terminations,
 * so a promotion left no trace at all.
 */
export async function updateEmployee(tx: Tx, input: UpdateEmployeeInput) {
  const before = await getEmployeeRow(tx, input.id);
  if (!before) throw new Error("Employee not found");

  const has = (k: keyof UpdateEmployeeInput) => input[k] !== undefined;

  const firstName = has("firstName") ? trimmed(input.firstName) : undefined;
  const lastName = has("lastName") ? trimmed(input.lastName) : undefined;
  if (has("firstName") && !firstName) throw new Error("First name is required");
  if (has("lastName") && !lastName) throw new Error("Last name is required");

  const patch: Record<string, unknown> = {
    lastModifiedById: input.actor?.id ?? null,
    lastModifiedByName: input.actor?.name ?? null,
    updatedAt: new Date(),
  };

  if (firstName) patch.firstName = firstName;
  if (lastName) patch.lastName = lastName;
  if (has("employeeNumber")) {
    const n = trimmed(input.employeeNumber);
    if (!n) throw new Error("Employee number cannot be blank");
    patch.employeeNumber = n;
  }
  for (const key of [
    "dateOfBirth",
    "gender",
    "nationalId",
    "nssfNumber",
    "shaNumber",
    "passportNumber",
    "nationality",
    "departmentId",
    "designation",
    "employmentType",
    "managerId",
    "workLocation",
    "jobGrade",
    "contractStart",
    "contractEnd",
    "contractType",
    "shiftStart",
    "shiftEnd",
    "emergencyName",
    "emergencyRelationship",
    "emergencyPhone",
    "emergencyAlternatePhone",
    "notes",
  ] as const) {
    if (has(key)) patch[key] = trimmed(input[key]);
  }
  if (has("kraPin")) patch.kraPin = trimmed(input.kraPin)?.toUpperCase() ?? null;
  if (has("nationality") && !patch.nationality) patch.nationality = "Kenyan";

  const [updated] = await tx
    .update(employees)
    .set(patch)
    .where(eq(employees.id, input.id))
    .returning();

  // Identity lives on the party; the trigger carries name, number, department
  // and designation across. Email and phone are only ON the party, so they are
  // written here.
  if (has("email") || has("phone")) {
    await tx
      .update(parties)
      .set({
        ...(has("email") ? { email: trimmed(input.email) } : {}),
        ...(has("phone") ? { phone: trimmed(input.phone) } : {}),
        lastModifiedById: input.actor?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(parties.id, before.partyId));
  }

  // What actually changed about the employment, recorded.
  const events: Array<{
    eventType: string;
    field: string;
    previousValue: string | null;
    newValue: string | null;
  }> = [];

  if (has("departmentId") && before.departmentId !== updated.departmentId) {
    events.push({
      eventType: "department_change",
      field: "department",
      previousValue: before.departmentName,
      newValue: await departmentName(tx, updated.departmentId),
    });
  }
  if (has("designation") && before.designation !== updated.designation) {
    events.push({
      eventType: "designation_change",
      field: "designation",
      previousValue: before.designation,
      newValue: updated.designation,
    });
  }
  if (has("jobGrade") && before.jobGrade !== updated.jobGrade) {
    events.push({
      eventType: "grade_change",
      field: "jobGrade",
      previousValue: before.jobGrade,
      newValue: updated.jobGrade,
    });
  }
  if (has("employmentType") && before.employmentType !== updated.employmentType) {
    events.push({
      eventType: "employment_type_change",
      field: "employmentType",
      previousValue: before.employmentType,
      newValue: updated.employmentType,
    });
  }

  for (const e of events) {
    await tx.insert(employmentEvents).values({
      companyId: input.companyId,
      employeeId: input.id,
      eventType: e.eventType,
      field: e.field,
      previousValue: e.previousValue,
      newValue: e.newValue,
      effectiveDate: new Date().toISOString().slice(0, 10),
      changedById: input.actor?.id ?? null,
      changedByName: input.actor?.name ?? null,
    });
  }

  return updated;
}

async function departmentName(tx: Tx, departmentId: string | null) {
  if (!departmentId) return null;
  const rows = (await tx.execute(
    sql`SELECT name FROM departments WHERE id = ${departmentId}::uuid`,
  )) as unknown as Array<{ name: string }>;
  return rows.length ? rows[0].name : null;
}

export interface UpdateCompensationInput {
  id: string;
  companyId: string;
  basicSalary: number | string;
  allowanceHousing?: number | string | null;
  allowanceTransport?: number | string | null;
  allowanceMedical?: number | string | null;
  allowanceOther?: number | string | null;
  paymentMethod?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  bankBranch?: string | null;
  mpesaNumber?: string | null;
  effectiveDate?: string | null;
  reason?: string | null;
  actor?: { id?: string | null; name?: string | null };
}

/**
 * Changing pay, and the record of it.
 *
 * The history row is written in the same transaction as the change. In the
 * source the profile is saved first and SalaryHistory.create() runs after,
 * outside any transaction — so a failure between them leaves a new salary with
 * no record of what it was before, which is the one thing the table exists to
 * answer.
 */
export async function updateCompensation(tx: Tx, input: UpdateCompensationInput) {
  const before = await getEmployeeRow(tx, input.id);
  if (!before) throw new Error("Employee not found");

  const effectiveDate =
    trimmed(input.effectiveDate) ?? new Date().toISOString().slice(0, 10);

  const [updated] = await tx
    .update(employees)
    .set({
      basicSalary: money(input.basicSalary),
      allowanceHousing: money(input.allowanceHousing),
      allowanceTransport: money(input.allowanceTransport),
      allowanceMedical: money(input.allowanceMedical),
      allowanceOther: money(input.allowanceOther),
      paymentMethod: trimmed(input.paymentMethod) ?? "bank",
      bankName: trimmed(input.bankName),
      bankAccount: trimmed(input.bankAccount),
      bankBranch: trimmed(input.bankBranch),
      mpesaNumber: trimmed(input.mpesaNumber),
      lastReviewDate: effectiveDate,
      lastReviewedById: input.actor?.id ?? null,
      lastReviewedByName: input.actor?.name ?? null,
      lastModifiedById: input.actor?.id ?? null,
      lastModifiedByName: input.actor?.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(employees.id, input.id))
    .returning();

  await tx.insert(salaryChanges).values({
    companyId: input.companyId,
    employeeId: input.id,
    previousBasic: before.basicSalary,
    previousHousing: before.allowanceHousing,
    previousTransport: before.allowanceTransport,
    previousMedical: before.allowanceMedical,
    previousOther: before.allowanceOther,
    newBasic: updated.basicSalary,
    newHousing: updated.allowanceHousing,
    newTransport: updated.allowanceTransport,
    newMedical: updated.allowanceMedical,
    newOther: updated.allowanceOther,
    effectiveDate,
    reason: trimmed(input.reason),
    changedById: input.actor?.id ?? null,
    changedByName: input.actor?.name ?? null,
  });

  return updated;
}

/** probation → active. */
export async function confirmEmployee(
  tx: Tx,
  input: {
    id: string;
    companyId: string;
    confirmationDate?: string | null;
    actor?: { id?: string | null; name?: string | null };
  },
) {
  const before = await getEmployeeRow(tx, input.id);
  if (!before) throw new Error("Employee not found");
  if (before.status !== "probation") {
    throw new Error("This employee is not on probation.");
  }

  const on = trimmed(input.confirmationDate) ?? new Date().toISOString().slice(0, 10);

  const [updated] = await tx
    .update(employees)
    .set({
      status: "active",
      confirmationDate: on,
      lastModifiedById: input.actor?.id ?? null,
      lastModifiedByName: input.actor?.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(employees.id, input.id))
    .returning();

  await tx.insert(employmentEvents).values({
    companyId: input.companyId,
    employeeId: input.id,
    eventType: "probation_confirmation",
    field: "status",
    previousValue: "probation",
    newValue: "active",
    effectiveDate: on,
    changedById: input.actor?.id ?? null,
    changedByName: input.actor?.name ?? null,
  });

  return updated;
}

/**
 * Termination.
 *
 * The reason goes in its own column. The source prepends
 * `TERMINATED: <reason>` to the free-text notes field, which mixes an
 * operational fact into whatever else was written there and cannot be queried.
 *
 * Deactivating the login is NOT done here: `users` is a platform table outside
 * this tenant's RLS scope, so it is the action's job — see
 * app/db/actions/employee-actions.ts.
 */
export async function terminateEmployee(
  tx: Tx,
  input: {
    id: string;
    companyId: string;
    terminationDate?: string | null;
    reason?: string | null;
    actor?: { id?: string | null; name?: string | null };
  },
) {
  const before = await getEmployeeRow(tx, input.id);
  if (!before) throw new Error("Employee not found");
  if (before.status === "terminated") {
    throw new Error("This employee has already been terminated.");
  }

  const on = trimmed(input.terminationDate) ?? new Date().toISOString().slice(0, 10);
  if (on < before.hireDate) {
    throw new Error("A termination date cannot fall before the hire date.");
  }

  const [updated] = await tx
    .update(employees)
    .set({
      status: "terminated",
      terminationDate: on,
      terminationReason: trimmed(input.reason),
      lastModifiedById: input.actor?.id ?? null,
      lastModifiedByName: input.actor?.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(employees.id, input.id))
    .returning();

  // The party stops being usable for new documents, matching the source.
  await tx
    .update(parties)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(parties.id, before.partyId));

  await tx.insert(employmentEvents).values({
    companyId: input.companyId,
    employeeId: input.id,
    eventType: "termination",
    field: "status",
    previousValue: before.status,
    newValue: "terminated",
    effectiveDate: on,
    reason: trimmed(input.reason),
    changedById: input.actor?.id ?? null,
    changedByName: input.actor?.name ?? null,
  });

  return updated;
}

/** Suspend / reinstate / put back to active, with the event to match. */
export async function setEmployeeStatus(
  tx: Tx,
  input: {
    id: string;
    companyId: string;
    status: EmployeeStatus;
    reason?: string | null;
    actor?: { id?: string | null; name?: string | null };
  },
) {
  if (input.status === "terminated") {
    throw new Error("Use termination to end an employment.");
  }
  const before = await getEmployeeRow(tx, input.id);
  if (!before) throw new Error("Employee not found");
  if (before.status === "terminated") {
    throw new Error("This employment has ended and cannot be reopened.");
  }
  if (before.status === input.status) return before;

  const [updated] = await tx
    .update(employees)
    .set({
      status: input.status,
      lastModifiedById: input.actor?.id ?? null,
      lastModifiedByName: input.actor?.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(employees.id, input.id))
    .returning();

  await tx.insert(employmentEvents).values({
    companyId: input.companyId,
    employeeId: input.id,
    eventType: "status_change",
    field: "status",
    previousValue: before.status,
    newValue: input.status,
    effectiveDate: new Date().toISOString().slice(0, 10),
    reason: trimmed(input.reason),
    changedById: input.actor?.id ?? null,
    changedByName: input.actor?.name ?? null,
  });

  return updated;
}

/** Links a login to an employment record. */
export async function linkEmployeeUser(
  tx: Tx,
  input: { id: string; userId: string | null },
) {
  const [updated] = await tx
    .update(employees)
    .set({ userId: input.userId, updatedAt: new Date() })
    .where(eq(employees.id, input.id))
    .returning();
  if (!updated) throw new Error("Employee not found");
  return updated;
}

export async function setEmployeePhoto(
  tx: Tx,
  input: {
    id: string;
    url: string | null;
    publicId: string | null;
    actor?: { id?: string | null; name?: string | null };
  },
) {
  const [updated] = await tx
    .update(employees)
    .set({
      photoUrl: input.url,
      photoPublicId: input.publicId,
      lastModifiedById: input.actor?.id ?? null,
      lastModifiedByName: input.actor?.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(employees.id, input.id))
    .returning();
  if (!updated) throw new Error("Employee not found");
  return updated;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** The raw row, for repository-internal before/after comparison. */
async function getEmployeeRow(tx: Tx, id: string) {
  const rows = (await tx.execute(sql`
    SELECT e.*, d.name AS department_name
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    partyId: String(r.party_id),
    status: String(r.status),
    hireDate: String(r.hire_date),
    departmentId: (r.department_id as string) ?? null,
    departmentName: (r.department_name as string) ?? null,
    designation: (r.designation as string) ?? null,
    jobGrade: (r.job_grade as string) ?? null,
    employmentType: String(r.employment_type),
    basicSalary: String(r.basic_salary),
    allowanceHousing: String(r.allowance_housing),
    allowanceTransport: String(r.allowance_transport),
    allowanceMedical: String(r.allowance_medical),
    allowanceOther: String(r.allowance_other),
    photoPublicId: (r.photo_public_id as string) ?? null,
  };
}

export interface EmployeeListRow {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  photoUrl: string | null;
  departmentId: string | null;
  department: string | null;
  designation: string | null;
  employmentType: string;
  status: string;
  hireDate: string;
  basicSalary: number;
  grossSalary: number;
  email: string | null;
  phone: string | null;
  hasLogin: boolean;
}

/**
 * The staff list.
 *
 * Terminated employees are hidden unless asked for by name, which is the
 * source's default. Search covers number, name and designation — the source
 * builds four case-insensitive regexes, one of which (`firstName`) cannot
 * match a search for a full name; here it is one match against the generated
 * full_name column, so "jane wanjiru" finds Jane Wanjiru.
 */
export async function listEmployees(
  tx: Tx,
  opts: {
    search?: string;
    departmentId?: string | null;
    status?: string | null;
    includeTerminated?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ rows: EmployeeListRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const filters = [sql`TRUE`];
  if (opts.status) {
    filters.push(sql`e.status = ${opts.status}`);
  } else if (!opts.includeTerminated) {
    filters.push(sql`e.status <> 'terminated'`);
  }
  if (opts.departmentId) {
    filters.push(sql`e.department_id = ${opts.departmentId}::uuid`);
  }
  if (opts.search?.trim()) {
    const like = `%${opts.search.trim()}%`;
    filters.push(sql`(
      e.full_name ILIKE ${like}
      OR e.employee_number ILIKE ${like}
      OR e.designation ILIKE ${like}
      OR p.email ILIKE ${like}
    )`);
  }
  const where = sql.join(filters, sql` AND `);

  const rows = (await tx.execute(sql`
    SELECT e.id, e.employee_number, e.first_name, e.last_name, e.full_name,
           e.photo_url, e.department_id, d.name AS department, e.designation,
           e.employment_type, e.status, e.hire_date,
           e.basic_salary, e.gross_salary,
           p.email, p.phone,
           (e.user_id IS NOT NULL) AS has_login,
           COUNT(*) OVER () AS total
      FROM employees e
      JOIN parties p       ON p.id = e.party_id
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE ${where}
     ORDER BY e.full_name
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    rows: rows.map(mapListRow),
    total: rows.length ? Number(rows[0].total) : 0,
  };
}

function mapListRow(r: Record<string, unknown>): EmployeeListRow {
  return {
    id: String(r.id),
    employeeNumber: String(r.employee_number),
    firstName: String(r.first_name),
    lastName: String(r.last_name),
    fullName: String(r.full_name),
    photoUrl: (r.photo_url as string) ?? null,
    departmentId: (r.department_id as string) ?? null,
    department: (r.department as string) ?? null,
    designation: (r.designation as string) ?? null,
    employmentType: String(r.employment_type),
    status: String(r.status),
    hireDate: String(r.hire_date),
    basicSalary: Number(r.basic_salary ?? 0),
    grossSalary: Number(r.gross_salary ?? 0),
    email: (r.email as string) ?? null,
    phone: (r.phone as string) ?? null,
    hasLogin: Boolean(r.has_login),
  };
}

/** Everything one employee's page shows, in one round trip. */
export async function getEmployee(tx: Tx, id: string) {
  const rows = (await tx.execute(sql`
    SELECT e.*, d.name AS department, p.email, p.phone, p.tax_pin,
           m.full_name AS manager_name, m.employee_number AS manager_number
      FROM employees e
      JOIN parties p          ON p.id = e.party_id
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN employees m   ON m.id = e.manager_id
     WHERE e.id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.length ? mapEmployee(rows[0]) : null;
}

export async function getEmployeeByUser(tx: Tx, userId: string) {
  const rows = (await tx.execute(sql`
    SELECT e.*, d.name AS department, p.email, p.phone, p.tax_pin,
           m.full_name AS manager_name, m.employee_number AS manager_number
      FROM employees e
      JOIN parties p          ON p.id = e.party_id
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN employees m   ON m.id = e.manager_id
     WHERE e.user_id = ${userId}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.length ? mapEmployee(rows[0]) : null;
}

export async function getEmployeeByParty(tx: Tx, partyId: string) {
  const rows = (await tx.execute(sql`
    SELECT e.*, d.name AS department, p.email, p.phone, p.tax_pin,
           m.full_name AS manager_name, m.employee_number AS manager_number
      FROM employees e
      JOIN parties p          ON p.id = e.party_id
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN employees m   ON m.id = e.manager_id
     WHERE e.party_id = ${partyId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.length ? mapEmployee(rows[0]) : null;
}

export type Employee = ReturnType<typeof mapEmployee>;

function mapEmployee(r: Record<string, unknown>) {
  const s = (k: string) => (r[k] as string) ?? null;
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    id: String(r.id),
    partyId: String(r.party_id),
    userId: s("user_id"),
    employeeNumber: String(r.employee_number),
    firstName: String(r.first_name),
    lastName: String(r.last_name),
    fullName: String(r.full_name),
    email: s("email"),
    phone: s("phone"),
    dateOfBirth: s("date_of_birth"),
    gender: s("gender"),
    nationalId: s("national_id"),
    kraPin: s("kra_pin"),
    nssfNumber: s("nssf_number"),
    shaNumber: s("sha_number"),
    passportNumber: s("passport_number"),
    nationality: s("nationality"),
    photoUrl: s("photo_url"),
    photoPublicId: s("photo_public_id"),

    departmentId: s("department_id"),
    department: s("department"),
    designation: s("designation"),
    employmentType: String(r.employment_type),
    status: String(r.status),
    hireDate: String(r.hire_date),
    confirmationDate: s("confirmation_date"),
    terminationDate: s("termination_date"),
    terminationReason: s("termination_reason"),
    contractStart: s("contract_start"),
    contractEnd: s("contract_end"),
    contractType: s("contract_type"),
    managerId: s("manager_id"),
    managerName: s("manager_name"),
    managerNumber: s("manager_number"),
    workLocation: s("work_location"),
    jobGrade: s("job_grade"),
    shiftStart: s("shift_start"),
    shiftEnd: s("shift_end"),

    basicSalary: n("basic_salary"),
    currency: String(r.currency ?? "KES"),
    allowanceHousing: n("allowance_housing"),
    allowanceTransport: n("allowance_transport"),
    allowanceMedical: n("allowance_medical"),
    allowanceOther: n("allowance_other"),
    grossSalary: n("gross_salary"),
    paymentMethod: String(r.payment_method ?? "bank"),
    bankName: s("bank_name"),
    bankAccount: s("bank_account"),
    bankBranch: s("bank_branch"),
    mpesaNumber: s("mpesa_number"),
    lastReviewDate: s("last_review_date"),

    emergencyName: s("emergency_name"),
    emergencyRelationship: s("emergency_relationship"),
    emergencyPhone: s("emergency_phone"),
    emergencyAlternatePhone: s("emergency_alternate_phone"),

    notes: s("notes"),
    createdAt: r.created_at ? new Date(r.created_at as string).toISOString() : null,
    updatedAt: r.updated_at ? new Date(r.updated_at as string).toISOString() : null,
  };
}

/** For manager and employee pickers. */
export async function listEmployeesForPicker(
  tx: Tx,
  opts: { search?: string; excludeId?: string | null; limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const filters = [sql`e.status <> 'terminated'`];
  if (opts.search?.trim()) {
    const like = `%${opts.search.trim()}%`;
    filters.push(
      sql`(e.full_name ILIKE ${like} OR e.employee_number ILIKE ${like})`,
    );
  }
  if (opts.excludeId) filters.push(sql`e.id <> ${opts.excludeId}::uuid`);

  const rows = (await tx.execute(sql`
    SELECT e.id, e.party_id, e.employee_number, e.full_name, e.designation,
           d.name AS department
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE ${sql.join(filters, sql` AND `)}
     ORDER BY e.full_name
     LIMIT ${limit}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    partyId: String(r.party_id),
    employeeNumber: String(r.employee_number),
    name: String(r.full_name),
    designation: (r.designation as string) ?? null,
    department: (r.department as string) ?? null,
  }));
}

/**
 * The numbers on the HR dashboard, in one query.
 *
 * The source runs five separate counts plus an aggregation. This is one pass
 * over one table.
 */
export async function getHeadcountStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*) FILTER (WHERE status = 'active')::int     AS active,
           COUNT(*) FILTER (WHERE status = 'probation')::int  AS probation,
           COUNT(*) FILTER (WHERE status = 'on_leave')::int   AS on_leave,
           COUNT(*) FILTER (WHERE status = 'suspended')::int  AS suspended,
           COUNT(*) FILTER (WHERE status = 'terminated')::int AS terminated,
           COUNT(*) FILTER (WHERE status <> 'terminated')::int AS headcount,
           COALESCE(SUM(gross_salary) FILTER (WHERE status <> 'terminated'), 0) AS monthly_payroll
      FROM employees
  `)) as unknown as Array<Record<string, unknown>>;

  const byDepartment = (await tx.execute(sql`
    SELECT e.department_id, COALESCE(d.name, 'Unassigned') AS department,
           COUNT(*)::int AS count
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.status <> 'terminated'
     GROUP BY e.department_id, d.name
     ORDER BY count DESC
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    active: Number(row.active),
    probation: Number(row.probation),
    onLeave: Number(row.on_leave),
    suspended: Number(row.suspended),
    terminated: Number(row.terminated),
    headcount: Number(row.headcount),
    monthlyPayroll: Number(row.monthly_payroll),
    byDepartment: byDepartment.map((d) => ({
      departmentId: (d.department_id as string) ?? null,
      department: String(d.department),
      count: Number(d.count),
    })),
  };
}

/** Contracts ending within `daysAhead`, soonest first. */
export async function getExpiringContracts(tx: Tx, daysAhead = 30) {
  const days = Math.min(Math.max(daysAhead, 1), 365);
  const rows = (await tx.execute(sql`
    SELECT e.id, e.employee_number, e.full_name, e.designation,
           d.name AS department, e.contract_end, e.contract_type,
           (e.contract_end - CURRENT_DATE)::int AS days_remaining
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.status <> 'terminated'
       AND e.contract_end IS NOT NULL
       AND e.contract_end BETWEEN CURRENT_DATE
                              AND CURRENT_DATE + ${days}::int
     ORDER BY e.contract_end
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    employeeNumber: String(r.employee_number),
    name: String(r.full_name),
    department: (r.department as string) ?? null,
    designation: (r.designation as string) ?? null,
    contractEnd: String(r.contract_end),
    contractType: (r.contract_type as string) ?? null,
    daysRemaining: Number(r.days_remaining),
  }));
}

// ── History ──────────────────────────────────────────────────────────────────

export async function listEmploymentEvents(tx: Tx, employeeId: string, limit = 50) {
  const rows = (await tx.execute(sql`
    SELECT id, event_type, field, previous_value, new_value,
           effective_date, reason, changed_by_name, created_at
      FROM employment_events
     WHERE employee_id = ${employeeId}::uuid
     ORDER BY effective_date DESC, created_at DESC
     LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    eventType: String(r.event_type),
    field: (r.field as string) ?? null,
    previousValue: (r.previous_value as string) ?? null,
    newValue: (r.new_value as string) ?? null,
    effectiveDate: String(r.effective_date),
    reason: (r.reason as string) ?? null,
    changedByName: (r.changed_by_name as string) ?? null,
  }));
}

export async function listSalaryChanges(tx: Tx, employeeId: string, limit = 50) {
  const rows = (await tx.execute(sql`
    SELECT id, previous_basic, previous_gross, new_basic, new_gross,
           basic_change, gross_change, effective_date, reason, changed_by_name
      FROM salary_changes
     WHERE employee_id = ${employeeId}::uuid
     ORDER BY effective_date DESC, created_at DESC
     LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    previousBasic: Number(r.previous_basic),
    previousGross: Number(r.previous_gross),
    newBasic: Number(r.new_basic),
    newGross: Number(r.new_gross),
    basicChange: Number(r.basic_change),
    grossChange: Number(r.gross_change),
    effectiveDate: String(r.effective_date),
    reason: (r.reason as string) ?? null,
    changedByName: (r.changed_by_name as string) ?? null,
  }));
}

// ── Documents ────────────────────────────────────────────────────────────────

export async function addEmployeeDocument(
  tx: Tx,
  input: {
    companyId: string;
    employeeId: string;
    docType: string;
    name: string;
    url: string;
    publicId?: string | null;
    resourceType?: "image" | "raw" | "video";
    expiryDate?: string | null;
    actor?: { id?: string | null; name?: string | null };
  },
) {
  const [created] = await tx
    .insert(employeeDocuments)
    .values({
      companyId: input.companyId,
      employeeId: input.employeeId,
      docType: input.docType,
      name: input.name,
      url: input.url,
      publicId: input.publicId ?? null,
      resourceType: input.resourceType ?? "raw",
      expiryDate: trimmed(input.expiryDate),
      uploadedById: input.actor?.id ?? null,
      uploadedByName: input.actor?.name ?? null,
    })
    .returning();
  return created;
}

export async function listEmployeeDocuments(tx: Tx, employeeId: string) {
  const rows = await tx
    .select()
    .from(employeeDocuments)
    .where(eq(employeeDocuments.employeeId, employeeId));

  return rows
    .map((d) => ({
      id: d.id,
      docType: d.docType,
      name: d.name,
      url: d.url,
      publicId: d.publicId,
      resourceType: d.resourceType,
      expiryDate: d.expiryDate,
      uploadedByName: d.uploadedByName,
      createdAt: d.createdAt?.toISOString() ?? null,
    }))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * Removes the row and returns what the caller needs to delete the asset.
 *
 * `resourceType` comes back because Cloudinary needs the right one:
 * deleteEmployeeDocument in the source always passes "raw", so images were
 * removed from the record and left in storage.
 */
export async function deleteEmployeeDocument(tx: Tx, id: string) {
  const [deleted] = await tx
    .delete(employeeDocuments)
    .where(eq(employeeDocuments.id, id))
    .returning();
  if (!deleted) throw new Error("Document not found");
  return { publicId: deleted.publicId, resourceType: deleted.resourceType };
}
