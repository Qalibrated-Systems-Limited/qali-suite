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
   evidence base for every claim above. Photos need blob storage.
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
  §6.4 is still open)
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

**1. IPC and Cash Requisitions — one section or two? (blocking)**

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

**2. Is there a bill of quantities?**

§6.4, still unanswered. It decides whether measured progress is real or whether
typed percentages remain — and §4.1 is unambiguous that typed percentages are
how a project reports 90% complete for four months. If there is a BOQ it is a
table, and progress derives from it.

**3. The type enum's values, for tenants we have not met.**

`construction | installation | maintenance | supply | consultancy | internal`.
An enum is a migration to change. A manufacturer or a logistics firm may need
something none of those covers, and this application is multi-tenant.

**4. Where the notice clocks belong.** `project_instructions` already carries
EI, VO, NCR and RFI-response with no deadline field. The 24-hour and 28-day
FIDIC clocks either extend that table or need a separate notice register. The
author of that table should have the view.

**5. Default retention on an installation contract** — what percentage the form
pre-fills. Not whether the mechanism exists: it does, for every contract type.
Only what is suggested before the user overrides it.


- **§6.4 stands: is there a bill of quantities?** It decides whether measured
  progress is real or whether typed percentages remain, and §4.1 is unambiguous
  that typed percentages are how a project reports 90% complete for four months.
- **Default retention on an installation job** — what percentage to pre-fill
  for a new `installation` contract. Not whether the mechanism exists: it does,
  for every type. Only what the form suggests before the user overrides it.
- **Where the completion certificate sits for a two-payment job** — one
  certificate at the end, or one per milestone including the advance.
