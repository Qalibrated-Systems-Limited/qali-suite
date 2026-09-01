# Projects — QaliTrack, and what to build

The MD produced a working HTML prototype, `QaliTrack_PMS`, and it is not a
sketch of the projects module we have. It is a **road construction contract
administration system**, which is a different thing built on top of one.

This note compares the three: what the prototype specifies, what the codebase
already has, and what the industry does. It exists so the porting decision is
made once, in writing, rather than discovered halfway through.

---

## 1. What the prototype actually is

Ten modules, gated by four roles (`admin`, `pm`, `site`, `view`):

| module | what it holds |
|---|---|
| dashboard | contract value, certified to date, AP balance, retention held |
| milestones | 25 milestones across 7 phases, each with % progress, a responsible role, and a `contractual` flag |
| programme | Gantt of activities by phase |
| ei | Engineer's Instructions — GCC clause, chainage, Instruction/NCR |
| diary | Contractor's Site Diary — daily weather, chainage, activities, plant, labour, photos |
| forms | a register of 16 contract forms, each with "when to use" |
| ipc | Interim Payment Certificates — the money |
| cash | cash requisitions against the project |
| mpr | Monthly Progress Report, with a submission checklist |
| users | the role permission matrix |

The sample project is RWC 772 (Otho–Got Kachola Road, KeRRA, KES 1.435bn) with
a second for KeNHA. The phases — Mobilisation, Earthworks, Drainage, Pavement,
Finishing, Completion, DLP — are road-works phases, not generic project stages.

**The three critical forms are time-barred**, and this is the single most
valuable idea in the prototype:

| form | deadline |
|---|---|
| AR — Accident Report | within 24 hours of the incident |
| EOT — Extension of Time Notice | within **28 days** of the delay event |
| CCN — Contractor's Claim Notice | within **28 days** of the cost event |

Under FIDIC-family conditions a late notice does not weaken a claim, it
**extinguishes** it. A system that reliably surfaces "day 21 of 28" is worth
more than every dashboard in this repo put together, and nothing we have does
it.

## 2. The IPC is the part that touches the ledger

The prototype states the payment certificate arithmetic explicitly:

```
Gross certified (pre-VAT)
  + VAT at 16%
  − Retention at 10%
  − Advance payment recovery
  − VAT withholding at 2%      (client withholds, remits to KRA)
  − Withholding tax at 3%
  = Net payable
```

with the note: *"Tax Invoice = Gross Certified × 1.16. KeRRA withholds 2% of
gross certified → remits to KRA. You pay the remaining 14% via VAT return."*

That is the standard Kenyan public-works certificate, and every line of it has
a home in the ledger we have already built:

| certificate line | where it already lives |
|---|---|
| gross certified | revenue, via an invoice |
| VAT 16% | `vat_output`, and `tax_transactions` |
| retention 10% | a **receivable held back** — contra-asset, released per the DLP milestones |
| AP recovery | reduces the advance **liability** taken at mobilisation |
| VAT withholding 2% | a tax credit receivable — the WHT machinery exists |
| WHT 3% | same |

Retention is the one that needs a decision. The milestones already encode the
release rule — *50% released on TOC, the remainder on DLC* — so retention is
not a number on a certificate, it is a balance with a release schedule.

## 3. What the codebase has now

`app/models/project.js`, still on Mongo, 11 screens:

- `projectNumber`, `name`, `client`, `description`, `status`, `tags`
- `contractValue`, `progressPercent`, `startDate`, `endDate`, `actualEndDate`
- `budget { amount, currency }`
- `financials { totalRevenue, totalCosts, totalCommitted }` — **cached**, updated
  on transaction post

And, importantly, projects are ALREADY a cost dimension elsewhere on Postgres:

- `employee_claims` carries `project_id`, `project_number`, `project_name`,
  `cost_code_id`, `cost_code_code`, `cost_code_name`
- `stock_requests` carries `project_number_at_request`, `project_name_at_request`,
  `cost_code_at_request`

So the spine — project as a cost centre with cost codes, referenced by claims
and stock issues — exists. What is missing is everything contractual.

**The cached `financials` should not survive the port.** It is the same pattern
as `products.quantityAvailable` and `parties.cachedBalance`: a stored number
that can disagree with the ledger it summarises. Project revenue and cost are a
`journal_lines` query filtered by project, exactly as the statements became.

## 4. Against the industry

The prototype is closer to standard practice than the module it would replace.

- **Procore, Aconex, RIB CX** are built around exactly these registers — RFI,
  variation/EI, NCR, submittals, daily diary — because those registers *are*
  contract administration.
- **Candy / CCS** and **RIB BuildSmart** do the valuation side: measured work,
  IPC, retention, advance recovery.
- **Odoo, NetSuite, Xero Projects** do what our current module does — a project
  as a cost centre with a budget and a P&L. None of them do EOT notices,
  chainage, or a site diary, and none of them pretend to.

The honest reading: **these are two products.** A general ERP project (cost
centre, budget, profitability) and a construction contract administration
system share a `project` record and almost nothing else.

Two things in the prototype are below industry standard and should not be
copied as they stand:

1. **Progress is a typed-in percentage.** Procore and Candy derive it from
   measured quantities against the bill — 8 of 20 km of subbase laid is 40%,
   not "somebody thinks 40%". Typed percentages are how a project reports 90%
   complete for four months. Milestone progress should roll up from measured
   work where a quantity exists.
2. **The Gantt has no dependencies.** `GANTT_ACTS` is start/end months per
   activity with no predecessor links, so nothing moves when an activity slips
   and there is no critical path. Without dependencies it is a picture of a
   programme, not a programme — and an EOT claim is argued on the critical
   path.

## 5. Recommendation

**Build it as its own module, `contracts`, keeping `projects` as the cost
centre it already is.**

- `projects` ports as-is: the cost dimension claims and stock requests already
  reference, with `financials` dropped in favour of a ledger query. Small, and
  it unblocks the trailing `projectQueries` reads in claims, invoices, bills,
  requests and expenses.
- `contracts` is new: contract sum, advance, retention terms, phases,
  milestones, the registers (EI/VO/NCR/RFI), the site diary, IPCs, and the
  notice deadlines. It references a project; it does not replace one.

Sequence, highest value first:

1. **Port `projects`** — unblocks five modules. Do this first regardless of
   what happens to the rest.
2. **The notice register with deadlines** — AR/EOT/CCN, with the 24-hour and
   28-day clocks and an alert before expiry. Smallest build, largest
   consequence of not having it.
3. **IPC and retention** — the money. Slots into invoicing, VAT and WHT that
   already exist; retention needs a balance and a release schedule tied to the
   TOC and DLC milestones.
4. **Milestones and phases** — with progress rolled up from measured work
   rather than typed, wherever a quantity exists.
5. **Site diary and the form register** — high volume, low complexity, and the
   evidence base for every claim above. ~~Photos need blob storage.~~ They need
   the upload path that already exists — see §10.5.
6. **Programme/Gantt** — last, and only with dependencies and a critical path.
   Without those it is a drawing.

## 6. Open questions for the MD

1. Is QaliTrack for **our own** contracts, or a product sold to other
   contractors? That decides whether it is a module here or its own tenant-facing
   application.
