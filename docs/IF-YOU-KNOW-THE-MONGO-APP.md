# If you know the Mongo app, start here

You know QaliSuite as a Next.js app on MongoDB and Mongoose. About two-thirds
of it is now on PostgreSQL. Both stores are live in the tree at the same time,
and **which one a module uses decides how you work on it** — so the first
question before touching anything is "has this module moved?"

This document answers that, and explains what changed and why.

---

## 1. Has this module moved? Ask the code, not a table

```bash
grep -rln "@/app/mongodb" app/dashboard --include="*.jsx" --include="*.tsx" \
  | cut -d/ -f3 | sort | uniq -c | sort -rn
```

A module is **on Postgres** when no screen in it imports `@/app/mongodb`.

### On Postgres — work in `app/db/`

products/stocks · invoices · bills · payments · statements · supplier-statements ·
parties · accounts · journal · categories · claims · expenses · petty-cash ·
credit-notes · quotes · purchase-orders · requests · checkout · users ·
HR & payroll · the dashboard

### Still Mongo — work in `app/mongodb/` as you always have

projects (11 screens) · integrations (10) · tax (8) · reports (8) · banking (8) ·
kpis (7) · settings (6) · leads · opportunities · adjustments · approvals ·
sales-orders · profile · admin · movements

### A non-zero count is not a verdict — read the import

Five modules in that list — **claims, invoices, bills, requests, expenses** —
have exactly **one** Mongo import each, and in every case it is the *project
picker*. They are fully ported apart from that one read, and all five close the
moment `projects` moves. Check what the import actually is before treating a
number as work.

**By the numbers:** 35 Postgres repositories, 35 action modules, 66 migrations,
51 Postgres test files. 61 Mongoose models remain for the unported modules.

---

## 1b. Your migration plan is the one that was followed

If you wrote `docs/POSTGRES_MIGRATION_PLAN.md` on the QSL branch — this is not a
different migration. It is yours, executed.

Your plan set out staged, per-module cutover through a repository layer so the
storage engine could be swapped underneath, with the app working at every step.
That is exactly what happened, and it is why a ported module is usually the
same screen with its imports repointed.

**The one place it diverged: the ORM.** Your plan recommended Prisma and named
the alternative — *"Drizzle (lighter, SQL-first) if you prefer raw-SQL control.
Either works."* The work went to Drizzle, for the reason your own document
gives: this schema leans on raw SQL that an ORM would fight — generated
columns, `COUNT(*) OVER ()`, window functions for running balances, and
row-level security policies doing the tenant scoping.

Where each got to:

| | your branch | this branch |
|---|---|---|
| schema | `prisma/schema.prisma`, 21 models | 66 SQL migrations |
| repositories | `app/data/*Repo.js`, 5 files, 256 lines | 35 repositories |
| action layer | — | 35 modules |
| tests | — | 51 Postgres suites |
| screens wired | **0** | roughly two-thirds |

That is not a criticism — scaffolding then executing is the right order, and
the plan is what made the execution straightforward. But it does mean
`app/data/*Repo.js`, `lib/prisma.js` and `prisma/schema.prisma` were **not
carried across** in the blend: nothing imported them, and two ORMs against one
database is not something to introduce quietly. They are still on your branch.

If you would rather the project were on Prisma, that is a real conversation to
have — but it is now a conversation about migrating 35 repositories and 51 test
suites, not about which to pick.

## 2. Where the code went

| Mongo | Postgres |
|---|---|
| `app/models/*.js` — Mongoose schemas | `app/db/schema/*.ts` — Drizzle tables |
| — | `app/db/migrations/*.sql` — numbered, applied in journal order |
| `app/mongodb/queries/*.js` | `app/db/repositories/*.ts` — **all SQL lives here** |
| `app/mongodb/actions/*.js` | `app/db/actions/*.ts` — `"use server"` |
| `dbConnect()` | `withAuthorizedTenant()` in `app/db/tenant.ts` |

The screens mostly did not move. A ported module is usually the *same page*
with its imports repointed, because **a ported function keeps its exact return
shape** — including Mongo-isms like `_id` alongside `id`, and nested
`inventory` / `costing` / `pricing` groups. That is deliberate: it makes a port
an import swap instead of a redesign.

---

## 3. The five habits that change

### Stop writing `companyId` filters

This is the big one.

```js
// Mongo — you scope every query yourself
const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };
const products = await Product.find({ ...tenantMatch, isActive: true });
```

```ts
// Postgres — the database scopes it. There is no filter to write.
return withAuthorizedTenant([], (tx) => productsRepo.listProducts(tx));
```

