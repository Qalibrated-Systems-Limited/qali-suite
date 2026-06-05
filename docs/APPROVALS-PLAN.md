# Approvals — Tightening Plan

**Status:** Phase 0 (planning)
**Last updated:** 2026-05-29
**Owner:** Geoffrey

The approval engine is solid; coverage is sparse. This document maps the actual state, identifies the high-impact gaps, and lays out a tight phased plan to bring approvals up to "real ERP" expectations.

For context see [CURRENT-STATE.md](CURRENT-STATE.md). For the precedent doc pattern see [HR-ROADMAP.md](../app/dashboard/hr/HR-ROADMAP.md).

---

## 1. What's actually built (verified)

### The engine — solid

[app/models/approvalRequest.js](../app/models/approvalRequest.js)

- Status state machine: `submitted → applying → approved | rejected | cancelled`
- Atomic claim flow (no double-approve race)
- Snapshot of `targetRef` (Product, InventoryAdjustment, Bill, Invoice, CreditNote) so the approval is decoupled from the source doc lifecycle
- Hardcoded approver matrix per type — SuperAdmin auto-approves all; others role-gated
- Tracks: requester, decision (action, by, timestamp, note), appliedAt, appliedRef (JE if applied)
- Status methods: `canApprove(role, type)`, decision history immutable once set

### Server actions — `app/mongodb/actions/approval-actions.js`

- `submitApproval(payload)` — invoked by other actions; creates the request
- `approveApproval(id, note)` — atomic claim (`submitted → applying → approved`), routes by type to `applyApprovalPayload()` handler, updates `appliedAt` / `appliedRef`
- `rejectApproval(id, note)`
- `cancelApproval(id)` — submitter abort

### Per-tenant threshold config

[app/mongodb/queries/threshold-queries.js](../app/mongodb/queries/threshold-queries.js)

- `settings.approvalThresholds.stockAdjustmentValue` (currency cap)
- `settings.approvalThresholds.stockHighRiskTypes` (array of adjustment types)
- **Limitation:** only stock-related; nothing for bills, payments, invoices, journals.

### UI — central queue exists

[app/dashboard/approvals/](../app/dashboard/approvals/)

- `page.tsx` — main queue (filter by type/status/requester)
- `components/ApprovalDecisionForm.jsx` — approve/reject form

### Permissions

[lib/permissions.js](../lib/permissions.js)

- `canSeeApprovalsNav(role)` — visible to SuperAdmin, Admin, CFO, Finance Manager, Sales Manager
- `ApprovalRequest.canApprove(role, type)` — per-type matrix on the model

---

## 2. Coverage — what's actually gated today

| Transaction type | In enum? | Actually fires `submitApproval`? | Where |
|---|:-:|:-:|---|
| `price_change` | ✅ | ✅ | [stock-actions.js](../app/mongodb/actions/stock-actions.js) — `updateProductPricing()` when selling price < cost or below margin floor |
| `stock_adjustment` | ✅ | ✅ | [adjustment-actions.js](../app/mongodb/actions/adjustment-actions.js) — value above threshold |
| `stock_writeoff` | ✅ | ✅ | same as above when adjustment type is high-risk |
| `bill_payment` | ✅ | ⬜ | not wired — payments auto-post |
| `credit_note` | ✅ | ⬜ | not wired — credit notes auto-post |
| `discount` | ✅ | ⬜ | not wired — discounts on invoices/quotes pass straight through |

So only **3 of 6** enum types actually create approval requests. And those 3 are all on the stock side. The whole AR/AP/Finance side is wide open — anyone with edit rights can post a bill, credit note, discount, or large invoice with zero gate.

---

## 3. Real-world gaps for an SMB ERP

What a mature ERP gates by approval, ranked by financial risk:

| Transaction | Risk | Status here |
|---|---|---|
| Large bill payment | High — outbound cash to supplier | ⬜ not gated |
| Customer credit note | High — reduces revenue, often used for fraud | ⬜ not gated |
| Large invoice discount | Medium — eats margin | ⬜ not gated |
| Manual journal entry | High — bypasses transactional posting; pure book moves | ⬜ not gated |
| Payroll run approval | Critical — biggest cash outflow each month | 🔧 has its own status workflow; doesn't integrate with central approvals |
| Expense claim | Medium — employee reimbursements | 🔧 own state machine, doesn't use ApprovalRequest |
| Customer credit limit change | Medium — exposes AR risk | ⬜ not gated |
| Stock adjustment | High — paper-trail for stock loss/gain | ✅ gated |
| Price change below cost | High — selling at loss | ✅ gated |
| Write-off (any kind) | High — book loss recognition | 🔧 only stock_writeoff via stock adjustment path |

Also missing across the whole engine:

- **No per-transaction-type threshold config** — only stock adjustments have a threshold. Bills, discounts, journals would need their own threshold UI.
- **No inline approve/reject** on transaction detail pages — approvers must visit /dashboard/approvals queue. For high-volume approvers this is friction.
- **No "pending approval" status banner with one-click approve** on the source document.
- **No notifications** — approver doesn't know a request is waiting for them until they happen to check the queue.
- **No delegation** — approver out of office? Their work piles up.
- **No multi-step / sequential approval** — bills over KES 1M might need 2 sign-offs (Accountant + CFO). Engine only supports single-step.
- **No bulk approve** — finance teams want to review 50 small claims at once, not click 50 buttons.

---

## 4. Phased plan

### Phase 1 — Wire the enum-but-not-fired types (1 day)

Goal: the 3 types already in the enum but not wired (`bill_payment`, `credit_note`, `discount`) actually create approval requests.

