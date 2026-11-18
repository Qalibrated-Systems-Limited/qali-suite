/**
 * Labels for the HR record types (cases, training, reviews, recruitment),
 * shared by the screens and the PDFs. The stored values are fixed by the
 * database's CHECK constraints (20261116T063101).
 */
export { LETTER_KIND_LABELS } from "./letters";

export const CASE_TYPE_LABELS = { disciplinary: "Disciplinary", grievance: "Grievance" };

export const CASE_CATEGORY_LABELS = {
  absenteeism: "Absenteeism",
  lateness: "Lateness",
  misconduct: "Misconduct",
  insubordination: "Insubordination",
  poor_performance: "Poor performance",
  safety_breach: "Safety breach",
  theft_fraud: "Theft / fraud",
  harassment: "Harassment",
  working_conditions: "Working conditions",
  pay: "Pay",
  other: "Other",
};
export const DISCIPLINARY_CATEGORIES = [
  "absenteeism", "lateness", "misconduct", "insubordination", "poor_performance", "safety_breach", "theft_fraud", "harassment", "other",
];
export const GRIEVANCE_CATEGORIES = ["working_conditions", "pay", "harassment", "other"];

export const CASE_STATUS_LABELS = {
  open: "Open",
  show_cause_issued: "Show-cause issued",
  hearing_scheduled: "Hearing scheduled",
  closed: "Closed",
};

export const CASE_OUTCOME_LABELS = {
  no_case: "No case to answer",
  counselling: "Counselling",
  verbal_warning: "Verbal warning (3 months)",
  written_warning: "Written warning (6 months)",
  final_warning: "Final written warning (12 months)",
  suspension: "Suspension",
  dismissal: "Dismissal",
  resolved: "Resolved",
  not_upheld: "Not upheld",
};
export const DISCIPLINARY_OUTCOMES = ["no_case", "counselling", "verbal_warning", "written_warning", "final_warning", "suspension", "dismissal"];
export const GRIEVANCE_OUTCOMES = ["resolved", "not_upheld"];

export const TRAINING_KIND_LABELS = {
  course: "Course",
  certification: "Certification",
  licence: "Licence / permit",
  induction: "Induction",
  competence: "Competence assessment",
  workshop: "Workshop / seminar",
};
export const TRAINING_STATUS_LABELS = {
  planned: "Planned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const REVIEW_STATUS_LABELS = {
  draft: "Draft — setting objectives",
  self_assessment: "Self-assessment",
  manager_review: "Manager review",
  completed: "Completed",
};
export const REVIEW_RECOMMENDATION_LABELS = {
  confirm: "Confirm in post",
  promote: "Promote",
  salary_increase: "Salary increase",
  training: "Training",
  improvement_plan: "Performance improvement plan",
  no_change: "No change",
  extend_probation: "Extend probation",
};
export const RATING_LABELS = {
  1: "1 — Unsatisfactory",
  2: "2 — Needs improvement",
  3: "3 — Meets expectations",
  4: "4 — Exceeds expectations",
  5: "5 — Outstanding",
};

export const VACANCY_STATUS_LABELS = { draft: "Draft", open: "Open", on_hold: "On hold", filled: "Filled", closed: "Closed" };
export const CANDIDATE_STAGE_LABELS = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const EMPLOYMENT_TYPE_LABELS = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  casual: "Casual",
  intern: "Intern",
};

export function fmtDay(d) {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}
