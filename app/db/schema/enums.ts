import { pgEnum } from "drizzle-orm/pg-core";

// Mirrors accountTypes in lib/utils.js
export const accountTypeEnum = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);

export const journalStatusEnum = pgEnum("journal_status", [
  "draft",
  "posted",
  "reversed",
]);

export const partyTypeEnum = pgEnum("party_type", [
  "customer",
  "supplier",
  "employee",
  "other",
]);

/**
 * `future` is a period that exists and has never been opened. Onboarding
 * creates twelve and opens only the first, so eleven of every twelve start
 * here. It is postable — see migration 0030 for why, and for the gap that
 * makes it necessary.
 */
export const fiscalPeriodStatusEnum = pgEnum("fiscal_period_status", [
  "future",
  "open",
  "closed",
  "locked",
]);

// Mirrors the entryType enum on JournalEntry. Kept as a Postgres enum so an
// unknown type fails at write time rather than flowing into reports.
export const journalEntryTypeEnum = pgEnum("journal_entry_type", [
  "sale",
  "payment_received",
  "payment_made",
  "expense",
  "advance",
  "purchase",
  "adjustment",
  "opening_balance",
  "advance_settlement",
  "invoice_cancellation",
  "bill_cancellation",
  "closing",
  "transfer",
  "credit_note",
  "debit_note",
  "depreciation",
  "write_off",
  "payroll",
  "contra",
  "bank_entry",
  "cash_entry",
  "accrual",
  "revaluation",
  "tax",
  "inventory_adjustment",
  "liability_payment",
  "loan_disbursement",
  "goods_receipt",
  "goods_dispatch",
  "asset_disposal",
  "impairment",
  "other",
  /** 0052 — cash handed back from an advance the employee did not spend. */
  "advance_return",
]);

// Replaces the 12 nullable *Id fields under JournalEntry.relatedDocuments.
export const sourceDocumentTypeEnum = pgEnum("source_document_type", [
  "invoice",
  "payment",
  "expense",
  "bill",
  "stock_movement",
  "weighbridge_ticket",
  /** 0050 — the acceptance entry: DR Inventory, CR GR/IR. */
  "goods_receipt",
  /** 0051 — the write-off or supplier debit-note a disposition raises. */
  "nonconformance",
  /** 0052 — an advance, its settlement, or a reimbursement. */
  "employee_claim",
  /** 0056 — depreciation, impairment or disposal of a registered asset. */
  "fixed_asset",
  /** 0060 — the transfer that puts money into a petty cash tin. */
  "petty_cash_return",
  /** 0066 — an approved stock adjustment's inventory entry. */
  "stock_adjustment",
]);

// ── Invoices slice ───────────────────────────────────────────────────────────

/**
 * ONE VALUE, and that is the point (0067).
 *
 * It offered five. The system implements weighted average and nothing else:
 * `fifo`, `lifo` and `specific` were never written anywhere, and
 * `weighted_average` was a DUPLICATE of `average` — and the dangerous one,
 * because the three re-costing expressions all guarded on
 * `costing_method <> 'average'`, so a product carrying it would never have
 * been re-costed at all. It was the wizard's default. Nothing stored it, which
 * is the only reason that never bit.
 *
 * FIFO is a costing-LAYERS table, not an enum value. When there is a reason
 * for it, `stock_cost_layers` and consumption-on-issue arrive together and
 * this enum grows a value with them.
 */
export const costingMethodEnum = pgEnum("costing_method", ["average"]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "completed",
  "cancelled",
  "expired",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid",
  "partial",
  "paid",
  "overpaid",
]);

/**
 * Where an invoice line's stock came from — and therefore which inventory
 * account COGS credits.
 *
 * In Mongo this is inferred from whether a nullable nested field happens to
 * exist (`!!(item.relatedRequest?.requestId || ...)`), so "not from technician
 * stock" and "the field did not persist" are the same state, and nothing stops
 * two sources being set at once. See docs/POSTGRES-MIGRATION-PLAN.md §8.1.
 * Here it is mandatory and single-valued.
 */
