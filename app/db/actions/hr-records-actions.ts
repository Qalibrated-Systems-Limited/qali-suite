"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { trainingToExpense, releaseTrainingExpense } from "../financeHandoff";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { rolesFor } from "@/lib/capabilities";
import { roleAllowed } from "@/lib/permissions";
import * as hr from "../repositories/hrRecords";
import * as staff from "../repositories/employees";
import * as notifications from "../repositories/notifications";
import { getCompanyForDocuments } from "../platform";
import { draftLetter } from "@/lib/hr/letters";

/**
 * HR records: letters, disciplinary and grievance cases, training, reviews,
 * recruitment, the HR report and the org chart.
 *
 * Every action names the roles that may run it (lib/capabilities.js) and runs
 * inside withAuthorizedTenant, so the company is the session's and RLS holds.
 * Self-service — an employee's own letters, their self-assessment — is
 * checked against the employee record linked to the signed-in user, never
 * against an id the browser sends.
 */

const LETTER_ROLES = rolesFor("hr.letters") as string[];
const CASE_ROLES = rolesFor("hr.discipline") as string[];
const TRAINING_ROLES = rolesFor("hr.training") as string[];
const REVIEW_ROLES = rolesFor("hr.reviews") as string[];
const RECRUIT_ROLES = rolesFor("hr.recruit") as string[];
const REPORT_ROLES = rolesFor("hr.reports") as string[];
const HR_ADMIN = rolesFor("hr.admin") as string[];

export type ActionResult =
  | { success: true; id?: string; message?: string }
  | { success: false; error: string };

const fail = (error: unknown): ActionResult => ({ success: false, error: userMessage(error) });
const actorOf = (user: { id: string; name?: string | null }) => ({ id: user.id, name: user.name ?? null });
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** Plain, JSON-safe rows for client components. */
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function touch(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
}

// ── Pickers ──────────────────────────────────────────────────────────────────

export async function getRecordsFormData() {
  return withAuthorizedTenant([...new Set([...LETTER_ROLES, ...TRAINING_ROLES, ...REVIEW_ROLES])], async (tx) => {
    const employees = await staff.listEmployeesForPicker(tx, { limit: 500 });
    const reviewers = (await tx.execute(
      // Anyone who can sign in to this company may be named as a reviewer.
      sql`
        SELECT u.id, u.name, COALESCE(a.role, u.role) AS role
          FROM users u
          JOIN user_company_access a ON a.user_id = u.id AND a.status = 'active'
           AND a.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
         WHERE COALESCE(u.status, 'active') NOT IN ('inactive', 'Inactive')
         ORDER BY u.name`,
    )) as unknown as Array<{ id: string; name: string; role: string }>;
    return plain({ employees, reviewers });
  });
}

// ── Probation ────────────────────────────────────────────────────────────────

export async function setProbationEnd(employeeId: string, endDate: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(HR_ADMIN, (tx, { user }) => hr.setProbationEnd(tx, employeeId, endDate, actorOf(user)));
    touch(`/dashboard/hr/employees/${employeeId}`, "/dashboard/hr");
    return { success: true, message: "Probation end date saved" };
  } catch (e) {
    return fail(e);
  }
}

// ── Letters ──────────────────────────────────────────────────────────────────

/** The standard wording for a letter to this employee, for HR to edit. */
export async function draftHrLetter(employeeId: string, kind: string, details: Record<string, unknown> = {}) {
  try {
    return await withAuthorizedTenant(LETTER_ROLES, async (tx, { companyId }) => {
      const employee = await hr.getEmployeeFacts(tx, employeeId);
      if (!employee) throw new Error("Employee not found");
      const company = await getCompanyForDocuments(companyId);
      return { success: true as const, ...draftLetter(kind, { employee, company: company ?? {}, details }) };
    });
  } catch (e) {
    return fail(e);
  }
}

