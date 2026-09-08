-- ─────────────────────────────────────────────────────────────────────────────
-- 0100 — The bank feed reaches the ledger.
--
-- Banking. It has been carried in every count since 2026-08-31 as "STAYS ON
-- MONGO BY DECISION, not by oversight … a ~3,900-line vertical whose service
-- posts payment-received and payment-made entries to the ledger, and it is not
-- currently broken — it reads the store it still writes."
--
-- THE SECOND HALF OF THAT SENTENCE IS WRONG, and it is why this is a repair
-- rather than a move. `bankFeedService.js` imports five models. Two of them —
-- BankStatement and BankFeedLine — are its own and still work. The other three
-- are `Account`, `Invoice` and `Bill`, and all three moved:
--
--   getBankAccounts()      reads Mongo Account  -> the UPLOAD screen's bank
--                          picker is EMPTY, so a statement cannot be imported
--   getExpenseAccounts()   reads Mongo Account  -> every account picker in the
--   getIncomeAccounts()      allocation dialog is EMPTY
--   autoMatchLines()       reads Mongo Invoice/Bill -> no suggestion is ever
--                          produced, for any line
--   allocateToInvoice()    reads Mongo Invoice  -> "Invoice not found", always
--
-- So the module is not working-but-unported. It is INERT: you cannot upload a
-- statement, and if you had one you could not allocate a line of it.
--
-- ── And the ledger sweep could not see it ─────────────────────────────────
--
-- `npm run ledger-sweep` has reported one remaining connector for weeks. It
-- seeds from `app/models/*.js` and the pattern `xSchema.methods/statics.name =
-- function`, then closes transitively over MODEL methods. `bankFeedService`
-- posts by calling `JournalService.createJournalEntry`, which calls
-- `JournalEntry.create` — from `app/mongodb/services/`, a directory the sweep
-- never scans for postings. A screen reaches it in four hops:
--
--   AllocationDialog.jsx -> bank-feed-actions.js -> bankFeedService
--     -> JournalService -> JournalEntry.create      (MONGO)
--
-- That is the eighth ledger gap, and the tool built to find exactly this class
-- of thing is structurally blind to it. The sweep is widened in the same
-- change; this migration is what makes the finding moot.
--
-- ── Decision 1 — A MATCHED RECEIPT IS A PAYMENT ───────────────────────────
--
-- Mongo's allocateToInvoice posted its own journal entry and hand-updated
-- `invoice.amountPaid`. On Postgres the payments module already does that,
-- exactly, and has since 0063: createPayment -> allocateToInvoice ->
-- confirmPayment, with a deferred constraint trigger refusing over-allocation
-- and a documented reversal path.
--
-- So a bank line matched to an invoice CREATES A REAL PAYMENT. The receipt is
-- then indistinguishable from one typed in by hand: it appears on the payments
-- screen, on the customer statement, in AR aging, and it can be reversed by
-- the path that already exists rather than by a bespoke undo. `source_line_id`
-- on `payments` is what lets the bank line find it again.
--
-- The other allocation kinds — expense, income, liability, transfer, split —
-- have no document to pay, so they post a journal entry directly, as before.
--
-- ── Decision 2 — THE STATS ARE DERIVED ────────────────────────────────────
--
-- `BankStatement.stats` was six stored counters, recomputed by
-- `updateStatementStats()` after every allocation and after every exclusion —
-- a cache maintained by hand at nine call sites, and stale the moment one of
-- them was forgotten. `bank_statement_stats` is a VIEW. It cannot drift,
-- because there is nothing to keep in step.
--
-- `status` stays a column, because 'processing' and 'error' describe the
-- IMPORT and no count can know them. The two the lines DO determine — ready
-- and completed — are maintained by a trigger, which is the same division the
-- quote totals use.
--
-- ── Decision 3 — ALLOCATION LEGS ARE ROWS ─────────────────────────────────
--
-- Mongo embedded `allocations[]` on the line. A split across four accounts is
-- four rows here, so "how much went to Motor Vehicle Expenses last quarter"
-- is a GROUP BY rather than an unwind, and each leg's account is a real
-- foreign key rather than a loose ObjectId.
--
-- ── Decision 4 — SUGGESTIONS ARE ROWS, AND DISPOSABLE ─────────────────────
--
-- Auto-match rewrites them wholesale on every run, so they are DELETEd and
-- re-inserted rather than merged, and they cascade with the line. They are a
-- cache of a computation, and the only thing that must not be lost is the
-- allocation a person actually chose.
-- ─────────────────────────────────────────────────────────────────────────────

/*
 * A bank allocation posts to the ledger, so it can be a journal entry's
 * source — and `journal_entries_source_pair` means `source_id` cannot be set
 * without a `source_type`. ADD VALUE only: nothing in this migration writes
 * it, which is what keeps it legal inside the migrator's transaction (0066).
 */
