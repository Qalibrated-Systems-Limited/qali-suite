# Building on the Postgres layer

For anyone adding a feature, an endpoint or a page on top of the port. The
migration reasoning lives in `POSTGRES-MIGRATION-PLAN.md`; this is the practical
half — what to call, what not to, and the four things that bite.

---

## Where the port has reached

Counted, not remembered — regenerate it with:

```
grep -rln "@/app/mongodb" app/dashboard --include="*.jsx" | cut -d/ -f3 | sort | uniq -c | sort -rn
```

A module is **on Postgres** when no screen in it imports `@/app/mongodb`.

| on Postgres | still Mongo (screen files) |
|---|---|
| **stocks/products**, **dashboard**, statements, supplier-statements, payments, hr, **claims**, assets, **expenses**, petty-cash, credit-notes, checkout, categories, users, accounts (incl. opening balances), invoices, bills, parties, requests, journal, quotes, purchase-orders, **fiscal periods**, **projects**, **tax**, **the platform/SuperAdmin dashboard** | integrations 10, banking 8, kpis 7, components 5, leads 4, employee 4, settings 3, sales-orders 3, profile 3, opportunities 3, admin 3, assets 2, approvals 2, reports 1, quotes 1, parties 1, executive 1, company 1, adjustments 1 |

Counted 2026-08-31, after profile:
**59 screen files, 18 modules** — down from 105 across 27.

**BANKING STAYS ON MONGO BY DECISION**, not by oversight. It is a ~3,900-line
vertical whose service posts payment-received and payment-made entries to the
ledger, and it is not currently broken — it reads the store it still writes. A
half-port of it would be §9L again. See the 2026-08-31 handoff.

**`tax` was a HALF-PORT, not a greenfield one**, and that is the shape to expect
from here on. `tax_transactions` shipped in 0018/0019 and invoices and bills
have been writing to it ever since; only the eight screens were left reading
Mongo. Ten of the fifteen repository functions had no caller — which is
question 4, and no screen-side grep would ever have found it. See the
2026-08-29 tax handoff.

**`executive 1` IS NOT WORK.** It is `cPipelineTotal`, and the CRM genuinely is
still on Mongo, so that read is correct until opportunities port. Everything
else on that screen moved to the ledger — see the 2026-08-29 executive handoff.
The same caveat the projects row carried, one module further on.

**PROJECTS CLOSED FIVE OTHER MODULES WITH IT.** The count above fell by 28
files, and only 11 of them were projects' own. Invoices, bills, requests,
movements and quotes went to zero, and claims and expenses to one, because what
they were reading was the project picker. The 2026-08-28 note below predicted
exactly this — "they all close the moment it lands" — and it is the clearest
case in the port of a count that was not a measure of work. See §9N.

**THE COMMAND UNDERCOUNTS — it only reads `*.jsx`.** There are `.tsx` screens
too, and 16 of them were in `components`. Count both:

```
grep -rln "@/app/mongodb" app/dashboard --include="*.jsx" --include="*.tsx" \
  | cut -d/ -f3 | sort | uniq -c | sort -rn
```

**AND IT MISSES ELEVEN SCREENS ENTIRELY — the ones that skip `app/mongodb`
and import the MODEL.** `import Product from "@/app/models/product"` does not
match `@/app/mongodb`, so a page reading a moved collection directly is
invisible to the count above. Add the second path:

```
grep -rln "@/app/mongodb\|@/app/models/\|@/app/config/dbConnect" app/dashboard \
  --include="*.jsx" --include="*.tsx" | cut -d/ -f3 | sort | uniq -c | sort -rn
```

Counted 2026-08-28, the eleven the first command does not see — and note the
modules they are in, three of which this document calls DONE:

| Screen | Reads | Store moved in |
|---|---|---|
| `stocks/create/page.jsx` | Mongo `Category` — and it already imports `getCategoriesPg` on the line above and never calls it | 0062 |
| `stocks/[id]/update/page.jsx` | Mongo `Category`, unscoped `find({})` | 0062 |
| `adjustments/create/page.jsx` | Mongo `Product` — FIXED with 0066 | products |
| `accounts/create/page.jsx` | Mongo `Account` | 0035 |
| `claims/[id]/(details)/page.jsx` | Mongo `Account` | 0035 |
| `expenses/[id]/page.jsx` | Mongo `Account` | 0035 |
| `components/createReqComponent.jsx` | Mongo `Account`, `User` | 0035 |
| `components/requestDialog.jsx` | Mongo `Account` | 0035 |
| `components/tabs/FinanceTab.tsx` | `dbConnect`, dynamically imported | — |
| `components/MyAlertsStrip.tsx` | Mongo `ItemCheckout` | checkouts |
| `components/SalesManagerDashboard.tsx` | Mongo `Product` | products |

Every one is a picker or a strip reading a collection nothing writes, so every
one shows an empty dropdown or a zero rather than failing. `Category.find({})`
in the two stocks pages carries no tenant filter at all, which would be a
cross-tenant read if that collection still held anything.

**A NON-ZERO COUNT IS NOT A VERDICT. Read the import.** Five of the modules
above — invoices, bills, requests, expenses and claims — read exactly one
thing, `projectQueries`, and it is the project picker. They are not
half-ported; they are waiting for PROJECTS, and they all close the moment it
lands. Same for quotes (the sales-orders flag) and parties (one action).
Check what the import actually is before treating a count as work.

**STATEMENTS AND SUPPLIER-STATEMENTS ARE DONE**, and are derived from the
LEDGER rather than from documents — see §"Where the port has reached" below and
`app/db/actions/statement-actions.ts`.

**STOCKS/PRODUCTS IS DONE, and it was the worst seam in the port.** The
repository was written early with the whole commitment-based flow and NOTHING
was ever pointed at it. Products were written to Mongo by the screens while
INVOICES read Postgres, so with 30 products in Mongo and 0 in Postgres the
product dropdown on a new invoice was empty and no stock item could be sold at
all. If you read one thing before porting a module, read §"Finding this one
yourself".

**THE DASHBOARD IS DONE.** Both Mongo dashboard query modules are ported
(`app/db/actions/dashboard-actions.ts` and `inventory-dashboard-actions.ts` —
two files because the Mongo layer had two, exporting the same names with
different shapes). It had been reporting on a store nothing writes.

**Regenerate rather than trust it:**

```
grep -rln "@/app/mongodb" app/dashboard --include="*.jsx" | cut -d/ -f3 | sort | uniq -c | sort -rn
```

**payments reads 0 — the half-port is closed.** See §9M for what the "three
missing functions" turned out to be.

**sales-orders reads 3 and is switched off** — `lib/unported-modules.js`, §9K.
Those three reads are behind the flag.

**Assets no longer reads Mongo.** That seam closed with expenses (0059):
`asset-cost-queries.js` keeps its filename and lost its reason for existing —
its own header called it "the one query that has to reach into both stores",
and both halves are Postgres now. It belongs in `asset-actions.ts`; only the
import path in `app/dashboard/assets/[id]/page.jsx` is stopping it.

**Claims read 4, and all four were the project picker.** They went with 0070,
along with a fifth thing nobody had counted: `claims/create/advance/page.jsx`
reads the Mongo `User` collection directly, so the on-behalf-of picker that
exists to stop "manual advances that bypass the system" has been EMPTY since
auth ported. It does not match `@/app/mongodb` and no screen-side grep found
it — the same class as the eleven above.

Also on Postgres, below the screens: auth and sign-in, invitations, companies
and provisioning, company access and the switcher, fiscal periods (the screens
too, since 0699892), payments, stock movements, tax transactions, fulfilment,
the reporting queries, the platform dashboard the three SuperAdmin tabs render,
and — with HR — the payroll exports, the payslip and P9 documents, and the
nightly attendance cron.

The `components` and `settings` counts above are mixed: the HR parts of the
dashboard strips, the attendance policy, public holidays, payroll rates and
fiscal periods all read Postgres; what is left in those files belongs to
checkouts and other unported modules. The claims parts of those strips moved
with §9H.

`components` is down to **four**, and they are four different modules rather
than one seam — worth knowing before treating them as a batch:

| File | Reads | Goes when |
|---|---|---|
| `AccountantDashboard.tsx` | `bank-feed-queries` | banking moves |
| `AlertsStrip.tsx` | `approval-queries` | the ApprovalRequest engine moves — see the 2026-08-27 handoff for why it has not |
| `NotificationBell.jsx` | `notification-actions` | notifications move |
| `crm/ActivityComposer.jsx` | `activity-actions` | leads/opportunities move |

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

Run it at the end of every port. READ the output rather than counting it —
scanning the list for "a whole file's worth" nearly produced three false
alarms in one sitting: purchase-orders (9 unwired) and grn (7) turned out to
have ZERO Mongo imports, their unwired entries being read helpers the screens
reach through server components; and claims (8) is the project picker, which is
Mongo because PROJECTS are. Check what the screens actually import before
reading a count as a verdict.

A genuine hit looks different: **the action was already dead before the port.**
`setCheckoutStatusPg` is flagged, and so was the `updateCheckoutStatus` it was
ported from — no screen has ever called either. Porting dead code faithfully
produces dead code, so run this BEFORE a port as well as after, and decide
then whether the thing deserves a UI or a deletion.

More context: a
form-data adapter, or a lower-level variant a route handler will want, can
legitimately have no screen calling it. What you are looking for is **a whole
file's worth at once** — that means the screens were never pointed at it.

### Read this before adding to any module

**NOTHING OF SUBSTANCE POSTS INTO THE MONGO LEDGER ANY MORE**, with one
connector left. Every ledger screen — the journal browser, trial balance, P&L,
balance sheet, general ledger — reads Postgres. Regenerate this with
`npm run ledger-sweep` rather than trusting the table:

| What posts | Reached from | Screens |
|---|---|---|
| `movement.reverse()` | `integration-actions.js:467` | 10 |

**The weighbridge connector is the last one.** Voiding a ticket reverses the
stock movement, and the movement reverses its linked journal entry with it —
the comment beside the call says so. It is a whole vertical rather than a
posting to redirect; see the note on it in the 2026-08-24 handoff.

**Payments closed** — no screen imports the Mongo `payment-actions` or
`payment-queries` at all. **Inventory adjustments closed with 0066**, and took
`approval-actions` with it: `applyStockAdjustment` and `voidApprovalTarget`
both call into `app/db/actions/adjustment-actions.ts` now.

**The sweep prints three false positives; do not port them.**
`project-actions.js:806` calls `budget.approve()`, which matches on the name
only — `app/models/projectBudget.js:95` supersedes the previous version and
sets three fields, and posts nothing. `taxQueries.js:476` and `kpi-queries.js`
match `Array.prototype.reverse`. Checked, because the sweep's own footer says
to check, and the footer is right: after 0066 the LIVE list is four modules
and only one of them is real.

Done: expenses (0059), petty cash (0060), credit notes (§9L), opening balances
(0061), checkouts, payments (§9M). Sales orders is switched off rather than
ported — `lib/unported-modules.js`, see §9K.

**Before estimating a port, measure the DESTINATION, not the source.**

