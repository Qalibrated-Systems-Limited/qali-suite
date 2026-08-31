# Projects — the execution layer, and what the MD is actually asking for

The MD's `project_module_upgrade_v2.md` is twelve phases, and read as a
checklist it is a year of work that mostly duplicates things this system
already has. Read as intent it is four sentences, and they are on its last
page:

> Tasks drive execution · Devices confirm progress · Costs update
> automatically · Billing reflects actual work

Three of those four are complaints about the module that exists, and they are
fair ones:

| what he wrote | what is true today |
|---|---|
| tasks drive execution | there are no tasks. `progressPercent` is typed into a slider. |
| devices confirm progress | nothing links what was installed to what was claimed |
| costs update automatically | they do NOW, since 0070. They did not when he wrote it — the figures read a store nothing writes. |
| billing reflects actual work | `billingModel` offers `milestone` and `time_material`, and there is no milestone and no hour anywhere in the system. Both bill exactly as `fixed` does. |

So the template is not a specification to implement phase by phase. It is a
list of symptoms, and this note is the diagnosis: what to build, what the
industry does about each, and where the MD's instinct is right, where it is
below standard, and where the system already answers him.

---

## 1. Against the industry

| | Procore / Aconex | Candy / CCS, RIB | Odoo / NetSuite / Xero Projects | MD's template | here today |
|---|---|---|---|---|---|
| WBS / tasks | ✅ core | ✅ | ✅ | ✅ phase 2 | ❌ |
| progress from measured work | ✅ from quantities | ✅ from the bill | ⬜ from task state | ❌ typed % | ❌ typed % |
| milestones with value | ✅ | ✅ | ✅ | ✅ phase 2 | ❌ |
| timesheets | ✅ | ✅ | ✅ | ✅ phase 2 | ❌ |
| timesheet posts to the GL | ❌ | ❌ | ❌ | — | — |
| change orders / variations | ✅ | ✅ | partial | ✅ phase 7 | ❌ |
| budget vs actual by account | ⬜ | ✅ | ✅ | ✅ phase 1 | ✅ |
| commitment (approved, unpaid) | ✅ | ✅ | ✅ | ✅ phase 1 | ✅ |
| earned value (CPI/SPI) | ⬜ | ✅ | ❌ | ❌ | ❌ |
| project as a GL dimension | ⬜ | ✅ | ✅ analytic | ❌ | ❌ |

Two readings fall out of that table.

**The MD is asking for the standard thing, and he is right that it is
missing.** Tasks, milestones and timesheets are in every one of those three
product families. Nothing in phases 2, 7 or 8 of his template is exotic.

**Two of his phases are already here and one is a mistake.** Phase 5
(`inventory_movements` per project) exists — stock requests carry a project and
0070 counts them. Phase 4 (procurement) is one nullable column on two tables,
not a subsystem. And phase 1's "financial aggregation" he lists as ✅ done was
the thing reading a dead store.

The mistake is **phase 9's dashboard before phase 2's data**, and more
importantly the thing his template inherits without questioning: **progress as
a number somebody types.** Procore and Candy derive it — 8 of 20 km of subbase
laid is 40%, not "somebody thinks 40%". A typed percentage is how a project
reports 90% complete for four months, and every EOT argument that follows is
had without evidence.

---

## 2. What to build, and the five decisions

### `project_tasks` — the WBS

Parent/child, status, assignee, planned and actual dates, estimated and actual
hours, and a **weight**.

> **Decision 1 — progress is derived where there are tasks, and typed only
> where there are none.**
>
> `projects.progress_percent` stays exactly as it is and stops being the
> answer: it becomes the fallback for a project with no WBS. Where tasks
> exist, progress is their weighted roll-up — weight defaulting to estimated
> hours, and to equal shares when nobody estimated. This is what Procore, MS
> Project and Odoo all do, and it is the one place the MD's template is below
> standard rather than merely absent.
>
> It is deliberately NOT a stored column recomputed by a trigger. Same
> reasoning as the budget total in 0070 decision 5 and the financials in
> decision 1: a rolled-up number with a second copy is a number that will
> disagree with what it rolls up.

### `project_milestones` — and what makes `billingModel` mean something

Name, due date, **value**, status, and a flag for whether it is a payment
milestone or only a progress one.

> **Decision 2 — a milestone carries a value, and the values are checked
> against the contract sum. Warned, never blocked.**
>
> Same principle as the budget: the module warns at 90% and does not stop
> anybody working. A milestone schedule that does not sum to the contract is a
> fact worth surfacing on the page, not a reason to refuse a save.

> **Decision 3 — completing a payment milestone raises a DRAFT invoice, and
> nothing more.**
>
> This is open question 2 in `PROJECTS-QALITRACK-PLAN.md` and the reversible
> half of it is clear: a draft is reviewable, editable and deletable, and it
> makes `billingModel: 'milestone'` mean something for the first time. Whether
> an IPC *becomes* an invoice or mirrors one raised elsewhere is a contracts
> question and stays with the MD.