2. Does an IPC **become** an invoice in this system, or mirror one raised
   elsewhere? If it becomes one, the certificate is the source document and
   invoicing needs to accept it.
3. Retention: one policy per contract, or per certificate? The prototype
   assumes a flat 10% with a 50/50 TOC/DLC release.
4. Are quantities measured against a **bill of quantities**? If yes, the BOQ is
   the missing table and progress derives from it. If no, progress stays typed
   and the limitation above stands.
5. How many concurrent contracts, and how many site staff filing daily diaries?
   It decides whether the diary is a form or an offline-capable mobile surface.

---

## 7. Addendum — 2026-08-31: what the merge landed, and the type enum

Section 6 asked five questions. The first is now answered, and it decides the
rest.

### 6.1 answered: it is a PRODUCT, so it must be flexible

**QaliTrack is not for our own contracts alone — this application is
multi-tenant.** Other contractors will run their own jobs in it, on their own
contract terms. Two consequences, and both are design constraints rather than
preferences:

- **Nothing about a contract may be hardcoded.** Retention percentage, its cap,
  advance percentage and recovery rule, the DLP length — all per contract. One
  tenant runs 10% capped at 5% with a 12-month DLP; the next runs 5% with six
  months. Answering 6.3 the same way: **one policy per contract.**
- **The module must serve natures of work we do not do.** A tenant doing pure
  supply, or consultancy, should not meet a site diary — and we cannot enumerate
  their business in advance.

And QSL itself runs at least two shapes: **a lot of construction jobs**, and
plant installation (weighbridges, electrical). So this is not a choice between
FIDIC machinery and a simpler milestone flow. It is both, in one module.

### What the merge actually built, against §5's own sequence

Zawadi's `feat/projects-module-dropdown` merged on 2026-08-31: two new tables
(`project_instructions`, `project_diary_entries`), a project-scoped workspace
with a switcher, and eight sections. It is careful work — RLS forced, correct
grants, CHECK constraints that refuse a status flip with nobody attached, and a
sign-off role that narrows the manage role with a cited precedent.

But set against §5's sequence, it built the bottom of the list:

| §5 rank | item | status after the merge |
|---|---|---|
| 1 | port `projects` | done earlier (0070) |
| 2 | **notice register with deadlines** | **NOT built** — see below |
| 3 | **IPC and retention** | **NOT built** — a view over invoices |
| 4 | milestones, progress from measured work | a view; progress still typed |
| 5 | site diary and form register | **built** |
| 6 | programme / Gantt | **built, without dependencies** |

Two of those need naming plainly, because §4 warned about both:

- **The registers have no clocks.** `project_instructions` carries EI, VO, NCR
  and RFI-response, which is the register §5 step 2 asked for — but with no
  deadline, no expiry and no alert. §5 called that step "the smallest build,
  largest consequence of not having it", and the consequence is the 24-hour and
  28-day FIDIC notice clocks. The register records that an instruction exists;
  it cannot tell you a notice is about to expire.
- **The programme has no dependencies.** §4.2 said without predecessor links it
  is "a picture of a programme, not a programme", and that an EOT claim is
  argued on the critical path. The merged page is that picture.

Neither is a defect in what was built. They are the difference between the
records and the contract administration.

### The decision: a project TYPE, and sections that follow it

`billing_model` (`fixed | milestone | time_material`) already says HOW a project
is paid. It does not say WHAT KIND of work it is, and that is what decides which
sections make sense. A weighbridge installation and a road are both `milestone`
and `measured` respectively, but a supply-only job is neither.

So `projects.type`, set at creation:

| type | what it is | typical billing |
|---|---|---|
| `construction` | civil / building works | measured, certified monthly |
| `installation` | plant, weighbridge, electrical | milestone — payment on delivery and acceptance stages |
| `maintenance` | recurring service agreement | periodic |
| `supply` | goods only | on delivery |
| `consultancy` | design, advisory | time and material |
| `internal` | own capex, R&D | none |

**Sections become conditional on it.** This is the whole point of the enum — the
module shapes itself rather than showing every tenant every page:

| section | constr | install | maint | supply | consult | internal |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Budget / cost codes | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Milestones / programme | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| Site diary | ✓ | ✓ | — | — | — | — |
| Instructions / VOs / notices | ✓ | ✓ | — | — | — | — |
| **Certificates** | ✓ | ✓ | — | — | — | — |
| **Retention** | ✓ | ✓ | — | — | — | — |
| **Advance + recovery** | ✓ | ✓ | ✓ | — | ✓ | — |
| Acceptance (FAT/SAT/calibration) | — | ✓ | — | — | — | — |
| Recurring billing | — | — | ✓ | — | — | — |

A default is offered per type and every section stays overridable, because a
tenant will always have a job that breaks the pattern. **The type chooses
defaults; it does not lock anything.**

### Present practice is not the specification

A caution on how this document was written, because it nearly went wrong.

Several of the shapes described here came from what QSL has been seen to do —
"a weighbridge is usually 50% advance and 50% on completion, with no
retention". That is a real observation and a useful one, and it is **not the
standard**. It is what one contractor arrived at without a guide to work from.

Encoding it would bake today's habit into a product other contractors use, and
would be exactly the wrong direction: a tenant running a properly administered
installation contract would find the system had decided on their behalf that
installations do not hold retention.

So: **the industry standard sets the mechanism; the tenant's contract sets the
values.** Defaults offered on a form are suggestions to be overridden, never
rules. Where this document names a percentage or a payment split, read it as an
illustration of the arithmetic, not as a term to implement.

The one place practice legitimately decides the design is **which sections a
project shows** — a supply-only job has no site diary, and no standard says it
should. That is what the type enum is for, and it is why the enum is necessary
rather than merely convenient.

### THE RULES DO NOT VARY BY TYPE — only the shape does

An earlier draft of this section had an installation job skipping retention and
running a "simplified" two-payment flow. **That is wrong and is corrected here.**

A weighbridge installation is a contract like any other: it is administered
under FIDIC (Yellow Book, plant and design-build, rather than the Red Book a
road uses), and every mechanism applies — certificates, retention, advance
recovery, variations, notices, taking-over, defects liability. Building a
shortcut path for "small" jobs would mean two engines to keep correct, and the
one used less often would be the one that quietly drifts.

**What varies is the SHAPE of the contract, not which rules govern it:**

| | drives |
|---|---|
| **size** | how many certificates, and whether retention reaches its cap |
| **period** | certificate frequency — monthly on a two-year road, per milestone on a three-month install |
| **nature** | the valuation source (measured vs milestone) and which evidence sections appear |

So a 50/50 weighbridge job is not "the flow without retention". It is a contract
whose terms happen to be two milestones, whose retention percentage may be set
to zero **on that contract**, and whose DLP is short. The engine is identical;
the row in `contracts` differs. A tenant who does hold retention on installs —
and many do — changes one field, not a code path.

This is also what the mature systems do. Candy, RIB BuildSmart and CMiC run one
valuation-and-certification engine and vary it by contract terms; none ships a
"small job" mode. Procore's payment applications work the same way whether the
job is a tower or a fit-out.

