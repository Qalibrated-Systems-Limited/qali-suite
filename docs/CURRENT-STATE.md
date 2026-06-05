# Qalisuite — Current State of the System

**Snapshot date:** 2026-05-29
**Branch:** `jeff-business-suite` (the main ERP SaaS)
**Stack:** Next.js 16 (Turbopack) · React 19 · Mongoose 8 / MongoDB · NextAuth 5 · Tailwind v4 · shadcn/ui · Recharts · @react-pdf/renderer

This document is a module-by-module audit of what's shipped, what's partial, and what's missing. For deep history and the older roadmap framing, see [erp-dev-roadmap.md](../erp-dev-roadmap.md). For the HR module specifically, the authoritative source is [app/dashboard/hr/HR-ROADMAP.md](../app/dashboard/hr/HR-ROADMAP.md).

> **Status legend** ✅ shipped · 🔧 partial / needs polish · ⬜ not started · ⚠️ implementation present but weak

---

## Architecture at a glance

- **Multi-tenant SaaS.** Every collection is scoped by `companyId`. Tenant isolation enforced via `withTenantScope()` in [lib/utils/tenant-utils.js](../lib/utils/tenant-utils.js).
- **SuperAdmin role** has cross-tenant access; all other roles see only their company's data.
- **Plan gating** via `requirePlanAccess()` in [lib/plan-gate.js](../lib/plan-gate.js) — features can be locked behind subscription tiers.
- **Server Actions + server-side `redirect()`** is the canonical mutation pattern (no client-side toasts for success; failures render inline; navigation handled by `redirect()` after `revalidatePath()`).
- **62 Mongoose models** in [app/models/](../app/models/) — full ERP scope.
- **47 dashboard route groups** under [app/dashboard/](../app/dashboard/).

---

## Module status matrix

