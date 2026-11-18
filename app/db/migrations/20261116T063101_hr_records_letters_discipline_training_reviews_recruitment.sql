-- HR to a standard set: probation, letters, disciplinary and grievance cases,
-- training and certificates, performance reviews, and recruitment.
--
-- Every table is per company under the same tenant_isolation policy as the
-- rest of HR, and every employee reference is the composite (employee_id,
-- company_id) foreign key, so a row can never point at another company's
-- employee even through the privileged connection.

/* Probation. `status = 'probation'` existed with no end date, so nobody could
   be told a confirmation was due. Employment Act s.42: at most six months,
   extendable once by up to six more with the employee's agreement. */
ALTER TABLE "employees" ADD COLUMN "probation_end_date" date;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_probation_after_hire"
  CHECK ("probation_end_date" IS NULL OR "probation_end_date" >= "hire_date");--> statement-breakpoint
UPDATE "employees"
   SET "probation_end_date" = ("hire_date" + INTERVAL '6 months')::date
 WHERE "status" = 'probation' AND "probation_end_date" IS NULL;--> statement-breakpoint

/* ── Letters ──────────────────────────────────────────────────────────────
   An issued letter is a record: what was said, to whom, on what date. The
   body is stored as written (it is what the employee was given) and printed
   on the company letterhead. */
CREATE TABLE "hr_letters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "letter_number" text NOT NULL,
  "employee_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "issued_on" date NOT NULL DEFAULT CURRENT_DATE,
  "effective_date" date,
  "signatory_name" text,
  "signatory_title" text,
  "status" text NOT NULL DEFAULT 'issued',
  "void_reason" text,
  "created_by_id" text,
  "created_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "hr_letters_company_number_uq" UNIQUE ("company_id", "letter_number"),
  CONSTRAINT "hr_letters_employee_fk" FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "hr_letters_kind_valid" CHECK ("kind" IN (
    'offer', 'appointment', 'probation_confirmation', 'probation_extension',
    'promotion', 'salary_review', 'transfer', 'warning', 'show_cause',
    'commendation', 'reference', 'general'
  )),
  CONSTRAINT "hr_letters_status_valid" CHECK ("status" IN ('issued', 'void')),
  CONSTRAINT "hr_letters_void_has_reason" CHECK ("status" <> 'void' OR "void_reason" IS NOT NULL),
  CONSTRAINT "hr_letters_subject_not_blank" CHECK (btrim("subject") <> ''),
  CONSTRAINT "hr_letters_body_not_blank" CHECK (btrim("body") <> '')
);--> statement-breakpoint
CREATE INDEX "hr_letters_employee_idx" ON "hr_letters" ("company_id", "employee_id", "issued_on" DESC);--> statement-breakpoint

/* ── Disciplinary and grievance cases ─────────────────────────────────────
   Employment Act s.41: before a warning, suspension or dismissal for
   misconduct or poor performance the employee is told why, in a language
   they understand, and heard — with a colleague or shop-floor representative
   present if they want one. The case keeps each of those steps. */
