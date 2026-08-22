# Building on the Postgres layer

For anyone adding a feature, an endpoint or a page on top of the port. The
migration reasoning lives in `POSTGRES-MIGRATION-PLAN.md`; this is the practical
half — what to call, what not to, and the three things that bite.

---

## Where the port has reached

Counted, not remembered — regenerate it with:

```
grep -rln "@/app/mongodb" app/dashboard --include="*.jsx" | cut -d/ -f3 | sort | uniq -c | sort -rn
```

A module is **on Postgres** when no screen in it imports `@/app/mongodb`.

| on Postgres | still Mongo (files) |
|---|---|
| **hr**, **claims**, **assets**, users, accounts (bar opening balances), invoices, bills, parties, requests, journal, statements, supplier-statements, credit-notes, quotes, purchase-orders | projects 11, integrations 11, tax 8, reports 8, banking 8, kpis 7, components 7, settings 6, payments 6, stocks 5, petty-cash 5, expenses 5, **claims 4**, **assets 2** |

**Assets reads 2, and both are the expenses side.** `fleet-insights-queries`
and `asset-cost-queries` merge spend from Mongo expenses with bills and the
register from Postgres — that seam is real until expenses move, and
`asset-cost-queries.js` deliberately lives on the Mongo side so it goes with
them.

**Claims reads 4, and all four are the project picker.** Every claim, item,
receipt, journal entry and count is on Postgres (§9H); what is left is
`getActiveProjects` and `ProjectContextCard`, which read Mongo because PROJECTS
are on Mongo. They go when projects do. This is the one case where a non-zero
count is not a half-ported module — assets is the other. Check what the import
actually is before reading the number as a verdict.

Also on Postgres, below the screens: auth and sign-in, invitations, companies
and provisioning, company access and the switcher, fiscal periods, payments,
stock movements, tax transactions, fulfilment, the reporting queries, and —
with HR — the payroll exports, the payslip and P9 documents, and the nightly
attendance cron.

The `components` and `settings` counts above are mixed: the HR parts of the
dashboard strips, the attendance policy, public holidays and payroll rates all
read Postgres; what is left in those files belongs to checkouts and other
unported modules. The claims parts of those strips moved with §9H.

**`docs/CURRENT-STATE.md` predates all of this** — it is a 2026-05-29 snapshot
of `jeff-business-suite` and describes the stack as Mongoose/MongoDB. Do not
take it as the state of this branch.

### The shape of the remaining risk

Every module in the right-hand column is a SEAM, and seams are where this port
has actually gone wrong. Not one of the bugs found so far was a mistranslated
query; they were all a screen reading one store while its writer used the
other:

- the invoice create and edit forms wrote Postgres while their pickers read
  Mongo (5cf453641)
- quote → invoice conversion wrote a MONGO invoice while every invoice screen
  read Postgres, then redirected to a page that could not load it (§9E)
- the customer picker showed every tenant's customers, because Mongo's
  withTenantScope is unscoped for a SuperAdmin
- the chart of accounts edited a store nothing else read
- HR created invitations in Postgres while the accept page read Mongo, so
  every link sent landed on "Invite Unavailable" (found porting HR)
- the approvals dashboard counted leave and loans in Mongo collections
  nothing writes to, and reported an empty queue however many were waiting
- **quotes: the port stopped one step short.** The repository, nine write
  actions and their tests all landed, and then nothing was pointed at them —
  every quote screen kept calling the Mongo action while the LIST page and the
  stats cards read Postgres. So a quote raised through the UI was written to
  one store and searched for in the other, and never appeared on the page it
  was created from. Found while surveying procurement's screens, and it is the
  §9E seam inside the module §9E was written about.

- **claims: eleven readers outside the module**, and each would have reported
  zero rather than erroring — an empty approvals queue, every dashboard tile at
  zero, every project's claim spend gone, claims unfindable in search. One of
  them was not a display: `project-actions` guards project deletion on a count
  of linked claims, so a project with claims against it would have been
  deletable. See §9H's table.
- **assets: three of its four seams were already broken.** The GL account
  dropdowns on the asset form had matched nothing since they were written, the
  bill asset picker read a collection nothing writes, and tagging an expense to
  an asset would have thrown a CastError the moment assets became UUIDs. §9I.

The lesson for whatever is ported next: the danger is not the module you are
moving, it is the module that talks to it. Grep for the MODEL name, not the
action file — `grep -rn "EmployeeClaim" app/ lib/` found all eleven, and the
screens found none of them.

