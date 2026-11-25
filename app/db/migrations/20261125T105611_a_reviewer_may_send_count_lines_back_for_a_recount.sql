-- ============================================================================
-- A REVIEWER MAY SEND COUNT LINES BACK FOR A RECOUNT
--
-- In review, lines whose variance looks wrong can be sent back to be counted
-- again. The sheet returns to `counting`; those lines are cleared and must be
-- counted afresh (blind, if the sheet is blind). Earlier counts are kept in
-- `count_history`, so the reviewer can compare rounds.
--
-- SAFE TO APPLY because: new columns with defaults; nothing reads them yet.
-- ============================================================================

ALTER TABLE "stock_count_lines"
  ADD COLUMN "recount_round" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "recount_reason" text,
  ADD COLUMN "recount_requested_by_name" text,
  ADD COLUMN "recount_requested_at" timestamp with time zone,
  ADD COLUMN "count_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_recount_round_non_negative" CHECK ("recount_round" >= 0);