export async function issueHrLetter(_prev: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const row = await withAuthorizedTenant(LETTER_ROLES, (tx, { user, companyId }) =>
      hr.createLetter(tx, {
        companyId,
        employeeId: str(fd, "employeeId"),
        kind: str(fd, "kind"),
        subject: str(fd, "subject"),
        body: str(fd, "body"),
        issuedOn: str(fd, "issuedOn") || null,
        effectiveDate: str(fd, "effectiveDate") || null,
        signatoryName: str(fd, "signatoryName") || null,
        signatoryTitle: str(fd, "signatoryTitle") || null,
        actor: actorOf(user),
      }),
    );
    touch("/dashboard/hr/letters", `/dashboard/hr/employees/${row.employeeId}`);
    return { success: true, id: row.id, message: `${row.letterNumber} issued` };
  } catch (e) {
    return fail(e);
  }
}

export async function voidHrLetter(id: string, reason: string): Promise<ActionResult> {
  try {
    const row = await withAuthorizedTenant(LETTER_ROLES, (tx) => hr.voidLetter(tx, id, reason));
    touch("/dashboard/hr/letters", `/dashboard/hr/letters/${id}`, `/dashboard/hr/employees/${row.employeeId}`);
    return { success: true, message: `${row.letterNumber} voided` };
  } catch (e) {
    return fail(e);
  }
}

export async function listHrLetters(f: { employeeId?: string; kind?: string; search?: string } = {}) {
  return withAuthorizedTenant(LETTER_ROLES, async (tx) => plain(await hr.listLetters(tx, f)));
}

/**
 * One letter — to HR, or to the employee it was issued to (their own copy).
 * Anyone else gets nothing.
 */
export async function getHrLetter(id: string) {
  return withAuthorizedTenant([], async (tx, { user }) => {
    const row = await hr.getLetter(tx, id);
    if (!row) return null;
    const isHr = roleAllowed(user.role, LETTER_ROLES);
    if (!isHr && row.employee_user_id !== user.id) return null;
    return plain({ ...row, canManage: isHr });
  });
}

/** The signed-in employee's own letters. */
export async function listMyLetters() {
  return withAuthorizedTenant([], async (tx, { user }) => {
    const me = await staff.getEmployeeByUser(tx, user.id);
    if (!me?.id) return [];
    return plain((await hr.listLetters(tx, { employeeId: me.id })).filter((l) => l.status === "issued"));
  });
}

// ── Cases ────────────────────────────────────────────────────────────────────

export async function openHrCase(_prev: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const row = await withAuthorizedTenant(CASE_ROLES, (tx, { user, companyId }) =>
      hr.createCase(tx, {
        companyId,
        employeeId: str(fd, "employeeId"),
        caseType: str(fd, "caseType"),
        category: str(fd, "category"),
        incidentDate: str(fd, "incidentDate"),
        description: str(fd, "description"),
        actor: actorOf(user),
      }),
    );
    touch("/dashboard/hr/cases", `/dashboard/hr/employees/${row.employeeId}`);
    return { success: true, id: row.id, message: `${row.caseNumber} opened` };
  } catch (e) {
    return fail(e);
  }
}

export async function advanceHrCase(id: string, step: Parameters<typeof hr.advanceCase>[2]): Promise<ActionResult> {
  try {
    const row = await withAuthorizedTenant(CASE_ROLES, (tx, { user }) => hr.advanceCase(tx, id, step, actorOf(user)));
    touch("/dashboard/hr/cases", `/dashboard/hr/cases/${id}`, `/dashboard/hr/employees/${row.employeeId}`);
    return { success: true, message: row.status === "closed" ? `${row.caseNumber} closed` : "Case updated" };
  } catch (e) {
    return fail(e);
  }
}

export async function listHrCases(f: { employeeId?: string; status?: string; type?: string } = {}) {
  return withAuthorizedTenant(CASE_ROLES, async (tx) => plain(await hr.listCases(tx, f)));
}

export async function getHrCase(id: string) {
  return withAuthorizedTenant(CASE_ROLES, async (tx) => plain(await hr.getCase(tx, id)));
}

// ── Training ─────────────────────────────────────────────────────────────────