Counting Mongo lines and `.post(` sites says how much old code there is. It
says nothing about how much of the new side already exists — and on this
project the answer is repeatedly "most of it". Checkout looked like a
1,300-line greenfield port; `item_checkouts` was already there, fully
designed, with three of its repository functions written. Products looked like
a 4,700-line rewrite; the table, the stock-movement logic and the entire
commitment-based flow are done, and what is missing is an action layer.

Check first:

```bash
ls app/db/schema/<thing>.ts app/db/repositories/<thing>.ts app/db/actions/<thing>-actions.ts
grep -n "^export async function" app/db/repositories/<thing>.ts
```

**Five questions find five different failures. Ask all five, cheapest first.**

**0. `npx eslint . --quiet`.** The cheapest of the lot and the one nobody runs.
`no-undef` finds a named import a module does not export, and a symbol used
under a different name than it was imported by — neither of which `tsc` catches
across the JS/TS boundary. It has found two live bugs: `POTable.jsx` imported
`sendPurchaseOrderPg` and bound `sendPurchaseOrder` at three call sites, so the
Send and Confirm buttons on the purchase-order table submitted a form whose
action was `undefined`; and `Categorymanagement.jsx` imported
`seedDefaultCategories` from a module that has never exported it, which is why
nothing renders that file.



```bash
# 1. What still posts into the Mongo ledger?
npm run ledger-sweep

# 2 & 3. What do the screens import from Mongo — and is there already a
#        Postgres twin that covers it?
grep -rn "from \"@/app/mongodb" app/dashboard components lib app/api
```

And the fourth, which no screen-side grep can find because no screen is
involved:

```bash
# 4. Which exported repository functions does nothing import?
grep -n "^export async function" app/db/repositories/<thing>.ts   # then grep each name
```

This is `find-unwired-actions.mjs` one layer deeper. That script finds ported
ACTIONS nothing calls; this question finds ported REPOSITORY FUNCTIONS no
action calls — the same failure one level further down, and the one that hides
better, because an action at least looks like something a screen should use.

An exported repository function with no callers is either dead code or an
UNFINISHED PORT — and the unfinished ones look complete in a file listing
while silently skipping the ledger. Three instances so far, all of them
functions that moved data and posted nothing: `createOpeningBalanceBill`
(0061), the credit-note repository half (§9L), and `returnCheckout`, which
brought stock back into the warehouse and left its value on the
technician-stock account for ever.

**Question 1 is a script, not a grep, and that matters.** `grep -rn "\.post("`
has been wrong four times, each time declaring a module "the last one". A
posting is usually WRAPPED in a domain verb — `payment.confirm()`,
`adjustment.approve()`, `movement.reverse()`, `invoice.complete()` each post an
entry by calling something else inside the model — so grepping the CALL SITES
for `.post(` finds none of them. `scripts/ledger-sweep.mjs` resolves the
transitive set and prints every hit with its line, because a name-based match
cannot tell `movement.reverse()` from `array.reverse()`, and a sweep that
silently filters is how you get a fifth wrong "last one".

Question 1 also misses anything whose posting is in the MODEL rather than the
action layer — that is how expenses survived three sweeps. Questions 2 and 3
find what question 1 cannot see at all:

  - a module that READS a collection nothing writes any more (§9K — sales
    orders, 466 lines against three stores that had all moved, switched off in
    `lib/unported-modules.js`);
  - a module ported only HALFWAY, where a `*-actions.ts` exists but a screen
    still imports a function it does not cover (§9L — credit notes, and the
    expense-account combobox, which created accounts in Mongo while every
    picker read Postgres).

Nothing errors: the entry is created, validated and posted into a ledger no
screen reads. If you are adding to one of these, post through
`app/db/repositories/journal.ts` rather than the Mongoose model, or you are
adding to the pile.

**Both connectors are done** — the weighbridge and the coffee co-op. The
weighbridge needed no migration at all: its Postgres half (the
`weighbridge_tickets` table, its constraints and its repository functions) had
shipped with fulfilment in 0020-0022 and nothing had ever used it. Worth
knowing before porting anything else under `lib/` — check whether the
Postgres side is already sitting there.

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

## Who a user is, and what they may do

Two separate questions, answered by two tables, and conflating them is the
mistake this model exists to prevent.

**`users` is the identity.** A person, globally: name, email, credentials. Its
`role` column is now only meaningful for one value — `SuperAdmin`, which is what
makes somebody platform staff.

**`user_company_access` is the membership.** One row per person per company,
and it carries the ROLE THEY HOLD THERE. `withAuthorizedTenant` resolves
`COALESCE(grant.role, users.role)` and re-checks the allow-list against it, so
the same person can be an Accountant in one company and a Store Manager in
another. Reading or writing a role means reading or writing the grant — since
0064, a role written only to `users.role` is overruled by the grant and the edit
silently does nothing. `adminUpdateUser` therefore REFUSES a role change with no
company rather than dropping it.

**`granted_via` says why the row exists**, and two values mean different things:

| granted_via | what it is | in the tenant's user list? |
|---|---|---|
| `invite`, `primary`, `manual` | a real membership | yes |
| `superadmin` | standing platform access | **no** |

Platform staff hold every tenant — `grantAllTenants` tops them up — so without
that distinction a SuperAdmin appears in every customer's user list as an
ordinary colleague. `visible_within_company` on `users` excludes them (0064);
the `own_row` policy still shows them to themselves, so they can operate inside
a tenant they have entered.

**The company ACCESS LIST is deliberately the other way round** and still shows
platform grants. Two surfaces, two questions:

    /dashboard/users        "who works here"            platform staff hidden
    company access list     "who can open these books"  platform staff shown

The second is the audit record — `tenant.ts` chose a dated, named, revocable row
over a role check scattered through the code precisely so it can answer "who
could read these books in March". Do not "tidy" platform grants out of it.

**Status is lowercase**, with a CHECK (0036). Components comparing against
`"Active"` match nothing — that has now produced the same bug three times: a
Select that renders blank, a badge with no colour, and a filter that finds
nobody.

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

## Four things that bite

**0. A timestamp off a raw `execute()` is a STRING.** `r.created_at as Date` is
a cast, not a conversion — it silences the compiler and hands a string to a
field the interface swears is a `Date`. Use `toDate()` from
`app/db/repositories/sqlHelpers.ts`.

Importing `drizzle-orm/postgres-js` replaces postgres.js's date parsers
globally, so drizzle can map columns from the schema itself. It does that for
`db.select()`. It cannot for `tx.execute(sql`…`)`, which has no schema to map
against, so those columns arrive exactly as Postgres printed them:
`2026-08-24 10:20:47.538458+00`.

The failure never lands where the bug is. It surfaces as
`.toLocaleDateString is not a function` on some page, or a date-fns call quietly
returning `Invalid Date`. Twenty-two of these were live across six
repositories — accounts, assets, claims, fulfilment, quotes and users — and the
only one anything caught was the edit page rendering "N/A" for Created and Last
updated on every user.

Check it rather than trusting the type:

```js
const [r] = await db.execute(sql`SELECT now() AS t`);
r.t instanceof Date   // false
```

Probe it in a script that never imports drizzle and you will get `Date` and
prove nothing — the global override is what makes this real.

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

---

## Handoff — 2026-08-31 — sessions, the bell, profile, cost codes, and a colleague's module

Twelve commits and one merge. No single module port — this was the day the
things that had been written down but never wired got connected, plus the first
merge of somebody else's work into this branch.

### The three that were silently broken, in order of how much they mattered

**A ROLE CHANGE REACHED NOTHING.** `token.role` was written at sign-in and never
again, and the session lives eight hours — so a demotion never reached
`session.user.role`, which is what every nav gate and page guard reads.
`adminUpdateUser` bumps `token_version` precisely to kill those sessions, but
the only thing that compares it, `requireFreshSession`, is called from two
legacy Mongo action files and from nothing on the Postgres path, no page and no
layout. **The revocation was being written and never read.**

The note in auth.ts said periodic refresh was removed because "edge runtime
can't reliably connect to MongoDB". That reason expired with 0036.

Scope of the exposure, stated precisely because it is narrower than it sounds:
server ACTIONS were never affected — `withAuthorizedTenant` re-checks the
allow-list against the GRANT's role, so a demoted user could not mutate
anything. Page and nav access trusted the stale claim.

The jwt callback now re-reads status, token_version and the per-company role;
returning null clears the cookie (`@auth/core` session.js:
`if (token !== null) … else sessionStore.clean()`). It FAILS OPEN on a database
error — a transient outage must not sign out the whole company.

The throttle is an in-process map, not a token field. **A Server Component
cannot set cookies**, so a stamp written during an RSC render is never persisted
and "once a minute" becomes once per `auth()` call, several times a page.

**NOBODY COULD CHANGE THEIR OWN PASSWORD.** `profile-actions.js` read
`user.password` from Mongo and saved the new one there; sign-in compares against
the Postgres `password_hash` (auth.ts:133). So a password change either failed
with "User not found" or appeared to work and left the person signing in with
the old one for ever — on a form that said it had worked. `updateProfile` was
the same shape: `findByIdAndUpdate` against a collection nothing reads.

**EVERY APPROVAL NOTIFIED NOBODY.** `lib/notifications/approval-notify.js` read
the Mongo `User` collection to decide who to tell. Users moved in 0036, so
`User.find({ companyId, role: { $in: roles } })` had matched nothing since —
silently, because that file swallows its own errors by design so a mail failure
cannot fail an approval.

### 0074 — the bell, and a TTL that Postgres does not have

Reported from the running app, logging on every dashboard render: "No legacy
Mongo id for company 4d6ab761-…". The bell scoped itself by translating the
active company's uuid BACK to an ObjectId, and a company created after the
migration has none. `cMyNotifications` swallows its own errors, so it was a log
line and an always-empty bell rather than a crash.

Three things the schema does that Mongo did not:

- **the recipient is in the WHERE of markRead**, not just the company. RLS
  scopes to the tenant, which is not the same as scoping to the reader — without
  it any colleague could clear another's bell by id.
- **href must be app-relative, by CHECK.** It becomes a link the recipient
  clicks; this stops a future writer turning the bell into an open redirect.
- **the 90-day TTL index has no Postgres equivalent**, so the sweep is
  `/api/cron/prune-notifications` on the existing per-tenant cron pattern.
  Porting the table alone would have dropped self-cleaning silently.

And one that is not the schema: **no session is not an error.** The layout's
`user && …` guard short-circuits, so a signed-out render reaches the bell.

### The UI pass, and a bug I shipped in it

The users stats cards showed nothing: `getUserStats` returns
`{ total, active, inactive, admins }` and the page read `stats.totalUsers`,
`activeUsers`, `inactiveUsers`, `adminCount` — names that have never existed on
it. The same class as the KRA tiles: four figures rendering `undefined`, which
React prints as nothing.

The layout answer was already in the codebase. The stock page's
`StockMetricsBar` is one inline line where every figure that names a subset is a
clickable filter, with a note arguing that four 140px cards put 300px between
the heading and the first row. That became `components/metric-bar.jsx` and the
competing component this session had introduced was deleted. **One pattern, and
it is the one the codebase had already reasoned its way to.**

