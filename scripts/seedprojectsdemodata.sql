-- Seed one demo project + three work-breakdown tasks, so the styled Projects
-- module (Milestone Tracker, Programme, IPC & Payments, Engineer's
-- Instructions, Site Diary, Monthly Report) has something real to render.
--
-- BEFORE RUNNING: replace the uuid on the next line with the company_id from
-- 00-find-company.sql — the one next to the user you'll be logged in as.
-- This runs as the database owner (bypasses RLS, same as every migration),
-- so nothing here checks that the id you paste in is real except the foreign
-- key on projects.company_id — if it's wrong, the insert simply fails.
WITH company AS (
  SELECT 'PASTE-COMPANY-ID-HERE'::uuid AS id
),
proj AS (
  INSERT INTO projects (
    company_id, project_number, name, description,
    status, priority, start_date, budget_amount, budget_currency,
    created_by_name
  )
  SELECT
    company.id,
    next_entry_number(company.id, 'PRJ'),
    'Demo Highway Rehabilitation Project',
    'Seed data for exercising the Milestone Tracker, Programme, IPC & Payments, Engineer''s Instructions, Site Diary and Monthly Report screens.',
    'active',
    'normal',
    CURRENT_DATE - INTERVAL '30 days',
    25000000,
    'KES',
    'Seed script'
  FROM company
  RETURNING id, company_id, project_number, name
),
task_data (title, status, progress_percent, estimated_hours, sort_order) AS (
  VALUES
    ('Site mobilisation and establishment', 'done',        100, 80,  1),
    ('Earthworks — cut and fill, Front 1',  'in_progress', 45,  600, 2),
    ('Subbase and base course',             'todo',        0,   400, 3)
),
tasks AS (
  INSERT INTO project_tasks (
    company_id, project_id, title, status, progress_percent,
    estimated_hours, sort_order, created_by_name
  )
  SELECT
    proj.company_id,
    proj.id,
    task_data.title,
    task_data.status::project_task_status,
    task_data.progress_percent,
    task_data.estimated_hours,
    task_data.sort_order,
    'Seed script'
  FROM proj, task_data
  RETURNING id, title, status, progress_percent
)
SELECT
  (SELECT id FROM proj)             AS project_id,
  (SELECT project_number FROM proj) AS project_number,
  (SELECT name FROM proj)           AS project_name,
  (SELECT count(*) FROM tasks)      AS tasks_created;