CREATE TABLE "hr_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "case_number" text NOT NULL,
  "employee_id" uuid NOT NULL,
  "case_type" text NOT NULL,
  "category" text NOT NULL,
  "incident_date" date NOT NULL,
  "description" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "show_cause_issued_on" date,
  "response_due_on" date,
  "employee_response" text,
  "hearing_date" date,
  "hearing_panel" text,
  "accompanied_by" text,
  "hearing_notes" text,
  "outcome" text,
  "outcome_notes" text,
  "suspension_days" integer,
  "warning_expires_on" date,
  "appeal_notes" text,
  "closed_on" date,
  "closed_by_id" text,
  "closed_by_name" text,
  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "hr_cases_company_number_uq" UNIQUE ("company_id", "case_number"),
  CONSTRAINT "hr_cases_employee_fk" FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "hr_cases_type_valid" CHECK ("case_type" IN ('disciplinary', 'grievance')),
  CONSTRAINT "hr_cases_category_valid" CHECK ("category" IN (
    'absenteeism', 'lateness', 'misconduct', 'insubordination', 'poor_performance',
    'safety_breach', 'theft_fraud', 'harassment', 'working_conditions', 'pay', 'other'
  )),
  CONSTRAINT "hr_cases_status_valid" CHECK ("status" IN (
    'open', 'show_cause_issued', 'hearing_scheduled', 'closed'
  )),
  CONSTRAINT "hr_cases_outcome_valid" CHECK ("outcome" IS NULL OR "outcome" IN (
    'no_case', 'counselling', 'verbal_warning', 'written_warning', 'final_warning',
    'suspension', 'dismissal', 'resolved', 'not_upheld'
  )),
  CONSTRAINT "hr_cases_closed_has_outcome" CHECK ("status" <> 'closed' OR "outcome" IS NOT NULL),
  CONSTRAINT "hr_cases_suspension_days" CHECK (
    "suspension_days" IS NULL OR "suspension_days" BETWEEN 1 AND 90
  ),
  CONSTRAINT "hr_cases_response_after_notice" CHECK (
    "response_due_on" IS NULL OR "show_cause_issued_on" IS NULL OR "response_due_on" >= "show_cause_issued_on"
  ),
  CONSTRAINT "hr_cases_description_not_blank" CHECK (btrim("description") <> '')
);--> statement-breakpoint
CREATE INDEX "hr_cases_employee_idx" ON "hr_cases" ("company_id", "employee_id", "incident_date" DESC);--> statement-breakpoint
CREATE INDEX "hr_cases_open_idx" ON "hr_cases" ("company_id", "status") WHERE "status" <> 'closed';--> statement-breakpoint

/* ── Training and certificates ────────────────────────────────────────────
   Courses attended and certificates or licences held, with their expiry —
   the competence record ISO/IEC 17025 §6.2 asks a laboratory to keep. */
CREATE TABLE "hr_training_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "provider" text,
  "start_date" date,
  "completed_on" date,
  "certificate_number" text,
  "expires_on" date,
  "status" text NOT NULL DEFAULT 'completed',
  "cost" numeric(19,4),
  "notes" text,
  "created_by_id" text,
  "created_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "hr_training_employee_fk" FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "hr_training_kind_valid" CHECK ("kind" IN (
    'course', 'certification', 'licence', 'induction', 'competence', 'workshop'
  )),
  CONSTRAINT "hr_training_status_valid" CHECK ("status" IN ('planned', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT "hr_training_dates" CHECK (
    "completed_on" IS NULL OR "start_date" IS NULL OR "completed_on" >= "start_date"
  ),
  CONSTRAINT "hr_training_expiry_after_completion" CHECK (
    "expires_on" IS NULL OR "completed_on" IS NULL OR "expires_on" >= "completed_on"
  ),
  CONSTRAINT "hr_training_cost_not_negative" CHECK ("cost" IS NULL OR "cost" >= 0),
  CONSTRAINT "hr_training_title_not_blank" CHECK (btrim("title") <> '')
);--> statement-breakpoint
CREATE INDEX "hr_training_employee_idx" ON "hr_training_records" ("company_id", "employee_id");--> statement-breakpoint
CREATE INDEX "hr_training_expiry_idx" ON "hr_training_records" ("company_id", "expires_on") WHERE "expires_on" IS NOT NULL;--> statement-breakpoint

/* ── Performance reviews ──────────────────────────────────────────────────
   One review per employee per cycle: objectives with weights, the
   employee's self-assessment, the manager's ratings and the agreed overall.
   Ratings are 1 (unsatisfactory) to 5 (outstanding). */
CREATE TABLE "hr_performance_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL,
  "cycle" text NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "reviewer_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewer_name" text,
  "status" text NOT NULL DEFAULT 'draft',
  "objectives" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "self_comment" text,
  "manager_comment" text,
  "strengths" text,
  "development_areas" text,
  "overall_rating" numeric(3,2),
  "recommendation" text,
  "employee_acknowledged_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_by_id" text,
  "created_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "hr_reviews_employee_fk" FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "hr_reviews_one_per_cycle" UNIQUE ("company_id", "employee_id", "cycle"),
  CONSTRAINT "hr_reviews_status_valid" CHECK ("status" IN (
    'draft', 'self_assessment', 'manager_review', 'completed'
  )),
  CONSTRAINT "hr_reviews_period" CHECK ("period_end" >= "period_start"),
  CONSTRAINT "hr_reviews_rating_range" CHECK (
    "overall_rating" IS NULL OR "overall_rating" BETWEEN 1 AND 5
  ),
  CONSTRAINT "hr_reviews_completed_rated" CHECK ("status" <> 'completed' OR "overall_rating" IS NOT NULL),
  CONSTRAINT "hr_reviews_recommendation_valid" CHECK ("recommendation" IS NULL OR "recommendation" IN (
    'confirm', 'promote', 'salary_increase', 'training', 'improvement_plan', 'no_change', 'extend_probation'
  )),
  CONSTRAINT "hr_reviews_objectives_array" CHECK (jsonb_typeof("objectives") = 'array')
);--> statement-breakpoint
CREATE INDEX "hr_reviews_status_idx" ON "hr_performance_reviews" ("company_id", "status");--> statement-breakpoint