export const fulfilmentSourceEnum = pgEnum("fulfilment_source", [
  "inventory",
  "stock_request",
  "checkout",
  "weighbridge",
]);

/**
 * Which system posted COGS for a line. Whichever gets there first wins, and
 * cogs_postings' primary key makes the second attempt a unique violation
 * rather than a duplicate posting — see §8.3.
 */
export const cogsSourceEnum = pgEnum("cogs_source", ["invoice", "weighbridge"]);

/**
 * Header-level provenance, stored on invoices and kept in step with the lines
 * by a trigger. Mongo stores this and the app reads it; it stays stored rather
 * than being derived on every read. `mixed` covers an invoice whose lines come
 * from more than one source, which the Mongo enum could not express.
 */
export const invoiceSourceTypeEnum = pgEnum("invoice_source_type", [
  "direct",
  "stock_request",
  "checkout",
  "weighbridge",
  "mixed",
]);

/**
 * Whether a document line sells a stocked product or a service.
 *
 * `credit_note_lines` has carried this since 0015; `invoice_lines` did not,
 * and had `product_id NOT NULL` — so a service line was expressible on the
 * credit note that reverses a sale but not on the invoice that makes it. See
 * migration 0025.
 */
export const lineItemTypeEnum = pgEnum("line_item_type", [
  "product",
  "service",
]);

/** Mirrors `serviceCategory` on invoice.js and quote.js. */
export const serviceCategoryEnum = pgEnum("service_category", [
  "labor", // hourly rate
  "mileage", // transport per km
  "accommodation", // nightouts, hotels
  "installation",
  "consultation",
  "maintenance",
  "repair",
  "other",
]);

// ── Payments ─────────────────────────────────────────────────────────────────

export const paymentTypeEnum = pgEnum("payment_type", ["received", "made"]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "mpesa",
  "bank_transfer",
  "cheque",
  "card",
]);

export const paymentRecordStatusEnum = pgEnum("payment_record_status", [
  "draft",
  "pending_clearance",
  "confirmed",
  "cancelled",
]);

/** What an allocation settles. */
export const allocationDocumentTypeEnum = pgEnum("allocation_document_type", [
  "invoice",
  "bill",
]);

// ── Bills (accounts payable) ─────────────────────────────────────────────────

export const billStatusEnum = pgEnum("bill_status", [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "cancelled",
]);

/**
 * Which account a bill line is charged to. Mongo restricts the line's
 * `account.type` to these two, and the choice decides the posting: an asset
 * line for a stocked product debits Inventory (or GR/IR under three-way
 * match), anything else debits the named account directly.
 */
export const billLineAccountTypeEnum = pgEnum("bill_line_account_type", [
  "expense",
  "asset",
]);

// ── Credit notes ─────────────────────────────────────────────────────────────

export const creditNoteStatusEnum = pgEnum("credit_note_status", [
  "draft",
  "issued",
  "applied",
  "void",
]);

export const creditNoteReasonEnum = pgEnum("credit_note_reason", [
  "return",
  "damaged",
  "overcharge",
  "cancellation",
  "discount",
  "defective",
  "other",
]);

export const creditNoteItemTypeEnum = pgEnum("credit_note_item_type", [
  "product",
  "service",
]);

// ── Fulfilment: stock requests, checkouts, weighbridge ───────────────────────

/** Mirrors `stockRequestTypes` in lib/utils.js. */
export const stockRequestTypeEnum = pgEnum("stock_request_type", [
  "sale", // direct sale → draft invoice at fulfilment
  "demo", // loan to customer → checkout, may convert to sale
  "installation", // installation job → checkout, accountant invoices
  "internal", // consumed internally → no invoice, no return
  "repair", // repair/service → checkout, usually returns
  "employee_borrow", // employee borrows for company use → must return
]);

export const stockRequestStatusEnum = pgEnum("stock_request_status", [
  "pending",
  "approved",
  "partially_fulfilled",
  "fulfilled",
  "invoiced",
  "rejected",
  "cancelled",
]);

/** Mirrors `priority` in lib/utils.js. */
export const requestPriorityEnum = pgEnum("request_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const requesterDepartmentEnum = pgEnum("requester_department", [
  "Technical",
  "Sales",
  "Service",
  "Installation",
  "Admin",
  "Finance",
  "Other",
]);

