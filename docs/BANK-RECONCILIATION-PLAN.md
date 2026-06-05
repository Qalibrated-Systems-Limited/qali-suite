# Bank Reconciliation — Tightening Plan

**Status:** Phase 0 (planning)
**Last updated:** 2026-05-29
**Owner:** Geoffrey

The banking module is more mature than I credited in earlier docs — full CSV import wizard, line-by-line allocation, auto-matching with confidence scoring. What's missing is the **reconciliation closure layer** that turns "matched bank lines" into a defensible, period-locked accounting reconciliation, plus the standard Bank Reconciliation Statement report, plus M-Pesa integration for the Kenyan SMB market.

For context see [CURRENT-STATE.md](CURRENT-STATE.md).

---

## 1. What's actually built (verified)

### Models — well-shaped

[app/models/bankFeed.js](../app/models/bankFeed.js)

**`BankStatement`** (lines 9–118): one per imported statement file
- `bankAccountId`, `statementPeriod {startDate, endDate}`
- `status`: processing → ready → completed → error
- `stats`: totalLines / allocatedLines / excludedLines / unallocatedLines / totalDebits / totalCredits
- `openingBalance`, `closingBalance`, `balanceSource` (from_file | manual | unavailable)
- `columnMapping`, `dateFormat`, `uploadedBy`

**`BankFeedLine`** (lines 124–326): one per transaction in a statement
- `transactionDate`, `description`, `reference`
- `debitAmount`, `creditAmount`, `runningBalance`
- `status`: unallocated → allocated → excluded → matched
- `excludeReason`: duplicate | opening_balance | bank_charge | bank_interest | reversal | internal_transfer | personal | manual
- `allocationType`: invoice_payment | bill_payment | expense | income | transfer | split | manual_journal
- `matchedDocument {type, documentId, documentNumber, partyId, partyName}`
- `allocations`: array of {account, amount}
- `journalEntryId` — links to the JE created on allocation
- `suggestions` — auto-generated match proposals with confidence scores
- `allocatedBy`, `allocatedAt`

### Import flow — full wizard

[app/dashboard/banking/upload/UploadWizard.jsx](../app/dashboard/banking/upload/UploadWizard.jsx) (1500 lines)

- CSV upload + column mapping (debit/credit pairs or single amount column)
- Multi-format date parsing (DD/MM/YYYY, DD.MM.YYYY, YYYY-MM-DD)
- Manual opening/closing balance override
- Duplicate detection via per-line hash

### Allocation — sophisticated

[app/dashboard/banking/[id]/AllocationDialog.jsx](../app/dashboard/banking/[id]/AllocationDialog.jsx) (1529 lines)

- 7 allocation types: invoice payment, bill payment, expense, income, transfer, split, manual journal
- Auto-suggests matches from unpaid invoices + bills

### Auto-matching — confidence-scored

[app/mongodb/services/bankFeedService.js](../app/mongodb/services/bankFeedService.js)

- `autoMatchLines()` runs async after import
- Scoring: amount match (40 pts exact, 25 pts ±5%), reference in description (35 pts), party name words in description (25 pts max)
- 30+ pts = suggested; 95+ pts with 15-pt gap = auto-allocated
- Generates JE on auto-allocate

### Pages

| Path | What |
|---|---|
| [/banking/(statements)/page.jsx](../app/dashboard/banking/(statements)/page.jsx) | Statement list, bulk upload, filter |
| [/banking/[id]/page.jsx](../app/dashboard/banking/[id]/page.jsx) | Statement detail, stats, drill-down |
| [/banking/[id]/BankFeedLinesTable.jsx](../app/dashboard/banking/[id]/BankFeedLinesTable.jsx) | Paginated line table |
| [/banking/[id]/StatementActions.jsx](../app/dashboard/banking/[id]/StatementActions.jsx) | Bulk exclude, rerun match, mark complete |
| [/banking/unallocated/page.jsx](../app/dashboard/banking/unallocated/page.jsx) | Cross-statement unallocated queue |

---

## 2. Gaps — what's missing

### Critical gaps (these define "real reconciliation")