/* ── Recruitment ──────────────────────────────────────────────────────────
   A vacancy and the candidates for it, from application to hire. A hired
   candidate becomes an employee and keeps the link. */
CREATE TABLE "hr_vacancies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "vacancy_number" text NOT NULL,
  "title" text NOT NULL,
  "department_id" uuid,
  "employment_type" text NOT NULL DEFAULT 'full_time',
  "positions" integer NOT NULL DEFAULT 1,
  "description" text,
  "requirements" text,
  "closing_date" date,
  "status" text NOT NULL DEFAULT 'open',
  "created_by_id" text,
  "created_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "hr_vacancies_id_company_uq" UNIQUE ("id", "company_id"),
  CONSTRAINT "hr_vacancies_company_number_uq" UNIQUE ("company_id", "vacancy_number"),
  CONSTRAINT "hr_vacancies_department_fk" FOREIGN KEY ("department_id", "company_id")
    REFERENCES "departments"("id", "company_id"),
  CONSTRAINT "hr_vacancies_status_valid" CHECK ("status" IN ('draft', 'open', 'on_hold', 'filled', 'closed')),
  CONSTRAINT "hr_vacancies_positions" CHECK ("positions" BETWEEN 1 AND 500),
  CONSTRAINT "hr_vacancies_title_not_blank" CHECK (btrim("title") <> '')
);--> statement-breakpoint

CREATE TABLE "hr_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "vacancy_id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "email" text,
  "phone" text,
  "source" text,
  "stage" text NOT NULL DEFAULT 'applied',
  "rating" integer,
  "interview_date" date,
  "expected_salary" numeric(19,4),
  "notes" text,
  "rejection_reason" text,
  "employee_id" uuid,
  "created_by_id" text,
  "created_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "hr_candidates_vacancy_fk" FOREIGN KEY ("vacancy_id", "company_id")
    REFERENCES "hr_vacancies"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "hr_candidates_employee_fk" FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id") ON DELETE SET NULL ("employee_id"),
  CONSTRAINT "hr_candidates_stage_valid" CHECK ("stage" IN (
    'applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'
  )),
  CONSTRAINT "hr_candidates_rating_range" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5),
  CONSTRAINT "hr_candidates_hired_has_employee" CHECK ("stage" <> 'hired' OR "employee_id" IS NOT NULL),
  CONSTRAINT "hr_candidates_rejected_has_reason" CHECK ("stage" <> 'rejected' OR "rejection_reason" IS NOT NULL),
  CONSTRAINT "hr_candidates_name_not_blank" CHECK (btrim("full_name") <> '')
);--> statement-breakpoint
CREATE INDEX "hr_candidates_vacancy_idx" ON "hr_candidates" ("company_id", "vacancy_id", "stage");--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hr_letters', 'hr_cases', 'hr_training_records', 'hr_performance_reviews',
    'hr_vacancies', 'hr_candidates'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

/* Letters and closed cases are records: no DELETE for the app (a letter is
   voided, a case closed). Training, reviews and recruitment entries can be
   removed when entered by mistake. */
GRANT SELECT, INSERT, UPDATE ON "hr_letters" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "hr_cases" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_training_records" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_performance_reviews" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_vacancies" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_candidates" TO app_user;