/** Mirrors `purposeForItemsRemovalFromStock` in lib/utils.js. */
export const stockRemovalPurposeEnum = pgEnum("stock_removal_purpose", [
  "sale",
  "technician_test",
  "customer_demo",
  "internal_use",
  "installation",
  "repair",
  "other",
]);

export const fulfilmentStatusEnum = pgEnum("fulfilment_status", [
  "pending",
  "partial",
  "complete",
]);

export const checkoutStatusEnum = pgEnum("checkout_status", [
  "checked_out",
  "returned",
  "overdue",
  "lost",
  "damaged",
  "converted_to_sale",
  "expensed",
]);

export const returnConditionEnum = pgEnum("return_condition", [
  "excellent",
  "good",
  "fair",
  "poor",
  "damaged",
  "lost",
]);

/** Why stock must come back: the sale that justified issuing it did not land. */
export const returnRequiredReasonEnum = pgEnum("return_required_reason", [
  "invoice_expired",
  "invoice_cancelled",
  "sale_failed",
  "other",
]);

export const checkoutReminderTypeEnum = pgEnum("checkout_reminder_type", [
  "upcoming",
  "due_today",
  "overdue",
  "final_warning",
]);

export const checkoutReminderMethodEnum = pgEnum("checkout_reminder_method", [
  "email",
  "sms",
  "in_app",
]);

/**
 * What a weighbridge trip was for. Mirrors WB_TRANSACTION_TYPES.
 *
 * This is the field that drives the general ledger, and the model says so:
 * "transactionType drives all accounting — direction alone is insufficient.
 * Gate software must declare the purpose of each trip."
 */
export const wbTransactionTypeEnum = pgEnum("wb_transaction_type", [
  "purchase", // inbound from supplier, clears via bill → GR/IR
  "sale", // outbound to customer against an invoice
  "sale_standalone", // outbound to customer, no invoice
  "transfer_out", // outbound to own location
  "transfer_in", // inbound from own location
  "return_to_supplier",
  "customer_return",
]);

/** The truck's direction. Describes the movement, not the accounting. */
export const wbDirectionEnum = pgEnum("wb_direction", ["inbound", "outbound"]);

export const wbStatusEnum = pgEnum("wb_status", [
  "pending",
  "first_recorded",
  "completed",
  "voided",
]);

export const wbWeightUnitEnum = pgEnum("wb_weight_unit", ["kg", "t"]);

// ── Tax transactions ─────────────────────────────────────────────────────────

/**
 * Kenyan statutory taxes. Carried over from taxTransactions.js unchanged,
 * including `nhif` — replaced by SHIF in October 2024, but kept so historical
 * records still validate. Dropping it would make old rows unreadable, which is
 * the opposite of what a tax record is for.
 */
export const taxTypeEnum = pgEnum("tax_type", [
  // VAT
  "vat_input", // VAT on purchases (claimable)
  "vat_output", // VAT on sales (payable)
  // Withholding
  "wht", // withheld on supplier payments
  "wht_received", // certificate received from a customer
  // Payroll
  "paye",
  "nssf",
  "shif", // replaced NHIF, Oct 2024
  "nhif", // legacy, retained for historical records
  "housing_levy",
  // Other
  "excise_duty",
  "advance_tax",
  "dst", // Digital Services Tax
  "turnover_tax",
  "cgt", // Capital Gains Tax
  "other",
]);

/** What a tax transaction was raised from. */
export const taxSourceDocumentTypeEnum = pgEnum("tax_source_document_type", [
  "invoice",
  "bill",
  "journal_entry",
  "other",
]);

// ── Stock movements ──────────────────────────────────────────────────────────

export const movementTypeEnum = pgEnum("movement_type", [
  "issue",       // internal issue (loan/use)
  "return",      // return from loan
  "sale",        // sale to customer
  "purchase",    // purchase from supplier
  "adjustment",  // stock adjustment
  "damage",      // damaged goods write-off
  "transfer",    // transfer between locations
  "initial",     // opening balance
]);

