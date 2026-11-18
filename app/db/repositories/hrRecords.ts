import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  hrLetters,
  hrCases,
  hrTrainingRecords,
  hrPerformanceReviews,
  hrVacancies,
  hrCandidates,
  LETTER_KINDS,
  CASE_TYPES,
  CASE_CATEGORIES,
  CASE_OUTCOMES,
  TRAINING_KINDS,
  TRAINING_STATUSES,
  REVIEW_RECOMMENDATIONS,
  VACANCY_STATUSES,
  CANDIDATE_STAGES,
  type ReviewObjective,
} from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * HR records — letters, disciplinary and grievance cases, training and
 * certificates, performance reviews, recruitment (20261116T063101).
 *
 * Same contract as the other repositories: every function takes a `tx` from
 * withTenant(), so RLS confines it to the company, and roles are checked one
 * layer up in hr-records-actions.ts. The rules that keep a record honest — a
 * case cannot close without an outcome, a review cannot complete without a
 * rating, a hired candidate is an employee — are checked here and again by the
 * database's own constraints.
 */

type Actor = { id: string | null; name: string | null };

const today = () => new Date().toISOString().slice(0, 10);
const blank = (v: unknown) => v == null || String(v).trim() === "";
const opt = (v: unknown) => (blank(v) ? null : String(v).trim());

async function nextNumber(tx: Tx, companyId: string, prefix: string) {
  const [row] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, ${prefix}) AS number`,
  )) as unknown as Array<{ number: string }>;
  return row.number;
}

/** The facts a letter or a case needs about an employee, from this company. */
export async function getEmployeeFacts(tx: Tx, employeeId: string) {
  if (!isUuid(employeeId)) return null;
  const [row] = (await tx.execute(sql`
    SELECT e.id, e.employee_number, e.first_name, e.last_name,
           COALESCE(e.full_name, e.first_name || ' ' || e.last_name) AS full_name,
           e.designation, e.status, e.hire_date, e.probation_end_date, e.confirmation_date,
           e.basic_salary, e.gross_salary, e.user_id, e.manager_id, d.name AS department
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.id = ${employeeId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  if (!row) return null;
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(row.id),
    employeeNumber: String(row.employee_number),
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    fullName: String(row.full_name),
    designation: (row.designation as string) ?? null,
    department: (row.department as string) ?? null,
    status: String(row.status),
    hireDate: row.hire_date ? String(row.hire_date).slice(0, 10) : null,
    probationEndDate: row.probation_end_date ? String(row.probation_end_date).slice(0, 10) : null,
    confirmationDate: row.confirmation_date ? String(row.confirmation_date).slice(0, 10) : null,
    basicSalary: num(row.basic_salary),
    grossSalary: num(row.gross_salary),
    userId: (row.user_id as string) ?? null,
    managerId: (row.manager_id as string) ?? null,
  };
}

const employeeJoin = sql`
  JOIN employees e ON e.id = x.employee_id
  LEFT JOIN departments d ON d.id = e.department_id`;
const employeeCols = sql`
  COALESCE(e.full_name, e.first_name || ' ' || e.last_name) AS employee_name,
  e.employee_number, d.name AS department`;

// ── Probation ────────────────────────────────────────────────────────────────

/**
 * Sets or extends the probation end. s.42: probation is at most six months,
 * extendable once by up to six more — twelve in all from the hire date.
 */
export async function setProbationEnd(tx: Tx, employeeId: string, endDate: string, actor: Actor) {
  const emp = await getEmployeeFacts(tx, employeeId);
  if (!emp) throw new Error("Employee not found");
  if (emp.status !== "probation") throw new Error("This employee is not on probation.");
  if (!endDate) throw new Error("Enter the date probation ends.");
  if (emp.hireDate && endDate < emp.hireDate) throw new Error("Probation cannot end before the hire date.");
  if (emp.hireDate) {
    const limit = new Date(`${emp.hireDate}T00:00:00Z`);
    limit.setUTCMonth(limit.getUTCMonth() + 12);
    if (new Date(`${endDate}T00:00:00Z`) > limit) {
      throw new Error("Probation cannot run past twelve months from the hire date (Employment Act s.42).");
    }
  }
  await tx.execute(sql`
    UPDATE employees
       SET probation_end_date = ${endDate}::date,
           last_modified_by_id = ${actor.id}, last_modified_by_name = ${actor.name}, updated_at = now()
     WHERE id = ${employeeId}::uuid
  `);
  return { ...emp, probationEndDate: endDate };
}

/** A new hire on probation gets the s.42 default: six months from the hire date. */
export async function defaultProbationEnd(tx: Tx, employeeId: string) {
  await tx.execute(sql`
    UPDATE employees SET probation_end_date = (hire_date + INTERVAL '6 months')::date
     WHERE id = ${employeeId}::uuid AND status = 'probation' AND probation_end_date IS NULL
  `);
}

// ── Letters ──────────────────────────────────────────────────────────────────

export interface LetterInput {
  employeeId: string;
  kind: string;
  subject: string;
  body: string;
  issuedOn?: string | null;
  effectiveDate?: string | null;
  signatoryName?: string | null;
  signatoryTitle?: string | null;
}

