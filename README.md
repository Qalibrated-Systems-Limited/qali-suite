# QaliSuite

A multi-tenant ERP for Kenyan SMEs — inventory, sales, purchases, accounting,
HR and payroll — built on Next.js 16, React 19 and PostgreSQL.

> **Read this first if you are new.** The app is mid-migration from MongoDB to
> PostgreSQL. Both stores are live in the tree at once, and which one a module
> uses decides how you work on it. See [Where things stand](#where-things-stand).

---

## Getting started

```bash
npm install
cp .env.example .env          # then fill it in — see below
npm run db:migrate            # builds the Postgres schema from scratch
npm run dev                   # http://localhost:3000
```

### What you must set in `.env`

| variable | what it is |
|---|---|
| `DATABASE_URL` | Postgres, as the **app** role. The main connection. |
| `DIRECT_DATABASE_URL` | Postgres, as a **superuser**. Migrations and tests need privileges the app role is deliberately denied. |
| `AUTH_SECRET` | NextAuth signing secret. Any long random string locally. |
| `APP_URL` | `http://localhost:3000` in development. |
| `MONGODB_URI` | Still required — modules not yet ported read Mongo. |

The rest (Cloudinary, Resend/SMTP, Google OAuth, `CRON_SECRET`) are for
uploads, email, social sign-in and scheduled jobs. The app runs without them;
those features will not.

**There is no data to import.** This is a from-scratch deployment — `db:migrate`
builds the schema and the app seeds a company on first sign-in. Do not go
looking for a backfill.

### Tests

Postgres suites need **their own database**, not your dev one — every suite
begins by truncating every tenant table.

```bash
cp .env.example .env.test.local   # point DATABASE_URL at e.g. qalisuite_test
npm run db:migrate:test
npm test
```

The suite name must contain `test`, or the suites refuse to run. That guard
exists because somebody once pointed them at a working database.

> The full run takes ~25 minutes because each test truncates 82 tables. For
> day-to-day work run one file: `npx vitest run tests/pg-invoices.test.mjs`.

---

## Where things stand

Roughly two-thirds of the app is on PostgreSQL. The authoritative, regenerable
table lives in **[`docs/BUILDING-ON-POSTGRES.md`](docs/BUILDING-ON-POSTGRES.md)**
— read it before touching any module.

| | |
|---|---|
| **On Postgres** | products/stocks, invoices, bills, payments, statements, parties, accounts, journal, categories, claims, expenses, petty-cash, credit-notes, quotes, purchase-orders, requests, checkout, users, HR/payroll, the dashboard |
| **Still Mongo** | projects, integrations, tax, reports, banking, kpis, settings, leads, opportunities, adjustments, approvals, sales-orders |

Count it yourself rather than trusting the table:

```bash
grep -rln "@/app/mongodb" app/dashboard --include="*.jsx" --include="*.tsx" \
  | cut -d/ -f3 | sort | uniq -c | sort -rn
```

**A non-zero count is not a verdict.** Five modules — claims, invoices, bills,
requests, expenses — have exactly one Mongo import left, and it is the project
picker. They are waiting on `projects`, not half-ported. Read the import before
treating a number as work.

---

## How the code is laid out

```
app/db/              PostgreSQL — the current stack
  schema/            Drizzle table definitions
  migrations/        numbered SQL, applied in journal order
  repositories/      all SQL lives here, one file per aggregate
  actions/           "use server" — session, permissions, validation
  tenant.ts          withAuthorizedTenant — the gate every action goes through

app/mongodb/         MongoDB — the layer being replaced
app/models/          Mongoose models, likewise

app/dashboard/       the screens
components/          shared UI; components/ui is shadcn
lib/                 permissions, plans, business rules, utilities
tests/               vitest; pg-*.test.mjs are the Postgres suites
```

### The three layers, and the rule

1. **Repository** — SQL only. Takes a `tx`. Knows nothing about sessions.
2. **Action** — `"use server"`. Session, role gate, validation, revalidation.
3. **Screen** — calls actions. Never a repository directly.

**Never write a `companyId` filter.** Tenant isolation is row-level security in
Postgres: `withAuthorizedTenant` sets the tenant for the transaction and the
policies do the rest. A hand-written filter is either redundant or a bug.

---

## Before you commit

```bash
npm run lint:ci     # eslint, errors only — this is the bug gate
npx tsc --noEmit    # types
npm test            # or the suites your change touches
```

`lint:ci` is deliberately narrow: it fails on real bugs (`no-undef`,
unreachable code) and warns on style. `no-undef` is the one that matters — it
catches the wrong-name import that typechecks and crashes at runtime.

**Three things neither check will catch**, learned the hard way:

- **An unresolvable import path.** Not a type error, and `no-undef` is satisfied
  because the symbol *is* imported — it just points at nothing. After moving or
  renaming a file, grep the whole repo, not the folder you were working in.
- **Raw SQL.** `tsc` cannot see inside a `sql\`...\`` template. Column names are
  unchecked until the query runs. Verify against `information_schema`.
- **CSS.** Neither tool parses `globals.css`. Compile it:
  `npx @tailwindcss/cli -i app/globals.css -o /tmp/out.css`.

---

## Documentation

**Current, and worth your time:**

| doc | what it is |
|---|---|
| [`docs/BUILDING-ON-POSTGRES.md`](docs/BUILDING-ON-POSTGRES.md) | **the practical guide** — what is ported, the traps, the handoff |
| [`docs/POSTGRES-MIGRATION-PLAN.md`](docs/POSTGRES-MIGRATION-PLAN.md) | why the migration is shaped the way it is |
| [`docs/PROJECTS-QALITRACK-PLAN.md`](docs/PROJECTS-QALITRACK-PLAN.md) | the projects/contracts module — read before starting it |
| [`docs/QSL-BLEND-NOTES.md`](docs/QSL-BLEND-NOTES.md) | what came across from the QSL ERP branch, and what did not |

**Older, and about the pre-migration Mongoose stack.** Still useful for domain
rules — accounting flows, journal examples — but do not take their descriptions
of the stack as current: `ACCOUNTING_*.md`, `CURRENT-STATE.md`,
`erp-dev-roadmap.md`, `dashboard-plan.md`, `INTEGRATION_LAYER.md`,
`project-module-plan.md`.

---

## Branches

| branch | what |
|---|---|
| `feat/postgres-migration` | the migration, plus the QSL UI blend. **Work from here.** |
| `jeff-pg-branch` | the migration alone, before the QSL theme and pages |
| `main` | pre-migration |

Pushed to two remotes: `origin` (personal) and `qsl`
(`Qalibrated-Syatems-Limited/qali-suite`).

---

## Conventions worth knowing

- **A ported function keeps its exact return shape.** Even when the old shape
  reads worse. Screens destructure it; "improving" it on the way past breaks
  callers at runtime, and has three times already.
- **Nothing derived is stored.** Stock availability, party balances and project
  financials are computed from the ledger or from generated columns, not cached
  in a field that can disagree with its own inputs.
- **Money moves through the ledger.** Opening stock, invoices, payments and
  claims all post journal entries. A quantity or balance that changes without
  one is a bug.
- **Run `node scripts/find-unwired-actions.mjs` after porting a module.** A
  ported action nothing calls is invisible: it typechecks, its tests pass, and
  the screen goes on calling the Mongo version beside it. That is how products
  ended up with 30 items in Mongo and 0 in Postgres.