**THEN THE HEADER SWEEP SHIPPED A BUG.** 41 page titles were resized by
replacing a list of class variants — and the list put `text-3xl font-bold`
FIRST, which is a substring of `text-2xl sm:text-3xl font-bold`. It matched
inside the longer variants and left `text-2xl sm:text-xl sm:text-2xl` in 18
files, which Tailwind resolves to text-2xl at every width: the titles came out
BIGGER on mobile than before the sweep. Ordering longest-first would have
avoided it; asserting the result would have caught it. Neither lint nor tsc can
see a class name. Found by chance while reading a projects file, after it was
already pushed.

### Cost codes got their other half

0073 put cost codes in front of the budget and named the hole in its own
handoff: "matching by cost code is where this goes when the claims, bills and
expense forms actually SET one — nothing does today". Nothing did.

Most of it already existed, which is this port's recurring lesson: all four
tables had `cost_code_id`, three repositories already accepted it, and the
EXPENSE validation already parsed and mapped it. **The gap was the action layer
and the field.** The picker only appears once a project is chosen, because a
cost code with no project has nothing to roll up to.

The create affordance 0073 removed came back GATED rather than absent. That
decision was about WHO may define a code, not about where: an accountant
part-way through a budget had to abandon the form — losing every line typed — to
add one. `canCreate` is the same FINANCE_WRITE_ROLES check the cost codes page
uses, so a Manager still sees no button.

### The merge — and reviewing before, not after

`feat/projects-module-dropdown` (Zawadi): two new tables, a project-scoped
workspace, eight sections, 3,787 lines. It branched directly off this branch's
tip, so no divergence.

Reviewed in an isolated worktree BEFORE merging: tsc and eslint clean, and
migration 0075 verified to apply — both tables landing with RLS enabled AND
forced, tenant_isolation, and correct app_user grants. It follows the house
conventions: RLS-only scoping, drizzle query builder, none of the traps this
port has been bitten by.

Four findings, three fixed here and one left deliberately:

1. **No tests** for a migration, two tables and 14 repository functions. Written
   — 17 of them — and they pin the CONSTRAINTS directly, with an UPDATE fired
   at the table rather than through the repository, so what is proven is the
   database's refusal and not the repository's care. **All 17 passed first
   time: the module was sound, it was untested, and those are different
   things.**
2. **`getInstructionById` / `getDiaryEntryById` took a bare id to a uuid
   column** — the pattern guarded in 22 other detail getters the same day.
   `isUuid` was on their own base commit.
3. **Two byte-identical admin scripts** differing by one comment.
4. **IPC and Cash Requisitions are two nav entries running the identical pair
   of queries**, each with a banner admitting it is not the document its name
   implies. NOT fixed: that is a product decision, not a review finding.

### Two defects found in the merged workspace afterwards

`getWorkspaceContext` resolves the project for all eight pages, and had both.

**Finished jobs were unreachable.** The switcher listed `getActiveProjects()` —
`status IN ('planning','active')`. Right for a picker on a new invoice; wrong
here, and wrong in the direction that matters. A site diary and an instruction
register are read MOST after completion — the final account, a dispute. FIDIC
claims are argued from the diary years later.

**And a bookmark showed a different project.** `?project=` was honoured only
when the id appeared in that filtered list; otherwise it fell through to
`projects[0]` SILENTLY. A saved link to a completed job's diary opened another
project's diary, with the right page title and the wrong records. **A wrong
answer that looks right is worse than an empty one.**

Writing the tests for that found a third thing: 0070 enforces the project status
machine in the database, so a fixture cannot jump planning → completed. The
trigger refused the shortcut, which is the guard working.

### What this day says about the sweeps

Three separate scripted sweeps landed this session — 47 ILIKE patterns, 22 uuid
guards, 41 page headers — and **the one that had no assertion is the one that
shipped a bug**. The other two asserted their target existed before replacing
it and were clean. `feedback_assert_before_replace` exists for this and was
followed twice out of three times.

### Where the count is

**59 screen files, 18 modules.** `profile` went to zero. Banking stays on Mongo
by an explicit decision — it is a ~3,900-line vertical that posts to the ledger,
and a half-port would be the credit-note failure again.

### Later the same day — the projects module read a shape it does not return

No migration. A correctness pass over the whole Projects module, and every
finding is the same class as the users stats cards above: **a key that has
never existed, rendered as nothing.**

**THE LINKED-TRANSACTION LISTS WERE WRITTEN AGAINST MONGO.** Three screens
render the rows `getProjectTransactions` returns — the project detail page's
Linked Transactions card, IPC & Payments and Cash Requisitions — and all three
read a nested party off a flat row:

| the screen read | the repository returns |
|---|---|
| `inv.customer.name` | `customerName` |
| `bill.vendor.name` | `vendorName` |
| `claim.employee.name` | `employeeName` |
| `req.requester.name` | `requesterName` |
| `bill.amounts.netPayable ?? bill.amounts.total` | `netPayable`, `total` |

Nothing threw. Every party name rendered blank, and
`formatCurrency(undefined || 0)` is a confident zero — **every supplier bill on
all three screens showed KES 0.** A project with 4m of bills against it read as
having none, on the page a project manager checks the spend on.

The part worth carrying forward: **the test suite already disagreed with the
screen and nothing compared them.** `tests/pg-projects.test.mjs` pinned
`employeeName` on the claims arm, three lines from a screen reading
`claim.employee.name`, and both were green. A test that pins the repository's
answer proves the query; it says nothing about whether the caller can read it.
The shape is now pinned with the nested forms asserted ABSENT, which is what
stops the next port of a Mongo list bringing one back.

**AND CASH REQUISITIONS RENDERED NaN.** It is the one page that sums two of
these lists in JavaScript, and `employee_claims.total_amount` and
`expenses.total` are `numeric(19,4)` read in drizzle's string mode — so
`0 + "1500.0000"` CONCATENATES. One claim and one expense came out as
`"01500.00002000.0000"`, which `Intl.NumberFormat` renders as NaN. The
repository contract is money-as-string and it is right; the page has to coerce,
and now does. Pinned as a type in the suite rather than "fixed" in the
repository.

**A FLAG WRITTEN AND NEVER READ — again.** `getWorkspaceContext` computed
`notFound` for a `?project=` naming a project the tenant does not have, and
left the silent `?? projects[0]` fallback in place beside it. No page read the
flag. So the defect the earlier commit describes — a bookmarked link to a
completed job's diary opening a DIFFERENT project's diary under the right page
title — was still live, now with a correct diagnosis sitting unread next to it.
Same shape as `token_version` this morning. The fallback is gone, the eight
pages render the flag, and `getWorkspaceContext` has its own test file.

**The id is now checked against the tenant's own list**, not with a second
`getProjectById` round trip. `listProjectsForWorkspace` is unfiltered — RLS
scopes it and nothing else does — so membership in it IS the question, answered
by a list the page has already paid for.

**And the Forms Register was paying for a financial aggregation.**
`getWorkspaceContext` called `getProjectById` for all eight pages, which runs
the live actuals, the effective budget and the WBS roll-up. Six of the eight
read nothing that is not already on the switcher row; the Forms Register is a
static reference table. `detail` is now opt-in, and only IPC & Payments
(`contractValue`) and Programme (`startDate`/`endDate`) ask for it.

**The programme clipped its own overruns.** The timeline range took
`project.startDate`/`endDate` whenever they existed, so a task planned outside
the contract dates was pinned to an edge by the width clamp: a task running
three months late drew the same bar as one finishing on time — on the page an
EOT is argued from. The range now spans the contract dates AND the programme.

None of this touches the two pages' open product question. **IPC and Cash
Requisitions still run the identical query under two names** and that is still
§7's blocking decision 1, for the author to settle. What changed is that both
now show the right numbers while it is settled.

### 0076 — the bill of quantities, and progress that is a measurement

The same day again, and the first migration since the merge. §8 of
`PROJECTS-QALITRACK-PLAN.md` answered §6.4 — there IS a bill of quantities — and
this builds it: `project_boqs`, `project_boq_items`, `project_boq_measurements`,
the repository, the actions, a page, and 35 tests.

**What it finishes.** 0071 replaced a typed percentage with a weighted roll-up
of tasks and was honest about it: `progress.source` returned `tasks` or `typed`.
But every leaf percentage in that tree was still typed by a person, so a roll-up
of tasks is a careful OPINION. `source` now has a third value, `measured`, and
it outranks the other two: 8 of 20 km of subbase laid is 40% because 8 km was
measured against a rate.

It also supplies the one figure §7's certificate arithmetic did not have — work
done to date, for a measured valuation.

**Three tables, where the plan said two.** The bill-level facts — the method of
measurement, which version is awarded, what freezing means — have nowhere to
live in the items. The precedent was already in the module:
`project_budgets` / `project_budget_lines`, versioned, one live at a time, lines
frozen once signed. A bill of quantities is that shape with quantities, so it
follows it, including the partial unique index that stops two racing awards
rather than a check-then-write.

**The decisions that are not obvious, and why:**

- **Only a LEAF is priced.** A section takes its amount from what is under it. A
  priced parent with priced children is double-counted in the bill total and the
  row cannot say which was meant. That is 0071 decision 2 applied to money.
- **…and where 0071 DEMOTED a parent to 0% silently, this REFUSES.** A
  percentage is a working number; a rate is a contractual figure, and discarding
  one without saying so is worse than declining. The message names the fix.
- **A measurement may be NEGATIVE and may exceed the bill.** A correction to a
  certified over-measure is a negative remeasure — that is how the trade fixes
  last month's certificate without editing it, and both rows stay in the log.
  Measuring more than was billed is usually the first evidence of a variation,
  so nothing caps it; the page warns, the same rule as the budget at 90%.
- **The unit and the method of measurement are TEXT.** CESMM4, SMM7, POMI and
  the national standards are not interchangeable, and whichever one our own
  bills happen to use would look like the obvious enum. The screen offers a
  list; the column takes what the contract says.
- **No `certificate_id` on a measurement yet.** It belongs there and
  certificates are two steps away — but a column with no writer is the cached
  `financials` that 0070 spent a migration undoing.

**And the enum lesson landed on the screens, not the schema.** Adding a third
value to `progress.source` meant four render sites that compared
`=== "tasks"` and fell through to "entered by hand" for everything else — which
would have described a remeasured bill as a typed percentage. All four were
found by grep before shipping, which is the same sweep the `_id` findings this
morning needed and did not get.

**A test that ran for 22 minutes, and did not need to.** The first run of the
BOQ suite took 1,325s with two hook timeouts in `TRUNCATE`; the second took 61s
with no changes but one test fixture. `pg_stat_activity` was empty by the time
it was sampled, so it was contention that had already cleared — worth recording
because the instinct on a 22-minute run is to look for a slow query, and the
duration alone does not distinguish the two. `feedback_caffeinate_pg_suite`
already says a huge duration is not proof of sleep; it is not proof of a slow
query either.

The one real failure that run found was a test asserting the wrong guard:
awarding a second bill with no priced item hit `project_boq_has_priced_items`
before it could ever reach `project_boqs_one_awarded`, so the test proved a
constraint it was not written for.

## Handoff — 2026-08-29 — global search (§9P), and the count that could not see it

No migration. `components/command-palette.jsx` — Ctrl-K, reachable from every
page — called `globalSearch`, which read the Mongo `Product`, `Invoice`,
`Quote`, `Bill`, `Party`, `StockRequest` and `Project` models. **All seven of
those collections had moved.** Claims was the only section repointed, by
whoever ported claims and hit it; the comment they left at `:129` says exactly
why.