ALTER TYPE "public"."source_document_type"
  ADD VALUE IF NOT EXISTS 'bank_feed';--> statement-breakpoint

CREATE TYPE "bank_statement_status" AS ENUM ('processing', 'ready', 'completed', 'error');--> statement-breakpoint
CREATE TYPE "bank_balance_source" AS ENUM ('from_file', 'manual', 'unavailable');--> statement-breakpoint
CREATE TYPE "bank_line_status" AS ENUM ('unallocated', 'allocated', 'excluded', 'matched');--> statement-breakpoint
CREATE TYPE "bank_exclude_reason" AS ENUM (
  'duplicate', 'opening_balance', 'bank_charge', 'bank_interest',
  'reversal', 'internal_transfer', 'personal', 'manual', 'other'
);--> statement-breakpoint
CREATE TYPE "bank_allocation_type" AS ENUM (
  'invoice_payment', 'bill_payment', 'expense', 'income',
  'transfer', 'split', 'manual_journal', 'liability'
);--> statement-breakpoint
CREATE TYPE "bank_match_document" AS ENUM ('invoice', 'bill');--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- STATEMENTS — one uploaded file.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "bank_statements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,

  /* The account being reconciled. RESTRICT, not cascade: deleting an account
     that has a statement against it would silently drop the reconciliation. */
  "bank_account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,

  "file_name" text NOT NULL,
  "period_start" date,
  "period_end" date,

  "status" "bank_statement_status" DEFAULT 'processing' NOT NULL,

  /* Reported by the bank, not derived from our lines — the whole point of a
     reconciliation is that these two are compared. */
  "opening_balance" numeric(19,4),
  "closing_balance" numeric(19,4),
  "balance_source" "bank_balance_source" DEFAULT 'unavailable' NOT NULL,

  /* The column mapping the importer used, kept so a re-import of the same
     bank's format does not have to be re-mapped by hand. */
  "mapping_date" text,
  "mapping_description" text,
  "mapping_reference" text,
  "mapping_debit" text,
  "mapping_credit" text,
  "mapping_amount" text,
  "mapping_balance" text,
  "date_format" text DEFAULT 'DD/MM/YYYY' NOT NULL,

  "error_message" text,
  /* sha256 of the file. Duplicate-upload detection. */
  "content_hash" text,

  "uploaded_by_id" text,
  "uploaded_by_name" text NOT NULL DEFAULT 'System',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "bank_statements_period_ordered" CHECK (
    "period_start" IS NULL OR "period_end" IS NULL OR "period_end" >= "period_start"
  ),
  /* An error says why; nothing else claims one. */
  CONSTRAINT "bank_statements_error_has_a_message" CHECK (
    ("status" = 'error') = (btrim(COALESCE("error_message", '')) <> '')
  ),
  /* A balance read from the file has to have a balance in it. */
  CONSTRAINT "bank_statements_balance_source_pair" CHECK (
    "balance_source" <> 'from_file'
    OR ("opening_balance" IS NOT NULL AND "closing_balance" IS NOT NULL)
  )
);--> statement-breakpoint

/*
 * The same file cannot be uploaded twice. Mongo used a partial index for a
 * reason its own comment records: a `sparse` compound index still records
 * { companyId, null } for a hashless row, so two hashless uploads collide.
 * Expressed here as a partial unique index for the same reason.
 */