export const movementDirectionEnum = pgEnum("movement_direction", ["in", "out"]);

export const movementStatusEnum = pgEnum("movement_status", [
  "pending",
  "completed",
  "reversed",
]);

// ── Employee claims (0052) ───────────────────────────────────────────────────

export const employeeClaimTypeEnum = pgEnum("employee_claim_type", [
  /** Money asked for up front. */
  "advance_request",
  /** The settlement of one: receipts in, balance either way. */
  "advance_return",
  /** Money already spent out of pocket. */
  "reimbursement",
]);

/**
 * `pending_return` and `pending_payment` are the two ways a settled advance can
 * end: the employee owes the company, or the company owes the employee. They
 * are not stages of one queue, which is why the status machine in 0052 lets
 * `closeSettlement` reach either and nothing reach both.
 */
export const employeeClaimStatusEnum = pgEnum("employee_claim_status", [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "paid",
  "pending_return",
  "pending_payment",
  "closed",
]);

// ── Fixed assets (0056) ──────────────────────────────────────────────────────

/**
 * Property, plant and equipment, in roughly IFRS balance-sheet order:
 * long-life tangibles first, then movable, then short-life.
 */
export const assetCategoryEnum = pgEnum("asset_category", [
  "land",
  "building",
  /** Tenant improvements, amortised over the lease term. */
  "leasehold_improvement",
  "vehicle",
  "machinery",
  "office_equipment",
  "computer",
  "furniture",
  "equipment",
  "other",
]);

export const assetStatusEnum = pgEnum("asset_status", [
  "active",
  "idle",
  "in_maintenance",
  "disposed",
  "written_off",
]);

/** `none` is what land uses — it does not depreciate. */
export const depreciationMethodEnum = pgEnum("depreciation_method", [
  "straight_line",
  "reducing_balance",
  "none",
]);

/**
 * The first-period convention. `full_month` charges a whole month however late
 * in it the asset arrived; `pro_rata` charges the days it was actually held and
 * bleeds the remainder into an extra final month.
 */
export const depreciationConventionEnum = pgEnum("depreciation_convention", [
  "full_month",
  "pro_rata",
]);

export const depreciationPeriodStatusEnum = pgEnum(
  "depreciation_period_status",
  ["pending", "posted", "skipped"],
);

export const disposalMethodEnum = pgEnum("disposal_method", [
  "sold",
  "scrapped",
  "donated",
  "lost",
  "stolen",
]);

/**
 * KRA wear-and-tear classes. I 37.5% (heavy machinery), II 30% (computers),
 * III 25% (commercial vehicles), IV 12.5% (furniture and the rest).
 */
export const kraClassEnum = pgEnum("kra_class", [
  "class_I",
  "class_II",
  "class_III",
  "class_IV",
  "none",
]);

export const usageUnitEnum = pgEnum("usage_unit", ["km", "miles", "hours"]);

// ── Coffee cooperative (0058) ────────────────────────────────────────────────

/** What arrived at the gate. Cherry is wet; parchment and mbuni are dried. */
export const coffeeTypeEnum = pgEnum("coffee_type", [
  "cherry",
  "parchment",
  "mbuni",
]);

export const coffeeSeasonTypeEnum = pgEnum("coffee_season_type", [
  "main",
  "fly",
  "early",
]);

export const farmerIntakeStatusEnum = pgEnum("farmer_intake_status", [
  "recorded",
  "voided",
]);

export const farmerPaymentStatusEnum = pgEnum("farmer_payment_status", [
  "unpaid",
  "partial",
  "paid",
]);

// ── Expenses (0059) ──────────────────────────────────────────────────────────

/**
 * The four states the flow actually produces.
 *
 * Mongo's enum also carries `pending`, `approved` and `rejected` under a
 * comment saying they are "no longer created by the current workflow" — true,
 * and yet approval-queries.js:110 and pending-approvals-queries.js:144 still
 * filter on `status: "pending"`, so two screens have been counting a state
 * that cannot occur.
 */
export const expenseStatusEnum = pgEnum("expense_status", [
  "draft",
  "posted",
  "paid",
  "void",
]);