| Module | Status | Notes |
|---|:-:|---|
| Multi-tenancy | ✅ | Mature — every query tenant-scoped, SuperAdmin override, plan gate |
| Authentication | ✅ | NextAuth 5 (beta), role-based permissions module |
| Chart of Accounts | ✅ | Per-tenant; `systemAccount` enum marks required accounts |
| General Ledger (JournalEntry) | ✅ | Balanced-line validation, fiscal-period gate, post/reverse lifecycle |
| Fiscal Periods | ✅ | Period-close protection via JournalEntry pre-save |
| AR — Invoices | ✅ | Full status workflow, line items, customer snapshots |
| AR — Credit Notes | ✅ | Reverses invoice posting |
| AR — Quotes | ✅ | Quote → Invoice conversion with linkage tracking |
| AR — Customer Statements | ✅ | Aged statements |
| AP — Purchase Orders | ✅ | Three-way match with GRN |
| AP — Bills | ✅ | Vendor invoicing, GR/IR clearing |
| AP — Goods Receipt Notes | ✅ | Receiving + acceptance |
| AP — Supplier Statements | ✅ | |
| Inventory — Products | ✅ | SKU, category, multi-unit |
| Inventory — Stock Movements | ✅ | Auditable trail |
| Inventory — Stock Adjustments | ✅ | Posts to Inventory Adjustments account |
| Inventory — Stock Requests | ✅ | Internal item-out workflow |
| Inventory — Item Checkouts | ✅ | Technician stock distribution |
| Inventory — NCR (Nonconformance) | ✅ | Reject inbound goods |
| HR — Employees | ✅ | Full profiles, photos, documents, lifecycle |
| HR — Departments | ✅ | |
| HR — Leave | ✅ | Request/approve, calendar, accrual, carry-over, encashment |
| HR — Payroll | ✅ | Kenya-compliant (PAYE / SHIF / NSSF / AHL), payslip PDF, bank/M-Pesa exports |
| HR — Attendance | 🔧 | Web clock-in works; field-staff blind spot (see ⚠️ below) |
| HR — Performance Management | ⬜ | Phase 9 — not started |
| HR — Recruitment | ⬜ | Phase 9 |
| HR — Training | ⬜ | Phase 9 |
| Payroll → GL posting | ✅ | Accrual + payment journals on approve/paid; reverses on void |
| Statutory remittance posting | 🔧 | Statutory payable accounts now seeded; `remitStatutory()` action + UI not yet built |
| Payments Received | ✅ | Matches invoices, AR clearing, multi-method |
| Payments Made | ✅ | Bill payment, AP clearing |
| Banking — Bank accounts | ✅ | |
| Banking — Bank feeds | ✅ | Full CSV import wizard, line allocation UI, auto-match with confidence scoring; OFX/MT940 not supported (see [plan](BANK-RECONCILIATION-PLAN.md)) |
| Banking — Reconciliation closure | ⬜ | Lines can be allocated, but no "lock period" concept, no balance verification, no Bank Reconciliation Statement report — see [BANK-RECONCILIATION-PLAN.md](BANK-RECONCILIATION-PLAN.md) |
| Banking — M-Pesa C2B / STK | ⬜ | Mpesa is a payment method enum value, but no Daraja webhook for inbound nor STK push for invoice collection |
| Tax — VAT | ✅ | Output VAT on sales, input on bills, returns |
| Tax — WHT | ✅ | Withholding payable + reports |
| Tax — Payroll statutory | ✅ | P10, P9A, NSSF/SHIF/AHL CSV exports |
| **Tax — KRA eTIMS / e-invoicing** | ⬜ | **CRITICAL** — legally mandatory in Kenya for VAT-registered customers |
| Reports — Financial | ✅ | P&L, Balance Sheet, Cash Flow, Trial Balance, General Ledger |
| Reports — AR / AP Aging | ✅ | |
| Reports — Inventory | ✅ | |
| Reports — Sales / Purchases | ✅ | |
| Reports — Asset Rollforward | ✅ | |
| Reports — Custom builder | ⬜ | No drag/drop or saved custom views |
| Reports — Drill-down to source | ⬜ | Can't click P&L total → see contributing JEs |
| KPIs | ✅ | Just shipped — 11 templates, 9 auto formulas, sparkline + chart, vs-prior + YoY, custom thresholds, inline target edit |
| Approvals workflow | 🔧 | Engine + atomic claim flow solid; only 3 of 6 enum types actually wired (price changes, stock adjustments, write-offs). Bills, credit notes, discounts, manual journals all auto-post with no gate — see [APPROVALS-PLAN.md](APPROVALS-PLAN.md) |
| Assets (Fixed Assets) | ✅ | Acquisition + depreciation; rollforward report |
| Expenses | ✅ | |
| Employee Claims / Reimbursements | ✅ | Workflow with approval chain |
| Loans (staff) | ✅ | |
| Projects | 🔧 | Basic structure exists; job costing + timesheets weak |
| CRM / Lead pipeline | ⬜ | First touch is the Quote — nothing tracks the funnel before that |
| Dashboards | ✅ | 8 role-based dashboards (Admin, CFO, Accountant, HR, Procurement, Sales Manager, Store Manager, Storekeeper) |
| Document attachments | 🔧 | Uniform on EmployeeProfile; sparse on invoices/bills/expenses |
| Notifications | ⬜ | Nothing in-app or email-driven |
| Audit log (global) | ⚠️ | Per-entity `createdBy` / `lastModifiedBy` stubs only — no central change history |
| Recurring transactions | ⬜ | No template engine for recurring invoices / bills / journals |
| Multi-currency / FX | ⬜ | `currency` field on accounts; no FX rate table or revaluation |
| Mobile app | ⬜ | Web only (responsive layouts work on mobile) |
| API / Webhooks | 🔧 | `integrationKey` model + `/api/v1` routes; not a published integration surface |

---

## Per-module detail

### Financial Core

**Chart of Accounts** — [app/models/account.js](../app/models/account.js)
- Per-tenant, hierarchical (parent / ancestors / level / path)
- `systemAccount` enum identifies required accounts that cannot be deleted (cash, bank_main, mpesa, accounts_receivable, paye_payable, salaries_payable, etc.)
- Seeded on tenant creation via [companyOnboardingService.js:seedChartOfAccounts](../app/mongodb/services/companyOnboardingService.js)
- Recently added: `ahl_payable`, `salaries_payable`, `employer_nssf_expense`, `employer_ahl_expense` (Phase 7 backfill action available in UI under Settings → Payroll Configuration)

**JournalEntry** — [app/models/JournalEntry.js](../app/models/JournalEntry.js)
- Header + balanced lines (debit = credit; pre-save validation)
- Status: `draft → posted → reversed`
- Fiscal-period gate in pre-save hook (`validateFiscalPeriod`) — blocks posting to closed periods
- Reversal pattern: new entry with swapped Dr/Cr, bidirectional link via `reversalEntryId` / `originalEntryId`
- Source-document linkage via `entryType` + party block