CREATE UNIQUE INDEX "bank_statements_content_hash_uq"
  ON "bank_statements" ("company_id", "content_hash")
  WHERE "content_hash" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "bank_statements_company_created_idx"
  ON "bank_statements" ("company_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "bank_statements_account_status_idx"
  ON "bank_statements" ("company_id", "bank_account_id", "status");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- LINES — one transaction off the statement.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "bank_feed_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "statement_id" uuid NOT NULL REFERENCES "bank_statements"("id") ON DELETE CASCADE,
  "bank_account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,

  "transaction_date" date NOT NULL,
  "description" text NOT NULL,
  "reference" text,

  /* Money out and money in, both POSITIVE. A line is one or the other. */
  "debit_amount" numeric(19,4) DEFAULT 0 NOT NULL,
  "credit_amount" numeric(19,4) DEFAULT 0 NOT NULL,
  "running_balance" numeric(19,4),

  /* What the file said, so an import can be argued with. */
  "raw_data" jsonb,
  "row_number" integer,
  /* sha256 of account|date|description|debit|credit. */
  "line_hash" text,

  "status" "bank_line_status" DEFAULT 'unallocated' NOT NULL,
  "exclude_reason" "bank_exclude_reason",
  "exclude_note" text,

  "allocation_type" "bank_allocation_type",

  /* What it was matched to, when it was matched to a document. */
  "matched_document_type" "bank_match_document",
  "matched_invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  "matched_bill_id" uuid REFERENCES "bills"("id") ON DELETE SET NULL,
  "matched_party_id" uuid REFERENCES "parties"("id") ON DELETE SET NULL,
  "matched_party_name" text,
  "applied_amount" numeric(19,4),
  "overpayment_amount" numeric(19,4),

  /* Decision 1 — the payment this line raised, when it raised one. */
  "payment_id" uuid REFERENCES "payments"("id") ON DELETE SET NULL,
  /* Or the entry it posted, for the kinds that have no document to pay. */
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,

  "allocated_by_id" text,
  "allocated_by_name" text,
  "allocated_at" timestamp with time zone,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "bank_feed_lines_amounts_non_negative" CHECK (
    "debit_amount" >= 0 AND "credit_amount" >= 0
  ),
  /* MONEY MOVED ONE WAY. Mongo allowed both columns to be zero — a line that
     is neither a payment nor a receipt — and allowed both to be set at once,
     which no bank statement produces and which every net-amount calculation
     downstream would then quietly get wrong. */
  CONSTRAINT "bank_feed_lines_one_direction" CHECK (
    ("debit_amount" > 0) <> ("credit_amount" > 0)
  ),
  /* An exclusion says why; nothing else carries a reason. */
  CONSTRAINT "bank_feed_lines_exclusion_pair" CHECK (
    ("status" = 'excluded') = ("exclude_reason" IS NOT NULL)
  ),
  /* An allocated line says how it was allocated, and an unallocated one does
     not pretend to. */
  CONSTRAINT "bank_feed_lines_allocation_pair" CHECK (
    ("status" IN ('allocated', 'matched')) = ("allocation_type" IS NOT NULL)
  ),
  /* And a document match names exactly the document it matched. */
  CONSTRAINT "bank_feed_lines_matched_document_pair" CHECK (
    CASE "matched_document_type"
      WHEN 'invoice' THEN "matched_invoice_id" IS NOT NULL AND "matched_bill_id" IS NULL
      WHEN 'bill'    THEN "matched_bill_id" IS NOT NULL AND "matched_invoice_id" IS NULL
      ELSE "matched_invoice_id" IS NULL AND "matched_bill_id" IS NULL
    END
  ),
  CONSTRAINT "bank_feed_lines_applied_non_negative" CHECK (
    ("applied_amount" IS NULL OR "applied_amount" >= 0)
    AND ("overpayment_amount" IS NULL OR "overpayment_amount" >= 0)
  )
);--> statement-breakpoint

/* One import of a given transaction. Partial, for the same reason the
   statement hash is: a NULL hash is not a duplicate of another NULL hash. */
CREATE UNIQUE INDEX "bank_feed_lines_hash_uq"
  ON "bank_feed_lines" ("company_id", "line_hash")
  WHERE "line_hash" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "bank_feed_lines_statement_idx"
  ON "bank_feed_lines" ("statement_id", "status");--> statement-breakpoint
/* The unallocated queue, across every statement — its own screen. */
CREATE INDEX "bank_feed_lines_queue_idx"
  ON "bank_feed_lines" ("company_id", "status", "transaction_date" DESC);--> statement-breakpoint
/* Matching searches description and reference. */
CREATE INDEX "bank_feed_lines_search_idx"
  ON "bank_feed_lines" USING gin (
    to_tsvector('simple', COALESCE("description", '') || ' ' || COALESCE("reference", ''))
  );--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- ALLOCATION LEGS — decision 3. One row per account a line was split across.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "bank_feed_line_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "line_id" uuid NOT NULL REFERENCES "bank_feed_lines"("id") ON DELETE CASCADE,

  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "amount" numeric(19,4) NOT NULL,
  "description" text,

  "tax_amount" numeric(19,4),
  "tax_account_id" uuid REFERENCES "accounts"("id") ON DELETE RESTRICT,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "bank_feed_line_allocations_amount_positive" CHECK ("amount" > 0),
  /* Tax needs an account to sit in, and an account needs an amount. */
  CONSTRAINT "bank_feed_line_allocations_tax_pair" CHECK (
    ("tax_amount" IS NULL) = ("tax_account_id" IS NULL)
  ),
  CONSTRAINT "bank_feed_line_allocations_tax_non_negative" CHECK (
    "tax_amount" IS NULL OR "tax_amount" >= 0
  )
);--> statement-breakpoint

CREATE INDEX "bank_feed_line_allocations_line_idx"
  ON "bank_feed_line_allocations" ("line_id");--> statement-breakpoint