### `project_timesheets` — and what makes `time_material` mean something

Person, date, task, hours, a billable flag, a cost rate and a bill rate.

> **Decision 4 — a timesheet does NOT post to the ledger.**
>
> This is the one place a reasonable person would go the other way, so it is
> worth the sentence. Odoo, NetSuite OpenAir and Procore all treat a timesheet
> as an ANALYTIC record: it produces project cost and drives T&M billing, and
> the general ledger receives labour through PAYROLL, once, where the PAYE and
> NSSF are. Posting the timesheet as well books the same wage twice — in a
> system that already has a payroll module posting real entries.
>
> It is the same rule 0070 was built on and the original design stated:
> transactions own financial truth, projects aggregate. A timesheet is not a
> transaction.

### `project_change_orders` — the variation register

Number, description, cost impact, time impact, status.

> **Decision 5 — an approved change order moves the contract value and the end
> date, and the originals are kept.**
>
> Without this `contract_value` is a lie from the first variation, and the
> `contractValue` on a project today has nothing that can ever change it.
> Keeping `original_contract_value` beside the current one is what makes the
> variance answerable — which is the entire point of a variation register in
> Procore and under FIDIC clause 13.

### And the MD's "devices confirm progress"

He means an installed device closing out the work claimed for it. This system
does not need a `project_assets` table to answer that: it already issues
serialised stock against a project through `stock_requests` and
`item_checkouts`. What is missing is one nullable `task_id` on the request, so
that the stock issued for a task is the evidence the task was done — which is
the same idea as his phase 3 and phase 5, using the two tables that already
carry the data.

---

## 3. What NOT to build, and why

| his phase | verdict |
|---|---|
| 3 — `project_assets` / `asset_logs` | the fixed asset register (0056) and `stock_movements` already hold this. One `task_id` column, not two tables. |
| 4 — procurement | `purchase_orders` and `quotes` each need ONE nullable `project_id`. Both are on the module's own gap list. |
| 5 — inventory movements | done, 0070. Stock requests carry a project and are split into issued cost and outstanding commitment. |
| 6 — parent rollup | a recursive query, no schema. Worth doing with tasks. |
| 9 — dashboard | falls out of the above; not a thing to design first. |
| 10 — project-level roles | real work, and a change to `withAuthorizedTenant` rather than to projects. Not now. |
| 11 — automation rules | a rules engine is a product. No. |
| 12 — documents | ~~needs blob storage, which nothing in this app has yet~~ — **WRONG, corrected 2026-08-31.** `lib/cloudinary.js` and `app/api/upload/route.js` have been there throughout and are used by expenses, claims and `employee_documents`. See `PROJECTS-QALITRACK-PLAN.md` §10.5. |

And, separately from his list: **earned value** (PV, EV, AC, CPI, SPI) is
free once milestones carry value and tasks carry weight — it is a read, not a
table — and it is what Candy gives a QS. Worth adding when the tables exist.

---

## 4. Sequence

1. ~~`project_tasks` with weighted roll-up, and `progress_percent` demoted to a
   fallback.~~ **Done — migration 0071.** The table, the repository, the
   actions, the WBS card on the detail page, and 26 tests. `progress.source`
   tells a screen whether the number was earned or asserted.
2. `project_milestones`, and milestone → draft invoice.
3. `project_change_orders`, contract value and end date moving with them.
4. `project_timesheets`, feeding project labour cost and T&M billing.
5. `project_id` on `purchase_orders` and `quotes`; `task_id` on
   `stock_requests`. One migration, three columns, four gaps closed.
6. Earned value on the detail page.
7. The cost-code management screen, which has never existed in either store.

`contracts` — notices, IPCs, retention, the site diary — remains a separate
product and a separate decision. See `PROJECTS-QALITRACK-PLAN.md` §5.

---

**Amended 2026-08-31 — the BOQ arrived, and it lands above step 2 of this
list.** `PROJECTS-QALITRACK-PLAN.md` §8 answers that document's §6.4: quantities
ARE measured against a bill, so migration 0076 built one — and it finishes what
step 1 above could only half-do. Decision 1 here demoted `progress_percent` to
the fallback for a project with no WBS, and 0071 delivered that; but a weighted
roll-up of tasks is a careful OPINION, because every leaf percentage in it was
still typed by a person. `progress.source` now returns `measured` where a bill
has been awarded and measured against, and it outranks `tasks` and `typed`.

Two consequences for the list above:

- **Milestones (step 2) keep their value and their draft invoice**, unchanged.
  What changes is that on a project with a bill, milestone completion is
  evidence rather than the valuation — the bill is.
- **Earned value (step 6) is now the real thing** rather than a proxy. EV is
  measured work at billed rates, which is exactly what the bill sums.
