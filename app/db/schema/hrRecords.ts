import { pgTable, uuid, text, integer, numeric, date, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

/**
 * HR records beyond pay and leave (migration 20261116T063101): letters,
 * disciplinary and grievance cases, training and certificates, performance
 * reviews, and recruitment. Each row belongs to one company and points at that
 * company's employee through a composite foreign key.
 */

export const LETTER_KINDS = [
  "offer",
  "appointment",
  "probation_confirmation",
  "probation_extension",
  "promotion",
  "salary_review",
  "transfer",
  "warning",
  "show_cause",
  "commendation",
  "reference",
  "general",
] as const;

export const CASE_TYPES = ["disciplinary", "grievance"] as const;
export const CASE_CATEGORIES = [
  "absenteeism",
  "lateness",
  "misconduct",
  "insubordination",
  "poor_performance",
  "safety_breach",
  "theft_fraud",
  "harassment",
  "working_conditions",
  "pay",
  "other",
] as const;
export const CASE_STATUSES = ["open", "show_cause_issued", "hearing_scheduled", "closed"] as const;
export const CASE_OUTCOMES = [
  "no_case",
  "counselling",
  "verbal_warning",
  "written_warning",
  "final_warning",
  "suspension",
  "dismissal",
  "resolved",
  "not_upheld",
] as const;

export const TRAINING_KINDS = ["course", "certification", "licence", "induction", "competence", "workshop"] as const;
export const TRAINING_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;

export const REVIEW_STATUSES = ["draft", "self_assessment", "manager_review", "completed"] as const;
export const REVIEW_RECOMMENDATIONS = [
  "confirm",
  "promote",
  "salary_increase",
  "training",
  "improvement_plan",
  "no_change",
  "extend_probation",
] as const;

export const VACANCY_STATUSES = ["draft", "open", "on_hold", "filled", "closed"] as const;
export const CANDIDATE_STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn"] as const;

const audit = {
  createdById: text("created_by_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const company = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" });

export const hrLetters = pgTable(
  "hr_letters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: company(),
    letterNumber: text("letter_number").notNull(),
    employeeId: uuid("employee_id").notNull(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    issuedOn: date("issued_on").notNull().defaultNow(),
    effectiveDate: date("effective_date"),
    signatoryName: text("signatory_name"),
    signatoryTitle: text("signatory_title"),
    status: text("status").notNull().default("issued"),
    voidReason: text("void_reason"),
    ...audit,
  },
  (t) => [
    unique("hr_letters_company_number_uq").on(t.companyId, t.letterNumber),
    index("hr_letters_employee_idx").on(t.companyId, t.employeeId, t.issuedOn),
  ],
);

export const hrCases = pgTable(
  "hr_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: company(),
    caseNumber: text("case_number").notNull(),
    employeeId: uuid("employee_id").notNull(),
    caseType: text("case_type").notNull(),
    category: text("category").notNull(),
    incidentDate: date("incident_date").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("open"),
    showCauseIssuedOn: date("show_cause_issued_on"),
    responseDueOn: date("response_due_on"),
    employeeResponse: text("employee_response"),
    hearingDate: date("hearing_date"),
    hearingPanel: text("hearing_panel"),
    accompaniedBy: text("accompanied_by"),
    hearingNotes: text("hearing_notes"),
    outcome: text("outcome"),
    outcomeNotes: text("outcome_notes"),
    suspensionDays: integer("suspension_days"),
    warningExpiresOn: date("warning_expires_on"),
    appealNotes: text("appeal_notes"),
    closedOn: date("closed_on"),
    closedById: text("closed_by_id"),
    closedByName: text("closed_by_name"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    ...audit,
  },
  (t) => [
    unique("hr_cases_company_number_uq").on(t.companyId, t.caseNumber),
    index("hr_cases_employee_idx").on(t.companyId, t.employeeId, t.incidentDate),
  ],
);

export const hrTrainingRecords = pgTable(
  "hr_training_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: company(),
    employeeId: uuid("employee_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    provider: text("provider"),
    startDate: date("start_date"),
    completedOn: date("completed_on"),
    certificateNumber: text("certificate_number"),
    expiresOn: date("expires_on"),
    status: text("status").notNull().default("completed"),
    cost: numeric("cost", { precision: 19, scale: 4 }),
    /** The draft expense its cost raised for finance (other_modules_hand_their_money_to_finance). */
    expenseId: uuid("expense_id"),
    notes: text("notes"),
    ...audit,
  },
  (t) => [index("hr_training_employee_idx").on(t.companyId, t.employeeId)],
);

export type ReviewObjective = {
  objective: string;
  weight: number;
  selfRating?: number | null;
  managerRating?: number | null;
  comment?: string | null;
};

export const hrPerformanceReviews = pgTable(
  "hr_performance_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: company(),
    employeeId: uuid("employee_id").notNull(),
    cycle: text("cycle").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    reviewerUserId: text("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewerName: text("reviewer_name"),
    status: text("status").notNull().default("draft"),
    objectives: jsonb("objectives").$type<ReviewObjective[]>().notNull().default([]),
    selfComment: text("self_comment"),
    managerComment: text("manager_comment"),
    strengths: text("strengths"),
    developmentAreas: text("development_areas"),
    overallRating: numeric("overall_rating", { precision: 3, scale: 2 }),
    recommendation: text("recommendation"),
    employeeAcknowledgedAt: timestamp("employee_acknowledged_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...audit,
  },
  (t) => [unique("hr_reviews_one_per_cycle").on(t.companyId, t.employeeId, t.cycle)],
);

export const hrVacancies = pgTable(
  "hr_vacancies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: company(),
    vacancyNumber: text("vacancy_number").notNull(),
    title: text("title").notNull(),
    departmentId: uuid("department_id"),
    employmentType: text("employment_type").notNull().default("full_time"),
    positions: integer("positions").notNull().default(1),
    description: text("description"),
    requirements: text("requirements"),
    closingDate: date("closing_date"),
    status: text("status").notNull().default("open"),
    ...audit,
  },
  (t) => [unique("hr_vacancies_company_number_uq").on(t.companyId, t.vacancyNumber)],
);

export const hrCandidates = pgTable(
  "hr_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: company(),
    vacancyId: uuid("vacancy_id").notNull(),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    source: text("source"),
    stage: text("stage").notNull().default("applied"),
    rating: integer("rating"),
    interviewDate: date("interview_date"),
    expectedSalary: numeric("expected_salary", { precision: 19, scale: 4 }),
    notes: text("notes"),
    rejectionReason: text("rejection_reason"),
    employeeId: uuid("employee_id"),
    ...audit,
  },
  (t) => [index("hr_candidates_vacancy_idx").on(t.companyId, t.vacancyId, t.stage)],
);