export async function createLetter(tx: Tx, input: LetterInput & { companyId: string; actor: Actor }) {
  if (!(LETTER_KINDS as readonly string[]).includes(input.kind)) throw new Error("Choose the kind of letter.");
  if (blank(input.subject)) throw new Error("The letter needs a subject.");
  if (blank(input.body)) throw new Error("The letter needs a body.");
  const emp = await getEmployeeFacts(tx, input.employeeId);
  if (!emp) throw new Error("Employee not found");
  const [row] = await tx
    .insert(hrLetters)
    .values({
      companyId: input.companyId,
      letterNumber: await nextNumber(tx, input.companyId, "HRL"),
      employeeId: input.employeeId,
      kind: input.kind,
      subject: input.subject.trim(),
      body: input.body.trim(),
      issuedOn: opt(input.issuedOn) ?? today(),
      effectiveDate: opt(input.effectiveDate),
      signatoryName: opt(input.signatoryName),
      signatoryTitle: opt(input.signatoryTitle),
      createdById: input.actor.id,
      createdByName: input.actor.name,
    })
    .returning();
  return row;
}

/** A letter is never edited or deleted once issued: it is voided, with a reason. */
export async function voidLetter(tx: Tx, id: string, reason: string) {
  if (blank(reason)) throw new Error("Say why the letter is being voided.");
  const [row] = await tx
    .update(hrLetters)
    .set({ status: "void", voidReason: reason.trim(), updatedAt: new Date() })
    .where(and(eq(hrLetters.id, id), eq(hrLetters.status, "issued")))
    .returning();
  if (!row) throw new Error("Letter not found, or already void.");
  return row;
}

export async function listLetters(tx: Tx, f: { employeeId?: string; kind?: string; search?: string } = {}) {
  return (await tx.execute(sql`
    SELECT x.*, ${employeeCols}
      FROM hr_letters x ${employeeJoin}
     WHERE TRUE
       ${f.employeeId && isUuid(f.employeeId) ? sql`AND x.employee_id = ${f.employeeId}::uuid` : sql``}
       ${f.kind ? sql`AND x.kind = ${f.kind}` : sql``}
       ${f.search ? sql`AND (x.letter_number ILIKE ${"%" + f.search + "%"} OR x.subject ILIKE ${"%" + f.search + "%"} OR e.first_name || ' ' || e.last_name ILIKE ${"%" + f.search + "%"})` : sql``}
     ORDER BY x.issued_on DESC, x.created_at DESC
     LIMIT 500
  `)) as unknown as Array<Record<string, unknown>>;
}