So the palette had been returning navigation entries and one working section
since products ported. It never errored, and that is why it lasted seven
module ports: **an empty result set is indistinguishable from a search with no
matches.**

### The count could not see it, and neither could the sweep

This is the finding worth carrying forward. `global-search-action.js`:

- imports the MODELS (`@/app/models/product`), not `@/app/mongodb`, so the
  module-count grep at the top of this document never listed it;
- posts nothing, so `ledger-sweep` passes over it;
- lives in `app/mongodb/actions/`, but is called from `components/`, so it is
  not a "screen" in any module.

The count is **still 63 files across 19 modules** after this port — unchanged,
because the thing that was broken was never in it. A module count measures
screens that import a path. It does not measure whether the app works.

### One query, not twenty-odd

Each of the eight modules already has a `search*` in its own repository, and
calling all eight would have been the faithful port. They are LIST queries
built for a page: `searchProducts` carries a `COUNT(*) OVER ()`, `listProjects`
runs four more queries for budget, actuals and progress, `searchStockRequests`
joins a totals subquery for a progress bar. The palette draws five fields per
row and throws the rest away — on a 300ms debounce, which makes this the most
frequently-executed query in the app.

`app/db/repositories/globalSearch.ts` is one UNION whose branches select only
what is drawn. The cost, stated because it is real: the match predicates are
restated rather than shared, so they can drift from the list pages. They are
deliberately the same columns, and a test pins each branch.

**Two bugs in the first draft of that UNION, both caught before running it:**

- **Only the first branch aliased its columns.** A UNION takes its output names
  from whichever branch comes FIRST — and which branch that is depends on the
  reader's ROLE, because a Storekeeper gets no invoice branch. Alias one branch
  and the result columns are named correctly for some users and not others.
  There is a test for exactly this: search with the product branch gated off.
- **A branch's own ORDER BY does not order the UNION.** It decides which four
  rows survive that branch's LIMIT; the UNION may still interleave. The outer
  ORDER BY is what makes the ranking hold.

### Two things deliberately not what Mongo did

**Results are gated by role.** The Mongo version returned invoices, bills,
claims, projects and every customer's contact details to anyone who could open
the palette, a Storekeeper included. The palette already refuses to OFFER a
page the role cannot see — "the app should not offer a door it will refuse to
open" — and a search result is the same claim about the same door. The gates
are read off `sidebar-content-grouped.jsx` rather than guessed, which mattered:
**parties sit behind FINANCE there, not sales**, and Bills carry an explicit
Procurement Officer exception. Neither is what I would have assumed.

**Claims are scoped to the reader unless they review claims.** The Mongo
search, and `searchClaimsPg` after it, matched every claim in the company — so
any employee could type a colleague's name and read their reimbursements and
the amounts. Gating claims off for non-reviewers would fix the leak and take
away an employee's ability to find their own; scoping on `employee_user_id`
does both.

### The escaping sweep — 47 sites, 26 files

Every search function in `app/db/repositories/` built its ILIKE pattern by
hand: `` `%${query}%` ``. That treats `%` and `_` IN THE SEARCH TERM as
wildcards, so typing `%` matches every row and `a_c` matches "abc" — and the
second is the worse one, because a wrong result looks like a right one.

Found in the tax port the same day and swept from there, per the rule that
fixing one instance is half the job. `likeContains` / `likePrefix` in
`sqlHelpers.ts`, beside `anyOf`, which exists for the same reason.

Nothing else in the suite searches with a wildcard character, so the sweep
changes no existing expectation — checked rather than assumed.

### Two hours lost to a test that was not failing

Worth recording because the diagnosis was wrong twice. The new test file ran
**926 seconds on one test** and failed two, then passed 11/11 in 54s with no
change. Both wrong readings had a plausible story attached — a lock held by an
abandoned transaction, then a slept machine.

It was neither. `pg_stat_activity` during the hang showed queries this file
does not run (`SELECT e.*, d.name AS department`, a platform-dashboard company
query): something else was on the machine. The project's own diagnostic settles
the sleep question and I should have used it first — **read the phase
breakdown**: a slept run reports hours in `import`, and this reported 611ms.

The one real fixture bug underneath: `TRUNCATE companies CASCADE` **does not
reach `users`**, because `home_company_id` is ON DELETE SET NULL. `pg-projects`
and `pg-user-admin` list `users` explicitly and this now does too.

### After this

`app/mongodb/actions/global-search-action.js` is deleted. The question §9K
named — **"what reads a collection nothing writes any more?"** — has now caught
sales orders, tax and this. Two of the three were invisible to every count in
this document, so it is not exhausted.

## Handoff — 2026-08-29 — tax (§9O), and two tiles that were never wired

No migration. The table, its constraints, its RLS and fifteen repository
functions all shipped with **0018/0019**, and Postgres invoices and bills have
been writing into it ever since they moved — `invoices.ts:679` calls
`recordInvoiceVatOutput`, `bills.ts:686` calls `recordBillTaxes`. All eight
screens under `/dashboard/tax` went on reading the Mongo `TaxTransaction`
collection, which nothing has written since.

So Kenya's statutory returns — the VAT return, the WHT report, the KRA filing
status — were being computed from a dead collection. **And they showed zeroes
rather than failing, which reads as "nothing to file".**

This is §9E's seam, inside the tax module. It was found by question 4, not by
any screen-side grep: ten of the fifteen repository functions had no caller.

### The port is a change of source, not a redesign

The nested `party` and `kraTracking` blocks and the `_id` key are kept, so the
four client components are untouched — the same call `statement-actions.ts`
made. Twelve reads went into `app/db/actions/tax-actions.ts`; seven new queries
went into the repository below it, each transcribed from a named function in
`taxQueries.js`.

Two things are deliberately NOT the Mongo behaviour, and both are defects a
faithful port would have carried across.

### The VAT page reported "compliant" whatever was outstanding

`getVATDashboard` has two branches. One aggregates and counts unfiled properly;
the other calls the `getVATReturn` model static and hardcodes
`unfiledCount: 0`, with the comment *"static method doesn't track this"*. The
static exists (`taxTransactions.js:565`), **so the first branch is unreachable
and both counts have always been zero.**

That value feeds three things: the compliance card on the VAT stats row, and the
two "N transactions not yet filed" warnings on the return itself. All three have
been silent since they were written.

`getVatUnfiledCounts` counts it. It is a second query rather than a column on
the `vat_return` view on purpose — the view is the RETURN, what is owed for a
period, and filing state is not part of that number.

### All four KRA tiles have always rendered zero

`KRAStatsCards` reads `summary.unfiled.vat`, `summary.filed.vat`,
`summary.unremittedWHT` and `summary.totalTax`. `TaxService.getTaxSummary`
returns `{ period, vat: {input, output, netPayable}, wht: {...} }`. **Not one of
those four fields has ever existed on the object.** Four tiles, four zeroes,
against a table that was live.

So `getTaxSummaryPg` returns what the card reads, with `vat` and `wht` kept
alongside so the shape is a superset rather than a swap. The unfiled, filed and
unremitted figures carry no date filter — a return that missed its deadline last
quarter is still unfiled today, and narrowing the dates must not make money owed
to KRA disappear. Mongo's unremitted aggregation made the same choice; its
filed/unfiled counts never existed to make it.

`kra/page.jsx` also fetched `getTaxSummary()` a second time and passed it as
`summary` to `KRAFilingsClient`, which destructures the prop and never reads it.
The fetch and the prop are gone.

### Three smaller decisions

- **Search is a literal, not a pattern.** Mongo ran four `$regex` with the raw
  search string interpolated, so a supplier named `A.*B` matched everything.
  `ILIKE` over an escaped term matches itself. The test pins it on `%`, which
  now matches exactly the one row whose description contains a percent sign
  (`WHT 5% withheld on payment to Vivo Energy`) rather than both.
- **`filed` and `remitted` are tri-state.** `?filed=false` arrives as the string
  `"false"`, which is truthy. Undefined means "do not filter", which is not the
  same as false.
- **`TAX_VIEW_ROLES` is FINANCE_WRITE plus `Viewer`.** The Mongo queries carried
  no role gate at all, and `canSeeTaxNav` puts the menu item in front of Viewer.
  A nav link that leads to "You don't have permission" is a worse answer than
  either. Same reasoning as `EXECUTIVE_VIEW_ROLES`.

### Ported code deliberately NOT written

`getTaxTransactionById` and `searchTaxTransactions` were **dead in Mongo too**
and are not in the action layer. There is no tax detail route — the list's rows
link nowhere — and the command palette searches through `global-search-action`,
which does not include tax. `getTaxTransaction` and the search filter both stay
in the repository, so either is a four-line action the day a screen wants one.

`taxQueries.js` and `taxService.js` are **deleted**, not left. Both had zero
importers the moment the screens moved, and a zero-importer Mongo file sitting
beside its Postgres twin is exactly how §9L happened — a screen imports the one
that no longer has any data behind it.

### The thing found that was not the tax module

**`global-search-action.js` is the next §9K.** The command palette's server
search reads the Mongo `Product`, `Invoice`, `Quote`, `Bill`, `Party`,
`StockRequest` and `Project` models directly — **all seven of those collections
have moved.** Claims is the only one repointed (`searchClaimsPg`), and the
comment at `:129` explains why it had to be.

It does not error. A search that finds nothing looks like a search with no
matches, so the palette has been returning navigation entries and nothing else
since products ported. It reads no `@/app/mongodb` path — it imports the models
— so the module count above has never seen it.

Not fixed here: it is one file against seven ported modules, which is a port of
its own rather than a line to redirect.

### Where that leaves the count

**63 screen files across 19 modules**, down from 71 across 21. `tax` is at zero.
Eslint clean, `tsc` clean, `ledger-sweep` unchanged — tax posts nothing, and
never did.

**The full suite: 1294 passed, 1 failed — and the failure is not this port.**
`tests/petty-cash-statement.test.mjs` passes `projectId:
"65f0000000000000000000aa"` into `createAndPostExpense`, and `expenses.project_id`
became a real uuid FK with the projects port, so the insert raises 22P02.
Confirmed pre-existing by stashing this branch's changes and running the file
against HEAD, where it fails identically. The fixture needs a project row, not a
one-line edit, so it is left for whoever picks up projects next.

## Handoff — 2026-08-29 — the journal browser, aging, and the reports (no migration)

Two live seams and three dead reports. No schema change: every reader this
needed already existed or was a query away.

### The journal browser was the worst of them

`/dashboard/journal/create` wrote to Postgres. The list, the stats and the
detail page read the Mongo `JournalEntry` collection. So a manual entry raised
through the UI **never appeared on the page it was raised from**, and every
automatic posting — invoices, bills, expenses, claims, payments — was invisible
in the browser entirely. `getJournalEntries` and `getJournalEntry` were already
sitting unwired in `journal-actions.ts`.

The Post and Reverse buttons went with it: those routes loaded the entry from
Mongo by `_id`, and once the browser served Postgres uuids they could only fail.

Three things the port had to decide rather than copy:

- **The cursor is an opaque string.** `JournalPageClient` puts it in a URL
  query parameter, so a structured cursor would reach the route as
  `[object Object]` and serve page one for ever. It encodes `(entry_date, id)`
  — an id alone is not monotonic in date order, so paging on it skips and
  repeats rows the moment two entries share a date, which in a ledger is every
  day. An unparseable cursor starts from the top rather than throwing.
