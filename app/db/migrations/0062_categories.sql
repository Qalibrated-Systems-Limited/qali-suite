-- ============================================================================
-- 0062 — Product categories, as a real tree.
--
-- `products.category` has been a plain `text` label since the products port,
-- while Mongo carried a full taxonomy: `parent`, a materialised `path`, a
-- `level`, per-category attribute definitions and a sort order. The categories
-- SCREENS assume that taxonomy exists — CategoryTree renders it — so the port
-- either builds the tree or deletes a feature. It builds it.
--
-- ── What Mongo maintains by hand, and what happens here ─────────────────────
--
-- 1. `path` AND `level` ARE MAINTAINED IN A PRE-SAVE HOOK.
--    `categorySchema.pre("save")` recomputes them when `parent` changes — for
--    the row being saved. Moving a category does NOT update its descendants,
--    so re-parenting a node leaves every child holding a path through a parent
--    it no longer has. Here `path` is an `ltree` maintained by a trigger over
--    the whole subtree, and `level` is derived from it and cannot disagree.
--
-- 2. `productCount` IS A CACHE THAT GUARDS A DESTRUCTIVE OPERATION.
--    category.js:292 refuses deletion when `productCount > 0` — a number
--    updated by hooks. If it drifts low, the guard passes and a category with
--    products is deleted; if it drifts high, a legitimate delete is refused
--    for ever with no way to correct it from the UI. Here the guard is the
--    foreign key: `products.category_id ... ON DELETE RESTRICT`. It cannot
--    drift, because it is not a number.
--
-- 3. SLUG UNIQUENESS IS A WHILE-LOOP.
--    The hook queries for the slug, appends `-1`, queries again, and repeats.
--    Two categories created at once both see "no such slug" and both take it.
--    A unique index makes the second one fail and retry honestly.
--
-- 4. A CATEGORY CAN BECOME ITS OWN ANCESTOR.
--    Nothing stops setting a node's parent to one of its own descendants,
--    which detaches the whole branch from the root and makes `getCategoryTree`
--    recurse until it gives up. The trigger below refuses it.
--
-- ── ltree ───────────────────────────────────────────────────────────────────
--
-- The extension has been enabled since 0001 (the chart of accounts uses it).
-- Labels are `A-Za-z0-9_` only, so a uuid's dashes become underscores — the
-- standard trick, and the reason `path` is built from ids rather than slugs:
-- a rename must not rewrite the path of every descendant.
--
-- `attributes` becomes a child table. It is a list of field DEFINITIONS
-- (name, type, whether required, unit), which is a table by any reading.
-- ============================================================================

CREATE TYPE "public"."category_attribute_type" AS ENUM (
  'text', 'number', 'boolean', 'date', 'select'
);--> statement-breakpoint

CREATE TABLE "categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE restrict,

  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,

  -- RESTRICT, not CASCADE: deleting a parent must not silently take a subtree
  -- of categories — and their products' classification — with it.
  "parent_id" uuid REFERENCES "categories"("id") ON DELETE restrict,

  -- Materialised by trigger over the WHOLE subtree, which the Mongo hook does
  -- only for the row being saved.
  "path" ltree NOT NULL,
  -- Derived, so it cannot disagree with the path it describes. Root is 0,
  -- matching Mongo's `level`.
  "level" integer GENERATED ALWAYS AS (nlevel("path") - 1) STORED,

  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,

  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "last_modified_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT "categories_name_not_blank" CHECK (btrim("name") <> ''),
  CONSTRAINT "categories_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);--> statement-breakpoint

-- The Mongo unique index was (companyId, name, parent) — two siblings cannot
-- share a name. NULLS NOT DISTINCT so two ROOTS cannot share one either, which
-- the Mongo index allowed: NULL parents never collide in a btree.
CREATE UNIQUE INDEX "categories_sibling_name_uq"
  ON "categories" ("company_id", "parent_id", lower("name")) NULLS NOT DISTINCT;--> statement-breakpoint