### Finding this one yourself

A ported action nothing calls is invisible: it typechecks, its tests pass —
because the tests call it directly, which is exactly the layer nothing else
uses — and the screen goes on calling the Mongo action beside it. The module
reads as done and is not.

```bash
node scripts/find-unwired-actions.mjs
```

Run it at the end of every port. READ the output rather than counting it: a
form-data adapter, or a lower-level variant a route handler will want, can
legitimately have no screen calling it. What you are looking for is **a whole
file's worth at once** — that means the screens were never pointed at it.

### Read this before touching petty cash or a connector

**Three live modules still post journal entries into MongoDB**, and every
ledger screen — the journal browser, trial balance, P&L, balance sheet, general
ledger — reads Postgres:

| Module | Screens | What is being lost |
|---|---|---|
| `petty-cash-actions.js` | 3 | every petty cash movement |
| `lib/integrations/connectors/weighbridge.js` | API | every weighed-in purchase, sale and transfer |
| `lib/integrations/connectors/coffee-coop.js` | API | every farmer coffee intake |

Nothing errors: the entry is created, validated and posted into a ledger no
screen reads. If you are adding to one of these, post through
`app/db/repositories/journal.ts` rather than the Mongoose model, or you are
adding to the pile.

**Fixed assets are done** — migrations 0056 and 0057, all 11 screens, the
rollforward report, and four seams. Note the correction while you are here:
that table used to say assets posted "acquisition, depreciation, disposal".
Acquisition posts NOTHING — the bill already raised DR Fixed Asset / CR
Accounts Payable — and the third entry is impairment. §9I also records three
defects found by auditing the arithmetic rather than comparing it to Mongo,
which is worth reading before porting anything with sums in it.

**Claims was the largest of them and it is done** — migration 0052, the
repository, twelve actions, all 21 screens and components (bar the project
picker, which reads Mongo because projects do), and the eleven places outside
the module that read claims. All six postings go into the ledger
the trial balance opens. See §9H, and read the seam table there before porting
anything else: repointing the module took a morning, and repointing everything
that TALKED to it took the rest of the day.

**GRN was the fourth and it is done** — migrations 0049-0051, the repositories,
the actions and all 24 screens. Acceptance posts DR Inventory / CR GR/IR into
the same ledger the bill posts to, and `/dashboard/reports/gr-ir` reconciles the
account. See §9G.

**The weighbridge took its place, and it was never counted.** The original
sweep read `app/mongodb/actions/`; this is an integration connector, so it was
missed. It posts through the Mongo `JournalEntry` model and its account matrix
maps `purchase` to DR Inventory / CR GR/IR — the receipt's own entry — while
`bill_lines.weighbridge_ticket_id` exists in Postgres so an approved bill can
clear exactly that position. Half the pair is in each store, which is the GRN
bug in mirror image. Its products, invoices, accounts and stock movements are on
Mongo too, so it is a vertical rather than a stray call.

**And the coffee co-op connector is the sixth.** Same directory the sweep never
read, same fault: `_createJournalEntry` posts DR Inventory / CR Farmer Payable
through the Mongo model (`coffee-coop.js:399`), and it is reachable — registered
in `lib/integrations/connectors/registry.js` and called by the live route
`app/api/v1/coffee-coop/intake`. Its farmer intake entries, products, accounts
and stock movements are all on Mongo. It does not have the weighbridge's
split-pair problem, because no half of it is in Postgres yet; it is simply a
purchase stream that no ledger screen can see.

**So sweep by the write, not by the directory.** The query that finds all six is
a grep for `.post(` against the Mongoose entry across `app/` AND `lib/` — not a
listing of `app/mongodb/actions/`. Two of the six live under `lib/`, and both
were invisible to the original count for that reason alone.

While reading the registry: `logistics` and `miller` are mapped to
`./logistics.js` and `./miller.js`, and neither file exists. `getConnector`
picks the loader by key before it can fall back to `generic`, so those two
types throw on dynamic import rather than degrading. Unrelated to the ledger,
but it is in the file you will be editing.

---

## The one rule

**Never write a `companyId` filter.** Tenant isolation is row-level security,
enforced by the database against `current_setting('app.company_id')`. Your job
is to get a transaction that has it set; after that, `SELECT * FROM invoices`
returns this tenant's invoices and nothing else.

An unscoped query returns **zero rows**, not every tenant's rows — the policies
compare against NULL, which is never true. It fails closed. So the symptom of
forgetting to scope is an empty page, never a leak.