- **One stats query, not five.** The Mongo version fires five, one of them an
  `$unwind` over every line posted this month purely to count distinct entries.
- **`isBalanced` compares exact sums**, as the balance sheet does. An entry out
  by half a cent is out.

### AR and AP aging disagreed with the tiles that link to them

`aging-queries.js` aggregates the Mongo `Invoice` and `Bill` collections, both
of which moved. Meanwhile the executive overview's "Owed to us" and "We owe"
tiles were moved onto the ledger earlier the same day — and they link straight
to these pages. Fixing the tile without the destination left the two visibly
disagreeing, which is worth stating plainly because it was introduced and then
removed within one session.

Both pages now call `getAgingReport`, the same function behind the tiles, so
they cannot disagree. It gained an `itemCount` — the open items behind each
balance — because the pages show a count beside the money; the dashboard
summaries that already read it ignore the new field.

### Three reports that had been empty

`sales`, `purchases` and `cash-flow` all read collections nothing writes.

**The cash flow categoriser was testing for account sub-types this chart has
never had.** `ReportService.generateCashFlow` looks for `owner_drawings`,
`retained_earnings`, `share_capital`, `investment` and `other_asset`;
`lib/chart-of-accounts.js` seeds `drawings`, `retained`, `capital` and
`fixed_asset`. Five dead strings out of eight — the only tests that ever matched
were `fixed_asset`, `loan` and `accountType === 'equity'`. The Postgres version
uses the names the chart actually uses, and a test asserts share capital lands
in financing.

`ReportServerComponents.jsx` was **deleted, not ported**: six stats-card
components reading Mongo that nothing imports — not the pages, not the barrel.
Porting dead code faithfully produces dead code.

### One report is blocked on a product decision, not on work

**`sales-by-rep` cannot be ported as it stands.** Mongo's invoice carries
`salesPerson.employeeId`; the Postgres `invoices` table has `created_by_id`
and nothing else. Porting it against `created_by` would be worse than leaving
it: a finance clerk raising invoices for the whole team would come out as the
top rep, and the page would look right. It needs a `sales_person` on the
invoice and a picker on the form to fill it — a feature, and one somebody
should choose deliberately. The page is empty either way today.

### Where that leaves the count

**71 screen files, down from 105 at the start of the day.** `journal` is at
zero, `reports` at one. The remaining seven untouched modules — tax, banking,
kpis, leads, employee, opportunities, approvals — are whole verticals and
honest about it.

## Handoff — 2026-08-29 — cost codes are the budget vocabulary (0073)

The budget form handed a project manager **39 postable expense accounts,
ordered by account code**, and asked them to build a budget out of it.
`PROJECT_MANAGE_ROLES` includes `Manager` — an operations role — so the person
being asked to read a chart of accounts is precisely the one who does not have
one in their head. The combobox also offered to **create an account** from
inside a budget line.

### What every comparable system does instead

| | what the budget-holder picks | who owns the GL mapping |
|---|---|---|
| Procore, Candy, RIB | **cost code** (+ cost type) | finance, once |
| Odoo | **budgetary position** — a named group of accounts | accountant |
| Sage Intacct, Xero Projects | **cost category** | mapped behind the scenes |
| NetSuite | accounts, but filtered and budgeted at parent level | finance |
| SAP, Oracle | cost element group / commitment item | finance |

Unanimous: nobody puts a raw chart of accounts in front of a project manager.

**And this schema already had the table.** `project_cost_codes` has existed
since 0070, is referenced by claims, bills, expenses and stock requests, has
full CRUD in both stores — and **has never had a screen in either of them**, so
no cost code could be created through the app at all. It had one thing missing:
it did not say which account it charges.

### The four decisions

1. **A cost code charges exactly one postable EXPENSE account**, and finance
   sets it. Not a group, as Odoo's budgetary position is — a group has to be
   split back across the codes that share it, and there is no non-arbitrary way
   to do that. Several codes MAY share one account; "Labour, site" and "Labour,
   office" both on 6200 Wages is normal.
2. **The budget line's account is derived, not chosen.**
   `project_budget_lines_derive_account` reads the cost code and writes
   `account_id` and the snapshot itself, so no path can produce a line whose
   account disagrees with its code — including paths nobody has written yet.
   It fires on write only: re-mapping a code later does not rewrite budgets
   already approved against the old account.
3. **One line per account survives** (0070 decision 6), and now has something
   to say: two codes charging one account cannot both be lines, because
   budget-versus-actual matches by account and each would show the full spend.
   Matching by cost code instead is where this goes when the claims, bills and
   expense forms actually SET one — nothing does today, so matching on it now
   would show every line an actual of zero.
4. **Defining a cost code became FINANCE's**, not `PROJECT_MANAGE_ROLES`. While
   a cost code was just a label that gate was right; it now carries a GL
   mapping, and keeping the chart away from the person filling in the budget is
   the entire point.

### And the hole underneath the picker

`project_budget_lines.account_id` was an unrestricted reference to `accounts`.
The picker had always filtered on `account_type = 'expense' AND can_post`; the
COLUMN never did, so a bank or receivable account posted to the form saved and
then matched no actual, for ever, in silence. Exactly the shape of the project
client in 0072 — the picker filtered and nothing underneath it agreed. That is
now three in a row, and it is worth stating as a rule: **if a picker filters,
find out what happens when the filter is bypassed.**

### New screens

`/dashboard/projects/cost-codes` — read by anyone who manages projects, written
by finance, linked from the projects list. It shows what each code charges and
warns when two codes share an account, rather than letting the budget page be
the first place anyone finds out.

## Handoff — 2026-08-29 — a project's client is a customer (0072)

The create and edit forms already offered nothing but customers and had no
quick-create beside the picker. The rule was enforced nowhere below the form,
and three routes around it existed.

1. **A name with no party was legal.** `projects_client_pair` (0070) was an
   implication — an id requires a name — so `client_name` on its own passed,
   and the 0070 header explicitly blessed it as "what a one-off client is".
   That was the wrong call: a project's client is the party its invoices are
   raised against, and a name that is not a customer record cannot be invoiced,
   aged, or put on a statement. The constraint is a BICONDITIONAL now.
2. **Any party was acceptable.** The FK targets `parties`, which holds
   suppliers and employees. The picker filtered; the column did not. A trigger
   does it, because an FK cannot target a partial unique index.
3. **The name came from the request body.** `createProject` stored whatever
   `clientName` and `clientEmail` were posted, with nothing checking they had
   anything to do with the id beside them. The action resolves both from
   `parties` now — the same fix `assignPartyToProject` needed.

The client stays OPTIONAL: an internal project has no external client, and
requiring one pushes people to invent a party to satisfy a form.

### Two things found doing it

**`getProjectTransactions` had no test, and its claims arm did not run.** It
selected `c.employee_name`, which is not a column — the employee is a party and
the name comes from a join. Every project detail page with a claim against it
threw. The Mongo function it replaced called `listClaimsPg({ projectId })`; the
port should have kept doing that, and now does. Found by the dev server, not by
the suite, which is the tell: the drill-down had zero coverage. It has three
tests now, and the first one exercises all five arms because the failure mode
was "the query does not run", not "the number is wrong".

**Every optional field on the project actions rejected an ABSENT key.**
`formData.get()` returns `null` for a key that is not present and
`z.string().optional()` rejects null, so an action called with anything less
than the full set of form keys failed with "expected string, received null"
against fields the caller had no opinion about. The screens post all of them,
so it never surfaced there. `optionalText` / `optionalEnum` /
`optionalTextMax` coerce null first.

## Handoff — 2026-08-29 — the executive overview

No migration. The CEO's home screen, moved off four dead Mongo collections and
onto the ledger.

`cExecutiveSnapshot` summed documents: `Invoice`, `Bill` and
`Account.cachedBalance`. All three are on Postgres, so **five of its eight
headline numbers — revenue, AR, AP, cash, and the net derived from two of them
— have read ZERO** since those modules ported. Nothing errored. The page
rendered, with the business apparently at a standstill on it. `executive` was
one line in the count table, which is why it sat there for four handoffs.

### It is not a transcription, for one reason

**The tile now IS the number on the report it links to.** The Mongo version's
revenue was `status IN ('sent', 'completed')`, and a SENT invoice posts
nothing — only completing one credits the revenue account. So the executive
card reported a bigger month than the P&L it drills into, by exactly the value
of everything sent and not completed, and no one number was wrong enough to
notice. Reading the ledger removes the question. `tests/pg-executive-
snapshot.test.mjs` asserts the two agree rather than asserting a figure.

Three things follow from the same change:

- **Credit notes net off for free.** A credit note debits revenue and the
  figure is `SUM(credit - debit)`. The document sum had no arm for them at all.
- **AR and AP use `getAgingReport`'s exact predicate** — open entries against
  the control account, by party type — so the tile and the aging page cannot
  disagree. They previously came from different stores.
- **Cash is a ledger balance**, not `Account.cachedBalance`, whose own Mongo
  comment reads "Cached - NOT source of truth!". Same family as
  `parties.cachedBalance` and `products.quantityAvailable`.

### Three things found that were not the screen being ported

1. **M-PESA WAS NOT COUNTED AS CASH.** `lib/chart-of-accounts.js` seeds account
   1113 with sub-type `mpesa`, and `getFinancialOverview` — the PG dashboard
   query, nothing to do with the executive page — filters on `cash` and `bank`
   only. Every dashboard reading it has understated the money position by the
   whole M-Pesa float. In this market that is not a rounding difference. Fixed
   there too, with `mpesaOnly` added to the shape and `CFODashboard`'s hint
   moved with it so the breakdown still adds up to the balance above it.

2. **`cPipeline().totals` caps at 250 rows.** Right for the board it was
   written for, wrong for a headline: a company with 300 open deals would see
   the value of 250 of them and nothing would say so. `cPipelineTotal`
   aggregates in the database instead.

3. **The role gate was about to be wrong.** The obvious gate for a finance
   action is `FINANCE_ROLES`, and `Viewer` is not in it — but Viewer is what
   CEO became (0039) and this screen is that role's HOME. Gating the snapshot
   on a finance list would have shown the "could not load" card to the one
   person the page exists for. `EXECUTIVE_VIEW_ROLES` now lives in
   `role-gates.js` and the page and the action share it.

### One tile deleted rather than ported

**Order backlog.** It aggregated the Mongo `SalesOrder` collection, the module
is switched off (`lib/unported-modules.js`, §9K), and the tile was already
behind the flag — so what the flag guarded was a zero labelled "confirmed
orders awaiting invoice". Restore it from Postgres when sales orders are
ported. A tile reading zero because its store is empty is worse than no tile,
and this session has now found six numbers that were exactly that.

## Handoff — 2026-08-29 — the work breakdown (0071)

Step 1 of `docs/PROJECTS-EXECUTION-LAYER.md` §4, and the first line of what the
MD's template actually asks for: "tasks drive execution".

`project_tasks` — an ltree WBS, the same pattern `categories` uses (0062) —
plus the repository, the actions, and a `ProjectTasks` card on the project
detail page. **`projects.progress_percent` is not dropped and not recomputed by
a trigger. It is now the FALLBACK**: a project with no tasks reports what
somebody typed; a project with tasks reports the weighted roll-up of its
leaves, computed on read.

