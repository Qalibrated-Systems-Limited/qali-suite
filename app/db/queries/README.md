# `app/db/queries`

Cached, server-only READ modules over Postgres.

Not `app/db/actions` — nothing here is a `"use server"` action. These are
`cache()`-wrapped functions a server component imports directly, so several
Suspense boundaries in one request share a single in-flight promise instead of
each running the query. Putting them behind the Server Action plumbing would
cost that.

Not `app/db/repositories` either — a repository takes a `tx` from
`withTenant()` and knows nothing about sessions or plan gates. These read the
session, check the plan and shape the result for a screen.

The first two arrived here from `app/mongodb/queries/`, where they had stopped
belonging: both read Postgres exclusively and `fleet-insights` still opened a
Mongo connection it never used. The module count called `assets` unported
because of the import path, which is the same thing the global search taught —
a count measures which path a file imports, not which store it reads.