### One mechanism for certificates, two valuation sources

Do NOT build an IPC module and a completion-certificate module. A certificate is
one record either way:

```
  work done to date          ← valuation source
– previously certified
= value this period
– retention this period
– advance recovery
= net certified
```

What differs is only where "work done to date" comes from:

- `construction` → **measured** work (remeasure against a BOQ where one exists —
  §6.4 is ANSWERED in §8: there is a BOQ, and it is the measured source)
- `installation` → **milestone achieved**, yes or no

A 50/50 weighbridge job is then two certificates with a milestone source — the
same table, the same retention and advance machinery, and terms that happen to
say two milestones rather than twenty-four months.

### What installation needs that construction does not

A weighbridge is a legal-for-trade instrument: in Kenya it must be verified and
stamped by Weights and Measures before it can lawfully issue a ticket. So an
installation carries acceptance evidence a road never does — FAT, SAT,
**calibration certificate**, commissioning, operator training, and the serial
numbers of the load cells and indicator.

These are **milestones with evidence attached**, not a new subsystem:
`project_tasks` plus a document reference.

And one join is missing that closes a loop QSL owns end to end: `assets` has no
`project_id`, so the weighbridge an installation project builds cannot point at
the job that built it — nor forward to the `weighbridge_tickets` it will later
issue. Install → asset → operating revenue, in one chain.

### Revised sequence

1. **`projects.type`** — cheap now, expensive later, because every section gate
   and every certificate default hangs off it.
2. **`contracts`** — sum, advance terms, retention terms, DLP. Per contract,
   never per tenant. Nothing below this is buildable without it.
3. **Variations reach the contract sum.** `project_instructions.estimated_cost`
   currently feeds nothing, so the register says the scope grew and the contract
   value does not move. Cheapest real fix on the board.
4. **Certificates** — one table, two valuation sources, replacing the IPC and
   Cash Requisitions pages, which today run the identical query under two names.
5. **Retention** — a balance with a release schedule tied to the TOC and DLC
   milestones, plus `1250 Retention Receivable` (does not exist in the chart).
   Applies to every contract type that has a contract; the percentage may be
   zero on a given job, which is a term, not a code path.
6. **Notice deadlines** on the register — the 24-hour and 28-day clocks §5
   ranked second and the merge did not build.
7. **Acceptance records** for installation, and `assets.project_id`.
8. **Maintenance contracts** — recurring billing. There is none in the
   application at all; CURRENT-STATE lists it as the #2 missing item and calls
   the manual re-keying "the #1 finance staff grind".
9. **Programme dependencies** — only with predecessors and a critical path.

### Still open

**These are decided BEFORE step 1, not during it.** Each one changes the shape
of what gets built, and two of them are not the porter's to settle alone.

**Four now, not five — number 2 is answered in §8**, and the sequence in §8
supersedes the one above it.

**1. IPC and Cash Requisitions — one section or two? — ANSWERED by §11: TWO.**

Building the certificate settled it. It needed contract terms, a cumulative
chain and a freeze on issue, and a cash requisition wants none of those: an IPC
is EXTERNAL and a valuation, a requisition is INTERNAL and a forecast. The IPC
page is now the certificate register; Cash Requisitions is untouched and is the
next thing that deserves a record of its own. The original question, as it
stood:

They are today two nav entries running the identical pair of queries —
`getProjectTransactions` + `getProjectFinancialSummary` — each carrying a banner
admitting it is not the document its name implies. Step 4 assumes they collapse
into one certificate section driven by contract type.

That assumption is NOT a review finding and must not be actioned as one. They
were built deliberately by somebody who may have had a reason not visible in the
code — in real practice an IPC (what the client certifies and pays) and a cash
requisition (what a site asks head office to fund) ARE different documents
serving different readers, even though neither exists as a record here yet.

So the question is genuinely open: are they one record with two views, two
records, or one section until a second earns its place? **Ask the author before
building over it.** Nothing in the sequence proceeds correctly until this is
settled, because step 4 either replaces two pages or extends one.

**2. Is there a bill of quantities? — ANSWERED, see §8.**

There is, and it is the spine. §8 is the table, the five decisions and the
place it takes in the sequence — at 2, ahead of `contracts`, because it depends
on nothing but `projects` and it is the only item on the list that fixes a
defect the module has TODAY. Progress stops being typed.

**3. The type enum's values — ANSWERED by §9.1 and BUILT in 0078: it is a
LOOKUP TABLE, not a `pgEnum`, seeded with the six and extensible per tenant.**

`construction | installation | maintenance | supply | consultancy | internal`
are the six to seed. The question this raised — a manufacturer or a logistics
firm needing a value none of those covers — is not answered by picking better
values, because a `pgEnum` is a migration to change and this application is
multi-tenant. A seeded lookup table costs the same and needs no deploy per
tenant. What remains open is only which six to seed, which is a smaller
question.

**4. Where the notice clocks belong.** `project_instructions` already carries
EI, VO, NCR and RFI-response with no deadline field. The 24-hour and 28-day
FIDIC clocks either extend that table or need a separate notice register. The
author of that table should have the view.

§9.3 raises the stakes on this one: the register needs the SERVICE TRAIL — who
was notified, by what medium, the acknowledgement, and the chain from notice to
particulars to determination — not only a deadline. That is more than a column
on `project_instructions`, and it argues for the separate register.

**5. Default retention on an installation contract** — what percentage the form
pre-fills. Not whether the mechanism exists: it does, for every contract type.
Only what is suggested before the user overrides it.


- ~~**§6.4: is there a bill of quantities?**~~ **Answered — §8.** There is one,
  it is a table, and measured progress derives from it.
- **Default retention on an installation job** — what percentage to pre-fill
  for a new `installation` contract. Not whether the mechanism exists: it does,
  for every type. Only what the form suggests before the user overrides it.
- **Where the completion certificate sits for a two-payment job** — one
  certificate at the end, or one per milestone including the advance.

---

## 8. 6.4 answered — there IS a bill of quantities, and it is the spine

§6.4 asked whether quantities are measured against a BOQ, and said that if they
are, "the BOQ is the missing table and progress derives from it". They are. So
this section is the table, and what falls out of it.

It answers the second of §7's five blocking decisions. The other four stand.

### Why this is the most valuable thing on the list

§4.1 named typed progress as the module's worst defect — "how a project reports
90% complete for four months, and every EOT argument that follows is had
without evidence" — and 0071 could only half-fix it. A weighted roll-up of
tasks is still somebody's opinion of each task, rolled up carefully.

**A BOQ is the first thing in this module that makes progress a measurement
rather than an assertion.** 8 of 20 km of subbase laid is 40%, and it is 40%
because 8 km was measured, not because it was typed.

It also needs nothing that does not exist. A BOQ hangs off `projects`. That
makes it buildable BEFORE `contracts`, and it is the reason the sequence below
moves it up.

### Against the industry

| | what the priced work is called | how a valuation is made |
|---|---|---|
| Candy / CCS, RIB BuildSmart | bill of quantities | remeasure: quantity this period × rate |
| Procore, Autodesk Build | schedule of values (AIA G702/G703) | % complete per SOV line × scheduled value |
| CMiC, Viewpoint | SOV over cost codes | as Procore |
| Odoo, NetSuite, Xero Projects | — none | task state, or a sales-order line |
| here today | — none | a typed percentage |