CREATE INDEX "bank_feed_line_allocations_account_idx"
  ON "bank_feed_line_allocations" ("company_id", "account_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- SUGGESTIONS — decision 4. A cache of the matcher, rewritten wholesale.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "bank_feed_line_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "line_id" uuid NOT NULL REFERENCES "bank_feed_lines"("id") ON DELETE CASCADE,

  "document_type" "bank_match_document" NOT NULL,
  "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE CASCADE,
  "bill_id" uuid REFERENCES "bills"("id") ON DELETE CASCADE,

  "document_number" text NOT NULL,
  "party_name" text,
  "amount" numeric(19,4) NOT NULL,
  "confidence" integer NOT NULL,
  "match_reason" text,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "bank_feed_line_suggestions_confidence_range" CHECK (
    "confidence" BETWEEN 0 AND 100
  ),
  CONSTRAINT "bank_feed_line_suggestions_document_pair" CHECK (
    CASE "document_type"
      WHEN 'invoice' THEN "invoice_id" IS NOT NULL AND "bill_id" IS NULL
      WHEN 'bill'    THEN "bill_id" IS NOT NULL AND "invoice_id" IS NULL
    END
  ),
  /* One suggestion per document per line — the matcher runs repeatedly. */
  CONSTRAINT "bank_feed_line_suggestions_once" UNIQUE (
    "line_id", "document_type", "invoice_id", "bill_id"
  )
);--> statement-breakpoint

CREATE INDEX "bank_feed_line_suggestions_line_idx"
  ON "bank_feed_line_suggestions" ("line_id", "confidence" DESC);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 1 — the payment a bank line raised knows where it came from.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "payments"
  ADD COLUMN "source_line_id" uuid REFERENCES "bank_feed_lines"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX "payments_source_line_idx"
  ON "payments" ("source_line_id") WHERE "source_line_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 2 — the stats are a VIEW, not six counters kept in step by hand.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "bank_statement_stats" AS
SELECT s.id                                                       AS statement_id,
       s.company_id                                               AS company_id,
       COUNT(l.id)::int                                           AS total_lines,
       COUNT(l.id) FILTER (
         WHERE l.status IN ('allocated', 'matched'))::int          AS allocated_lines,
       COUNT(l.id) FILTER (WHERE l.status = 'excluded')::int       AS excluded_lines,
       COUNT(l.id) FILTER (WHERE l.status = 'unallocated')::int    AS unallocated_lines,
       COALESCE(SUM(l.debit_amount), 0)::numeric(19,4)             AS total_debits,
       COALESCE(SUM(l.credit_amount), 0)::numeric(19,4)            AS total_credits
  FROM bank_statements s
  LEFT JOIN bank_feed_lines l ON l.statement_id = s.id
 GROUP BY s.id, s.company_id;--> statement-breakpoint

/*
 * And the two statuses the LINES determine. 'processing' and 'error' describe
 * the import and are never touched here — only the ready <-> completed pair,
 * which is a fact about how many lines are still outstanding.
 */
CREATE OR REPLACE FUNCTION sync_bank_statement_status() RETURNS trigger AS $$
DECLARE
  target uuid := COALESCE(NEW.statement_id, OLD.statement_id);
  outstanding int;
  total int;
BEGIN
  SELECT COUNT(*) FILTER (WHERE status = 'unallocated'), COUNT(*)
    INTO outstanding, total
    FROM bank_feed_lines WHERE statement_id = target;

  /* CAST BOTH ARMS. A bare CASE yields `text`, and `status` is an enum, so
     without this the trigger raises 42804 on EVERY insert — which means no
     line can be imported at all. The migration still applies cleanly, because
     a trigger body is only parsed when it runs. A test caught it. */
  UPDATE bank_statements
     SET status = CASE WHEN total > 0 AND outstanding = 0
                       THEN 'completed'::bank_statement_status
                       ELSE 'ready'::bank_statement_status END,
         updated_at = now()
   WHERE id = target
     AND status IN ('ready', 'completed');

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER sync_bank_statement_status_on_line_change
AFTER INSERT OR UPDATE OF status OR DELETE ON "bank_feed_lines"
FOR EACH ROW EXECUTE FUNCTION sync_bank_statement_status();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security, same shape as every other tenant-scoped table.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_statements', 'bank_feed_lines',
                           'bank_feed_line_allocations',
                           'bank_feed_line_suggestions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

/* 0023's ALTER DEFAULT PRIVILEGES already granted app_user full DML on these
   as they were created, so there is nothing to add — see 0099, where wanting
   SELECT-only meant REVOKE rather than GRANT. The view inherits nothing, and
   is granted explicitly. */
GRANT SELECT ON "bank_statement_stats" TO app_user;