CREATE UNIQUE INDEX "categories_slug_uq" ON "categories" ("company_id", "slug");--> statement-breakpoint

CREATE INDEX "categories_path_gist" ON "categories" USING gist ("path");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" ("company_id", "parent_id", "sort_order");--> statement-breakpoint
CREATE INDEX "categories_active_idx" ON "categories" ("company_id", "is_active");--> statement-breakpoint

CREATE TABLE "category_attributes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE restrict,
  "category_id" uuid NOT NULL REFERENCES "categories"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "attribute_type" "category_attribute_type" DEFAULT 'text' NOT NULL,
  "is_required" boolean DEFAULT false NOT NULL,
  -- For a number attribute: "kg", "mm".
  "unit" text,
  "sort_order" integer DEFAULT 0 NOT NULL,

  CONSTRAINT "category_attributes_name_not_blank" CHECK (btrim("name") <> '')
);--> statement-breakpoint

CREATE UNIQUE INDEX "category_attributes_name_uq"
  ON "category_attributes" ("category_id", lower("name"));--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The path, maintained for the whole subtree.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION categories_sync_path() RETURNS trigger AS $$
DECLARE
  v_parent_path ltree;
  v_label       text;
BEGIN
  v_label := replace(NEW.id::text, '-', '_');

  IF NEW.parent_id IS NULL THEN
    NEW.path := v_label::ltree;
  ELSE
    SELECT path INTO v_parent_path FROM categories WHERE id = NEW.parent_id;
    IF v_parent_path IS NULL THEN
      RAISE EXCEPTION 'Parent category does not exist';
    END IF;
    -- A category cannot sit under itself or one of its own descendants.
    -- Tested against the LABEL rather than OLD.path: on an insert there is no
    -- OLD, and on an update OLD.path may already be stale. If the proposed
    -- parent's path contains this node's own label, the move makes a cycle.
    IF v_parent_path @> v_label::ltree OR v_parent_path ~ (('*.' || v_label || '.*')::lquery) THEN
      RAISE EXCEPTION 'A category cannot be moved beneath itself';
    END IF;
    NEW.path := v_parent_path || v_label::ltree;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER categories_path_before
  BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW EXECUTE FUNCTION categories_sync_path();--> statement-breakpoint

-- Moving a node moves its descendants. THE MONGO HOOK DOES NOT DO THIS: it
-- recomputes the path of the row being saved and leaves every child pointing
-- through a parent that has moved.
CREATE OR REPLACE FUNCTION categories_resync_descendants() RETURNS trigger AS $$
BEGIN
  IF NEW.path IS DISTINCT FROM OLD.path THEN
    UPDATE categories
       SET path = NEW.path || subpath(path, nlevel(OLD.path))
     WHERE path <@ OLD.path AND id <> NEW.id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- NOT `AFTER UPDATE OF path`. `UPDATE OF column` fires on what the STATEMENT
-- set, and `path` is set by the BEFORE trigger above — so the qualified form
-- never fires at all, and moving a category silently stranded its whole
-- subtree. Exactly the bug this trigger exists to fix, reintroduced by the
-- trigger's own declaration.
CREATE TRIGGER categories_path_after
  AFTER UPDATE ON categories
  FOR EACH ROW
  WHEN (NEW.path IS DISTINCT FROM OLD.path)
  EXECUTE FUNCTION categories_resync_descendants();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Products point at a category, and the FK is the delete guard.
--
-- `category` (text) STAYS, as the snapshot of what the product was filed under.
-- Dropping it would rewrite history on every product the moment a category is
-- renamed, and every picker and report reading it would need porting in the
-- same commit. It becomes derived-on-write, not authoritative.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "category_id" uuid REFERENCES "categories"("id") ON DELETE restrict;--> statement-breakpoint

CREATE INDEX "products_category_id_idx" ON "products" ("company_id", "category_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories', 'category_attributes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "categories" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "category_attributes" TO app_user;