This replaces the 3,479 hand-written filters in the Mongo layer, where
forgetting one leaked another tenant's books instead of returning nothing.

---

## The three layers

| | what it is | who calls it |
|---|---|---|
| `app/db/repositories/*` | plain `(tx, input)` functions. **The invariants live here** | everything |
| `app/db/actions/*` | `"use server"` actions: `(prevState, FormData)`. Validate, gate the role, call a repository | forms, `useActionState` |
| `app/api/v1/*` | HTTP endpoints, API-key auth, JSON in and out | machines |

Actions and endpoints are both thin. Neither is allowed to hold a business rule
the other cannot reach — if you find yourself writing one in a route, it belongs
in the repository or in `app/db/validation/`.

---

## Getting a scoped transaction

There are exactly two doors, and which one you use is decided by how the caller
authenticated, not by what you are building.

### A session — pages, server actions

```ts
import { withAuthorizedTenant } from "@/app/db/tenant";
import { INVOICE_WRITE_ROLES } from "@/lib/utils/role-gates";

const invoice = await withAuthorizedTenant(
  [...INVOICE_WRITE_ROLES],
  async (tx, { user, companyId }) => {
    return invoices.createInvoice(tx, { companyId, /* … */ createdById: user.id });
  },
);
```

It authenticates, checks the role, resolves which company the user is acting in
(their home company, or the one they switched to — verified against their
grants), re-checks the role **for that company**, then opens the transaction.

Pass `[]` for the roles only when every signed-in user may do the thing.

### An API key — `/api/v1/*`

```js
import { withApiKeyTenant } from "@/app/db/apiTenant";

export async function GET(request) {
  return withApiKeyTenant(request, { requireScope: "invoices:read" }, async (tx, ctx) => {
    const rows = await invoices.listInvoices(tx, { limit: 50 });
    return listResponse(rows, { limit: 50, offset: 0, returned: rows.length });
  });
}
```

`app/api/v1/invoices/route.js` is the worked reference — copy its shape.

Scopes are a fixed list on `app/models/integrationKey.js`; use an existing one
or add it there first.

---

## Three things that bite

**1. Do not call a server action from an API route.** They are `"use server"`
functions taking `(prevState, FormData)`, and they read a NextAuth session
internally. An API key has no session, so the action throws "Not authenticated".
Call the repository instead — that is where the rules are anyway. This has
already been attempted once; it is the most natural wrong turn on this layer.

**2. Share validation, do not restate it.** A `"use server"` file can only
export async functions, so a schema declared beside an action cannot be imported
by a route. Put it in `app/db/validation/` and have both import it. Two
definitions of "what a valid invoice is" drift the first time one is corrected.

**3. Record a real actor.** The 47 `created_by_id` columns are `text` only
because there was no `users` table when 0031 landed; 0036 says the foreign keys
arrive once the backfill has run. Anything that is not a user id — `"system"`,
`"apikey:abc"` — will fail that migration. Write a user id, or write NULL.

---

## Migrating a vertical

The unit of work is a **feature, end to end** — not a table and not a layer. A
half-ported feature is worse than an unported one, because the half that still
reads Mongo and the half that writes Postgres disagree silently.

Work the list in order. It exists so a vertical closes once.

**1. Enumerate before writing.** List every entry point the Mongo feature has,
and keep the list in the PR:

- list page, detail page, create form, edit form
- row actions and bulk actions
- PDF and export routes (`app/api/**`), which are easy to miss and read the
  company record directly
- cron jobs (`app/api/cron/**`)
- anything under `app/api/v1` already serving it

A feature is not ported until every one of these reads Postgres. Grep for the
Mongo model name before claiming otherwise.

**2. Port behaviour as-is; fix deliberately.** Domain logic moves unchanged —
reconciliation against the old behaviour is the test. Where the source is
actually wrong, fix it and write down why, the way §8 and §9 of the plan do. A
silent behaviour change found later costs more than the bug did.

**3. Push invariants into the schema.** The rule for the whole port: *something
the application currently remembers to check becomes something the database will
not allow.* A CHECK, a composite foreign key or a trigger is worth far more than
a guard in one of four call sites — this is how "no new bugs on Postgres" is
actually achieved, rather than hoped for.

**4. Forms first, and completely.** The form is where a missed field surfaces.
Wire the server action to `useActionState`, keep the schema in
`app/db/validation/` so the API path shares it, and check the whole round trip:
field errors land on fields, a failed submit keeps the user's input, success
calls `revalidatePath`, and the redirect goes where the Mongo version went.