Two families, and the important observation is that **they are the same table.**
A schedule-of-values line is a BOQ item whose unit is `sum`, whose quantity is
1, and which is measured as a percentage rather than a count. A remeasured road
and a lump-sum weighbridge differ in how much of the same structure they use.

That is the same conclusion §7 reached about certificates, for the same reason:
one engine, varied by contract, and no "simplified" second path to drift.

### The tables

**`project_boq_items`** — an ltree tree, like `project_tasks` (0071) and
`categories` (0062). A bill of quantities is hierarchically numbered — bill,
section, sub-section, item — and the figures a QS reads are the section totals,
which are roll-ups of the leaves. The house has built this shape twice; this is
the third and it should look like the other two.

    item_code        the BOQ reference as printed — "B.2.14"
    description
    is_heading       a section that carries no quantity of its own
    unit             m, m2, m3, kg, no, sum, item, prov_sum
    quantity         the billed quantity
    rate             money
    amount           GENERATED: quantity * rate
    cost_code_id     nullable — what the earned value charges
    task_id          nullable — the WBS activity this item measures

**`project_boq_measurements`** — one row per measurement event, never a running
total:

    boq_item_id, measured_on, quantity, reference (sheet / chainage /
    location), measured_by, and the certificate it was taken up in.

### The five decisions

> **Decision 1 — quantity to date is a SUM, never a column.**
>
> The same rule as the budget total in 0070 decision 5, the financials in
> decision 1, and the task roll-up in 0071 decision 1: a rolled-up number with
> a second copy is a number that will disagree with what it rolls up. A
> remeasured quantity that can be typed over is a final account nobody can
> defend.

> **Decision 2 — `amount` is generated from quantity × rate.**
>
> A bill where the extension does not equal quantity × rate is the oldest error
> in the trade, and it is arithmetic, so the database does it. `bills.total`
> and `expenses.total` are already generated for the same reason.

> **Decision 3 — a rate is frozen once the bill is awarded, and a variation
> issues a NEW item or a NEW rate. It never edits the priced one.**
>
> This is what makes the final account answerable — the same reasoning as
> `original_contract_value` beside the current one in the execution layer's
> decision 5, and the same reasoning as every `*_at_*` snapshot column in this
> schema. The BOQ therefore carries a status (`draft → priced → awarded`), and
> `awarded` is what freezes it. It does NOT need `contracts` to exist first;
> when `contracts` lands it supplies the award date rather than the concept.

> **Decision 4 — the BOQ does not replace the WBS. One nullable `task_id`
> joins them.**
>
> They answer different questions and both are standard: the programme is the
> PLAN (what happens when, what is on the critical path), the bill is the
> MEASUREMENT (what was done, what it is worth). Procore, Candy and MS Project
> all keep both. Where an item names a task, that task's progress becomes
> measured — earned from quantity — and 0071's `progress.source` gains a third
> value, `measured`, ranking above `tasks` and `typed`. Where it does not, the
> task keeps its weighted roll-up. Nothing regresses.

> **Decision 5 — the BOQ is OPTIONAL, and its presence is what makes a project
> measured.**
>
> §7 settled that the rules do not vary by type, only the shape does, and this
> is that principle applied. A project with a priced BOQ values by measurement;
> one without values by milestone. `construction` will usually have one and
> `installation` usually will not, but neither is a code path — a supply
> contract with a priced schedule is measured, and a construction job let as a
> lump sum is not.

### What falls out, free

- **`work done to date` for a certificate** — §7's arithmetic needs exactly one
  number it does not have, and this is it: Σ(measured quantity × rate) at the
  valuation date.
- **Earned value.** The execution layer noted CPI/SPI is "a read, not a table"
  once tasks carry weight and milestones carry value. With a priced BOQ it is
  the real thing rather than a proxy, because EV is measured work at billed
  rates, which is what this sums.
- **Budget versus actual gains its missing half.** `getProjectBudgetVsActual`
  compares committed and spent against the budget. The BOQ adds what was EARNED
  against the same cost codes — the third column, and the only one that says
  whether the job is making money.
- **The contract sum is checkable.** For a remeasured contract the priced BOQ
  total IS the contract sum. Where `contracts` later carries its own figure and
  the two disagree, the module WARNS and does not block — the budget rule and
  the milestone rule, unchanged.

### What this deliberately does not decide

**The method of measurement is the tenant's, not ours.** CESMM4, SMM7, POMI and
the various national standards each define units and how an item is measured,
and they are not interchangeable. It is a field on the bill, offered as a list
and overridable — never a rule in the code. This is §7's "observed practice is
not the specification" applied to the one place it would be easiest to get
wrong, because whichever standard our own bills happen to use would look like
the obvious default.

**Clause references and any percentage in this section are illustrations.** The
mechanism — remeasurement, extension, section roll-up, rate freezing — is
standard and is what is being built. Specific clause numbers and any figure
that would become a form's default must be checked against a real contract the
tenant holds before they are encoded. Carried forward from the 2026-08-31
handoff note, and it applies here more than anywhere: a BOQ is where a wrong
default becomes a wrong valuation.

### Revised sequence — BOQ enters at 2

*Amended by §9. Step 1 is a lookup table rather than an enum; step 3 carries a
retention direction; step 5 gains two valuation lines.*

1. **`projects.type`** — a LOOKUP TABLE (§9.1), not a `pgEnum`. Cheap now,
   expensive later.
2. **`project_boq_items` + `project_boq_measurements`.** Moved ahead of
   `contracts` because it depends on nothing but `projects`, and because it is
   the one item on this list that fixes a defect the module has TODAY rather
   than adding administration it does not yet do.
3. **`contracts`** — sum, advance terms, retention terms, DLP. Supplies the
   award date the BOQ freezes against.
4. **Variations reach the contract sum** — and, with a BOQ, issue their own
   items and rates rather than only moving a total.
5. **Certificates** — one table, two valuation sources. The measured source is
   now real.
6. **Retention.** 7. **Notice deadlines.** 8. **Acceptance records and
   `assets.project_id`.** 9. **Maintenance / recurring billing.**
   10. **Programme dependencies.**

---

## 9. Review — 2026-08-31: five things this document was missing

A review of §§7–8 against the industry, from someone who has administered these
contracts. The verdict on the mechanisms was that they are standard and in
places more disciplined than the ERPs named — retention as a term rather than a
code branch, measured progress from a bill, quantity-to-date as a sum, frozen
rates with variations issuing new items, are all what the QS-grade tools
enforce. **And the gaps were real.** Five of them, recorded here as findings
rather than folded silently into the sections above, because each one arrived
from experience this document did not have.

Two are ahead of where a tenant would otherwise be, and worth stating so the
comparison is not lost: **stock Odoo has no retention field at all.** Its
documented workaround is a payment term of 90% now and the balance in six or
twelve months, which is not retention — it does not accumulate, it does not
release against a taking-over certificate, and it cannot be reported as a
balance. A retention receivable with a TOC/DLC release schedule puts this above
stock Odoo rather than catching up to it. Ledger-derived project P&L, likewise,
is what NetSuite and Odoo's analytic accounting do; the cached `financials` that
0070 removed was the thing to get rid of.