export const expenseCategoryEnum = pgEnum("expense_category", [
  "utilities",
  "rent",
  "salaries",
  "transport",
  "office_supplies",
  "insurance",
  "maintenance",
  "marketing",
  "legal_professional",
  "bank_charges",
  "depreciation",
  "meals_entertainment",
  "telecommunications",
  "training",
  "materials",
  "subscriptions",
  "security",
  "cleaning",
  "licenses_permits",
  "printing_stationery",
  "courier_postage",
  "other",
]);

/**
 * Mongo's list minus "unpaid". "unpaid" is not a payment method, it is the
 * absence of one — and conflating them is what allows an expense to carry
 * `paymentMethod: "cash"` with no account behind it, the state
 * postLegacyExpense has a special case for. Here the column is NULL until
 * money moves.
 */
export const expensePaymentMethodEnum = pgEnum("expense_payment_method", [
  "cash",
  "mpesa",
  "bank_transfer",
  "cheque",
  "card",
]);

// ── Petty cash (0060) ────────────────────────────────────────────────────────

/**
 * Four states, and `rejected` is now one of them in practice.
 *
 * `rejectPettyCashReturn` sets `status = "draft"`, so the Mongo enum's fourth
 * value was never written and a rejected return was indistinguishable from one
 * that had never been submitted — except by a `rejectionReason` string the
 * draft it became did not clear. The eighth dead enum value this migration
 * series has turned up; see the expense statuses in §9J for the pattern.
 */
export const pettyCashReturnStatusEnum = pgEnum("petty_cash_return_status", [
  "draft",
  "submitted",
  "approved",
  "rejected",
]);

// ── Categories (0062) ────────────────────────────────────────────────────────

/** What kind of value a category's attribute definition expects. */
export const categoryAttributeTypeEnum = pgEnum("category_attribute_type", [
  "text",
  "number",
  "boolean",
  "date",
  "select",
]);

// ── Stock adjustments (0066) ─────────────────────────────────────────────────

/**
 * `opening_balance` is kept and never written.
 *
 * On Mongo, creating a product with initial stock raised an adjustment of this
 * type and approved it in the same breath — the creator being the approver was
 * an explicit segregation-of-duties exception, documented at stock-actions.js:
 * 365. On Postgres, `createProductPg` posts opening stock directly to Opening
 * Balance Equity (product-actions.ts, `postOpeningStock`), which is where the
 * Mongo model's own comment says the credit belongs. So the path that wrote
 * this value is gone; the value survives so a migrated row can still say what
 * it was.
 */
export const adjustmentTypeEnum = pgEnum("adjustment_type", [
  "physical_count",
  "damage",
  "expiry",
  "theft",
  "correction",
  "write_off",
  "found",
  "opening_balance",
  "other",
]);

/**
 * Three states, and both terminal ones are reached from `draft` only.
 * `cancel()` refuses anything that is not a draft, which is what lets the two
 * pair CHECKs in 0066 be biconditionals rather than implications.
 */
export const adjustmentStatusEnum = pgEnum("adjustment_status", [
  "draft",
  "approved",
  "cancelled",
]);

// ── Stocktake sessions (0068) ────────────────────────────────────────────────

/**
 * A sheet, counted, reviewed, and posted — or abandoned.
 *
 * `draft` is a sheet not yet generated; the freeze happens on the way to
 * `counting`, which is what `stock_counts_frozen_once_open` states. Both
 * terminal states are reached from an open one, never from each other.
 */
export const stockCountStatusEnum = pgEnum("stock_count_status", [
  "draft",
  "counting",
  "review",
  "posted",
  "cancelled",
]);

// ── Projects (0070) ──────────────────────────────────────────────────────────

/**
 * planning → active → on_hold → active
 *                    → completed → closed
 *
 * Enforced by `project_status_transition`, not by the application. Mongo's
 * `canTransitionTo` guards ONE of the three writers — `updateProject` and
 * `updateProjectProgress` both reach the document through `findOneAndUpdate`,
 * where nothing checks anything.
 */
export const projectStatusEnum = pgEnum("project_status", [
  "planning",
  "active",
  "on_hold",
  "completed",
  "closed",
]);