const trainingInput = (fd: FormData): hr.TrainingInput => ({
  employeeId: str(fd, "employeeId"),
  kind: str(fd, "kind"),
  title: str(fd, "title"),
  provider: str(fd, "provider") || null,
  startDate: str(fd, "startDate") || null,
  completedOn: str(fd, "completedOn") || null,
  certificateNumber: str(fd, "certificateNumber") || null,
  expiresOn: str(fd, "expiresOn") || null,
  status: str(fd, "status") || "completed",
  cost: num(fd, "cost"),
  notes: str(fd, "notes") || null,
});

export async function saveTraining(_prev: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const id = str(fd, "id");
    const { row, handed } = await withAuthorizedTenant(TRAINING_ROLES, async (tx, { user, companyId }) => {
      const row = id
        ? await hr.updateTraining(tx, id, trainingInput(fd))
        : await hr.createTraining(tx, { ...trainingInput(fd), companyId, actor: actorOf(user) });
      // A cost goes to finance as a draft expense (other_modules_hand_their_money_to_finance).
      const handed = await trainingToExpense(tx, companyId, row.id, user.id ? String(user.id) : null);
      return { row, handed };
    });
    touch("/dashboard/hr/training", `/dashboard/hr/employees/${row.employeeId}`, "/dashboard/hr", "/dashboard/expenses");
    return { success: true, id: row.id, message: (id ? "Training record updated." : "Training recorded.") + handed };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTraining(id: string): Promise<ActionResult> {
  try {
    const row = await withAuthorizedTenant(TRAINING_ROLES, async (tx) => {
      const deleted = await hr.deleteTraining(tx, id);
      await releaseTrainingExpense(tx, (deleted as { expenseId?: string | null }).expenseId ?? null);
      return deleted;
    });
    touch("/dashboard/hr/training", `/dashboard/hr/employees/${row.employeeId}`);
    return { success: true, message: "Training record deleted" };
  } catch (e) {
    return fail(e);
  }
}

export async function listHrTraining(f: { employeeId?: string; expiringWithin?: number; search?: string } = {}) {
  return withAuthorizedTenant(TRAINING_ROLES, async (tx) => plain(await hr.listTraining(tx, f)));
}

// ── Reviews ──────────────────────────────────────────────────────────────────

export async function startReview(_prev: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const objectives = JSON.parse(str(fd, "objectives") || "[]");
    const row = await withAuthorizedTenant(REVIEW_ROLES, async (tx, { user, companyId }) => {
      const reviewerUserId = str(fd, "reviewerUserId") || null;
      let reviewerName: string | null = null;
      if (reviewerUserId) {
        const [u] = (await tx.execute(
          sql`SELECT name FROM users WHERE id = ${reviewerUserId}`,
        )) as unknown as Array<{ name: string }>;
        if (!u) throw new Error("Reviewer not found");
        reviewerName = u.name;
      }
      return hr.createReview(tx, {
        companyId,
        employeeId: str(fd, "employeeId"),
        cycle: str(fd, "cycle"),
        periodStart: str(fd, "periodStart"),
        periodEnd: str(fd, "periodEnd"),
        reviewerUserId,
        reviewerName,
        objectives,
        actor: actorOf(user),
      });
    });
    touch("/dashboard/hr/reviews");
    return { success: true, id: row.id, message: "Review created" };
  } catch (e) {
    return fail(e);
  }
}

/** Who the signed-in user is on this review: HR, the employee, or the reviewer. */
async function roleOnReview(tx: Parameters<Parameters<typeof withAuthorizedTenant>[1]>[0], user: { id: string; role: string }, id: string) {
  const r = await hr.getReview(tx, id);
  if (!r) throw new Error("Review not found");
  const parts: Array<"hr" | "employee" | "reviewer"> = [];
  // Nobody sets the objectives for, or rates, their own review — not even HR.
  if (r.employee_user_id && r.employee_user_id === user.id) return { review: r, parts: ["employee" as const] };
  if (roleAllowed(user.role, HR_ADMIN)) parts.push("hr");
  if ((r.reviewer_user_id && r.reviewer_user_id === user.id) || (!r.reviewer_user_id && roleAllowed(user.role, REVIEW_ROLES))) {
    parts.push("reviewer");
  }
  return { review: r, parts };
}