### 9.1 The type enum should be a LOOKUP TABLE, not a Postgres enum

**This changes step 1, and it is the one to act on before anything is built.**

§7 already said the enum's values are an open question "for tenants we have not
met", and then specified an enum anyway. Those two positions do not survive
together: a `pgEnum` is a migration to change, and a multi-tenant product whose
own document admits it cannot enumerate its tenants' business should not need a
deploy to add `logistics`.

A lookup table seeded with the six costs the same and needs no migration per
tenant. The section matrix in §7 then hangs off a row rather than a literal.

**Where this does NOT apply:** the enums that encode a MECHANISM this system
owns — `project_boq_status`, `project_task_status`, `project_instruction_status`
— are correctly enums. Their values are the state machine, and adding one is a
change to how the software works, which is exactly when a migration is right.
The distinction is whether the tenant or the product owns the vocabulary.

### 9.2 Subcontract retention — `contracts` needs a DIRECTION from the start

Absent from §7 entirely, and the review is right that it is structural rather
than an addition: a main contractor holds retention on its subcontractors
mirroring what the employer holds on it, back to back. Candy, Viewpoint, CMiC
and the Odoo construction add-ons all run retention on the purchase side for
this reason.

**So `contracts` carries a direction — receivable (we are the contractor) or
payable (we are the employer) — from step 3, not discovered at step 6.** The
arithmetic is the same engine pointed the other way, which is the §7 principle
again; what changes is which ledger account the retention sits in, and
`1250 Retention Receivable` acquires a payable sibling.

Getting this wrong is expensive in a specific way: retrofitting a direction onto
a table that assumed one means every existing row needs a value and every query
needs a filter it did not have.

### 9.3 The notice register needs the EVIDENTIARY TRAIL, not just a clock

§7 step 6 is "the 24-hour and 28-day clocks". That is step one of the register
and not the whole of it. Aconex and Procore track who was notified, **by what
medium**, the acknowledgement, and the chain from notice → particulars →
determination.

The reason is what the register is FOR. A deadline with an alert stops a notice
being late. **What wins the claim is proving the notice was served** — and under
FIDIC the particulars follow the notice on their own clock, so a register that
records only the first document loses the thread at exactly the point the
argument gets serious.

### 9.4 A certificate needs MATERIALS ON SITE and DAYWORKS as valuation lines

The arithmetic in §7 has one valuation source and no slot for either, and both
are standard on an interim certificate:

- **materials on site** — delivered, not yet built in, certified at a
  percentage and recovered as the work is done. It is NOT a bill item and
  cannot be one: nothing has been measured.
- **dayworks** — work done on a daywork basis at scheduled rates rather than
  measured against a bill item.

Cheap to add to the certificate table now, awkward after certificates exist and
have rows. **Note that the BOQ needs nothing for dayworks** — a daywork schedule
is a section of the bill like any other, and 0076's tree already holds it. It is
the certificate that needs the line.

### 9.5 IPC and cash requisition: expect TWO records, and still ask

§7's blocking decision 1 left this genuinely open and said to ask the author.
The review's answer is the industry's: they are different documents. **An IPC is
external** — contractor → engineer → employer, and it is a valuation. **A cash
requisition is internal** — site → head office — and in most contractors it is a
FORECAST driven by the programme, not a certificate of anything.

That reframes the question rather than closing it. If the cash requisition is a
forecast, it is not a second view of the certificate and it is not a small
version of one: it is a different table with a different purpose, and step 4
extends one page rather than replacing two. **The question stays open and the
author still decides** — what changes is that the assumption in step 4 should
now be that they do NOT collapse.

### What this section changes

| | was | now |
|---|---|---|
| step 1 | `projects.type` as a pgEnum | a lookup table, seeded with the six |
| step 3 | `contracts` | with a retention DIRECTION, receivable and payable |
| step 5 | certificates: one valuation source | plus materials-on-site and daywork lines |
| step 6 | notice deadlines | deadlines AND the service/acknowledgement trail |
| open 1 | assumed IPC and cash requisition collapse | assume they do not; the author still decides |

Nothing here changes 0076. The bill of quantities is unaffected by all five —
which is a small piece of evidence for having built it first.

---

## 10. Scope review — against SAP, and against ourselves

The question: measured against what SAP and its peers offer, where is this
module doing too much, and where is it genuinely short — given the goal is a
module that is FIRST in its market and small enough that somebody can pick it up
and use it.

The answer in one line: **the overkill is not in the schema, it is in the
navigation** — ten sections of which five own no records — **and the shortfall is
one architectural gap that everything else is downstream of: the project is not
a dimension on the ledger.**

A note on the comparison. SAP PS is being used here as the benchmark for SHAPE,
not for feature parity. Where this section names an SAP object it means the
concept — a WBS element as an account-assignment object, a settlement rule, a
results-analysis key — and not any particular release's behaviour. The useful
thing about SAP as a yardstick is not what it has; it is what it costs to turn
on.

### 10.1 Where this module is already ahead, and should stay there

Worth stating first, because the rest of this section is critical and the
calibration matters.

- **Progress is derived by default.** In SAP, quantity-proportional progress is
  one of several measurement methods available once somebody has configured
  progress versions. Here it is what a project does unless it has nothing to
  derive from, and `progress.source` tells the screen which of `measured`,
  `tasks` or `typed` it is looking at. Being honest about the provenance of a
  percentage is rarer than deriving it.
- **No cached financials.** Revenue, cost and commitment are computed from the
  documents. The stored `financials` that 0070 removed is the class of thing
  that makes a project report disagree with the ledger.
- **The whole module is nine tables.** SAP PS needs a project profile, a network
  profile, a planning profile, a budget profile and a settlement profile before
  the first WBS element exists. A contractor here creates a project, prices a
  bill, awards it, and measures.
- **Warn, never block.** The budget warns at 90%, a milestone schedule that does
  not sum to the contract warns, an over-measure warns. SAP's availability
  control can be configured to ERROR a posting that breaks a budget. For a
  contractor the work does not stop while the commercial argument is had, and a
  system that blocks it will be worked around within a week.

### 10.2 What SAP has that we should deliberately NOT build

| SAP concept | what it is for | verdict here |
|---|---|---|
| **Settlement rules** | periodically settling a WBS element's costs to a cost centre, an asset under construction, or a profitability segment | **No.** A contractor's project IS the profit centre — it is not a temporary collector waiting to be emptied somewhere else. The one real case is an internal capex job building a fixed asset, and 0057 already links a bill to an asset. |
| **Networks and activities beside the WBS** | separating what the work is from when it happens and who does it | **No.** One tree. `project_tasks` carries planned dates and an assignee; MS Project and Odoo both manage with one structure, and two structures means two things to keep in step. |
| **Availability control that blocks** | refusing a posting that breaches the budget | **No.** See above. The warning stays. |
| **Work centres, capacity, resource levelling** | scheduling people and plant against finite capacity | **No.** A different product, and nobody buying this is asking for it. |
| **Results-analysis keys and versions** | a configuration framework for WIP and revenue recognition | **Not as a framework.** If WIP is ever built (10.4), it is ONE rule, not a configuration surface. |
| **A Project Builder mega-transaction** | one screen that edits every object on a project | **No** — and this module is already the other way round, split by section. That is the right instinct and 10.3 is about not overdoing it. |
| **Milestone billing plans** | a configured schedule that generates billing documents | **No.** The execution layer's decision — completing a payment milestone raises a DRAFT invoice — does the same job and is reversible by deleting a draft. |