**5. Performance is part of the port, not a follow-up.**

- every list query capped — repositories do this themselves
  (`listInvoices` clamps `limit` to 200); keep that habit
- `select()` the columns the page renders, not the row
- no N+1: one query with a join, not a query per row
- an index behind every filter and sort the UI actually offers
- `EXPLAIN (ANALYZE, BUFFERS)` the list query for the biggest tenant before
  calling it done — a sequential scan on 50 rows in dev is a sequential scan on
  500,000 in production

**6. Navigation and loading state.** Server components that read Postgres
suspend. Put a `<Suspense>` boundary *below the layout the routes share* — a
boundary in the root layout does nothing on a client navigation, because only
the tree below the shared layout re-renders.

Genuine **instant navigation** in Next 16.3 requires Cache Components
(`cacheComponents: true`), which this app has **not** enabled — see the note
below. Until it is, aim for correct streaming boundaries and honest loading
states, which is the prerequisite anyway: a route that does not navigate
instantly without runtime prefetching will not with it either.

**7. Tests, three kinds.** Repository behaviour; the action or endpoint above it;
and a tenant-isolation case that asserts a second tenant's rows are invisible
*with nothing in the callback filtering them*. The third is the one that proves
RLS rather than assuming it.

**8. Close it.** The commit says the vertical runs on Postgres, and lists what
moved. If something did not, it says so.

---

## A note on Cache Components

Instant navigation, runtime prefetching and `use cache` all sit behind
`cacheComponents: true`. It is not set here, and turning it on is **its own
vertical**, not a line in `next.config.mjs`:

- it changes the caching model for every route at once
- every access to `cookies()`, `headers()`, `searchParams` and `params` has to
  move below a `<Suspense>` boundary or into a cached function
- dev-mode validation then reports every segment that would block a navigation

That is a large audit to run across an app whose data layer is mid-migration.
The sequencing that avoids doing the work twice is: finish moving a vertical to
Postgres, then adopt Cache Components across the app deliberately — the
structural pattern it rewards (async work pushed deep, wrapped in Suspense) is
worth applying while porting regardless, and costs nothing now.

The version-accurate guides ship with the package:
`node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md`.

---

## Privileged access

`privilegedDb()` bypasses RLS entirely. It exists for operations on a record
from **outside that record's own scope**: provisioning a tenant, an admin
editing another user, the platform's cross-tenant company list.

Do not reach for it because a query returned nothing. That is almost always the
scope being wrong, and the fix is to set it — not to remove the thing enforcing
it. If you do use it, the constraint is your only guard: RLS will not catch a
cross-tenant write on that connection, which is why the party link's foreign key
is composite `(party_id, company_id)`.

---

## Testing

Postgres suites live in `tests/pg-*.test.mjs` and are
`DATABASE_URL ? describe : describe.skip` — without the URL they skip silently,
so check your `.env`. CI now runs an empty `postgres:16`, applies the migrations
from scratch and runs them for real.

The harness to copy is `tests/pg-api-key-tenant.test.mjs` (API path) or
`tests/pg-invoice-actions.test.mjs` (session path). Both mock the auth layer,
truncate between tests, and assert against a second tenant's rows to prove the
scope holds rather than assuming it.

A driver error arrives wrapped: drizzle throws `DrizzleQueryError` with the
`PostgresError` on `.cause`, so assert `err.cause.constraint_name`, not
`err.code`.

---

## Local setup

```
npm run db:migrate:all   # dev AND test databases, in journal order
```

**Both, every time.** There are two databases — `.env` names the one `next dev`
uses, `.env.test.local` names the one the suites TRUNCATE — and nothing applies
migrations automatically to either. Migrate only the test one and the app throws
`relation "quotes" does not exist` on the page you just built; migrate only the
dev one and the suites fail the same way. `db:migrate` and `db:migrate:test` do
them singly if you need that.

On a brand-new cluster, migration 0023 creates `app_user` as `NOLOGIN` with no
password — inventing a credential is not a migration's job. Once, before the app
boots:

```sql
ALTER ROLE app_user LOGIN PASSWORD '<pass>';
```

`DATABASE_URL` must name that role, never `postgres`: a superuser has BYPASSRLS
and makes every policy in the schema inert. `SELECT assert_rls_effective()`
raises if the current connection would bypass RLS — worth a health check.