export async function getPerformanceReview(id: string) {
  return withAuthorizedTenant([], async (tx, { user }) => {
    const { review, parts } = await roleOnReview(tx, user, id);
    if (!parts.length && !roleAllowed(user.role, REVIEW_ROLES)) return null;
    // The employee sees the reviewer's ratings and comments only once the
    // review is complete — they are removed here, not just hidden on screen.
    const onlyEmployee = parts.length === 1 && parts[0] === "employee";
    if (onlyEmployee && review.status !== "completed") {
      const objectives = ((review.objectives as Array<Record<string, unknown>>) || []).map(
        ({ managerRating: _r, comment: _c, ...o }) => o,
      );
      return plain({
        ...review,
        objectives,
        manager_comment: null,
        strengths: null,
        development_areas: null,
        recommendation: null,
        parts,
      });
    }
    return plain({ ...review, parts });
  }).catch(() => null);
}

export async function savePerformanceReview(
  id: string,
  as: "hr" | "employee" | "reviewer",
  patch: Parameters<typeof hr.saveReview>[3],
): Promise<ActionResult> {
  try {
    const row = await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      const { review, parts } = await roleOnReview(tx, user, id);
      if (!parts.includes(as)) throw new Error("You cannot edit this part of the review.");
      const saved = await hr.saveReview(tx, id, as, patch);
      // Tell whoever acts next.
      if (patch.advance) {
        const next =
          saved.status === "self_assessment"
            ? (review.employee_user_id as string | null)
            : saved.status === "manager_review"
              ? (review.reviewer_user_id as string | null)
              : (review.employee_user_id as string | null);
        if (next && next !== user.id) {
          await notifications.createMany(tx, [
            {
              companyId,
              userId: next,
              type: "approval_request",
              title:
                saved.status === "completed"
                  ? `Your ${review.cycle} review is complete`
                  : saved.status === "self_assessment"
                    ? `Your ${review.cycle} self-assessment is open`
                    : `${review.employee_name}'s ${review.cycle} review needs your ratings`,
              body: String(review.employee_name),
              href: `/dashboard/hr/reviews/${id}`,
            },
          ]);
        }
      }
      return saved;
    });
    touch("/dashboard/hr/reviews", `/dashboard/hr/reviews/${id}`, "/dashboard/hr/my-reviews");
    return { success: true, message: patch.advance ? `Review moved to ${row.status.replace("_", " ")}` : "Saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function acknowledgePerformanceReview(id: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant([], async (tx, { user }) => {
      const { parts } = await roleOnReview(tx, user, id);
      if (!parts.includes("employee")) throw new Error("Only the employee acknowledges their review.");
      return hr.acknowledgeReview(tx, id);
    });
    touch(`/dashboard/hr/reviews/${id}`, "/dashboard/hr/my-reviews");
    return { success: true, message: "Review acknowledged" };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePerformanceReview(id: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(HR_ADMIN, (tx) => hr.deleteReview(tx, id));
    touch("/dashboard/hr/reviews");
    return { success: true, message: "Review deleted" };
  } catch (e) {
    return fail(e);
  }
}

export async function listPerformanceReviews(f: { status?: string; cycle?: string } = {}) {
  return withAuthorizedTenant(REVIEW_ROLES, async (tx, { user }) => {
    // A line manager sees the reviews they are named on; HR sees all.
    const mine = roleAllowed(user.role, HR_ADMIN) ? {} : { reviewerUserId: user.id };
    return plain(await hr.listReviews(tx, { ...f, ...mine }));
  });
}

export async function listMyReviews() {
  return withAuthorizedTenant([], async (tx, { user }) => plain(await hr.listReviews(tx, { employeeUserId: user.id })));
}

// ── Recruitment ──────────────────────────────────────────────────────────────