- [ ] Add per-company threshold config for each type (extend `threshold-queries.js`):
  - [ ] `billPaymentValue` — bills above this need approval before posting
  - [ ] `creditNoteValue` — credit notes above this need approval
  - [ ] `invoiceDiscountPercent` — discounts above this % need approval
- [ ] In [payment-actions.js](../app/mongodb/actions/payment-actions.js) `createPayment()`: when bill payment exceeds threshold, call `submitApproval()` instead of completing immediately. Action returns `{ status: "pending_approval", requestId }`.
- [ ] In [credit-note-actions.js](../app/mongodb/actions/credit-note-actions.js) creation flow: same pattern.
- [ ] In invoice line-item / discount mutation: if discount % above threshold, gate.
- [ ] Extend `applyApprovalPayload()` in `approval-actions.js` to handle each new type — when approved, runs the original posting code.
- [ ] Add Settings → Approval Thresholds UI for admins to set each value (defaults: bill 100k, credit note 50k, discount 15%).
- [ ] Acceptance: a bill payment above threshold creates an approval request; CFO/Admin can approve it; original payment posts on approval.

### Phase 2 — Inline approve/reject on source documents (0.5 day)

Goal: approvers don't have to leave the bill/invoice/credit-note page to act.

- [ ] On each source-document detail page, if `linked ApprovalRequest.status === "submitted"`:
  - [ ] Yellow "Pending Approval" banner with the requester name + request reason
  - [ ] Inline Approve / Reject buttons (role-gated to approvers for that type)
  - [ ] Both buttons open a small dialog for the decision note
- [ ] On Approve: server action calls `approveApproval(id, note)` → server-side redirect back to the same detail page; the banner is gone, document is now in its approved state
- [ ] Acceptance: an approver can approve a pending bill payment from the bill detail page in 2 clicks (no leaving the page).

### Phase 3 — Manual journal entry gate + write-offs (1 day)

Goal: manual journals (which bypass transactional posting) require approval; pure write-offs are gated.

- [ ] Add `journal_entry` and `write_off` to ApprovalRequest type enum
- [ ] Add threshold config for both (per-company)
- [ ] In [journal-actions.js](../app/mongodb/actions/journal-actions.js) `createManualJournalEntry()`: gate when amount above threshold; default threshold = 0 (every manual JE requires approval) since these bypass document workflow
- [ ] Treat write-offs (AR bad debt, AP forgiveness, inventory) as their own type
- [ ] Apply handler runs the posting on approval
- [ ] Acceptance: an Accountant can no longer post a 5M manual journal without CFO approval.

### Phase 4 — Notifications (1 day)

Goal: approvers know there's work waiting. Cross-cutting with CURRENT-STATE.md "missing — notifications" gap.

- [ ] Create a minimal Notification model: `{ companyId, userId, kind, subject, body, link, status: unread|read|dismissed, createdAt }`
- [ ] Bell icon in topbar (badge with unread count); dropdown shows 10 most recent + "View all" link
- [ ] On `submitApproval()`: find users matching `requiredApproverRoles` for this company, create notifications for each
- [ ] On `approveApproval()` / `rejectApproval()`: notify the requester of the outcome
- [ ] Acceptance: when a bill payment approval is submitted, all eligible approvers get a bell badge update; when approved, requester gets a notification.

### Phase 5 — Multi-step + delegation (1 day)

Goal: real corporate approval chains.

- [ ] Add `chain` to ApprovalRequest: `[{ stepNumber, requiredRoles, approvedBy, approvedAt, status }]`
- [ ] Per-tenant config: which transaction types need multi-step (e.g. "bills > 1M need Accountant + CFO")
- [ ] On approve: advance to next step if any; only fire `applyApprovalPayload()` after the last step
- [ ] Add delegation: user profile setting "delegate my approvals to X when I'm out from date A to B". On request creation, if requester's eligible approver is delegating in that window, route to delegate.
- [ ] Acceptance: a 5M bill payment routes Accountant → CFO sequentially; if CFO has delegated to Finance Manager, request goes there instead.

### Phase 6 — Bulk approve + queue polish (0.5 day)

Goal: finance teams can review batches without clicking 50 buttons.

- [ ] Checkbox column on /dashboard/approvals queue
- [ ] "Approve selected" / "Reject selected" with one decision note applied to all
- [ ] Filter chips: "My approvals" (where current user is eligible approver), "Mine submitted" (where current user is requester)
- [ ] Quick filters for type, age, requester
- [ ] Acceptance: a CFO can approve 20 small bill payments under a uniform rationale in 3 clicks.

---

## 5. Out of scope

- **Risk scoring / AI auto-approve** — too clever, breaks audit trail
- **External approval (Slack/email button)** — defer until customers ask; needs email infra anyway
- **Approval analytics dashboard** — nice to have, low priority

---

## 6. Estimates

| Phase | Estimate | Cumulative |
|---|---|---|
| 1. Wire bill/credit/discount + thresholds UI | 1 day | 1 day |
| 2. Inline approve/reject on source docs | 0.5 day | 1.5 days |
| 3. Manual journal + write-off gates | 1 day | 2.5 days |
| 4. Notifications | 1 day | 3.5 days |
| 5. Multi-step + delegation | 1 day | 4.5 days |
| 6. Bulk + queue polish | 0.5 day | **5 days total** |

---

## 7. Sign-off protocol

Before merging each phase: check every checkbox, manual smoke-test in dev, update `CURRENT-STATE.md` to flip approvals row toward ✅. Don't skip a phase to chase a later one — each phase is independently shippable and each builds on the prior's data model.
