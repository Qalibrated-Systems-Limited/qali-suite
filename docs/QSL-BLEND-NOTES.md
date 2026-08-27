# Blending the QSL ERP branch — what came across, what didn't, and why

For the conversation with whoever wrote `QaliTrack` / the QSL ERP modules.
Nothing here is a criticism of the work; it is the list of decisions somebody
had to make when the two branches met, so they can be argued with.

**The situation.** The QSL branch forked *before* the Postgres migration. The
two share a lineage but not a base, so this was a blend, not a merge. Of the 76
files that differ, **47 are files the migration branch deleted** — `app/models/*`,
`app/mongodb/actions/*` — not new work. Only 29 are genuinely new.

---

## 1. What came across, unchanged

| | |
|---|---|
| `components/erp-ui.jsx` | the UI kit, verbatim |
| 12 dashboard pages | bids, calibration, compliance, fleet, hse, inspection, inter-company, qms, shop, sops, tasks, workspace |
| 4 nav groups | Technical, Operations, Quality, Pre-Sales & Shop, plus the ungrouped **My Workspace** |
| the theme | all 28 QSL tokens — navy `#1B3A5C`, gold `#C8960C`, off-white `#F0F4F8` |

Both sidebars now carry the same 74 links and every one resolves to a page.

## 2. What did not, and why

**`/dashboard/settings/database`** — imports `@/lib/prisma`. The migration
branch is on Drizzle against Postgres; two ORMs against one database is not
something to carry in silently. The page and its nav entry are the only things
excluded on those grounds.

**`app/api/v1/*`, `app/data/*Repo.js`, `lib/prisma.js`, `lib/integrations/openapi.js`**
— the API layer. Left for the API pass rather than blended half-done.

**`customers-select.jsx` and `Categorymanagement.jsx`** — these look like new
work and are not. Both were deleted by the migration branch; the second in a
commit titled *"a dead component removed"*. Nothing in either tree imports them.

## 3. The theme: the remap is the good idea

Retargeting the whole `yellow-*` scale onto a gold ramp, rather than editing
~350 hard-coded call sites, is the right call and it is what made the blend
cheap. It went in as-is.

But the remap alone was **not** the theme. It moves the yellow *utilities*;
every screen built on semantic tokens (`bg-primary`, `text-foreground`,
`bg-card`) kept reading the old values, so the app stayed white-canvas and
yellow-primary. The token block had to come across too.

One thing worth knowing about `globals.css`: it defines the palette **twice** —
an unlayered `:root`/`.dark` pair, and a second HSL pair inside `@layer base`.
Layered styles lose to unlayered ones, so the unlayered block is the live one
and the HSL block has been dead for a while (its own header says
"Fallback/Legacy"). Only the live block was replaced. If you edit the HSL one
expecting a colour to change, nothing will happen.

The result reaches everything, because almost nothing hard-codes a colour: the
landing page is semantic tokens only, and the login page's `yellow-500` classes
land on the gold via the remap.

## 4. The one thing worth actually discussing: `erp-ui.jsx`

Its own header is explicit — *"self-contained, inline-styled primitives (no
Tailwind, no external deps) so they are immune to erpinventory's own design
tokens"*. Measured:

| | |
|---|---|
| inline `style={{}}` blocks | 43 |
| Tailwind `className` | **0** |
| hardcoded hex colours | 28 |
| `var(--…)` CSS variables | **0** |
| `@media` queries | **0** |
| dark-mode handling | **0** |

and it re-implements **ten** primitives that already exist as shadcn in
`components/ui`: badge, card, button, input, select, dialog, table, tabs,
progress, alert.

The immunity was deliberate and, at fork time, defensible — it guaranteed the
modules looked like the QSL ERP app regardless of what the host app did. Now
that the host app *is* the QSL theme, it costs three things:

1. **No dark mode.** The rest of the dashboard uses 1,597 `dark:` variants.
   These twelve pages hardcode `background: #FFFFFF`, so they stay white slabs
   when everything around them goes dark.
2. **The theme cannot reach them.** They read zero CSS variables, so the gold
   remap and the navy tokens — the thing that just made the whole app look like
   QSL — stop at their edge.
3. **No breakpoints.** Inline styles cannot express them; `maxWidth: 1440` and
   fixed padding, on an otherwise mobile-aware dashboard.

Plus 107 `react/jsx-key` violations in the twelve pages. That is a real rule —
React keys DOM nodes by `key`, so a keyless list carries stale state across a
reorder. It is scoped to a *warning* in `eslint.config.mjs` rather than fixed,
so the code stays theirs and `lint:ci` stays green. The count stays visible.

**The cheap fix, if we want it:** keep the component API exactly — the nine the
pages actually use are `Page`, `SectionHeader`, `StatGrid`, `Stat`, `Tabs`,
`DataTable`, `Badge`, `Btn`, `Alert` — and rebuild the internals on shadcn +
Tailwind. **The twelve pages do not change by a character**, and they gain dark
mode, breakpoints and the theme. Roughly an hour.

## 5. Two things about the branch they should know

**Data.** The migration branch writes Postgres. Their dev Mongo has 30 products;
Postgres has 0. Product screens now read and write Postgres, so the list will
look empty until products are re-entered — there is no backfill, by decision:
this is a fresh deploy and the from-scratch path is what matters.

**Mongo is still there, on purpose.** Unported modules still read Mongo and
should keep doing so until they are ported. One fix went in around that: the
approvals tile called `dbConnect()` as its first line, so an unreachable Atlas
cluster threw before any of the six *Postgres* counts ran and the tile reported
"nothing to approve". The Mongo engine count now owns its own connection and
its own catch — Mongo down costs you that one number, not the other six.

## 6. Where things are

| branch | what |
|---|---|
| `feat/postgres-migration` | the migration, untouched, pushed to `qsl` |
| `geoffrey/qali-erp` | migration + this blend — the one to continue from |
| `feat/qsl-ui-blend` | the blend commits on their own, same tip |
