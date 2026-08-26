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