export const projectPriorityEnum = pgEnum("project_priority", [
  "low",
  "normal",
  "high",
  "critical",
]);

/**
 * `milestone` and `time_material` are declared and nothing acts on them: there
 * is no milestone table and no hour logging, so both bill exactly as `fixed`
 * does. They are here because the Mongo enum had them and the create form
 * offers them; what makes them mean something is `contracts`.
 */
export const projectBillingModelEnum = pgEnum("project_billing_model", [
  "fixed",
  "milestone",
  "time_material",
]);

/** A superseded budget WAS approved and keeps its approval stamp. */
export const projectBudgetStatusEnum = pgEnum("project_budget_status", [
  "draft",
  "approved",
  "superseded",
]);

export const projectAssignmentStatusEnum = pgEnum("project_assignment_status", [
  "active",
  "inactive",
  "removed",
]);

export const projectRateUnitEnum = pgEnum("project_rate_unit", [
  "hour",
  "day",
  "month",
  "fixed",
]);

export const projectPartyTypeEnum = pgEnum("project_party_type", [
  "employee",
  "supplier",
  "both",
]);

// ── Project tasks (0071) ─────────────────────────────────────────────────────

/**
 * `done` is 100% and 100% is `done` — a biconditional, enforced by
 * `project_tasks_done_is_complete`. A leaf sitting at 100 that nobody marked
 * done is the same lie as a summary typed to 90, pointing the other way.
 *
 * `cancelled` is not a kind of finished. It is excluded from the progress
 * roll-up entirely: work called off is neither completed nor outstanding.
 */
export const projectTaskStatusEnum = pgEnum("project_task_status", [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]);

// ── Notifications (0074) ─────────────────────────────────────────────────────

/**
 * Transcribed from `NOTIFICATION_TYPES` in app/models/notification.js.
 *
 * An enum rather than free text because the bell renders an icon per type and
 * a value it does not recognise draws nothing — the failure is silent, which
 * is the mode this module was already failing in.
 */
export const notificationTypeEnum = pgEnum("notification_type", [
  "approval_request",
  "approval_decision",
  "system",
]);

// ── Project instructions & site diary (0075) ─────────────────────────────────

/**
 * What kind of record this is. `vo` and `rfi_response` are declared because
 * the site log the template mirrors distinguishes them from a plain
 * instruction and a non-conformance; nothing else in this pass acts on the
 * difference, the same posture `projectBillingModelEnum` takes with
 * `milestone`/`time_material`.
 */
export const projectInstructionTypeEnum = pgEnum("project_instruction_type", [
  "instruction",
  "ncr",
  "vo",
  "rfi_response",
]);

/**
 * pending → complied | disputed, and back to pending on reopen.
 * `project_instructions_response_signed` requires a name and a timestamp on
 * the way out of pending — a status flip with nobody attached to it is a
 * checkbox, not a decision.
 */
export const projectInstructionStatusEnum = pgEnum("project_instruction_status", [
  "pending",
  "complied",
  "disputed",
]);

/**
 * submitted → countersigned. There is no Resident Engineer role in this
 * system's role list, so `PROJECT_LOG_SIGNOFF_ROLES` (lib/utils/role-gates.js)
 * stands in for "whoever plays the RE on this tenant" — narrower than the
 * roles that may log a diary entry in the first place.
 */
export const projectDiaryStatusEnum = pgEnum("project_diary_status", [
  "submitted",
  "countersigned",
]);

// ── Bill of quantities (0076) ────────────────────────────────────────────────

/**
 * `draft → awarded → superseded`, versioned per project with one awarded at a
 * time (`project_boqs_one_awarded`).
 *
 * `awarded` is what FREEZES the priced facts — quantity, rate, unit, code — so
 * a variation issues a new item rather than editing a signed one, and a final
 * account can be argued from what was actually let. It is a status on the bill,
 * NOT a dependency on `contracts`: when that table lands it supplies the award
 * date, not the concept.
 */
export const projectBoqStatusEnum = pgEnum("project_boq_status", [
  "draft",
  "awarded",
  "superseded",
]);
