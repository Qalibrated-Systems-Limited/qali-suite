-- ─────────────────────────────────────────────────────────────────────────────
-- 0072 — A project's client is a customer, and there is no other way to name one.
--
-- The create and edit forms already offer nothing but customers: the picker is
-- fed by `searchParties("", "customer")` and there is no quick-create beside
-- it. The rule was never enforced anywhere BELOW the form, and three routes
-- around it existed.
--
-- 1. A NAME WITH NO PARTY WAS LEGAL. `projects_client_pair` (0070) is an
--    implication — an id requires a name — so `client_name` on its own passed.
--    The 0070 header even blessed it: "a free-text client name with no Party
--    behind it stays legal ... which is what a one-off client is". That was the
--    wrong call. A project's client is the party its invoices are raised
--    against; a name that is not a customer record cannot be invoiced, cannot
--    be aged, and cannot appear on a statement. The constraint becomes a
--    BICONDITIONAL: both columns or neither.
--
-- 2. ANY PARTY WAS ACCEPTABLE. `client_party_id` references `parties`, and
--    `parties` holds suppliers and employees too. The picker filtered; the
--    column did not, so a supplier id posted to the form would have saved and
--    the project would have shown a vendor as its client.
--
--    A foreign key cannot say "and it must be a customer" — the target would
--    have to be a partial unique index, which Postgres will not accept as an FK
--    target. So it is a trigger, and it fires however the row is written.
--
-- 3. THE NAME CAME FROM THE REQUEST BODY. `createProject` read `clientName`
--    and `clientEmail` off the form and stored them. Nothing checked they had
--    anything to do with the id beside them. The action now resolves both from
--    `parties` and ignores what was posted — the same fix
--    `assignPartyToProject` needed for the roster.
--
-- The client stays OPTIONAL. An internal project — a warehouse move, an ERP
-- rollout — has no external client, and requiring one would push people to
-- invent a party to satisfy the form. What is refused is a client that is not
-- a customer, not the absence of one.
-- ─────────────────────────────────────────────────────────────────────────────

-- Anything already carrying a name with no party is a client that cannot be
-- invoiced. The name is kept nowhere: it was never a link, and leaving it
-- would mean leaving the constraint off.
UPDATE "projects"
   SET "client_name" = NULL, "client_email" = NULL
 WHERE "client_party_id" IS NULL
   AND ("client_name" IS NOT NULL OR "client_email" IS NOT NULL);--> statement-breakpoint

ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_client_pair";--> statement-breakpoint

-- Both or neither. The email rides with them: it is the customer's, snapshotted
-- when the project was raised, so it cannot exist without the customer.
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_pair" CHECK (
  ("projects"."client_party_id" IS NULL)
  = (length(btrim(COALESCE("projects"."client_name", ''))) = 0)
);--> statement-breakpoint

ALTER TABLE "projects" ADD CONSTRAINT "projects_client_email_needs_a_client" CHECK (
  "projects"."client_email" IS NULL OR "projects"."client_party_id" IS NOT NULL
);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- And the party has to be a customer.
--
-- Checked on the way in only. A customer later reclassified — the supplier
-- flag added, the customer flag dropped — does not retrospectively invalidate
-- a project raised when they were one, and the invoices already against it
-- are the record of that. Same reasoning as every other snapshot in this
-- schema: history is not rewritten by a later edit.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_client_is_a_customer() RETURNS trigger AS $$
DECLARE
  v_is_customer boolean;
  v_name        text;
BEGIN
  SELECT p.is_customer, p.name INTO v_is_customer, v_name
    FROM parties p WHERE p.id = NEW.client_party_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That client is not a party in this company.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT v_is_customer THEN
    RAISE EXCEPTION
      'A project''s client must be a customer, and % is not one. Add the customer role to them first.',
      v_name
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_client_is_a_customer"
BEFORE INSERT OR UPDATE OF client_party_id ON "projects"
FOR EACH ROW WHEN (NEW.client_party_id IS NOT NULL)
EXECUTE FUNCTION project_client_is_a_customer();