| Gap | Why it matters |
|---|---|
| **No closed-period concept** | After matching, the period can't be "locked" as reconciled. An accountant can re-edit a line that was already part of last month's reconciliation, silently invalidating the prior month's books. |
| **No balance verification** | Statement's `closingBalance` (from the bank) is not checked against the GL running balance on the same account. The whole *point* of bank reconciliation is to prove these match. Currently nothing does. |
| **No Bank Reconciliation Statement report** | The standard accounting deliverable — `Book Balance ± Outstanding Items = Bank Balance` — doesn't exist. Auditors expect this; tax authorities ask for it; the boss asks for it monthly. |
| **No unposted cheque / outstanding deposit tracking** | Real bank rec has items "in transit" (cheque issued by us but not yet cleared by bank, deposit received but not yet credited). System has no concept. |
| **No multi-currency support** | Bank account in USD with KES book — no FX revaluation on rec date. |

### Convenience gaps (slow but not blocking)

- **No OFX/MT940 import** — CSV only. Some Kenyan banks export OFX; many corporates use MT940
- **No bank-feed-pull integration** — manual upload only; no Plaid/Stitch/local-Kenya equivalent for auto-fetch
- **No M-Pesa C2B webhook** — incoming Mpesa payments don't auto-flow into bank feed lines. Accountants manually create them. This is the #1 missed-money cause in Kenyan SMB books.
- **No M-Pesa STK push** — can't generate an invoice payment request from the invoice detail page
- **No fuzzy match on description** — only word-token party name matching; misses common abbreviations
- **No "learn from corrections" loop** — when accountant overrides an auto-match, system doesn't remember the pattern for next time

### Audit gaps

- **No reconciliation history / change log** — once allocated, who allocated it and when is stored on the line, but bulk changes to a statement aren't logged
- **No reviewer step** — junior accountant allocates → senior signs off → period closes. Currently single-step.

---

## 3. Phased plan

### Phase 1 — Reconciliation closure (1 day)

Goal: turn "all lines matched" into "this period is officially reconciled and locked." This is the single most-asked-for missing piece.

- [ ] Add `BankReconciliation` model: `{ companyId, bankAccountId, periodStart, periodEnd, bookOpeningBalance, bookClosingBalance, bankOpeningBalance, bankClosingBalance, status (draft | locked), lockedBy, lockedAt, statementIds[], reconcilingItems[] }`
- [ ] `reconcilingItems[]` captures the "outstanding items" — cheques issued but not cleared, deposits in transit, bank-side items not yet booked. Shape: `{ kind, description, amount, source }`
- [ ] On statement detail page: "Mark as Reconciled" button (visible only when all lines are allocated/excluded). Click → creates the BankReconciliation record, prompts for any outstanding items, calculates the rec gap, surfaces it.
- [ ] If `bookClosingBalance - bankClosingBalance - sum(reconcilingItems)` is not zero → block the lock; show the user the discrepancy with suggested causes
- [ ] When locked, BankFeedLines in this period become read-only (status `matched` and `lockedBy` set)
- [ ] Acceptance: a fully-allocated statement can be marked reconciled, system verifies balance math, period locks against further edits.

### Phase 2 — Bank Reconciliation Statement report (0.5 day)

Goal: the standard accounting deliverable.

- [ ] Add `app/dashboard/reports/bank-reconciliation/` page
- [ ] For a chosen bank account + period: render the standard layout:

```
                    BANK RECONCILIATION STATEMENT
                    Account: Bank — Main
                    For period: 2026-05-01 to 2026-05-31

Balance per Bank Statement (closing)            KES 1,234,567.00
  Add: Deposits in transit                            45,000.00
  Less: Outstanding cheques                          (12,500.00)
  ────────────────────────────────────────────  ──────────────
Adjusted Bank Balance                           KES 1,267,067.00

Balance per General Ledger (closing)            KES 1,267,067.00
  ────────────────────────────────────────────  ──────────────
Difference                                              0.00 ✓
```

- [ ] Export to PDF + CSV
- [ ] Acceptance: accountant can generate a bank-rec statement for any reconciled period and hand it to auditor.

### Phase 3 — M-Pesa C2B webhook (1.5 days)

Goal: incoming Mpesa payments auto-flow into bank feed lines, so accountants don't have to type them.