None of these is a gap. Each is a place where the honest answer to "SAP has it"
is "and it is why SAP takes eighteen months to configure".

### 10.3 Where WE are overkilling: ten sections, five with nothing behind them

This is the finding. The module presents ten navigation entries; five of them
own no records of their own:

| section | own table | what it actually shows |
|---|---|---|
| Dashboard | `projects` | the project list |
| **Bill of Quantities** | 3 tables | the bill, and measurement |
| Milestone Tracker | — | `project_tasks` |
| Programme | — | `project_tasks` again, as a Gantt |
| **Engineer's Instructions** | `project_instructions` | the register |
| **Site Diary** | `project_diary_entries` | the diary |
| Forms Register | — | a hardcoded list of sixteen form names |
| IPC & Payments | — | invoices + bills |
| Cash Requisitions | — | claims + expenses, from the SAME pair of queries as IPC |
| Monthly Report | — | a digest of the four above it |

Two things fall out of that table and both are worth naming plainly.

**`project_tasks` is presented three times** — the WBS card on the project detail
page, the Milestone Tracker, and the Programme — and neither extra view
introduces a record type. **And "Milestone Tracker" does not show milestones**,
because there are none in the schema; it shows tasks. A section named after a
thing the database does not have is the same class of defect as a figure read
from a key that does not exist, and it lasts for the same reason: it looks
right.

**Three sections carry a banner explaining what they are not.** IPC & Payments
says formal certificates are not a module yet; Cash Requisitions says the
requisition workflow is not built; Forms Register says digital submission is
coming. A page that has to apologise for itself in a banner is not a page yet.

This is the SAP failure mode in miniature, and it is the exact thing the module
is trying to beat: **menu entries for things that are not there.** A new user
cannot tell from the navigation which five sections hold their data.

#### The cut: ten to six

| keep | what it becomes |
|---|---|
| **Overview** | the dashboard and the project record. The Monthly Report becomes a PRINT/EXPORT action here, not a nav entry — it is a rendering of other sections, and a report is something you produce, not somewhere you go. |
| **Bill of Quantities** | unchanged. |
| **Programme** | ONE section with two views of `project_tasks` — list and Gantt, as tabs. Absorbs the Milestone Tracker. Becomes "Programme & Milestones" when milestones are actually a table. |
| **Instructions & Notices** | the register, plus the notice clocks when they land. The Forms Register folds in here as a reference panel — the list is genuinely useful and it does not need a nav slot to be read. |
| **Site Diary** | unchanged. |
| **Money** | budget vs actual, and what has been invoiced and spent against the project. IPC & Cash Requisitions collapse into it UNTIL a certificate record exists. |

That last row needs care and is NOT a licence to act. §7's blocking decision 1
and §9.5 both say the same thing from different directions: an IPC and a cash
requisition are genuinely different documents and will probably end up as two
tables. But **two empty pages today is not how you get there** — the honest
intermediate is one section that says what it shows, and the second section
arrives with the second record type. **Ask the author before merging those two
pages.**

Everything else in the cut is a rearrangement of surfaces over tables that
already exist. Nothing is deleted from the database.

#### Done — 2026-08-31

**Ten to seven**, and it will be six when the IPC/Cash Requisitions question is
settled:

| | |
|---|---|
| Milestone Tracker | folded into **Programme** as the *Work breakdown* view. Two views, two real URLs (`?view=list` / `?view=gantt`), one query. The views are named for what they are — there are no milestones to track. |
| Forms Register | a collapsed **reference panel on Instructions**, where the four forms that DO exist as records live. A native `<details>`, so the page stays a server component. |
| Monthly Report | a **button on the project record**. It is a rendering of four other sections, so it is something you produce, not somewhere you go. |
| IPC & Cash Requisitions | **untouched**, deliberately. |

`/dashboard/projects/milestones` and `/dashboard/projects/forms` are redirects
rather than deletions, carrying `?project=` through, so no saved link and no
link in anybody's email breaks.

**And a defect fell out of it.** `revalidateTask` revalidated
`/dashboard/projects/${projectId}/tasks`, which is not a route and never has
been — the WBS is a card on the project page. So adding a task revalidated
nothing beyond the project page itself, and the Programme kept showing the old
tree until something else invalidated it. Written and never read, in the cache
layer, which is the third instance of that shape this day. It now revalidates
the programme and the bill, both of which read `project_tasks`.

### 10.4 Where we genuinely fall short, worst first

**1. THE PROJECT IS NOT A DIMENSION ON THE LEDGER.** This is the architectural
one and everything else is downstream of it.

`journal_lines` has no `project_id`. `computeProjectActuals` therefore
reconstructs a project's position by scanning five document tables — invoices,
credit notes, bills, claims, expenses, stock requests — each with its own status
rules. In SAP the WBS element is an account-assignment object: it is ON the
posting, so a project's cost is a ledger query and reconciles to the trial
balance by construction.

What that costs us today, concretely:

- **a manual journal cannot be charged to a project at all**
- **payroll cannot reach a project** — payroll posts journals, and the execution
  layer's own decision 4 says labour reaches the GL through payroll. So the one
  cost that is usually a contractor's largest is structurally invisible to the
  project. **CORRECTED in §12:** the column does NOT fix this. It removes the
  structural barrier and leaves the data one — nothing records which project a
  person worked on, and that is timesheets.
- **depreciation on plant working on a job cannot reach it either** — and still
  cannot, because `assets` has no `project_id`
- every new document type that carries a project needs a new arm in that query
- **a project P&L can never be reconciled to the general ledger**, because the
  two are computed from different places

The fix is one nullable `project_id` on `journal_lines` (with `cost_code_id`
beside it), stamped by the posting helpers that already know the source
document's project. It does not require rewriting `computeProjectActuals` on day
one — the two can run side by side and be compared, which is also how you find
out whether the scan was ever right.

**2. Commitments stop at bills.** A purchase order raised and not yet invoiced
is invisible to the project, and that is precisely the money a project manager
needs to see before committing more. SAP shows commitment from the purchase
requisition onward. `purchase_orders.project_id` is one nullable column, already
on the execution layer's step 5 and still unbuilt.

**3. Nothing in the module notifies anybody.** The bell exists since 0074 and no
project action writes to it. The notice clocks are the plan's own highest-value
item and a clock nobody is told about is a column. Budget at 90%, an
over-measure, an instruction awaiting a compliance decision, a diary entry
unsigned for a week — the module knows all four and tells nobody.

**4. No retention, no certificates.** Already the plan's steps 5 and 6. Named
here only to say the ordering is right: retention is the thing stock Odoo cannot
do at all (§9), and it is a real differentiator rather than catching up.