### The six decisions

1. **Progress is derived where there are tasks, typed where there are none**,
   and `progress.source` says which — because a number somebody dragged a
   slider to and a number rolled up from measured work look identical on a bar,
   and only one is evidence. `updateProjectProgress` now REFUSES once a WBS
   exists rather than writing a value the read ignores.
2. **A summary task has no progress of its own.** The trigger refuses to store
   one on a task with subtasks, and breaking a task down demotes whatever it
   was carrying. The commonest way a WBS lies is 90% typed on a summary line
   whose children are at 20%.
3. **Weight, not count** — `COALESCE(weight, estimated_hours, 1)`. An
   unweighted average makes "order the cable" worth as much as "lay 8km of
   subbase". Zero weight is refused: invisible to the average, still on the page.
4. **`done` is 100 and 100 is `done`** — a biconditional. `cancelled` is
   excluded from both the CHECK and the roll-up. Reopening a completed task is
   the one transition the repository will not guess: it asks for the number.
5. **The hierarchy is an ltree maintained over the subtree** — cycle check free
   with the path, descendants move with their parent, `depth` generated so it
   cannot disagree, and the roll-up becomes `leaf.path <@ task.path` rather
   than a recursive CTE per row. A composite FK keeps a subtask in its parent's
   project.
6. **No `actual_hours` column**, though the MD's template lists one. It is the
   sum of a task's timesheets and timesheets are step 4 — storing the total now
   is storing a number with no writer, which is the `financials` mistake 0070
   spent a migration undoing.

Deliberately absent: **dependencies and a critical path**.
`PROJECTS-QALITRACK-PLAN.md` §4 is blunt that a Gantt without predecessor links
"is a picture of a programme, not a programme", and half of one is worse than
none.

### One thing found that was not the table being built

`assignPartyToProject` — the roster action ported in 0070 — **took a different
shape from the one its only caller sends.** `ProjectTeam.jsx` posts
`{ partyId, role, rate: { amount, unit } }`; the port asked for `name`, `type`,
`rateAmount` and `rateUnit`. It typechecked, and a direct-call test would have
passed, because a direct-call test uses the shape the function wants — which is
exactly the layer nothing else uses. Every member added through the only screen
that adds one would have been written as "Unnamed" with no rate.

The action now resolves the party from `parties` and snapshots the name and
type server-side, as the Mongo action did — which is also the safer half: the
name was being taken from the request body. `tests/pg-projects.test.mjs` has
four tests on the contract itself for that reason.

**The lesson generalises: grep the CALLER before settling a ported function's
signature.** `tsc` cannot see across the `.jsx` boundary and neither can a test
that calls the function directly.

## Handoff — 2026-08-29 — projects (§9N)

Migration **0070**. `projects`, `project_budgets` + `project_budget_lines`,
`project_cost_codes`, `project_assignments`; the repository, the actions, all
13 screens, and the five `project_id` columns that have been `text` with no
foreign key since 0053/0054.

**This is the one module that was NOT a faithful port, and that was decided in
writing before it started** — `docs/PROJECTS-QALITRACK-PLAN.md`. The MD has a
prototype, `QaliTrack_PMS`, which is a road contract administration system: a
different product built on top of a project. That product is `contracts` and it
is not built. What is built is the cost centre the ledger already refers to.

### What the module was doing before

Not one of these is a translation error. They were all live.

| | |
|---|---|
| `financials.{totalRevenue,totalCosts,totalCommitted}` | Three cached columns maintained by an `$inc` helper **nothing has ever called**. Grep `updateProjectFinancials` outside its own file: one comment. Every project has displayed zeros since the module shipped. |
| `computeProjectActuals` | The live figures beside them aggregate the MONGO `Invoice`, `Bill`, `StockRequest` and `StockMovement` collections. All four ported; none is written to. Revenue, bill cost and stock commitment read a dead store. |
| `status: { $in: ["completed", "posted"] }` | `posted` is not an invoice status in EITHER store. Dead filter. Postgres raises 22P02 on it, which is how it was found — the same shape as claims' `settled`. |
| `StockMovement status: "posted"` | Same again: `movement_status` is pending\|completed\|reversed. The returned-COGS arm never matched anything. |
| a fulfilled stock request | Counted as committed while `approved`, and **counted as nothing once fulfilled**. The stock is on site and the project's cost FALLS by what was just delivered. Nothing restores it: fulfilment posts DR Technician Stock, an asset, and the checkout that later expenses it carries no project. |
| `deleteProject` | Counts CLAIMS. The module's own gap list admits it. A project with three invoices and no claims deleted cleanly and took the link off all three. |
| `getProjectsForParentPicker` | Docstring says "excludes self and own children". The query excludes self. Picking your own child builds a cycle `getSubprojects` walks for ever. |
| `budget.approve()` | Supersede-then-approve, read-write-write, no lock. Two approvals racing leave two approved budgets and budget-vs-actual takes whichever sorts first. |
| `{ companyId, code, projectId }` unique | Works in Mongo, which treats a missing `projectId` as a value. Postgres NULLs are distinct, so the same index lets a company hold ten cost codes called `LAB`. Two partial indexes. |
| the client / PM / on-behalf pickers | `partyQueries.searchParties`, `getUsers`, `getEmployees` and `claims/create/advance` read Mongo collections that auth and parties stopped writing to. Every one of those dropdowns was empty. |
| `ExpenseForm`'s vendor dialog | Created the vendor in MONGO while every supplier picker on the page read Postgres, so a vendor added there vanished from the dropdown that had just been used to add it. |

### The seven decisions

In the 0070 header, at length. In one line each:

1. **No cached financials.** Computed from the documents, live, for one project
   or twenty in one query.
2. **No project dimension on `journal_lines`** — deliberately. `committed` is
   the number a budget is checked against and an approved stock request has no
   ledger entry at all, correctly. A ledger-only summary reports a project as
   having spent nothing until the goods arrive. The dimension is the right move
   when IPCs and retention arrive; it touches every posting path and is its own
   migration.
3. **The status machine is a trigger.** Two of Mongo's three writers reach the
   document through `findOneAndUpdate`, where `canTransitionTo` never runs.
4. **One approved budget per project, as a partial unique index.**
5. **The budget total is not stored and is not copied onto the project.** The
   lines are the total; `projects.budget_amount` stays the advisory figure the
   create form collects; the repository reads `COALESCE` of the two.
6. **One budget line per account.** Two lines on one account each display the
   FULL actual for it, so the project reads twice as far over budget as it is.
7. **Two cost code indexes**, split on whether the code is project-scoped.

### Still open, and why

- **A project dimension on `journal_lines`.** Decision 2. Until it exists,
  project cost is a document query and labour reaching a project through
  payroll is invisible to it.
- **Cost codes have no screen.** The CRUD actions and the "for the management
  page" query both exist, in Mongo and now here, and there has never been a
  management page — so no cost code can be created through the app, and the
  picker that would spend one is not on any form either.
- **`contracts`** — notices with their 24-hour and 28-day clocks, IPCs,
  retention, the site diary. The sequence is in `PROJECTS-QALITRACK-PLAN.md` §5.
- **The MD's execution layer** — tasks/WBS, milestones, timesheets, change
  orders. Not built; the data model is designed and the picks are argued in
  the handoff below rather than in code.

## Handoff — 2026-08-28

State: branch `feat/postgres-migration`. `tsc --noEmit` and `eslint . --quiet`
clean. **Full suite green — 75 files, 1130 tests**, run with `caffeinate -i`
and `--no-file-parallelism`. 0066 is applied to both databases.

### What moved

**Inventory adjustments — the last module of substance posting into the Mongo
ledger.** Two tables (0066), a repository, an action layer, both screens, and
both ends of the approval engine's wire. 16 tests. After it the
`ledger-sweep`'s LIVE list is four modules and three are false positives; the
only real posting left is `movement.reverse()` in the weighbridge connector.

Most of the 825-line Mongo model did not need porting, for the reason fiscal
periods did not:

| Was a method | Is now |
|---|---|
| `validateLines()`'s two arithmetic checks | generated columns — nothing to disagree with |
| "reason required for every line" | NOT NULL + a non-empty CHECK |
| "can only approve draft adjustments" | `WHERE status = 'draft'` on the claiming UPDATE, which two racing approvals cannot both win |
| "cannot take stock below zero" | `products_quantities_non_negative` |
| the three stored totals | summed on read |

### The bug that was not in this module at all

**Company settings could not be read AT ALL, by anyone, in either direction.**
`getSettingsFor` is the one way to reach a tenant's thresholds, prefixes, VAT
rate and feature flags, and it threw *"This company has no ledger tenant yet.
Open it once, then try again."* on companies that plainly exist. Fourteen files
outside `companyConfig.ts` reach it, five of them financial CONTROLS.

**Two independent causes, one per form of company id.**

**1. A UUID has no row in `_migration_id_map`.** `getSettingsFor` resolves a
MONGO id through that map — the form the session carries and the Mongo actions
pass. But a Postgres action reads its company from `withAuthorizedTenant`, and
`ctx.companyId` is `acting.companyUuid`. Four call sites did this: the invoice
discount cap (`invoice-actions.ts:117`), the bill-payment threshold
(`payment-actions.ts:375`), the expense-payment threshold
(`expense-actions.ts:421`), and this port's routing rule.

**2. `lookupCompanyUuid` joined an RLS'd table from outside any tenant scope.**
Its query was

```sql
SELECT c.id FROM _migration_id_map m
JOIN companies c ON c.id = m.new_uuid
WHERE m.collection = 'companies' AND m.old_object_id = $1
```

and it runs on the application pool as `app_user`, a role with no BYPASSRLS by
design (0023). `companies` carries two policies, keyed on `app.company_id` and
`app.user_id`, and `withTenant` sets both with `set_config(..., true)` —
TRANSACTION-LOCAL. This query is what runs BEFORE that transaction, to decide
which tenant to open, so neither setting exists and every row of `companies` is
invisible to it. **The map row was always found; the join threw it away.** So
the Mongo-id path returned null for every id ever passed to it, which is every
caller in `app/mongodb/` plus `saveCompanyThresholds`.

Proven rather than reasoned about — as `app_user` with no context, the same
predicate returns 1 row without the join and 0 rows with it.

The join was guarding against a map row pointing at a deleted company.
`_migration_id_map` has no RLS and is the authority for the mapping, so it
answers alone; a stale row now yields a uuid whose `withTenant` read fails with
a message about the company, which is a truer error than a mapping that
silently is not there.

**Why nothing caught either half:** `tests/bill-payment-threshold.test.mjs` and
`tests/expense-payment-threshold.test.mjs` both `vi.mock` the entire threshold
module, so the id that reaches the resolver in a test is never the one
production sends, and the resolver itself never runs. **Testing the layer above
a seam cannot find a bug in the seam** — the same lesson as
`find-unwired-actions`, one layer down. `tests/pg-company-thresholds.test.mjs`
now exercises the resolver itself, in both forms, on both the read and the
write path, and asserts it still fails CLOSED on an id that names nothing.