- [ ] Per-tenant M-Pesa config: paybill/till number, consumer key, consumer secret, validation URL (stored encrypted)
- [ ] Settings → Banking → M-Pesa Integration page (admin-only, like eTIMS pattern)
- [ ] Register C2B URLs with Safaricom Daraja sandbox first
- [ ] Webhook handler at `/api/banking/mpesa/c2b/[tenantId]` that creates a BankFeedLine in real time
- [ ] Reuse auto-match scoring — incoming Mpesa with a known reference field auto-allocates to the invoice
- [ ] Acceptance: a real Mpesa payment to the tenant's paybill creates a bank feed line within seconds; if it carries an invoice number in the reference, it auto-allocates.

### Phase 4 — M-Pesa STK push (1 day)

Goal: invoice → click "Request Mpesa payment" → customer's phone rings → they enter PIN → invoice marked paid.

- [ ] On invoice detail page: "Request Mpesa payment" button (when invoice is unpaid + customer has phone)
- [ ] Server action: calls Daraja STK push API with phone + amount + invoice number as reference
- [ ] Webhook on payment confirmation → reuse C2B flow to auto-allocate
- [ ] Acceptance: customer pays in <30 seconds end-to-end without retyping anything.

### Phase 5 — Reviewer step + audit log (1 day)

Goal: junior allocates, senior approves, period closes with sign-off trail.

- [ ] Add `reviewedBy`, `reviewedAt`, `reviewNote` to BankReconciliation
- [ ] Two-stage lock: `draft → submitted_for_review → locked`
- [ ] Reviewer (Accountant / CFO / Finance Manager) sees pending reconciliations in their dashboard
- [ ] Audit log for the BankReconciliation lifecycle and any post-lock unlock action
- [ ] Acceptance: a junior accountant submits a reconciliation; CFO approves; period locks with both signatures captured.

### Phase 6 — OFX import (0.5 day)

Goal: support OFX-format statements alongside CSV.

- [ ] Add OFX parser (use `ofx-js` or similar)
- [ ] Wizard detects file type, switches parser
- [ ] Same downstream code path
- [ ] Acceptance: an OFX file uploads successfully and produces the same BankFeedLines a CSV would.

### Phase 7 — Multi-currency revaluation (1 day)

Goal: USD or EUR bank account works correctly against KES books.

- [ ] Add `currency` to BankAccount
- [ ] FX rate table (effective-date-ranged, per company)
- [ ] On import: store both `amount` (original currency) and `amountFunctional` (KES at rate-on-date)
- [ ] On lock: compute unrealised FX gain/loss; post to a "FX Gain/Loss" account
- [ ] Acceptance: a USD bank statement reconciles cleanly against KES books with a clear FX line.

---

## 4. Out of scope

- **Bank-feed-pull integration** (Plaid, Stitch, local equivalents) — most don't cover Kenyan banks well; manual CSV/OFX upload remains the most reliable path for our market
- **Learn-from-corrections ML** — too clever, breaks audit trail, defer
- **Standing instruction / scheduled payments** — separate cash-management feature

---

## 5. Estimates

| Phase | Estimate | Cumulative |
|---|---|---|
| 1. Reconciliation closure | 1 day | 1 day |
| 2. Bank Reconciliation Statement report | 0.5 day | 1.5 days |
| 3. M-Pesa C2B webhook | 1.5 days | 3 days |
| 4. M-Pesa STK push | 1 day | 4 days |
| 5. Reviewer step + audit log | 1 day | 5 days |
| 6. OFX import | 0.5 day | 5.5 days |
| 7. Multi-currency revaluation | 1 day | **6.5 days total** |

The Mpesa pieces (Phases 3-4) deserve some buffer for Daraja sandbox onboarding and the inevitable "their docs lie" debugging — probably 1.5x estimates.

---

## 6. Sequencing within the plan

Phases 1 & 2 must come together — closure without a report is half a feature; report without closure has no data to render against. Do them as one milestone.

Phases 3 & 4 can be done independently of 1 & 2 but depend on each other (C2B and STK share the M-Pesa client and credentials).

Phase 5 builds on Phase 1 (the lock concept). Don't do 5 before 1.

Phases 6 & 7 are independent of everything else; slot wherever capacity exists.

**Recommended order:** 1 → 2 → 3 → 4 → 5 → 6 → 7.

---

## 7. Sign-off protocol

Same as Approvals plan: check every box, smoke-test, update CURRENT-STATE.md per phase. Don't roll multiple phases into a single PR — too much surface area for review.
