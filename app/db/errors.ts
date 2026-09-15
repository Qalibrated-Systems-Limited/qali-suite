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

  // ── Procurement (0049-0051) ───────────────────────────────────────────────
  purchase_orders_company_number_uq:
    "A purchase order with that number already exists.",
  purchase_orders_tolerance_range:
    "The receipt tolerance is a percentage between 0 and 100.",
  purchase_orders_valid_until_after_date:
    "The validity date cannot fall before the order date.",
  purchase_orders_cancelled_has_reason:
    "Cancelling a purchase order needs a reason.",
  purchase_orders_closed_has_reason:
    "Closing a purchase order short needs a reason.",
  purchase_orders_wht_rate_range:
    "The withholding rate must be between 0 and 30 percent.",
  purchase_order_lines_quantity_positive:
    "A line must order more than nothing.",
  purchase_order_lines_price_not_negative: "A unit price cannot be negative.",
  purchase_order_lines_vat_is_a_percentage:
    "VAT must be a percentage between 0 and 100.",

  // ── Employee claims (0052) ────────────────────────────────────────────────
  employee_claims_number_unique: "A claim with that number already exists.",
  employee_claims_one_open_advance:
    "That employee already has an advance outstanding. It has to be settled before another can be drawn.",
  employee_claims_advance_settled_once:
    "That advance has already been settled. You cannot submit another settlement for it.",
  employee_claims_advance_fields:
    "An advance request needs an amount and a purpose.",
  employee_claims_return_fields:
    "A settlement has to say which advance it settles, and for how much.",
  employee_claims_settlement_only_amounts:
    "Only a settlement can record cash returned or paid to the employee.",
  employee_claims_amounts_non_negative: "An amount cannot be negative.",
  employee_claims_rejection_has_reason:
    "Rejecting a claim needs a reason of at least ten characters.",
  employee_claims_travel_dates_ordered:
    "The return date cannot fall before the departure date.",
  employee_claim_items_amount_positive:
    "An expense line must be worth more than nothing.",
  employee_claim_items_line_unique: "That line number is already used on this claim.",
  employee_claim_items_expense_account_id_fk:
    "That expense account does not exist, or belongs to another company.",
  employee_claim_journal_entries_purpose_unique:
    "That has already been posted for this claim.",

  goods_receipts_company_number_uq:
    "A goods receipt with that number already exists.",
  goods_receipts_two_distinct_signatures:
    "Sales and Finance must be signed by two different people.",
  goods_receipts_receiver_does_not_sign:
    "The person who received the goods cannot also accept them. Ask a colleague to sign.",
  goods_receipts_finalised_is_signed_or_rejected:
    "A receipt needs both the Sales and Finance signatures before it can be finalised.",
  goods_receipts_sales_signature_complete:
    "A signature needs both the signatory and the time.",
  goods_receipts_finance_signature_complete:
    "A signature needs both the signatory and the time.",
  goods_receipts_source_matches_reference:
    "The receipt names a source that does not match the document it points at.",
  goods_receipts_voided_has_reason: "Voiding a receipt needs a reason.",
  goods_receipt_lines_accepted_within_received:
    "You cannot accept more than actually arrived.",
  goods_receipt_lines_rejection_has_reason:
    "Rejecting a line needs a reason — the nonconformance workflow starts from it.",
  goods_receipt_lines_quantities_not_negative:
    "A received or accepted quantity cannot be negative.",

  nonconformances_company_number_uq:
    "A nonconformance with that number already exists.",
  nonconformances_raiser_does_not_propose:
    "You cannot propose a disposition for a nonconformance you raised. Ask a colleague to review it.",
  nonconformances_proposer_does_not_authorize:
    "You proposed this disposition — ask another authority to approve it.",
  nonconformances_proposed_has_disposition:
    "A proposal needs an actual disposition and a reason.",
  nonconformances_authorized_is_authorized:
    "A nonconformance cannot be authorised before a disposition has been proposed.",
  nonconformances_closed_is_executed:
    "A nonconformance is closed once its authorised disposition has been carried out.",
  nonconformances_cancelled_has_reason:
    "Cancelling a nonconformance needs a reason.",
  nonconformances_source_matches_reference:
    "The nonconformance names a source that does not match the document it points at.",

  // ── Expenses (0059) ───────────────────────────────────────────────────────
  expenses_number_unique: "An expense with that number already exists.",
  expenses_amount_positive: "An expense must be worth more than nothing.",
  expenses_tax_non_negative: "Tax and withholding cannot be negative.",
  expenses_total_non_negative:
    "Withholding tax cannot be more than the expense plus its tax.",
  expenses_payment_is_whole:
    "A payment needs a method, an account and a date — or none of the three.",
  expenses_posted_has_entry:
    "A posted expense must have a journal entry, and a draft must not.",
  expenses_clearing_needs_payment:
    "An expense that was never paid cannot have a payment clearing entry.",
  journal_entries_party_pair:
    "A journal entry names a party without saying what kind, or the other way round.",

  // ── Petty cash (0060) ─────────────────────────────────────────────────────
  petty_cash_returns_number_unique:
    "A petty cash return with that number already exists.",
  petty_cash_returns_no_overlap:
    "A return already covers part of that period for this float. Open the existing one, or choose different dates.",
  petty_cash_returns_period_ordered:
    "The period cannot end before it starts.",
  petty_cash_returns_rejection_has_reason:
    "Sending a return back needs a reason.",
  petty_cash_returns_freeze_is_whole:
    "The signed figures on a return move together or not at all.",
  petty_cash_returns_submitted_is_frozen:
    "A return that has been submitted must carry the figures it was submitted with.",
  petty_cash_returns_totals_non_negative:
    "A return's totals cannot be negative.",

  // ── Projects (0070) ───────────────────────────────────────────────────────
  projects_company_number_idx: "A project with that number already exists.",
  projects_name_not_blank: "A project needs a name.",
  projects_progress_in_range: "Progress is a percentage between 0 and 100.",
  projects_amounts_non_negative: "A budget or contract value cannot be negative.",
  projects_client_pair:
    "A project's client is a customer, chosen from the list — not a name typed in.",
  projects_client_email_needs_a_client:
    "A client email belongs to a client. Choose the customer first.",
  projects_manager_pair:
    "A project with a project manager needs that person's name on it.",
  projects_dates_ordered: "The end date cannot fall before the start date.",
  projects_actual_end_needs_an_end:
    "Only a completed or closed project has an actual end date.",
  projects_not_own_parent: "A project cannot be its own parent.",
  project_budgets_version_idx:
    "That budget version already exists for this project.",
  project_budgets_one_approved:
    "This project already has an approved budget. Supersede it first.",
  project_budgets_approval_pair:
    "A draft budget carries no approval, and an approved one must.",
  project_budgets_approver_pair: "An approved budget must name its approver.",
  /**
   * Worded to be true either way. Postgres reports whichever unique index it
   * happens to check first, and the same code twice and two codes sharing an
   * account both land here — the sentence has to fit both. The repository
   * catches the same-code case before the insert and says so exactly.
   */
  project_budget_lines_one_per_account:
    "Two lines on this budget charge the same account, so each would show that account's full spend. Budget them as one line.",
  project_budget_lines_one_per_cost_code:
    "That cost code is already on this budget. Two lines against one code are two halves of one number.",
  project_cost_codes_account_id_accounts_id_fk:
    "That account is not in this company's chart.",
  project_budget_lines_cost_code_id_project_cost_codes_id_fk:
    "That cost code does not exist.",
  project_budget_lines_amount_non_negative:
    "A budget line cannot be negative.",
  project_cost_codes_company_code_idx:
    "A company-wide cost code with that code already exists.",
  project_cost_codes_project_code_idx:
    "That project already has a cost code with that code.",
  project_cost_codes_code_not_blank: "A cost code needs a code.",
  project_cost_codes_name_not_blank: "A cost code needs a name.",
  project_assignments_party_once:
    "That person is already on this project's roster.",
  project_assignments_rate_pair:
    "A rate needs both an amount and a unit, or neither.",
  project_assignments_rate_non_negative: "A rate cannot be negative.",
  project_assignments_removal_pair:
    "A removed assignment carries the date it was removed.",

  // ── Timesheets (0089) ─────────────────────────────────────────────────────
  project_timesheets_quantity_positive:
    "Enter how long was worked.",
  project_timesheets_quantity_within_a_day:
    "One line cannot be longer than a day. Split it across the days it was worked.",
  project_timesheets_cost_is_employee_labour:
    "Only an employee's time carries a cost here — a supplier's work is invoiced.",
  project_timesheets_cost_non_negative: "A cost cannot be negative.",
  project_timesheets_rate_pair:
    "A rate needs both an amount and a unit, or neither.",
  project_timesheets_bill_needs_billable:
    "A line that is not billable cannot carry a bill rate.",
  project_timesheets_bill_pair:
    "A bill rate and its amount go together.",
  project_timesheets_approval_pair:
    "An approved entry carries the date it was approved.",
  project_timesheets_cost_code_pair:
    "A cost code brings its account with it.",

  // ── The work breakdown (0071) ─────────────────────────────────────────────
  project_tasks_title_not_blank: "A task needs a title.",
  project_tasks_progress_in_range: "Progress is a percentage between 0 and 100.",
  project_tasks_hours_non_negative: "Estimated hours cannot be negative.",
  project_tasks_weight_positive:
    "A task's weight must be more than zero — a zero-weight task counts for nothing.",
  project_tasks_planned_dates_ordered:
    "The planned finish cannot fall before the planned start.",
  project_tasks_actual_dates_ordered:
    "The actual finish cannot fall before the actual start.",
  project_tasks_assignee_pair:
    "A task assigned to somebody needs that person's name on it.",
  project_tasks_done_is_complete:
    "A task is done at 100% and only at 100%. Set the percentage and the status together.",
  project_tasks_todo_has_not_started:
    "A task nobody has started has no progress and no start date.",
  project_tasks_finished_has_ended:
    "Only a task that is done or cancelled carries a finish date.",
  project_tasks_not_own_parent: "A task cannot be its own parent.",
  project_tasks_parent_same_project_fk:
    "A subtask belongs to the same project as the task above it.",
  project_tasks_id_project_uq: "That task already exists.",

  // ── KPIs (0097) ───────────────────────────────────────────────────────────
  kpis_name_uq:
    "A KPI with that name already exists. Two metrics with one name cannot be told apart on the board.",
  kpis_name_not_blank: "A KPI needs a name.",
  kpis_thresholds_agree_with_direction:
    "The on-track band has to be harder to reach than the at-risk one. For a lower-is-better metric that means a smaller ratio, not a bigger one.",
  kpis_thresholds_positive: "A threshold is a share of the target, so it has to be above zero.",
  kpi_snapshots_period_uq:
    "That period already has an actual recorded. Edit it rather than adding a second one.",
  kpi_snapshots_month_in_range: "The month has to be between 1 and 12.",
  kpi_snapshots_year_in_range: "That is not a year this system records against.",
  kpi_snapshots_period_shape:
    "That period does not fit the KPI's periodicity — a quarterly figure is filed on the quarter's last month, a yearly one on December.",
  kpis_owner_employee_id_employees_id_fk:
    "That employee is not in this company's register.",

  // ── Sales orders (0098) ───────────────────────────────────────────────────
  sales_orders_company_number_uq: "An order with that number already exists.",
  sales_orders_status_valid: "That is not a state a sales order can be in.",
  sales_orders_confirmation_pair:
    "A confirmed order carries the moment it was confirmed, and only a confirmed one does.",
  sales_orders_cancellation_pair:
    "A cancelled order carries the moment it was cancelled, and only a cancelled one does.",
  sales_orders_invoiced_pair:
    "An invoiced order carries the moment it was invoiced, and only an invoiced one does.",
  sales_orders_salesperson_pair:
    "A salesperson on an order needs their name recorded beside the reference.",
  sales_orders_customer_fk: "That customer is not in this company's records.",
  sales_order_lines_quantity_positive: "An order line needs a quantity above zero.",
  sales_order_lines_price_not_negative: "A unit price cannot be negative.",
  sales_order_lines_product_has_product:
    "A product line names a product; a service line names a category.",
  sales_order_lines_discount_is_a_percentage:
    "A discount is a percentage between 0 and 100.",
  sales_order_lines_tax_is_a_percentage:
    "A tax rate is a percentage between 0 and 100.",
  sales_order_lines_number_uq: "That line number is already used on this order.",
  sales_order_lines_product_fk: "That product is not in this company's catalogue.",
  /**
   * The reservation guard. Reached when two orders race for the last units:
   * both pass the availability pre-check, and the second one's UPDATE is the
   * one the constraint stops. The pre-check exists to name the product in the
   * ordinary case; this is what makes overselling impossible in the rare one.
   */
  products_commitments_within_on_hand:
    "There is not enough stock left to reserve — somebody else has committed it since this page loaded.",
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