**And fixing it woke a cache that had never run.** `companyUuidCache` sits at
module scope in `tenant.ts` and is written by `lookupCompanyUuid` — which, as
above, had never returned a value, so it had never cached one. With the lookup
working, a vitest worker running many files in one process now carried mappings
across the `TRUNCATE companies` every Postgres suite opens with, and seven
tests in four unrelated files failed. Each of them passed alone, and passed
with the others when run as a group: full-suite only.

The cache is inert under `VITEST` now. NOT a reset hook in `tests/setup.mjs` —
importing `tenant.ts` from the shared setup pulls NextAuth into every test file
that has no reason to load it, and 494 of them fail on the spot. That was the
first attempt.

Worth keeping because the shape recurs: **a fix that makes dead code live for
the first time inherits every assumption that code was written under.** This
one assumed nothing ever deletes a company.

### The other thing the tests found

**The segregation of duties this module is built around did not exist.** The
Mongo rule is

```js
!hasZeroCostIncrease && (hasFullAuthority || (!isHighRisk && !isHighValue))
```

and the second branch tests no role at all — while the policy header above it
says the branch is for "Store Manager / Accountant", and the comment beside
`CREATE_ROLES` says "Storekeeper can now propose, but the approval engine
ensures they don't auto-apply". A Storekeeper auto-approved every adjustment
under fifty thousand shillings: posted to the ledger, moved the stock, no
second signature.

A DELIBERATE DIVERGENCE — the port adds the role test the policy describes.
Three tests hold the line in both directions: a Storekeeper routes, a Store
Manager still applies a small low-risk one, and a Store Manager's *theft*
adjustment routes however small it is.

### Two repository functions that would have been the wrong ones to reuse

`issueStock` also decrements `quantity_committed`, which is right for
fulfilling a sale and an OVERSELL for a write-off: the customer order those
units were promised to is still open, and releasing the commitment would let
the same stock be committed twice. `receiveStock` also writes
`last_purchase_cost` and `last_purchase_date`, which would let stock found
behind a shelf overwrite the record of what the product last cost to buy.
`adjustStockUp` and `adjustStockDown` are the adjustment-shaped pair.

### Three traps that only running the code found

- **`journal_entries_source_pair`.** Setting `sourceId` without `sourceType`
  is refused — `(source_type IS NULL) = (source_id IS NULL)`. 0066 adds
  `stock_adjustment` to `source_document_type`, as 0050, 0051, 0052, 0056 and
  0060 each added theirs. ADD VALUE only, so it stays legal inside the
  migrator's transaction.
- **A Drizzle column interpolated into ALIASED raw SQL** renders as
  `"stock_adjustments"."status"` and Postgres rejects it once the FROM clause
  has renamed the table to `a`. Spell the alias out in raw queries.
- **`.select()` with `sql` subqueries did not map the columns back.**
  `lineCount` arrived `undefined` and the totals arrived zero, with no error
  anywhere — so the list rendered rows with no items and no value, and `tsc`
  typed the field as a number throughout, because it types the select from its
  KEYS and not from what the driver returns. `listAdjustments` is one raw
  query now, like the stats beside it.

### Rejecting an approval left the draft standing

`voidApprovalTarget` looked the adjustment up in Mongo by `targetRef.id`, which
is a uuid now, so the lookup threw a CastError the engine's own catch swallowed
as a log line — the exact defect the CreditNote branch three lines above it was
written to fix.

Worth knowing how it was nearly missed: `inventoryAdjustment.cancel()` looked
like dead code, because the grep for it was `cancelAdjustment` and its one
caller invokes it on a variable named `doc`. **Grep the METHOD name, not the
name you would have given it.**

### The approver list is the union of two matrix rows

`APPROVER_MATRIX` (approvalRequest.js:196) admits Store Manager for
`stock_adjustment` and CFO / Finance Manager for `stock_writeoff`. A gate
narrower than the union refuses an approver the engine has just accepted, and
it fails silently: the approval sits in the queue and the approver is told they
lack a permission they have.

### The finding that is bigger than the module

**The port-reach command misses eleven screens.** It greps `@/app/mongodb`;
these import `@/app/models/…` or `dbConnect` directly, so they have never
appeared in any count this document has printed. Three are in modules called
DONE here. The table is in §"Where the port has reached", and the shape is the
familiar one — a picker or a strip reading a collection nothing writes, showing
an empty dropdown or a zero rather than failing.

Two are one line each:

- `stocks/create/page.jsx` **already imports `getCategoriesPg` and never calls
  it**, reading Mongo `Category` on the line below.
- `stocks/[id]/update/page.jsx` does the same without even the import.

Both call `Category.find({})` with no tenant filter.

### Next, in order

**1. The ten remaining direct-model screens** — small, mechanical, and each one
is a picker that is empty today. The eleventh was fixed with 0066.

**2. PROJECTS — read `docs/PROJECTS-QALITRACK-PLAN.md` FIRST.** Still the
keystone, still blocked on the split decision it describes.

**3. The weighbridge connector** — the last Mongo ledger posting, and a whole
vertical rather than a call to redirect.

**4. Whole modules still untouched** — integrations, tax, reports, banking,
kpis, settings, leads, opportunities, journal.

### Ported code deliberately NOT written

**No approve action for a UI that does not exist.** The Mongo action file
exports exactly one function, `createStockAdjustment`; there is no detail page
(the list links to `/dashboard/adjustments/[id]`, which is a dead route and was
before this port). `applyApprovedStockAdjustmentPg` and
`voidDraftStockAdjustmentPg` exist because the approval engine calls both, and
nothing else was invented to go with them.

### One thing to tidy

0066 was edited AFTER being applied, so the recorded hash in
`drizzle.__drizzle_migrations` was realigned by hand on both databases and the
`ALTER TYPE` applied directly. Both are consistent now and a from-scratch run
of the file is correct, but that path has not been exercised end to end on a
clean database — `stockvault_test` had live connections and could not be
dropped. Worth doing once before this branch merges.

---

## Handoff — 2026-08-27

State: branch `feat/postgres-migration`, everything committed, 180 ahead of
origin. `tsc --noEmit` and `eslint . --quiet` both clean (re-run 2026-08-28).
**The full suite has NOT been run since the 2026-08-26 handoff** — 33 tests
were added across three new suites and each passed on its own; 75 test files
now, 54 of them `pg-*`. Run it with `caffeinate -i` and
`--no-file-parallelism` before trusting a green.

### What moved

| Module | What |
|---|---|
| Platform / SuperAdmin | `company-queries.js`'s nine functions — 13 tests |
| Fiscal periods | Fifteen Mongo functions, four screens — 15 tests |
| Payroll rates | Not a port: a real bug, see below — 5 tests |
| QSL ERP pages | Twelve pages carried across verbatim, plus the brand theme |

**Fiscal periods is the clearest example yet of the rule in §"Migrating a
vertical": most of the service did not need porting.** Overlapping periods,
duplicate codes, end-before-start and posting into a closed period are all
CONSTRAINTS (`fiscal_periods_company_year_month_uq`,
`fiscal_periods_company_code_uq`, `fiscal_periods_date_order`,
`trg_resolve_fiscal_period`). The Mongo service performed each as a query
before writing — a race, and a duplicate of what the schema already says. What
survived into the repository is the part SQL cannot state: a period with
unposted work in it is not finished, and closing one moves the result to
retained earnings. Statistics are no longer STORED either; the Mongo period
cached `statistics` and `closingBalances` at close time, which could disagree
with the ledger and needed a button to refresh it.

### Things found that were not the module being ported

- **Payroll rates could not be saved at all**, by anyone, and the database was
  right. KRA gazettes PAYE bands inclusively — "0 – 24,000", then "24,001 –
  32,333" — which typed in literally is not a partition of the number line, and
  `assert_paye_brackets_cover` (0048) refused it: nothing covers 24,000.50.
  Worse quietly: `lib/payroll/kenya-tax.js` takes a band's width as `to - from`,
  so read inclusively every band was one shilling short of what the gazette says
  it is worth. Had the save succeeded, every payslip would have been slightly
  wrong. Fixed at the point of ENTRY, because the assertion and the arithmetic
  already agreed with each other — bands are half-open `[from, to)` — and the
  only thing that disagreed was what the form handed them.
- **The whole platform dashboard read a store nothing writes.** Companies moved
  in 0035; `company-queries.js` still read the Mongo `Company` model, so company
  counts, subscription mix, MRR, expiring trials and system alerts were all
  derived from an empty collection. Same failure as statements and the tenant
  dashboard before it. **This is the third time.** When a module reports
  plausible zeros, check WHICH STORE before checking the query.
- **The approvals tile called `dbConnect()` as its first line**, so with Atlas
  unreachable it threw before any of the six Postgres counts ran and the tile
  reported 0 — "nothing to approve" being the worst possible answer an approvals
  tile can give, and this module has been burnt by exactly that once before. It
  now owns its connection and its own catch: Mongo down costs you the engine
  number, and stock requests, bills, leave, loans, claims and NCRs still report.

**Three shapes that read better and broke a caller**, all caught by `tsc`,
bringing this month's total to five. `formatDaysRemaining` returned a NUMBER
despite its name and a friendlier string broke `daysRemaining <= 2` into
`"3 days leftd"`; `getPeriodStats` omitted `currentPeriod`, which the accountant
dashboard renders as `currentPeriod.name`; and the period summary counted LINES
rather than entries, so joining `journal_lines` made a two-line entry report as
two and the close guard told the user there were twice as many drafts as there
were. `count(DISTINCT e.id)`. The trap in §"Two traps" is not theoretical — it
has now fired five times in one month.

**A backtick inside a SQL comment terminates the `sql` template literal.**
Nothing may contain a backtick inside one.

### The ApprovalRequest engine stays on Mongo, deliberately

There is no Postgres table for it — only `stock_request_approvals`, which
belongs to fulfilment. It is the one module where "still Mongo" is a decision
rather than a backlog item, and it is why `AlertsStrip.tsx` is in the remaining
four component reads. Anything porting approvals should read
`docs/APPROVALS-PLAN.md` first: the engine's coverage was already partial on
`jeff-business-suite` (3 of 6 enum types wired), so a faithful port would carry
that gap across.

### Next, in order

Unchanged from 2026-08-26, minus what closed:

**1. PROJECTS — read `docs/PROJECTS-QALITRACK-PLAN.md` FIRST.** Still the
keystone: five modules (claims, invoices, bills, requests, expenses) each have
exactly one trailing Mongo read and it is the project picker. Still not a
straight port — the MD's `QaliTrack_PMS` is a road-construction CONTRACT
ADMINISTRATION system, and that document recommends splitting `projects` (the
cost centre it already is) from `contracts` (its own module). Do not merge them
without reading it.

**2. Inventory adjustments** — the last module of substance posting into the
Mongo ledger, and `approval-actions` follows it.

**3. The remaining 4 component reads** — bank-feed, approvals, notifications,
activity. Each belongs to a different unported module; see the table in
§"Where the port has reached".

**4. Whole modules still untouched** — integrations, tax, reports, banking,
kpis, settings, leads, opportunities, adjustments, journal.

### The two decisions from 2026-08-26 are still open

Manager and selling prices (consolidated on the STRICTER side, one line to
widen), and the ungated starter tier (`<PlanGate>` covers hr, projects and
integrations only, because gating finance/tax/purchases/assets/claims would
lock the free-plan dev company out of most of the app).