**Fiscal Periods** — [app/models/fiscalPeriod.js](../app/models/fiscalPeriod.js)
- `open | closed | locked` status protects historical numbers

### Accounts Receivable

**Invoices** — [app/models/invoice.js](../app/models/invoice.js)
- Status: `draft | sent | completed | cancelled | void | expired`
- Line items, customer snapshot, sales-person commission tracking
- VAT calculation, discounts, multi-currency-field (not fully wired)
- Posts to GL via `journalService` on completion

**Quotes** — [app/models/quote.js](../app/models/quote.js)
- Status workflow with conversion to Invoice (full or partial)
- Tracks invoiced quantity per line for partial conversion
- Sales-person + customer snapshots

**Credit Notes** — reverses invoice posting against the customer

### Accounts Payable

**Purchase Orders** — full 3-way match flow with GRN  
**Bills** — vendor invoicing; uses GR/IR clearing (`2175` account, `systemAccount: "grni"`) so receiving and billing can happen out of order  
**GRN** — inbound receiving with quantity acceptance; NCR for rejections  
**Supplier Statements** — aged

### Inventory

**Products** — SKU, category, units, current stock  
**Stock Movements** — every in/out tracked  
**Stock Requests** — internal item-out (e.g. technician needs parts)  
**Item Checkouts** — distributes from Inventory account to Technician Stock account  
**Adjustments** — manual stock corrections, posts to Inventory Adjustments expense

**Gap**: no formal multi-warehouse — Technician Stock is the only non-primary location. No location transfers, no per-location reorder points, no cycle counts.

### HR & Payroll

This module is the most mature on the system — ~80% feature-complete vs. a mature ERP. Full status in [app/dashboard/hr/HR-ROADMAP.md](../app/dashboard/hr/HR-ROADMAP.md).

**Highlights:**
- EmployeeProfile / Department / LeaveRequest / PayrollRun / PayrollEntry / Attendance / EmploymentHistory / SalaryHistory all modeled
- Kenya statutory: PAYE brackets, SHIF (replaces NHIF), NSSF Tier I/II, Affordable Housing Levy — all rates in `PayrollConfig` (effective-date-ranged, per company)
- Payslip PDF, payroll summary PDF, bank EFT CSV, M-Pesa B2C bulk CSV
- Statutory exports: P10 monthly, P9A annual, NSSF/SHIF/AHL CSVs
- Pro-rata payroll for mid-month joiners/leavers, LWOP deduction
- Leave calendar, accrual, carry-over, encashment
- Public-holiday-aware working-day calculation
- Phase 7 GL posting **wired**: payroll approve → accrual journal; payroll paid → clearing journal; void → reversing journal

**Caveats / gaps:**
- Attendance: web/mobile clock-in works, but field staff who report directly from home aren't captured. Auto-deriving payroll OT or absences from Attendance is explicitly off-limits per [[field-staff-attendance]] memory.
- Statutory remittance posting: payables accumulate on the balance sheet until cleared; `remitStatutory()` action + UI is the next deliverable (Phase 7 Step 2).
- Performance management, recruitment, training: nothing yet.

### KPIs (newly shipped)

[app/dashboard/kpis/](../app/dashboard/kpis/) — full module, ~3 days of focused build

**Models** — [app/models/kpi.js](../app/models/kpi.js) (definition) + [app/models/kpiSnapshot.js](../app/models/kpiSnapshot.js) (per-period actuals)

**Capabilities:**
- 11 starter templates (8 universally relevant + 3 efficiency ratios)
- 9 auto-compute formulas (revenue, payroll cost, AR days, cash position, headcount, gross margin %, opex ratio, payroll-to-revenue, average order value) + manual entry
- Monthly / quarterly / yearly periodicities
- Sparkline on every list card; full Recharts line chart on detail; target reference line
- vs Prior + YoY delta computation (server-side, served with the snapshot)
- Custom per-KPI thresholds + status labels (override default 95%/80% bands)
- Inline target edit on the detail card (pencil → input → save, no separate page)
- Owner picker: HR-aware combobox (search by name / employee number / department) with graceful free-text fallback for tenants without HR
- "Compute for any period" backfill form
- Templates dialog with checkbox selection