export async function getLetter(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = (await tx.execute(sql`
    SELECT x.*, ${employeeCols}, e.designation, e.user_id AS employee_user_id
      FROM hr_letters x ${employeeJoin}
     WHERE x.id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  return row ?? null;
}

// ── Disciplinary and grievance cases ─────────────────────────────────────────

/** How long a warning stays live on the file, from the day it is given. */
export const WARNING_MONTHS: Record<string, number> = {
  verbal_warning: 3,
  written_warning: 6,
  final_warning: 12,
};

export interface CaseInput {
  employeeId: string;
  caseType: string;
  category: string;
  incidentDate: string;
  description: string;
}

export async function createCase(tx: Tx, input: CaseInput & { companyId: string; actor: Actor }) {
  if (!(CASE_TYPES as readonly string[]).includes(input.caseType)) throw new Error("Choose disciplinary or grievance.");
  if (!(CASE_CATEGORIES as readonly string[]).includes(input.category)) throw new Error("Choose the category.");
  if (!input.incidentDate) throw new Error("Enter the date of the incident.");
  if (input.incidentDate > today()) throw new Error("The incident date cannot be in the future.");
  if (blank(input.description)) throw new Error("Describe what happened.");
  const emp = await getEmployeeFacts(tx, input.employeeId);
  if (!emp) throw new Error("Employee not found");
  const [row] = await tx
    .insert(hrCases)
    .values({
      companyId: input.companyId,
      caseNumber: await nextNumber(tx, input.companyId, input.caseType === "grievance" ? "GRV" : "DC"),
      employeeId: input.employeeId,
      caseType: input.caseType,
      category: input.category,
      incidentDate: input.incidentDate,
      description: input.description.trim(),
      createdById: input.actor.id,
      createdByName: input.actor.name,
      lastModifiedById: input.actor.id,
      lastModifiedByName: input.actor.name,
    })
    .returning();
  return row;
}

async function caseRow(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(hrCases).where(eq(hrCases.id, id));
  return row ?? null;
}

/**
 * The steps of a case, each recorded as it happens. Show-cause and hearing
 * are disciplinary steps (s.41); a grievance goes straight to hearing or to a
 * resolution. A closed case is the record and is not reopened.
 */
export async function advanceCase(
  tx: Tx,
  id: string,
  step:
    | { kind: "show_cause"; issuedOn: string; responseDueOn: string }
    | { kind: "response"; employeeResponse: string }
    | { kind: "hearing"; hearingDate: string; hearingPanel?: string | null; accompaniedBy?: string | null }
    | { kind: "hearing_notes"; hearingNotes: string }
    | {
        kind: "close";
        outcome: string;
        outcomeNotes?: string | null;
        suspensionDays?: number | null;
        appealNotes?: string | null;
      },
  actor: Actor,
) {
  const c = await caseRow(tx, id);
  if (!c) throw new Error("Case not found");
  if (c.status === "closed") throw new Error("This case is closed.");
  const set: Record<string, unknown> = { lastModifiedById: actor.id, lastModifiedByName: actor.name, updatedAt: new Date() };

  if (step.kind === "show_cause") {
    if (c.caseType !== "disciplinary") throw new Error("A grievance has no show-cause notice.");
    if (!step.issuedOn || !step.responseDueOn) throw new Error("Enter when the notice was issued and when the reply is due.");
    if (step.responseDueOn < step.issuedOn) throw new Error("The reply cannot be due before the notice is issued.");
    Object.assign(set, { status: "show_cause_issued", showCauseIssuedOn: step.issuedOn, responseDueOn: step.responseDueOn });
  } else if (step.kind === "response") {
    if (blank(step.employeeResponse)) throw new Error("Record the employee's response.");
    set.employeeResponse = step.employeeResponse.trim();
  } else if (step.kind === "hearing") {
    if (!step.hearingDate) throw new Error("Enter the hearing date.");
    Object.assign(set, {
      status: "hearing_scheduled",
      hearingDate: step.hearingDate,
      hearingPanel: opt(step.hearingPanel),
      accompaniedBy: opt(step.accompaniedBy),
    });
  } else if (step.kind === "hearing_notes") {
    if (blank(step.hearingNotes)) throw new Error("Record what was said at the hearing.");
    set.hearingNotes = step.hearingNotes.trim();
  } else if (step.kind === "close") {
    if (!(CASE_OUTCOMES as readonly string[]).includes(step.outcome)) throw new Error("Choose the outcome.");
    const punitive = ["verbal_warning", "written_warning", "final_warning", "suspension", "dismissal"];
    if (c.caseType === "disciplinary" && punitive.includes(step.outcome) && !c.hearingDate) {
      // s.41: no warning, suspension or dismissal for misconduct without a hearing.
      throw new Error("Hold and record the hearing before a warning, suspension or dismissal (Employment Act s.41).");
    }
    if (c.caseType === "grievance" && punitive.includes(step.outcome)) {
      throw new Error("A grievance closes as resolved or not upheld.");
    }
    if (step.outcome === "suspension" && !step.suspensionDays) throw new Error("Enter the number of suspension days.");
    const months = WARNING_MONTHS[step.outcome];
    let expires: string | null = null;
    if (months) {
      const d = new Date();
      d.setMonth(d.getMonth() + months);
      expires = d.toISOString().slice(0, 10);
    }
    Object.assign(set, {
      status: "closed",
      outcome: step.outcome,
      outcomeNotes: opt(step.outcomeNotes),
      suspensionDays: step.outcome === "suspension" ? step.suspensionDays : null,
      warningExpiresOn: expires,
      appealNotes: opt(step.appealNotes),
      closedOn: today(),
      closedById: actor.id,
      closedByName: actor.name,
    });
  }
  const [row] = await tx.update(hrCases).set(set).where(eq(hrCases.id, id)).returning();
  return row;
}

export async function listCases(tx: Tx, f: { employeeId?: string; status?: string; type?: string } = {}) {
  return (await tx.execute(sql`
    SELECT x.*, ${employeeCols}
      FROM hr_cases x ${employeeJoin}
     WHERE TRUE
       ${f.employeeId && isUuid(f.employeeId) ? sql`AND x.employee_id = ${f.employeeId}::uuid` : sql``}
       ${f.status === "open" ? sql`AND x.status <> 'closed'` : f.status ? sql`AND x.status = ${f.status}` : sql``}
       ${f.type ? sql`AND x.case_type = ${f.type}` : sql``}
     ORDER BY (x.status = 'closed'), x.incident_date DESC
     LIMIT 500
  `)) as unknown as Array<Record<string, unknown>>;
}

export async function getCase(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = (await tx.execute(sql`
    SELECT x.*, ${employeeCols}, e.designation
      FROM hr_cases x ${employeeJoin}
     WHERE x.id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  return row ?? null;
}

// ── Training and certificates ────────────────────────────────────────────────

export interface TrainingInput {
  employeeId: string;
  kind: string;
  title: string;
  provider?: string | null;
  startDate?: string | null;
  completedOn?: string | null;
  certificateNumber?: string | null;
  expiresOn?: string | null;
  status?: string | null;
  cost?: number | null;
  notes?: string | null;
}

function checkTraining(t: TrainingInput) {
  if (!(TRAINING_KINDS as readonly string[]).includes(t.kind)) throw new Error("Choose the kind of training.");
  if (blank(t.title)) throw new Error("Enter the course or certificate.");
  const status = t.status || "completed";
  if (!(TRAINING_STATUSES as readonly string[]).includes(status)) throw new Error("Choose the status.");
  if (status === "completed" && !t.completedOn) throw new Error("Enter when it was completed.");
  if (t.completedOn && t.startDate && t.completedOn < t.startDate) throw new Error("It cannot be completed before it started.");
  if (t.expiresOn && t.completedOn && t.expiresOn < t.completedOn) throw new Error("It cannot expire before it was completed.");
  if (t.cost != null && t.cost < 0) throw new Error("The cost cannot be negative.");
  return status;
}

export async function createTraining(tx: Tx, input: TrainingInput & { companyId: string; actor: Actor }) {
  const status = checkTraining(input);
  if (!(await getEmployeeFacts(tx, input.employeeId))) throw new Error("Employee not found");
  const [row] = await tx
    .insert(hrTrainingRecords)
    .values({
      companyId: input.companyId,
      employeeId: input.employeeId,
      kind: input.kind,
      title: input.title.trim(),
      provider: opt(input.provider),
      startDate: opt(input.startDate),
      completedOn: opt(input.completedOn),
      certificateNumber: opt(input.certificateNumber),
      expiresOn: opt(input.expiresOn),
      status,
      cost: input.cost == null ? null : String(input.cost),
      notes: opt(input.notes),
      createdById: input.actor.id,
      createdByName: input.actor.name,
    })
    .returning();
  return row;
}

export async function updateTraining(tx: Tx, id: string, input: TrainingInput) {
  const status = checkTraining(input);
  const [row] = await tx
    .update(hrTrainingRecords)
    .set({
      kind: input.kind,
      title: input.title.trim(),
      provider: opt(input.provider),
      startDate: opt(input.startDate),
      completedOn: opt(input.completedOn),
      certificateNumber: opt(input.certificateNumber),
      expiresOn: opt(input.expiresOn),
      status,
      cost: input.cost == null ? null : String(input.cost),
      notes: opt(input.notes),
      updatedAt: new Date(),
    })
    .where(eq(hrTrainingRecords.id, id))
    .returning();
  if (!row) throw new Error("Training record not found");
  return row;
}

export async function deleteTraining(tx: Tx, id: string) {
  const [row] = await tx.delete(hrTrainingRecords).where(eq(hrTrainingRecords.id, id)).returning();
  if (!row) throw new Error("Training record not found");
  return row;
}

/**
 * Training records. `expiringWithin` lists certificates and licences that
 * expire within that many days — including any already expired — which is
 * the alert list.
 */
export async function listTraining(tx: Tx, f: { employeeId?: string; expiringWithin?: number; search?: string } = {}) {
  return (await tx.execute(sql`
    SELECT x.*, ${employeeCols},
           CASE WHEN x.expires_on IS NULL THEN NULL ELSE (x.expires_on - CURRENT_DATE) END AS days_to_expiry
      FROM hr_training_records x ${employeeJoin}
     WHERE TRUE
       ${f.employeeId && isUuid(f.employeeId) ? sql`AND x.employee_id = ${f.employeeId}::uuid` : sql``}
       ${f.expiringWithin != null ? sql`AND x.expires_on IS NOT NULL AND x.status <> 'cancelled' AND x.expires_on <= CURRENT_DATE + ${f.expiringWithin}::int AND e.status IN ('active','probation','on_leave','suspended')` : sql``}
       ${f.search ? sql`AND (x.title ILIKE ${"%" + f.search + "%"} OR x.provider ILIKE ${"%" + f.search + "%"} OR e.first_name || ' ' || e.last_name ILIKE ${"%" + f.search + "%"})` : sql``}
     ORDER BY ${f.expiringWithin != null ? sql`x.expires_on ASC` : sql`COALESCE(x.completed_on, x.start_date) DESC NULLS LAST`}
     LIMIT 1000
  `)) as unknown as Array<Record<string, unknown>>;
}

// ── Performance reviews ──────────────────────────────────────────────────────

const RATING = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 5) throw new Error("Ratings are from 1 to 5.");
  return Math.round(n);
};