**5. No revenue recognition or WIP.** SAP's results analysis computes
work-in-progress and percentage-of-completion revenue at period end. With a
priced bill and measured quantities the INPUT now exists — earned value is
Σ(measured × rate). **Defer it, do not skip it:** it is an accounting build with
audit consequences and it belongs after certificates, when "certified to date"
and "earned to date" can be compared. That difference IS the WIP figure.

**6. Attachments on project records.** See 10.5 — the reason this was excluded
turns out to be false.

### 10.5 A correction: blob storage exists

`PROJECTS-EXECUTION-LAYER.md` §3 rules out the MD's phase 12 (documents) because
it "needs blob storage, which nothing in this app has yet", and §5 of this
document says photos need it too.

**Both are wrong.** `lib/cloudinary.js` and `app/api/upload/route.js` have been
there throughout: an authenticated upload endpoint taking a `folder` parameter,
capped at 10MB, accepting JPEG/PNG/WebP/HEIC and PDF — and it is already used by
expenses, by claims and by HR's `employee_documents`, which is the exact table
shape a project attachment would copy.

So site-diary photographs, an instruction's marked-up drawing, a calibration
certificate and a measurement sheet are a small build on an existing path, not a
blocked one. For a site diary the photograph often IS the evidence, which makes
this better value than its position on any list suggests.

Recorded as a correction rather than fixed in place, because an exclusion that
rested on a false premise is worth seeing.

### 10.6 The rules that keep it usable

Stated as rules because "don't bloat it" is not actionable and these are:

1. **A nav entry must own records.** If a section needs a banner to explain what
   it is not, it is not a section yet. It is a panel inside one.
2. **A section is named after the table it shows.** "Milestone Tracker" showing
   tasks is the same defect as a figure read from a key that does not exist.
3. **Sections appear when the project needs them.** This is what the type lookup
   table (§9.1) is for: a supply job should never see a site diary. The measure
   of success is that the average project shows FEWER than six sections.
4. **One number, one place.** `project_tasks` rendered three times is three
   places for the same number to be presented differently.
5. **Warn, never block** — already the house rule, and it is the main thing
   separating this from SAP's availability control.
6. **A figure that names a subset is a link to that subset** — already codified
   in `components/metric-bar.jsx`, and it is what stops a dashboard being
   decoration.

### 10.7 What this changes in the sequence

The §8/§9 sequence stands. Two things move into it and one thing moves up:

| | change |
|---|---|
| **new, before step 3** | `journal_lines.project_id` + `cost_code_id`. Everything about project cost is downstream of it, and it is cheaper now than after certificates post. |
| **new, beside step 3** | `purchase_orders.project_id` — one column, closes the commitment gap. |
| **moved up** | the notice clocks (was step 7) go with `contracts`, and they carry a NOTIFICATION, because a clock nobody is told about is a column. |
| **added at the end** | WIP / earned-vs-certified, after certificates exist. One rule, not a configuration surface. |
| **not in the sequence at all** | the nav cut in 10.3 — it is a day's work over tables that already exist, and it needs the author's agreement on IPC and Cash Requisitions first. |

The shape to protect: **nine tables, six sections, and fewer than six on most
projects.** Every item above either removes a surface or adds a column. The one
thing that would make this module lose is answering "SAP has it" with "then we
should have it too".

---

## 11. Built — 2026-08-31: the type, the contract, and the certificate

Steps 1, 3 and 5 of the §8 sequence, in that order once step 1 was noticed to be
missing. §10's cut had reduced the navigation to seven entries on the rule that a
section must own records — and left the OTHER half of §10.6 rule 3 unbuilt, so
every project still showed every section. Adding certificates to that would have
made an eighth entry every project sees, days after cutting three.

### 0078 — `projects.type`, as a lookup table

A LOOKUP TABLE, per §9.1, and the argument held up under building: §7 specified
an enum while recording as an open question that we cannot enumerate the
business of tenants we have not met, and those two do not survive together.

Six built-ins seeded with the §7 matrix. `company_id IS NULL` is a built-in,
readable by every tenant and writable by none — the RLS policy READS
`company_id IS NULL OR company_id = current` and WRITES only
`company_id = current`, so the asymmetry is the database's rather than something
every query has to remember. A tenant adds its own types beside them.

**A project with no type shows everything**, so nothing disappeared from anybody's
screen when the column arrived. The narrowing is opted into.

**The gate is in two places, and that is not redundancy.** The nav hides a
section the type excludes; the page refuses it too. Hiding a link is a sign on
an unlocked door — the same mistake the plan gate made when only the LIST page
checked it and any project could still be opened by URL.

**Where the section flags are resolved.** A layout does not receive
`searchParams`, so it cannot know which project is selected — but it can hand the
nav every project's flags and let it apply `selectProject`, the same rule the
pages use, from the same module (`lib/sections.js`, pure, imported by both a
server module and a client component). A rule stated twice is a rule that
drifts, and this module has already paid for that once.

### 0077 — the contract, and the interim payment certificate

They land together because a certificate has nothing to compute against without
terms, and §7 is unambiguous that nothing about a contract may be hardcoded.

**The arithmetic is cumulative, and almost all of it is derived.** Four stored
numbers — permanent work to date, materials on site, dayworks to date, retention
released to date — and the terms produce every other figure:

```
  value of permanent work to date
+ materials on site
+ dayworks to date
= gross valuation
− retention held        min(pct × gross, cap% × contract sum)
+ retention released
− advance recovered     min(pct × gross, advance paid)
= net to date
− previously certified  the last CERTIFIED certificate's net to date
= net this certificate
```

This is not an aesthetic choice. Because every line is cumulative, **a
correction to certificate 2 flows into 3 by itself** — there is a test for
exactly that. A design storing "this period" would need every later certificate
rewritten, which is how a final account stops reconciling.

**The certificate stops at net certified.** VAT, VAT withholding and WHT are the
invoice's and the payment's, both of which already have a tested engine. Putting
the rates here would be a second engine to keep correct, and the one used less
often is the one that drifts.

**Certifying raises a DRAFT invoice, and nothing more** — the reversible half of
§6 open question 2, and the same decision the execution layer made for
milestones. One service line at the net for THIS certificate, which is what the
employer is being asked to pay.

**Retention is a balance, and it does not reach the ledger.** Said on the page
as well as in the migration, because somebody reading the figure should not
assume the ledger knows about it. `1250 Retention Receivable` still does not
exist in the chart and the journal is still step 6.

**A contract has a direction from the start** (§9.2) — `receivable` where the
employer holds retention on us, `payable` where we hold it on a subcontractor,
back to back. At most one receivable per project, because two would be two
contract sums; as many payables as there are subcontractors.

**Materials on site and dayworks are columns** (§9.4), not lines. Three known
components of one valuation. Itemising what is on site is a line table hanging
off this one and it does not change the arithmetic.

### IPC and Cash Requisitions: two records, and the question is now closed

§7 open question 1 asked whether they collapse. They do not. An IPC is EXTERNAL
— contractor → engineer → employer — and it is a valuation; a cash requisition
is INTERNAL — site → head office — and usually a forecast driven by the
programme. §9.5 predicted this and building the certificate confirmed it: the
certificate needed contract terms, a cumulative chain and a freeze, and none of
those is anything a requisition wants.