export async function createVacancy(_prev: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const row = await withAuthorizedTenant(RECRUIT_ROLES, (tx, { user, companyId }) =>
      hr.createVacancy(tx, {
        companyId,
        title: str(fd, "title"),
        departmentId: str(fd, "departmentId") || null,
        employmentType: str(fd, "employmentType") || "full_time",
        positions: num(fd, "positions"),
        description: str(fd, "description") || null,
        requirements: str(fd, "requirements") || null,
        closingDate: str(fd, "closingDate") || null,
        status: str(fd, "status") || "open",
        actor: actorOf(user),
      }),
    );
    touch("/dashboard/hr/recruitment");
    return { success: true, id: row.id, message: `${row.vacancyNumber} created` };
  } catch (e) {
    return fail(e);
  }
}

export async function setVacancyStatus(id: string, status: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(RECRUIT_ROLES, (tx) => hr.setVacancyStatus(tx, id, status));
    touch("/dashboard/hr/recruitment", `/dashboard/hr/recruitment/${id}`);
    return { success: true, message: "Vacancy updated" };
  } catch (e) {
    return fail(e);
  }
}

export async function addCandidate(_prev: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const row = await withAuthorizedTenant(RECRUIT_ROLES, (tx, { user, companyId }) =>
      hr.addCandidate(tx, {
        companyId,
        vacancyId: str(fd, "vacancyId"),
        fullName: str(fd, "fullName"),
        email: str(fd, "email") || null,
        phone: str(fd, "phone") || null,
        source: str(fd, "source") || null,
        expectedSalary: num(fd, "expectedSalary"),
        notes: str(fd, "notes") || null,
        actor: actorOf(user),
      }),
    );
    touch(`/dashboard/hr/recruitment/${row.vacancyId}`, "/dashboard/hr/recruitment");
    return { success: true, id: row.id, message: `${row.fullName} added` };
  } catch (e) {
    return fail(e);
  }
}

export async function moveCandidate(id: string, step: Parameters<typeof hr.moveCandidate>[2]): Promise<ActionResult> {
  try {
    const row = await withAuthorizedTenant(RECRUIT_ROLES, (tx) => hr.moveCandidate(tx, id, step));
    touch(`/dashboard/hr/recruitment/${row.vacancyId}`, "/dashboard/hr/recruitment");
    return { success: true, message: `${row.fullName}: ${row.stage}` };
  } catch (e) {
    return fail(e);
  }
}

export async function listVacancies() {
  return withAuthorizedTenant(RECRUIT_ROLES, async (tx) => plain(await hr.listVacancies(tx)));
}

export async function getVacancy(id: string) {
  return withAuthorizedTenant(RECRUIT_ROLES, async (tx) => plain(await hr.getVacancy(tx, id)));
}

export async function getCandidateForHire(id: string) {
  return withAuthorizedTenant(RECRUIT_ROLES, async (tx) => plain(await hr.getCandidate(tx, id)));
}

// ── Alerts, report, org chart ────────────────────────────────────────────────

export async function getHrRecordAlerts() {
  return withAuthorizedTenant(rolesFor("hr.view") as string[], async (tx) => plain(await hr.getHrRecordAlerts(tx)));
}

export async function getHrReport(year: number) {
  return withAuthorizedTenant(REPORT_ROLES, async (tx) => plain(await hr.getHrReport(tx, year)));
}

export async function getOrgChart() {
  return withAuthorizedTenant(rolesFor("hr.view") as string[], async (tx) => plain(await hr.listOrgChart(tx)));
}

/** Everything on one employee's file beyond pay and leave, for their profile. */
export async function getEmployeeRecords(employeeId: string) {
  return withAuthorizedTenant(rolesFor("hr.view") as string[], async (tx, { user }) => {
    const canLetters = roleAllowed(user.role, LETTER_ROLES);
    const canCases = roleAllowed(user.role, CASE_ROLES);
    return plain({
      letters: canLetters ? await hr.listLetters(tx, { employeeId }) : null,
      cases: canCases ? await hr.listCases(tx, { employeeId }) : null,
      training: await hr.listTraining(tx, { employeeId }),
      reviews: await hr.listReviews(tx, { employeeId }),
    });
  });
}