/** Objectives cleaned and checked: a name each, weights adding to 100. */
export function normaliseObjectives(list: unknown): ReviewObjective[] {
  if (!Array.isArray(list)) return [];
  const out = list
    .map((o) => ({
      objective: String((o as ReviewObjective)?.objective ?? "").trim(),
      weight: Number((o as ReviewObjective)?.weight ?? 0),
      selfRating: RATING((o as ReviewObjective)?.selfRating),
      managerRating: RATING((o as ReviewObjective)?.managerRating),
      comment: opt((o as ReviewObjective)?.comment),
    }))
    .filter((o) => o.objective);
  if (out.some((o) => !Number.isFinite(o.weight) || o.weight <= 0)) throw new Error("Every objective needs a weight above zero.");
  const total = out.reduce((n, o) => n + o.weight, 0);
  if (out.length && Math.round(total) !== 100) throw new Error(`Objective weights must add up to 100 (they add up to ${total}).`);
  return out;
}

/** The overall rating: the manager's ratings weighted by each objective's weight. */
export function weightedRating(objectives: ReviewObjective[]) {
  const rated = objectives.filter((o) => o.managerRating != null);
  if (!rated.length || rated.length !== objectives.length) return null;
  const total = objectives.reduce((n, o) => n + o.weight, 0);
  const score = objectives.reduce((n, o) => n + o.weight * Number(o.managerRating), 0) / total;
  return Math.round(score * 100) / 100;
}