### A third decision, new: the QSL pages

Twelve pages came across verbatim in `8375317b8`, and `components/erp-ui.jsx`
bypasses Tailwind and shadcn by design — 43 inline style blocks, 0 `className`,
0 CSS variables, 0 media queries, 0 dark-mode handling, ten primitives
re-implemented. That was defensible at fork time and now costs those pages the
theme, dark mode and breakpoints. `docs/QSL-BLEND-NOTES.md` proposes keeping
their component API exactly and rebuilding the internals, so their pages do not
change at all. Not yet done.

---

## Handoff — 2026-08-26

State: branch `feat/postgres-migration`, everything committed, `tsc` and
`eslint --quiet` clean, full suite green (1028 tests at last full run, plus the
suites added since).

### What moved

| Module | What |
|---|---|
| Statements | Off the LEDGER, not documents — 10 tests |
| Products / stocks | The missing action layer + all 6 screens — 22 tests |
| Dashboard | Both Mongo query modules, all consumers — 25 tests |
| Tenant translation | 115 broken casts across 26 files — 9 tests |
| Plan gate | `<PlanGate>` on module layouts |
| Test speed | 4.6s -> 2.3s of TRUNCATE per test |

### Things found that were not the module being ported

- **`withTenantScope` threw for every non-SuperAdmin.** The session carries a
  Postgres uuid; Mongo documents are keyed by ObjectId. 115 call sites across
  26 files built the cast INLINE rather than calling the shared helper, so
  fixing the helper fixed one of them. It survived because every helper returns
  early for SuperAdmin — testing as one, nothing breaks.
- **The plan gate was nav-deep only.** The port never carried
  `requirePlanAccess` into `app/db/`, and no HR page checked, so a free-plan
  company had a working Professional module via the command palette or a typed
  URL.
- **The session carried the GLOBAL role**, so promoting somebody per-company
  changed nothing they could see.
- **Two dashboard alert strips reported zeros** rather than failing, because
  the ObjectId cast threw inside their own try/catch.

The pattern in all four: the bug was never in the module being moved. Grep the
MODEL name, not the action file.

### Next, in order

**1. PROJECTS — read `docs/PROJECTS-QALITRACK-PLAN.md` FIRST.**
It is the keystone: five modules (claims, invoices, bills, requests, expenses)
each have exactly one trailing Mongo read and it is the project picker. They
all close when projects lands.

It is ALSO not a straight port. The MD produced a working prototype,
`QaliTrack_PMS`, and it is a road construction CONTRACT ADMINISTRATION system —
Engineer's Instructions, site diaries, Interim Payment Certificates, retention,
and time-barred notices (EOT and CCN at 28 days, Accident Report at 24 hours,
where a late notice extinguishes the claim). The recommendation in that
document is to split: port `projects` as the cost centre it already is, and
build `contracts` as its own module. Do not merge them without reading it.

**2. The remaining 7 component reads** — company-queries (3), bank-feed,
approvals, notifications, fiscal-periods, activity. `auth-actions` was the
eighth and had no Mongo in it at all; it moved to `app/db/actions/`.

**3. Whole modules still untouched** — integrations, tax, reports, banking,
kpis, settings, leads, opportunities, adjustments, approvals, journal.

### Two decisions still open

- **Manager and selling prices.** `PRICE_ROLES` (server) included Manager,
  `PRICING_EDIT_ROLES` (UI) did not, so the server's documented intent was
  unreachable. Consolidated into `lib/permissions.js` on the STRICTER side. One
  line to widen if that is wrong.
- **The starter tier is ungated.** `<PlanGate>` covers hr, projects and
  integrations. Finance, tax, purchases, assets and claims are not gated,
  because gating them would immediately lock the free-plan dev company out of
  most of the app. Needs a call on plan assignments.

### Two traps worth knowing before you touch anything

- **A ported return shape is a contract, not a draft.** Three shapes were
  "improved" during the dashboard port and `tsc` caught all three. Match the
  Mongo shape exactly, even when it reads worse.
- **`tsc` cannot check raw SQL.** Two invented column names shipped before
  being caught by running the query. Check identifiers against
  `information_schema` after writing raw SQL.

---

## Handoff — 2026-08-24

State: branch `feat/postgres-migration`, everything committed, `tsc` and
`eslint --quiet` clean.

### What moved in the last session

| Module | Migration | Tests |
|---|---|---|
| Expenses | 0059 | 35 |
| Petty cash | 0060 | 25 + 4 statement |
| Credit notes | — (finished a half-port) | 27 existing |
| Opening balances | 0061 | 24 |
| Checkouts | — (wired an existing table) | 16 |
| Payments | — (action layer only) | 12 |
| Categories | 0062 | 17 |
| **Payments (wired)** | **0063** | **29 + 8 gate** |

Sales orders was **switched off** rather than ported — `lib/unported-modules.js`,
§9K. One flag, five guards, `grep -rn SALES_ORDERS_AVAILABLE`.

### Next, in the order I would take them

**1. ~~Wire payments~~ — DONE, and it was not three functions.**
See §9M. `payment.confirm()` is unreachable and `npm run ledger-sweep` no
longer lists it. Read §9M before the next port: the estimate was wrong in a
way that is going to repeat, because the work was not in the module being
moved. It was in the SIX seams around it, four of which were already broken.

**2. Statements — the seam payments just made worse, and the table above was
wrong about it.**
`docs/BUILDING-ON-POSTGRES.md` listed statements and supplier-statements as
"on Postgres". They are not. Four screens read
`app/mongodb/queries/statement-queries.js`, which reads the MONGO `Invoice`,
`Bill`, `Party` and `Payment` models while pulling credit notes from Postgres.
All four of those moved long ago — `app/mongodb/invoice-actions.js` has no
screen importer left — so customer and supplier statements have been rendering
an empty ledger, and payments moving makes the last column of the statement
empty too.

Measure the destination first, as always: the AGING HALF IS ALREADY BUILT.
`reports.ts:getAgingReport(tx, "receivable" | "payable", asOfDate)` derives it
from the LEDGER rather than from document fields, which is the better source
anyway. What is missing is the transaction-list half — the running-balance
statement itself — and the four screens.

**3. Products / stocks.** `stock-actions.js` is 1,163 lines over 7 exports, and
the destination is largely built: `app/db/repositories/products.ts` has 13
functions including the whole commitment-based flow (`commitStock`,
`releaseStock`, `issueStock`, receive-to-hold/accept/reject,
`recostFromAcceptedReceipt`), all in use by invoices, quotes and GRNs. What is
missing is `product-actions.ts` and six screens. Two of those screens import
the Mongoose `Category` model directly — `stocks/[id]/update/page.jsx` and
`stocks/create/page.jsx` — and categories is on Postgres now, so they are
reading a collection nothing writes.

**4. Inventory adjustments.** The only genuine from-scratch port left in the
cluster: no Postgres table, no repository. 308 action + 197 query lines, and it
holds `adjustment.approve()` — a live ledger posting reached from three
modules (`stock-actions`, `adjustment-actions`, `approval-actions`).

**5. Stock movements.** `app/db/repositories/stockMovements.ts` is complete and
has ZERO CALLERS — `recordMovement`, `attachAccounting`, `reverseMovement`,
`listMovements`. `movement.reverse()` in `integration-actions.js:467` is the
third remaining posting, reached from 10 screens.

### Remaining Mongo ledger postings

TWO now, and `npm run ledger-sweep` is the authority — not a grep:

| Posts | From |
|---|---|
| `adjustment.approve()` | `stock-actions.js:371`, `adjustment-actions.js:210`, `approval-actions.js:457` |
| `movement.reverse()` | `integration-actions.js:467` |

`payment.confirm()` was the third and is gone (§9M). Both callers moved with
it: `payment-actions.js:656` is dead, and `approval-actions.js:505` now calls
`releaseApprovedPaymentPg`.

The sweep also prints three false positives it cannot distinguish — two
`Array.reverse()` and a project budget's `approve()`. It says so in its own
output. Read the lines.

### Ported code deliberately NOT written

- `deletePayment` — the Mongo action deletes DRAFT payments only, and on the
  Postgres layer a draft payment does not survive its own transaction:
  `createPaymentPg` confirms and posts before it returns, and
  `invoice-actions.ts` does the same. Porting it would have produced a function
  no status can reach — `setCheckoutStatusPg`'s trap, walked into knowingly.
  `cancelPaymentPg` is the operation that exists, and it is the right one: a
  payment that reached the ledger is undone by an auditable reversal, not by a
  row disappearing.
- `reconcilePayment` — there are no reconciliation columns on `payments` and no
  screen ever called it. The detail page's "Reconciled" row is now "Cleared",
  read off the status, because a hardcoded "No" is a claim the data cannot
  support. Bank reconciliation is its own unported module.

### Known dead code, left deliberately

- `setCheckoutStatusPg` — no caller, and the Mongo `updateCheckoutStatus` it
  was ported from had none either. `lost` and `damaged` are real states the
  list filters on, so the gap is a missing UI. If no screen wants it, delete
  the action and the two enum values together.
- `getPettyCashExpenseAccountsPg` — no caller. Ported because the Mongo module
  had it; the statement derives spend from expenses, so nothing needs a spend
  picker. Same decision to make.

### Two SQL traps that cost a day between them

**`= ANY(${array}::type[])` NEVER WORKS.** drizzle expands a JS array to a
parameter tuple — `($1, $2)` — and the cast fails with 22P02 "malformed array
literal". It fails inline, nested, through `sql.join`, and for a single-element
array. Use `anyOf()` from `app/db/repositories/sqlHelpers.ts`, which builds
`ARRAY[$1, $2]` from individual params.

It hid behind `if (array.length)` guards at all twelve call sites: the broken
branch is skipped when the filter is empty, and every suite called those list
functions with no filter. 77 tests passed identically before and after the fix.
Meanwhile the dashboard called the broken branch on every load. **Test the
filtered path** — a list function tested only with no arguments exercises the
branch that cannot fail.

**`AFTER UPDATE OF column` fires on what the STATEMENT set**, not on what a
BEFORE trigger changed. The categories path trigger was declared that way and
never fired, so moving a category stranded its entire subtree — the exact bug
the trigger existed to prevent. Use `AFTER UPDATE ... WHEN (NEW.x IS DISTINCT
FROM OLD.x)`.

Both were found by running the code, not by reading it. A migration that
applies cleanly has proved nothing about its triggers.

### Environment, before running anything

- **Wrap EVERY Postgres test run in `caffeinate -i`.** Idle sleep does not
  merely slow a run, it corrupts it: tests report 926-second durations (the
  sleep interval) that the 30-second `testTimeout` never fires on, and a sleep
  mid-transaction splits `TRUNCATE ... CASCADE` from the fixture insert and
  produces duplicate-key failures. Two full suites and one targeted run were
  thrown away to this.
- **One run at a time.** Overlapping runs on `stockvault_test` block each other
  on the `TRUNCATE` in `beforeEach` and time out the 120s hook. A four-file run
  that should take 2 minutes took 55.
- **Restart `next dev` after touching `app/db/schema/`.** Turbopack caches the
  module scope, so adding an import produces `ReferenceError: x is not defined`
  against source that plainly imports it.