`withAuthorizedTenant` sets the tenant on the transaction and **row-level
security policies** do the filtering. A hand-written `companyId` filter is
either redundant or a bug. If a query returns nothing, suspect the tenant
context, not a missing `where`.

*(One narrow exception exists and is commented where it occurs: a join that
must name the company to avoid duplicate rows RLS has legitimately allowed.)*

### Nothing derived is stored

Mongo cached values that could drift from their own inputs. Postgres computes
them:

| Mongo | Postgres |
|---|---|
| `product.inventory.quantityAvailable` — stored | a **generated column**, `on_hand − committed − on_hold` |
| `party.cachedBalance` | the `party_balances` **view**, off the AR/AP control accounts |
| `project.financials.totalRevenue` | a query over `journal_lines` |

If you find yourself writing a number into a column that could be computed,
stop. That pattern is why statements once showed customers owing money they
had already been credited.

### Money moves through the ledger

Opening stock, invoices, payments and claims all post journal entries. A
quantity or a balance that changes **without** one is a bug. Adding stock means
recording a movement *and* posting DR Inventory / CR Opening Balance Equity —
not incrementing a field.

### Numbers are strings

Postgres `numeric` comes back as a string, on purpose, so money does not go
through a float. `Number(...)` at the edge where you display it; never do
arithmetic on the raw value assuming it is a number.

### Roles are per-company now

`users.role` is the identity-level role and only `SuperAdmin` is meaningful
there. What somebody may do **in a company** lives on their
`user_company_access` grant. Use `roleAllowed()` / `canSee*Nav()` from
`lib/permissions.js` rather than `.includes(user.role)` — the helpers grant
SuperAdmin everywhere, which inline lists forget.

---

## 4. Porting a module: the shape of the work

The unit is a **feature, end to end** — not a table and not a layer. A
half-ported feature is worse than an unported one, because half the screens
write one store while the rest read the other.

1. **Look at the destination first.** Much is already built. Products had a
   complete repository — commit/release/issue stock, receive-to-hold, recost —
   and nobody had noticed.
2. **Repository, then action, then screens.** SQL in the repository, session and
   permissions in the action, screens call actions only.
3. **Keep the return shape identical.** Even when the old one reads worse.
4. **Grep for the MODEL name, not the action file.** `grep -rn "EmployeeClaim"`
   found eleven readers outside the claims module that the screens did not.
5. **Run `node scripts/find-unwired-actions.mjs`** when you think you are done.

### The failure that keeps happening

**A ported action nothing calls is invisible.** It typechecks. Its tests pass —
because the tests call it directly, which is exactly the layer nothing else
uses. And the screen goes on calling the Mongo action beside it.

That is how products ended up with **30 items in Mongo and 0 in Postgres**: the
repository was written early, nothing was pointed at it, and meanwhile invoices
moved. The product dropdown on a new invoice was empty and no stock item could
be sold — for months, silently.

Grep the screens. Run the script.

---

## 5. Things that will surprise you

- **`tsc` cannot check raw SQL.** Column names inside a `` sql`...` `` template
  are unverified until the query runs. Two invented column names shipped this
  month. Check `information_schema`.
- **`eslint` will not catch a bad import path.** `no-undef` is satisfied because
  the symbol *is* imported — it just points at nothing. After moving a file,
  grep the whole repo.
- **Neither tool parses CSS.** Compile it:
  `npx @tailwindcss/cli -i app/globals.css -o /tmp/out.css`.
- **The test suite needs its own database** and takes ~25 minutes, because every
  test truncates 82 tables. Run one file while working.
- **There is no data to migrate.** This is a from-scratch deployment. Postgres
  starts empty and the schema is built by `npm run db:migrate`.
- **Session `companyId` is a Postgres uuid**, but Mongo documents are keyed by
  their original ObjectId. `lib/utils/legacy-company-id.js` translates. If you
  write a Mongo query in an unported module, use the helpers in
  `lib/utils/tenant-utils.js` rather than casting yourself.

---

## 6. Where to go next

| | |
|---|---|
| [`../README.md`](../README.md) | setup, scripts, layout |
| [`BUILDING-ON-POSTGRES.md`](BUILDING-ON-POSTGRES.md) | **the detailed guide** — the portedness table, the traps, the current handoff |
| [`POSTGRES-MIGRATION-PLAN.md`](POSTGRES-MIGRATION-PLAN.md) | why the migration is shaped this way |
| [`PROJECTS-QALITRACK-PLAN.md`](PROJECTS-QALITRACK-PLAN.md) | read before starting projects — it is not a straight port |

Anything marked **PRE-MIGRATION DOCUMENT** describes the Mongoose stack. Its
domain rules are still good; its descriptions of storage are not.