export interface ReviewInput {
  employeeId: string;
  cycle: string;
  periodStart: string;
  periodEnd: string;
  reviewerUserId?: string | null;
  reviewerName?: string | null;
  objectives?: unknown;
}

export async function createReview(tx: Tx, input: ReviewInput & { companyId: string; actor: Actor }) {
  if (blank(input.cycle)) throw new Error("Name the review cycle, e.g. 2026 annual.");
  if (!input.periodStart || !input.periodEnd) throw new Error("Enter the period under review.");
  if (input.periodEnd < input.periodStart) throw new Error("The period cannot end before it starts.");
  const emp = await getEmployeeFacts(tx, input.employeeId);
  if (!emp) throw new Error("Employee not found");
  if (input.reviewerUserId && input.reviewerUserId === emp.userId) throw new Error("An employee cannot review themselves.");
  const [dup] = await tx
    .select({ id: hrPerformanceReviews.id })
    .from(hrPerformanceReviews)
    .where(and(eq(hrPerformanceReviews.employeeId, input.employeeId), eq(hrPerformanceReviews.cycle, input.cycle.trim())));
  if (dup) throw new Error(`${emp.fullName} already has a review for ${input.cycle.trim()}.`);
  const [row] = await tx
    .insert(hrPerformanceReviews)
    .values({
      companyId: input.companyId,
      employeeId: input.employeeId,
      cycle: input.cycle.trim(),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      reviewerUserId: opt(input.reviewerUserId),
      reviewerName: opt(input.reviewerName),
      objectives: normaliseObjectives(input.objectives),
      createdById: input.actor.id,
      createdByName: input.actor.name,
    })
    .returning();
  return row;
}