**Patterns adopted:**
- Server-side `redirect()` from actions on success (no client toast)
- Errors render inline near the action
- All UI confirmation comes from the page itself updating (the snapshot row appears, the badge changes color, the value updates)

### Reports

[app/dashboard/reports/](../app/dashboard/reports/) — financial + operational

**Shipped:** Profit & Loss, Balance Sheet, Cash Flow, Trial Balance, General Ledger, AR Aging, AP Aging, Asset Rollforward, Inventory Reports, Sales Reports, Purchases Reports

**Gaps:**
- No drill-down — clicking a P&L number doesn't show the contributing JEs
- No custom report builder
- No scheduled / subscribed reports
- Export to Excel/CSV varies by report

### Approvals

[app/models/approvalRequest.js](../app/models/approvalRequest.js)

Engine exists with `roleAllowed`-based routing; coverage across the system is partial. Some transactions (price changes, large bills, write-offs) flow through approvals; many don't.

### Tax

VAT, WHT, PAYE all functional. Annual filings supported. **eTIMS is the gap** — KRA's mandatory e-invoicing integration is missing and likely the #1 adoption blocker for VAT-registered customers in Kenya.

---

## Cross-cutting concerns

### Authentication & authorisation
- NextAuth 5 (beta 22)
- 13+ roles defined in [lib/permissions.js](../lib/permissions.js)
- Granular `canSee*` helpers for nav, `canEdit*` / `canSeePricing` for action gates
- Multi-tenant: every API call resolves `companyId` from session

### Multi-tenancy
- `getTenantContext()` / `withTenantScope()` / `getCompanyIdForCreate()` — every action and query path
- Cross-tenant access reserved for SuperAdmin

### Plan gating
- `requirePlanAccess(planKey)` and `hasPlanAccess()` per [lib/plan-gate.js](../lib/plan-gate.js)
- Feature flags live in plan definitions, not in code

### Performance
- Per [[pre-prod-perf]]: every change considers indexes, ObjectId casts in `$match`, `.lean()`, projections, capped limits
- Indexes defined on every model at the appropriate query shape

---

## ⚠️ Weakly implemented (skeleton, needs flesh)

1. **Bank reconciliation closure** — full import + allocation UI exists; reconciliation *closure* (period lock, balance verification, Bank Reconciliation Statement report) does not. Accountants can match lines but can't produce the audit-grade reconciliation deliverable. Full gap analysis in [BANK-RECONCILIATION-PLAN.md](BANK-RECONCILIATION-PLAN.md).
2. **Attendance reporting at the company level** — works for office staff, blind to field staff. Reports built on top of it are misleading until a "field staff" tag excludes them.
3. **Approval workflow coverage** — engine works; only 3 of 6 enum types actually fire approvals (stock-side only). AR/AP/Finance transactions (bills, payments, credit notes, manual journals) all bypass approvals entirely. Full gap analysis in [APPROVALS-PLAN.md](APPROVALS-PLAN.md).
4. **Audit log** — per-entity `createdBy` / `lastModifiedBy` only. No central change-history log queryable by entity / time / user.
5. **Document attachments** — uniform on EmployeeProfile; ad-hoc or absent on most other entities (invoices, bills, expenses, contracts). Real-world workflow needs PDFs attached to every transaction.
6. **Project costing** — Projects exist; not clear if material/labour costs feed into per-project P&L.
7. **Multi-warehouse** — only "Technician Stock" sub-location. No transfers, cycle counts, location-aware reorder points.
8. **Stale standalone script** — [scripts/seed-chart-of-acounts.js](../scripts/seed-chart-of-acounts.js) is the obsolete one-tenant seeder. Real per-tenant COA seeding lives in [companyOnboardingService.js](../app/mongodb/services/companyOnboardingService.js). Standalone script should be deleted or marked deprecated.

---

## ⬜ Missing entirely — critical for Kenyan SMB market

These are the gaps that meaningfully block adoption or daily use:

1. **KRA eTIMS / e-invoicing integration** — Legally mandatory for VAT-registered customers. Without it, customers can't legally issue tax invoices. **Highest priority.**
2. **Recurring transactions** (invoices, bills, journals) — Rent, subscriptions, retainers, depreciation. Manual re-keying every month is the #1 finance staff grind.
3. **In-app + email notifications** — "Leave approved", "Bill due", "Contract expiring", "Payroll ready". The data is all there; no notification surface exists.
4. **Multi-currency with FX rates** — Tourism, exports, USD service contracts. Posting USD into a KES book without FX revaluation produces wrong numbers.
5. **Bank reconciliation UI** — see ⚠️ above.

## ⬜ Missing — high value but not blocking

- **Custom report builder** (drag fields, save, export)
- **CRM / lead pipeline** before quotes
- **Project time tracking + job costing** to project P&L
- **Performance management** (KPIs per employee + review cycles)
- **Recruitment pipeline** (candidate → hire → createEmployee)
- **Training records** with expiry alerts
- **Workflow automation** triggers ("when invoice paid → send thank-you")
- **Vendor / customer scorecards** (on-time delivery, payment-on-time)
- **Custom fields per entity** (avoid schema changes per customer ask)

---

## Suggested next sprints (ranked by impact)

**Sprint 1 — Approvals tightening (in flight)**  
See [APPROVALS-PLAN.md](APPROVALS-PLAN.md) — 6 phases over ~5 days, wires bills/credit notes/journals/etc. into the existing approval engine, adds inline approve/reject + notifications + multi-step.

**Sprint 2 — Bank reconciliation completion**  
See [BANK-RECONCILIATION-PLAN.md](BANK-RECONCILIATION-PLAN.md) — 7 phases over ~6.5 days, adds reconciliation closure, the Bank Rec Statement report, M-Pesa C2B + STK, reviewer step, OFX, multi-currency.

**Sprint 3 — Kenyan compliance**  
KRA eTIMS integration ([ETIMS-PLAN.md](ETIMS-PLAN.md)) — production blocker for VAT-registered customers; can be done in parallel with Sprints 1-2 since it's isolated to invoice flow.

**Sprint 4 — Recurring transactions**  
Templates for recurring invoices, bills, journal entries. Kills the #1 monthly grind.

**Sprint 5 — HR Phase 7.5**  
`remitStatutory()` action + remittance UI on payroll runs.

**Sprint 6 — HR Phase 9 (pick one)**  
Performance management OR Recruitment pipeline — depends on customer ask.

---

## File-path quick reference

| What | Where |
|---|---|
| Models | [app/models/](../app/models/) — 62 files |
| Server actions | [app/mongodb/actions/](../app/mongodb/actions/) |
| Server-only queries | [app/mongodb/queries/](../app/mongodb/queries/) |
| Posting service | [app/mongodb/services/journalService.js](../app/mongodb/services/journalService.js) |
| Tenant onboarding | [app/mongodb/services/companyOnboardingService.js](../app/mongodb/services/companyOnboardingService.js) |
| Permissions | [lib/permissions.js](../lib/permissions.js) |
| Tenant helpers | [lib/utils/tenant-utils.js](../lib/utils/tenant-utils.js) |
| Business rules | [lib/business-rules.js](../lib/business-rules.js) |
| Plan gate | [lib/plan-gate.js](../lib/plan-gate.js) |
| Dashboard routes | [app/dashboard/](../app/dashboard/) — 47 route groups |
| Sidebar nav | [components/sidebar-content-grouped.jsx](../components/sidebar-content-grouped.jsx) |
| HR roadmap (authoritative) | [app/dashboard/hr/HR-ROADMAP.md](../app/dashboard/hr/HR-ROADMAP.md) |
| Approvals plan | [APPROVALS-PLAN.md](APPROVALS-PLAN.md) |
| Bank reconciliation plan | [BANK-RECONCILIATION-PLAN.md](BANK-RECONCILIATION-PLAN.md) |
| eTIMS plan | [ETIMS-PLAN.md](ETIMS-PLAN.md) |
| Earlier ERP roadmap | [erp-dev-roadmap.md](../erp-dev-roadmap.md) (Feb 2026 — partly stale) |

---

## Update protocol

When a module's status meaningfully changes (✅↔🔧↔⬜ transition, major feature lands, major gap discovered), update both:
1. The relevant section in this file
2. The status matrix at the top

Don't let this drift like the older `erp-dev-roadmap.md` did. If a section becomes too long, extract a module-specific roadmap (HR-style) and link to it.
