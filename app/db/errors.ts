/**
 * What the user is told when the database refuses something.
 *
 * The schema says a great deal in plain English — "Jane cannot report to
 * somebody who reports to them", "This department still has 3 employees" — and
 * none of it reached anybody. drizzle wraps every driver failure in a
 * DrizzleQueryError whose `message` is the statement and its parameters, with
 * the real PostgresError on `.cause`. An action that returns `error.message`
 * therefore shows a page of SQL instead of the sentence written for exactly
 * this moment.
 *
 * `userMessage` walks to the real error and, where the failure is a constraint
 * rather than a raised message, translates the constraint name into something
 * a person can act on. Anything it does not recognise falls back to the
 * driver's own text, which is still better than the statement.
 */

/** Postgres error codes worth naming individually. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";

/**
 * Constraint name → what the person did wrong.
 *
 * Only for constraints whose failure a user can actually reach and fix. The
 * rest fall through to the database's message, which for a RAISE EXCEPTION is
 * already the sentence we wrote.
 */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  departments_company_code_uq: "A department with that code already exists.",
  departments_company_name_uq: "A department with that name already exists.",
  employees_company_number_uq:
    "That employee number is already in use. Employee numbers are unique within a company.",
  parties_company_employee_number_uq:
    "That employee number is already in use by another record.",
  employees_company_party_uq:
    "That person already has an employee record in this company.",
  employees_company_user_uq:
    "That login is already linked to another employee.",
  employees_terminated_has_a_date:
    "A terminated employee needs a termination date.",
  employees_terminated_after_hire:
    "The termination date cannot fall before the hire date.",
  employees_confirmed_after_hire:
    "The confirmation date cannot fall before the hire date.",
  employees_contract_ends_after_it_starts:
    "The contract end date cannot fall before it starts.",
  employees_basic_salary_not_negative: "A salary cannot be negative.",
  employees_allowances_not_negative: "An allowance cannot be negative.",
  employees_shift_start_is_a_time:
    "The shift start must be a 24-hour time, like 08:00.",
  employees_shift_end_is_a_time:
    "The shift end must be a 24-hour time, like 17:00.",
  employees_status_valid: "That is not a status an employee can be in.",
  employees_employment_type_valid: "That is not an employment type.",
  employees_payment_method_valid:
    "Pay can be made by bank transfer, M-Pesa or cash.",
  employees_manager_is_not_self: "Somebody cannot be their own manager.",
  departments_parent_is_not_self:
    "A department cannot be its own parent department.",
  public_holidays_recurrence_matches_year:
    "A recurring holiday applies every year, so it takes no year; a one-off needs one.",
  public_holidays_day_exists_in_month: "That date does not exist.",
  public_holidays_unique_recurring:
    "That holiday is already on the calendar.",
  public_holidays_unique_one_off: "That holiday is already on the calendar.",
};

interface PgLike {
  message?: string;
  code?: string;
  constraint_name?: string;
  detail?: string;
  cause?: unknown;
}

/** The deepest error in the `cause` chain — the one the database raised. */
export function rootCause(err: unknown): PgLike {
  let current = err as PgLike;
  const seen = new Set<unknown>();
  while (current?.cause && !seen.has(current.cause)) {
    seen.add(current.cause);
    current = current.cause as PgLike;
  }
  return current ?? {};
}

export function userMessage(err: unknown, fallback = "Something went wrong."): string {
  const root = rootCause(err);
  const named = root.constraint_name && CONSTRAINT_MESSAGES[root.constraint_name];
  if (named) return named;

  if (root.constraint_name) {
    switch (root.code) {
      case UNIQUE_VIOLATION:
        return "That value is already in use.";
      case FOREIGN_KEY_VIOLATION:
        return "That refers to something that does not exist, or is still in use elsewhere.";
      case CHECK_VIOLATION:
        return "That combination of values is not allowed.";
    }
  }
  if (root.code === NOT_NULL_VIOLATION) return "A required value is missing.";

  // A RAISE EXCEPTION from one of our own triggers lands here, and its message
  // is already written for the reader.
  const message = (root.message ?? (err as Error)?.message ?? "").trim();
  if (!message) return fallback;
  // Never hand back drizzle's wrapper, which is the statement itself.
  if (message.startsWith("Failed query:")) return fallback;
  return message;
}
