# Building on the Postgres layer

For anyone adding a feature, an endpoint or a page on top of the port. The
migration reasoning lives in `POSTGRES-MIGRATION-PLAN.md`; this is the practical
half — what to call, what not to, and the three things that bite.

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
npm run db:migrate     # applies app/db/migrations in journal order
```

On a brand-new cluster, migration 0023 creates `app_user` as `NOLOGIN` with no
password — inventing a credential is not a migration's job. Once, before the app
boots:

```sql
ALTER ROLE app_user LOGIN PASSWORD '<pass>';
```

`DATABASE_URL` must name that role, never `postgres`: a superuser has BYPASSRLS
and makes every policy in the schema inert. `SELECT assert_rls_effective()`
raises if the current connection would bypass RLS — worth a health check.
