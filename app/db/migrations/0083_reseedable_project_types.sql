-- ─────────────────────────────────────────────────────────────────────────────
-- 0079 — The built-in project types, made re-runnable.
--
-- 0078 seeded six built-in rows with a plain INSERT. That is correct once and
-- wrong for ever after, and the way it was found is worth writing down:
--
--   `project_types.company_id` references `companies`, so `TRUNCATE companies
--   CASCADE` empties `project_types` COMPLETELY — cascade follows the FOREIGN
--   KEY, not the rows, so the built-ins go with it even though their
--   `company_id` is NULL. Every Postgres test suite in this repo opens with
--   that truncate. So the first suite to run deleted the built-in types for
--   every suite after it, and for the developer's test database until somebody
--   re-ran the migrations.
--
-- The general rule, which this repo now has an instance of: **reference data
-- that a TRUNCATE can reach must be re-runnable, not a one-shot INSERT.** The
-- seed becomes a function, the function is idempotent, and anything that needs
-- the rows back — a test harness, a restore, a developer wondering where they
-- went — calls it.
--
-- `ON CONFLICT (code) WHERE company_id IS NULL` infers the partial unique index
-- from 0078, so re-running touches nothing that already exists and cannot
-- collide with a TENANT's type of the same code.
--
-- The rows are the §7 matrix, unchanged. They are defaults OFFERED: a tenant
-- that runs a site diary on its supply jobs adds its own type, and nothing here
-- decides on anybody's behalf what their contract requires.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION seed_builtin_project_types() RETURNS void AS $$
BEGIN
  INSERT INTO project_types
    (company_id, code, name, description,
     shows_boq, shows_programme, shows_instructions, shows_diary,
     shows_certificates, shows_cash_requisitions, sort_order)
  VALUES
    (NULL, 'construction', 'Construction',
     'Civil or building works, measured against a bill and certified.',
     true,  true,  true,  true,  true,  true,  10),
    (NULL, 'installation', 'Installation',
     'Plant, weighbridge or electrical installation, paid on delivery and acceptance stages.',
     true,  true,  true,  true,  true,  true,  20),
    (NULL, 'maintenance', 'Maintenance',
     'A recurring service agreement.',
     false, false, false, false, false, true,  30),
    (NULL, 'supply', 'Supply',
     'Goods only, invoiced on delivery.',
     false, true,  false, false, false, false, 40),
    (NULL, 'consultancy', 'Consultancy',
     'Design or advisory work, usually time and material.',
     false, true,  false, false, false, true,  50),
    (NULL, 'internal', 'Internal',
     'Own capital works or R&D. No client and nothing to certify.',
     false, true,  false, false, false, true,  60)
  ON CONFLICT (code) WHERE company_id IS NULL DO NOTHING;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Put back whatever a truncate has already taken, on every database this runs
-- against.
SELECT seed_builtin_project_types();--> statement-breakpoint

-- `app_user` may CALL it — the function is SECURITY INVOKER, so the RLS policy
-- still applies and a tenant connection inserting a `company_id IS NULL` row
-- would be refused by WITH CHECK. That is deliberate: the grant makes the
-- function available to a health check, not to a tenant trying to write a
-- built-in.
GRANT EXECUTE ON FUNCTION seed_builtin_project_types() TO app_user;