**So the IPC page is now the certificate register, and Cash Requisitions is
untouched.** It remains a view over claims and expenses, and it is the next
thing that deserves a record of its own — as a forecast, not as a small
certificate.

### Three things found while building

**A biconditional that was right, refusing something reasonable.**
`project_certificates_draft_is_uncertified` made cancelling a DRAFT impossible —
status would leave `draft` while `certified_at` stayed NULL. The constraint is
correct and stays; what changed is that the repository now says which of the two
states the user is in ("nothing was issued, so delete the draft") rather than
letting a raw check violation reach them.

**A seed a TRUNCATE can wipe must be re-runnable.** 0078 seeded the six built-in
types with a plain INSERT. `project_types.company_id` references `companies`, so
`TRUNCATE companies CASCADE` empties the table COMPLETELY — cascade follows the
foreign key, not the rows, so `company_id IS NULL` does not protect them. Every
Postgres suite here opens with that truncate, so the first suite to run deleted
the built-in types for every suite after it and for the developer's database
until migrations were re-run. 0079 makes the seed an idempotent function.

The general rule this repo now has an instance of: **reference data a TRUNCATE
can reach must be re-runnable, not a one-shot INSERT.**

**And the sentinel that would have reached a uuid column.** The type picker
cannot use `""` as a Select value, so the form posts `"none"` — which is truthy,
so `typeId || null` would have sent the literal string to a uuid column and
turned an ordinary choice into a 22P02. Normalised in the schema rather than at
the call site, so every caller gets it.

### Where the sequence is now

Done: 1 (type), 2 (bill of quantities, 0076), 3 (contract, 0077), 5
(certificates, 0077).

Next, in the order that pays:

1. **`journal_lines.project_id`** — §10.4's architectural gap, and now more
   pressing than before: a certificate raises an invoice that posts, so the
   project's revenue reaches the ledger by document while payroll and manual
   journals still cannot reach it at all.
2. **Variations** (step 4) — `project_instructions.estimated_cost` feeds nothing,
   and `contract_sum` now exists for it to move, with `original_sum` beside it to
   make the variance answerable.
3. **Retention to the ledger** (step 6) — the balance is computed; the account
   and the journal are not.
4. **Notice deadlines with a NOTIFICATION** — the bell has existed since 0074 and
   nothing in this module writes to it.

---

## 12. The ledger dimension, and the question it exposed

Migration 0080 makes the project a dimension on `journal_lines` — §10.4's item
1, the gap everything else about project cost sits downstream of. Building it
turned up an accounting question that is not the porter's to answer, and
corrected something §10.4 got wrong.

### What 0080 does

`journal_lines.project_id` and `cost_code_id`, nullable, on the LINE rather than
the entry because one entry can span projects. Stamped by the five postings
whose source document knows a project — invoice (revenue and cost of sales),
bill, expense, employee claim, credit note (from the invoice it credits) — and
by a manual journal, which is the case that could not be done at all before.

`getProjectLedgerActuals` reads it; `reconcileProjectActuals` puts the ledger
figure beside the document scan with the difference between them. **Nothing has
been switched over.** `computeProjectActuals` is untouched and still answers
every screen, for the reasons below.

### The correction §10.4 needs

§10.4 listed, as things the missing dimension cost us, that "**payroll cannot
reach a project**" and depreciation cannot either — implying the column fixes
them. **It does not.** The column removes the STRUCTURAL barrier and leaves the
DATA barrier untouched:

- **Payroll** posts wages, PAYE and NSSF, and nothing in this system records
  which project a person worked on. That is timesheets. `project_assignments`
  already holds the RATE (`rate_amount` + `rate_unit`: hour, day, month, fixed)
  and nothing multiplies it by anything; `attendance` holds hours but carries no
  project, and field staff who report from home straight to site never clock in
  — which is already why payroll deductions are not derived from it.
- **Depreciation** posts, and `assets` has no `project_id`, so plant working a
  job cannot charge it.

So: rate in one table, hours in another that cannot be trusted for this, money
in a third that posts. Three thirds of an answer and no joins between them.

### The question this exposed, and it is an accounting one

**Stock issued to a project posts nothing at all.** `recordMovement`,
`issueStock` and `createCheckout` each insert a row and none of them creates a
journal entry — while a bill for an inventory purchase DEBITS Inventory
(`bills.ts`, the `isInventoryPurchase` arm). So material bought for a job and
issued to it is relieved from stock in QUANTITY and never in the LEDGER.

On a construction project that is usually the largest cost line. It means a
ledger-derived project P&L would be missing materials however well 0080's column
is populated — and it would look authoritative while being wrong, which is the
failure this module has spent a day removing.

`computeProjectActuals` counts it, because it reads the movements. That is
precisely why the two figures disagree, and why `reconcileProjectActuals`
reports the difference rather than either one claiming to be the answer.

**Three options, and the choice is the tenant's accounting policy, not a
porting decision:**

| | what it means |
|---|---|
| **(a) analytic only** | project cost lives in project reporting; the GL stays document-level. What Odoo, NetSuite and Procore do. Cheap and honest, and the project P&L never reconciles to the trial balance. |
| **(b) allocated** | issues post DR project cost / CR Inventory; labour is moved from a payroll control account to project cost by ONE period-end journal on the timesheets. SAP settlement, Candy cost allocation. The only version where a project P&L reconciles. |
| **(c) expensed at purchase** | material bought against a job is charged to the job when PURCHASED, so the bill already carries the cost and the issue is a stock record only. Common in practice, and it makes today's behaviour nearly right. |

**Materials and labour are the same question**, and it should be answered once
for both rather than twice. If the answer is (b), note the shape: one allocation
journal per period, never a posting per timesheet — per-timesheet postings are
how a ledger acquires fifty thousand lines a month and no clean way to reverse a
correction.

Until it is answered, the ledger figure is an instrument and not the answer, and
this document should not claim otherwise.

### Where the two figures differ today, and why

Pinned in `tests/pg-project-ledger-dimension.test.mjs` as facts rather than left
to be rediscovered as bugs:

1. **Nothing is backfilled.** Entries posted before 0080 carry no project. A job
   running for months reads near zero from the ledger and correctly from the
   scan.
2. **Materials, as above.**
3. **Commitment is not an accounting concept.** The scan's `committed` —
   approved and unpaid — has no journal entry by definition, which is why 0070
   decision 2 computed it from documents in the first place.

### What is now unblocked

The **timesheet** is the join between projects and payroll, and its shape is
already decided by the execution layer's decision 4: it does NOT post — labour
reaches the GL through payroll once, where the statutory deductions are, and
posting the timesheet too books the same wage twice. It is an analytic record
that produces project labour cost and makes `billing_model = 'time_material'`
mean something for the first time.

One thing to settle before that table exists: the roster's four rate units do
not all multiply the same way. `hour` and `day` are a straight multiplication;
`month` is a salary that has to be APPORTIONED across the days and jobs worked;
`fixed` is a lump sum against the project and is closer to a milestone than a
timesheet. That decides whether the timesheet stores hours, days, or both.