export async function getReview(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = (await tx.execute(sql`
    SELECT x.*, ${employeeCols}, e.designation, e.user_id AS employee_user_id
      FROM hr_performance_reviews x ${employeeJoin}
     WHERE x.id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  return row ?? null;
}

/**
 * One review, moving draft → self assessment → manager review → completed.
 * `as` says who is acting, and each may only write their own part: HR sets
 * the objectives, the employee their self-ratings and comment, the reviewer
 * the ratings, the summary and the recommendation.
 */
export async function saveReview(
  tx: Tx,
  id: string,
  as: "hr" | "employee" | "reviewer",
  patch: {
    objectives?: unknown;
    selfComment?: string | null;
    managerComment?: string | null;
    strengths?: string | null;
    developmentAreas?: string | null;
    recommendation?: string | null;
    advance?: boolean;
  },
) {
  const r = await getReview(tx, id);
  if (!r) throw new Error("Review not found");
  const status = String(r.status);
  if (status === "completed") throw new Error("This review is completed.");
  const current = (r.objectives as ReviewObjective[]) || [];
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (as === "hr") {
    if (status !== "draft") throw new Error("The objectives are fixed once the review has started.");
    if (patch.objectives !== undefined) set.objectives = normaliseObjectives(patch.objectives);
    if (patch.advance) {
      const objs = (set.objectives as ReviewObjective[]) ?? current;
      if (!objs.length) throw new Error("Add the objectives before starting the review.");
      set.status = "self_assessment";
    }
  } else if (as === "employee") {
    if (status !== "self_assessment") throw new Error("The self-assessment is not open.");
    if (patch.objectives !== undefined) {
      const mine = normaliseObjectives(patch.objectives);
      // Only the self-ratings move; the objectives and weights stay as set.
      set.objectives = current.map((o, i) => ({ ...o, selfRating: mine[i]?.selfRating ?? o.selfRating ?? null }));
    }
    if (patch.selfComment !== undefined) set.selfComment = opt(patch.selfComment);
    if (patch.advance) set.status = "manager_review";
  } else {
    if (status !== "manager_review") throw new Error("The manager review is not open yet.");
    let objs = current;
    if (patch.objectives !== undefined) {
      const theirs = normaliseObjectives(patch.objectives);
      objs = current.map((o, i) => ({
        ...o,
        managerRating: theirs[i]?.managerRating ?? o.managerRating ?? null,
        comment: theirs[i]?.comment ?? o.comment ?? null,
      }));
      set.objectives = objs;
    }
    for (const k of ["managerComment", "strengths", "developmentAreas"] as const) {
      if (patch[k] !== undefined) set[k] = opt(patch[k]);
    }
    if (patch.recommendation !== undefined) {
      if (patch.recommendation && !(REVIEW_RECOMMENDATIONS as readonly string[]).includes(patch.recommendation)) {
        throw new Error("Choose a recommendation.");
      }
      set.recommendation = opt(patch.recommendation);
    }
    if (patch.advance) {
      const overall = weightedRating(objs);
      if (overall == null) throw new Error("Rate every objective before completing the review.");
      Object.assign(set, { status: "completed", overallRating: String(overall), completedAt: new Date() });
    }
  }
  const [row] = await tx.update(hrPerformanceReviews).set(set).where(eq(hrPerformanceReviews.id, id)).returning();
  if (set.status === "completed") {
    await tx.execute(sql`
      UPDATE employees SET last_review_date = CURRENT_DATE,
             last_reviewed_by_id = ${r.reviewer_user_id ?? null}, last_reviewed_by_name = ${r.reviewer_name ?? null}
       WHERE id = ${String(r.employee_id)}::uuid
    `);
  }
  return row;
}

export async function acknowledgeReview(tx: Tx, id: string) {
  const [row] = await tx
    .update(hrPerformanceReviews)
    .set({ employeeAcknowledgedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(hrPerformanceReviews.id, id), eq(hrPerformanceReviews.status, "completed")))
    .returning();
  if (!row) throw new Error("Only a completed review can be acknowledged.");
  return row;
}

export async function deleteReview(tx: Tx, id: string) {
  const [row] = await tx
    .delete(hrPerformanceReviews)
    .where(and(eq(hrPerformanceReviews.id, id), eq(hrPerformanceReviews.status, "draft")))
    .returning();
  if (!row) throw new Error("Only a draft review can be deleted.");
  return row;
}

export async function listReviews(
  tx: Tx,
  f: { employeeId?: string; status?: string; cycle?: string; reviewerUserId?: string; employeeUserId?: string } = {},
) {
  return (await tx.execute(sql`
    SELECT x.*, ${employeeCols}
      FROM hr_performance_reviews x ${employeeJoin}
     WHERE TRUE
       ${f.employeeId && isUuid(f.employeeId) ? sql`AND x.employee_id = ${f.employeeId}::uuid` : sql``}
       ${f.status ? sql`AND x.status = ${f.status}` : sql``}
       ${f.cycle ? sql`AND x.cycle = ${f.cycle}` : sql``}
       ${f.reviewerUserId ? sql`AND x.reviewer_user_id = ${f.reviewerUserId}` : sql``}
       ${f.employeeUserId ? sql`AND e.user_id = ${f.employeeUserId}` : sql``}
     ORDER BY x.period_end DESC, employee_name
     LIMIT 1000
  `)) as unknown as Array<Record<string, unknown>>;
}

// ── Recruitment ──────────────────────────────────────────────────────────────

export interface VacancyInput {
  title: string;
  departmentId?: string | null;
  employmentType?: string | null;
  positions?: number | null;
  description?: string | null;
  requirements?: string | null;
  closingDate?: string | null;
  status?: string | null;
}

export async function createVacancy(tx: Tx, input: VacancyInput & { companyId: string; actor: Actor }) {
  if (blank(input.title)) throw new Error("Enter the job title.");
  const status = input.status || "open";
  if (!(VACANCY_STATUSES as readonly string[]).includes(status)) throw new Error("Choose the status.");
  const [row] = await tx
    .insert(hrVacancies)
    .values({
      companyId: input.companyId,
      vacancyNumber: await nextNumber(tx, input.companyId, "VAC"),
      title: input.title.trim(),
      departmentId: input.departmentId && isUuid(input.departmentId) ? input.departmentId : null,
      employmentType: input.employmentType || "full_time",
      positions: input.positions && input.positions > 0 ? input.positions : 1,
      description: opt(input.description),
      requirements: opt(input.requirements),
      closingDate: opt(input.closingDate),
      status,
      createdById: input.actor.id,
      createdByName: input.actor.name,
    })
    .returning();
  return row;
}

export async function setVacancyStatus(tx: Tx, id: string, status: string) {
  if (!(VACANCY_STATUSES as readonly string[]).includes(status)) throw new Error("Choose the status.");
  const [row] = await tx
    .update(hrVacancies)
    .set({ status, updatedAt: new Date() })
    .where(eq(hrVacancies.id, id))
    .returning();
  if (!row) throw new Error("Vacancy not found");
  return row;
}

export async function listVacancies(tx: Tx) {
  return (await tx.execute(sql`
    SELECT v.*, d.name AS department,
           count(c.id)::int AS candidates,
           count(c.id) FILTER (WHERE c.stage IN ('applied','screening','interview','offer'))::int AS in_progress,
           count(c.id) FILTER (WHERE c.stage = 'hired')::int AS hired
      FROM hr_vacancies v
      LEFT JOIN departments d ON d.id = v.department_id
      LEFT JOIN hr_candidates c ON c.vacancy_id = v.id
     GROUP BY v.id, d.name
     ORDER BY (v.status IN ('filled','closed')), v.created_at DESC
  `)) as unknown as Array<Record<string, unknown>>;
}

export async function getVacancy(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [v] = (await tx.execute(sql`
    SELECT v.*, d.name AS department FROM hr_vacancies v
      LEFT JOIN departments d ON d.id = v.department_id
     WHERE v.id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown> & { status: string }>;
  if (!v) return null;
  const candidates = await tx
    .select()
    .from(hrCandidates)
    .where(eq(hrCandidates.vacancyId, id))
    .orderBy(desc(hrCandidates.createdAt));
  return { ...v, candidates };
}

export interface CandidateInput {
  vacancyId: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  expectedSalary?: number | null;
  notes?: string | null;
}

export async function addCandidate(tx: Tx, input: CandidateInput & { companyId: string; actor: Actor }) {
  if (blank(input.fullName)) throw new Error("Enter the candidate's name.");
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new Error("That email address is not valid.");
  const v = await getVacancy(tx, input.vacancyId);
  if (!v) throw new Error("Vacancy not found");
  if (["filled", "closed"].includes(String(v.status))) throw new Error("This vacancy is closed.");
  const [row] = await tx
    .insert(hrCandidates)
    .values({
      companyId: input.companyId,
      vacancyId: input.vacancyId,
      fullName: input.fullName.trim(),
      email: opt(input.email),
      phone: opt(input.phone),
      source: opt(input.source),
      expectedSalary: input.expectedSalary == null ? null : String(input.expectedSalary),
      notes: opt(input.notes),
      createdById: input.actor.id,
      createdByName: input.actor.name,
    })
    .returning();
  return row;
}

/**
 * Moves a candidate along. Hiring is not a stage you set by hand: it happens
 * when the candidate's employee record is created (hireCandidate), so a
 * "hired" candidate always is an employee.
 */
export async function moveCandidate(
  tx: Tx,
  id: string,
  step: { stage: string; rating?: number | null; interviewDate?: string | null; rejectionReason?: string | null; notes?: string | null },
) {
  if (!(CANDIDATE_STAGES as readonly string[]).includes(step.stage) || step.stage === "hired") {
    throw new Error("Choose the next stage.");
  }
  if (step.stage === "rejected" && blank(step.rejectionReason)) throw new Error("Give the reason for rejecting.");
  const [cur] = await tx.select().from(hrCandidates).where(eq(hrCandidates.id, id));
  if (!cur) throw new Error("Candidate not found");
  if (cur.stage === "hired") throw new Error("This candidate has been hired.");
  const [row] = await tx
    .update(hrCandidates)
    .set({
      stage: step.stage,
      rating: step.rating == null ? cur.rating : RATING(step.rating),
      interviewDate: step.interviewDate === undefined ? cur.interviewDate : opt(step.interviewDate),
      rejectionReason: step.stage === "rejected" ? opt(step.rejectionReason) : null,
      notes: step.notes === undefined ? cur.notes : opt(step.notes),
      updatedAt: new Date(),
    })
    .where(eq(hrCandidates.id, id))
    .returning();
  return row;
}

/** Links a candidate to the employee record created for them, and counts the post. */
export async function hireCandidate(tx: Tx, candidateId: string, employeeId: string) {
  const [cur] = await tx.select().from(hrCandidates).where(eq(hrCandidates.id, candidateId));
  if (!cur) throw new Error("Candidate not found");
  if (cur.stage === "hired") throw new Error("This candidate has already been hired.");
  if (!(await getEmployeeFacts(tx, employeeId))) throw new Error("Employee not found");
  const [row] = await tx
    .update(hrCandidates)
    .set({ stage: "hired", employeeId, rejectionReason: null, updatedAt: new Date() })
    .where(eq(hrCandidates.id, candidateId))
    .returning();
  // The vacancy is filled once every position is.
  await tx.execute(sql`
    UPDATE hr_vacancies v SET status = 'filled', updated_at = now()
     WHERE v.id = ${cur.vacancyId}::uuid AND v.status = 'open'
       AND (SELECT count(*) FROM hr_candidates c WHERE c.vacancy_id = v.id AND c.stage = 'hired') >= v.positions
  `);
  return row;
}

export async function getCandidate(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(hrCandidates).where(eq(hrCandidates.id, id));
  return row ?? null;
}

// ── Alerts and reports ───────────────────────────────────────────────────────

/** What needs HR's attention: probation ending, certificates expiring, open cases, reviews waiting. */
export async function getHrRecordAlerts(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      (SELECT count(*) FROM employees WHERE status = 'probation'
          AND probation_end_date IS NOT NULL AND probation_end_date <= CURRENT_DATE + 30)::int AS probation_due,
      (SELECT count(*) FROM hr_training_records t JOIN employees e ON e.id = t.employee_id
          WHERE t.expires_on IS NOT NULL AND t.status <> 'cancelled' AND t.expires_on <= CURRENT_DATE + 60
            AND e.status IN ('active','probation','on_leave','suspended'))::int AS certs_expiring,
      (SELECT count(*) FROM hr_cases WHERE status <> 'closed')::int AS open_cases,
      (SELECT count(*) FROM hr_performance_reviews WHERE status IN ('self_assessment','manager_review'))::int AS reviews_open,
      (SELECT count(*) FROM hr_vacancies WHERE status = 'open')::int AS open_vacancies
  `)) as unknown as Array<Record<string, number>>;
  const probation = (await tx.execute(sql`
    SELECT e.id, COALESCE(e.full_name, e.first_name || ' ' || e.last_name) AS name, d.name AS department,
           e.probation_end_date, (e.probation_end_date - CURRENT_DATE) AS days_remaining
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.status = 'probation' AND e.probation_end_date IS NOT NULL
       AND e.probation_end_date <= CURRENT_DATE + 30
     ORDER BY e.probation_end_date
  `)) as unknown as Array<Record<string, unknown>>;
  return { ...row, probation };
}

/** The HR reports page: headcount, movement, leave, pay and attendance. */
export async function getHrReport(tx: Tx, year: number) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const q = async (query: ReturnType<typeof sql>) => (await tx.execute(query)) as unknown as Array<Record<string, unknown>>;

  const headcountByDept = await q(sql`
    SELECT COALESCE(d.name, 'No department') AS department,
           count(*) FILTER (WHERE e.status IN ('active','probation','on_leave','suspended'))::int AS headcount,
           count(*) FILTER (WHERE e.status = 'probation')::int AS probation,
           count(*) FILTER (WHERE e.gender ILIKE 'f%')::int AS female,
           count(*) FILTER (WHERE e.gender ILIKE 'm%')::int AS male
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.status IN ('active','probation','on_leave','suspended')
     GROUP BY 1 ORDER BY headcount DESC
  `);
  const movement = await q(sql`
    SELECT to_char(m, 'YYYY-MM') AS month,
           (SELECT count(*) FROM employees WHERE date_trunc('month', hire_date) = m)::int AS joiners,
           (SELECT count(*) FROM employees WHERE termination_date IS NOT NULL AND date_trunc('month', termination_date) = m)::int AS leavers,
           (SELECT count(*) FROM employees WHERE hire_date <= (m + INTERVAL '1 month' - INTERVAL '1 day')
               AND (termination_date IS NULL OR termination_date > (m + INTERVAL '1 month' - INTERVAL '1 day')))::int AS closing
      FROM generate_series(${from}::date, ${to}::date, INTERVAL '1 month') AS m
     WHERE m <= date_trunc('month', CURRENT_DATE)
     ORDER BY 1
  `);
  const leave = await q(sql`
    SELECT COALESCE(lt.name, 'Leave') AS leave_type, count(*)::int AS requests,
           COALESCE(sum(lr.total_days), 0)::numeric AS days
      FROM leave_requests lr LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE lr.status IN ('approved', 'completed') AND lr.from_date BETWEEN ${from}::date AND ${to}::date
     GROUP BY 1 ORDER BY days DESC
  `);
  const payroll = await q(sql`
    SELECT to_char(make_date(r.period_year, r.period_month, 1), 'YYYY-MM') AS month,
           COALESCE(sum(r.total_gross), 0)::numeric AS gross,
           COALESCE(sum(r.total_net), 0)::numeric AS net,
           COALESCE(sum(r.total_employer_nssf + r.total_employer_ahl), 0)::numeric AS employer_cost,
           COALESCE(sum(r.employee_count), 0)::int AS payslips
      FROM payroll_runs r
     WHERE r.status IN ('approved', 'paid') AND r.period_year = ${year}
     GROUP BY 1 ORDER BY 1
  `);
  const attendance = await q(sql`
    SELECT COALESCE(e.full_name, e.first_name || ' ' || e.last_name) AS name,
           count(*) FILTER (WHERE a.status IN ('present', 'late', 'half_day'))::int AS days_present,
           count(*) FILTER (WHERE a.status = 'late')::int AS days_late,
           count(*) FILTER (WHERE a.status = 'absent')::int AS days_absent,
           COALESCE(round(sum(a.overtime_hours)::numeric, 1), 0)::numeric AS overtime_hours
      FROM attendance a JOIN employees e ON e.id = a.employee_id
     WHERE a.work_date >= date_trunc('month', CURRENT_DATE)::date
     GROUP BY 1 ORDER BY days_late DESC, name LIMIT 200
  `);
  const training = await q(sql`
    SELECT kind, count(*)::int AS records, COALESCE(sum(cost), 0)::numeric AS cost
      FROM hr_training_records
     WHERE COALESCE(completed_on, start_date) BETWEEN ${from}::date AND ${to}::date
     GROUP BY 1 ORDER BY records DESC
  `);
  const cases = await q(sql`
    SELECT case_type, category, count(*)::int AS cases
      FROM hr_cases WHERE incident_date BETWEEN ${from}::date AND ${to}::date
     GROUP BY 1, 2 ORDER BY cases DESC
  `);
  return { year, headcountByDept, movement, leave, payroll, attendance, training, cases };
}

/** Everyone active, with their manager, for the org chart. */
export async function listOrgChart(tx: Tx) {
  return (await tx.execute(sql`
    SELECT e.id, e.manager_id, e.designation, e.photo_url, e.employee_number, e.status,
           COALESCE(e.full_name, e.first_name || ' ' || e.last_name) AS name, d.name AS department
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.status IN ('active','probation','on_leave','suspended')
     ORDER BY name
  `)) as unknown as Array<Record<string, unknown>>;
}
