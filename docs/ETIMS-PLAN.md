# KRA eTIMS — Plan & Phased Checklist

**Status:** Phase 0 (planning)
**Last updated:** 2026-05-29
**Owner:** Geoffrey

This document is the implementation plan for integrating Qalisuite with KRA's eTIMS (Electronic Tax Invoice Management System).

Each phase has its own checklist. Tick boxes as work lands. Don't start the next phase until the previous one is fully `[x]`'d and verified in a sandbox tenant. This is a regulated integration — moving fast without sign-off creates legal liability for our customers.

---

## 1. Why this matters

Since November 2023, KRA legally requires every VAT-registered business in Kenya to issue tax invoices through eTIMS. Sales recorded outside eTIMS are not legally claimable as input VAT by the buyer, expose the seller to penalties, and increasingly trigger automated tax audits because KRA cross-references each tax invoice with the buyer's claims in real time.

**Concrete consequences for our customers without this:**
- They cannot legally invoice a VAT-registered customer over the threshold
- Their buyers can't claim input VAT, so they get pushed off as suppliers
- iTax monthly returns become a mismatch nightmare
- Risk of penalties and (for repeat issues) trade licence cancellation

**For Qalisuite as a SaaS:** this is the #1 hard adoption blocker for VAT-registered customers. Without eTIMS we can sell to micros and exempt businesses only.

---

## 2. How eTIMS works (the model in 90 seconds)

KRA exposes eTIMS via three integration shapes:

| Shape | When it fits |
|---|---|
| **OSCU** — Online Sales Control Unit | Software-only integration to KRA's cloud. **This is what we use.** |
| **VSCU** — Virtual Sales Control Unit | On-premise box for large enterprises that can't depend on internet. Not our market. |
| **eTIMS Lite** | Web portal for the smallest businesses — they type each invoice themselves. We replace this for our customers. |

The flow for every taxable sale:

```
ERP                              eTIMS (OSCU)
─────                            ─────────────
1. User finalises invoice
2. POST /invoice with structured tax payload  →
                                            3. KRA validates schema + signs it
                                            4. Returns: CUIN, signature,
                                               timestamp, internal data, QR
5. Store the eTIMS response
   against the invoice
6. Re-render invoice PDF
   with CUIN + signature + QR
7. Hand PDF to customer
   (or email it)                            8. KRA cross-references with
                                               buyer's input VAT claim
```

**What KRA returns and we MUST capture:**
- `cuin` — Control Unit Invoice Number (eTIMS-assigned, globally unique)
- `signature` — KRA's cryptographic signature over the invoice payload
- `internalData` — KRA's internal reference for the transaction
- `receiptDate` / `timestamp` — server-time of registration
- `qrCode` — a URL the buyer can scan to verify the invoice on KRA's portal

Without these four on the PDF, the invoice is not a legal tax invoice.

**For credit notes:** the same flow, plus a KRA-defined "reason code" (price change, return, error correction, etc.) and a reference to the original invoice's CUIN.

---

## 3. What needs to be true about our data

eTIMS validates strict shapes. Our data must satisfy:

| Field | Where it lives now | What eTIMS needs |
|---|---|---|
| **Seller PIN** | Per-tenant Company doc (probably) | KRA PIN (P051234567X format) |
| **Buyer PIN** | Party — likely not stored | KRA PIN; required for B2B; optional for B2C |
| **Buyer name + address** | Party | Mandatory; must match KRA records for VAT customers |
| **Item HS/UNSPSC code** | Product — currently absent | UNSPSC or HS code per line item |
| **Item tax category** | Product — currently absent | A/B/C/D/E (16% VAT / Zero / Exempt / Non-VAT / RVAT) |
| **Currency** | Invoice | KES default; FX rate required if non-KES |
| **Date format** | Invoice | ISO 8601, KRA timezone |
| **Total + tax breakdown** | Invoice | Per-category subtotal + tax — we compute, eTIMS verifies |

So before any submission code can work, we need product tax classification + customer PIN capture. Those are foundational; treat them as Phase 1.

---

## 4. Gating model (this is critical)

Per the user's explicit ask: **eTIMS submission is opt-in, not automatic.** Users / accountants must indicate they need a posting to flow through eTIMS. The rules:

### Tenant-level gate
- `Company.etims.enabled = false` by default for every tenant
- Admin enables it in Settings → eTIMS Configuration after entering credentials
- Until enabled, every eTIMS UI affordance is hidden

### Per-invoice gate
- Enabling at tenant level does **not** auto-submit invoices on completion
- Each invoice has a "Send to eTIMS" button shown on the detail page once it's `completed`
- Submission requires a deliberate click — never fires from `completeInvoice()` itself
- After submission, the invoice locks against item edits (eTIMS would need a void + resubmit)

### Configurable auto-submit (opt-in within opt-in)
- Per-tenant flag `etims.autoSubmitOnComplete = false` by default
- Admin can flip it on once they're confident in their data quality
- Even when on, certain conditions skip auto-submit:
  - Customer marked "exempt from eTIMS" (manual flag on Party)
  - Invoice marked "exclude from eTIMS" (per-invoice flag — used for intercompany, write-offs)
  - Validation fails (missing PIN, missing tax category) — surface to user, don't submit

### Permissions
| Action | Roles allowed |
|---|---|
| Configure eTIMS (credentials, defaults, toggle auto-submit) | Admin · CFO |
| Submit invoice to eTIMS | Admin · CFO · Accountant · Sales Manager |
| Re-submit / void submission | Admin · CFO · Accountant |
| View submission status | Anyone who can view the invoice |
| Configure product tax categories | Admin · Accountant |
| Set customer PINs | Admin · Accountant · Sales |

### Sandbox vs. production
- KRA exposes a sandbox endpoint for testing
- Per-tenant: `etims.env = "sandbox" | "production"` (default sandbox)
- Visual indicator: all eTIMS UI shows a yellow "SANDBOX" badge until env flipped to production
- Switching to production requires a separate confirm + admin re-auth

---

## 5. Phased implementation checklist

Each phase is independently shippable. Don't merge a phase until every checkbox is ticked. Don't start the next until the prior is verified in a sandbox tenant.

### Phase 1 — Foundations: data model + per-tenant config

Goal: schema and config UI exist; no actual submission yet.

- [ ] Create `app/models/etimsConfig.js` — per-tenant config (pin, apiKey, env, autoSubmit, defaults)
- [ ] Create `app/models/etimsSubmission.js` — one row per submission attempt (invoiceId, status, cuin, signature, qrCode, rawRequest, rawResponse, attemptedBy, attemptedAt, errors[])
- [ ] Add fields to `app/models/invoice.js`:
  - [ ] `etims.requiredForThisInvoice` (Boolean, default true — false for exempt / internal)
  - [ ] `etims.submissionId` (ObjectId ref ETimsSubmission, sparse)
  - [ ] `etims.status` enum: `not_required | pending | submitted | failed | voided`
  - [ ] `etims.cuin`, `etims.signature`, `etims.qrCode` snapshot for PDF rendering without lookup
- [ ] Add fields to `app/models/creditNote.js` — same shape
- [ ] Add `kraPin` to `app/models/parties.js` (Party / customer), `requiresEtims` flag, optional `etimsExempt` flag
- [ ] Add `taxCategory` enum + `hsCode` String to `app/models/product.js`
- [ ] Add `etims` block to `app/models/Company.js` with `enabled`, `env`, `pin`, `autoSubmitOnComplete` (credentials live separately — see Phase 4)
- [ ] Build `app/dashboard/settings/etims/` page with:
  - [ ] Admin-only role gate
  - [ ] Enable/disable toggle
  - [ ] Sandbox/production env toggle (with "you sure?" confirm for production)
  - [ ] Auto-submit toggle (default off)
- [ ] Add `etims` permission helpers in `lib/permissions.js`
- [ ] Update `companyOnboardingService.js` to default `etims.enabled = false`
- [ ] Type-check + build
- [ ] **Acceptance:** Admin can open Settings → eTIMS, toggle enabled, see the toggle persist; no other UI changes.

### Phase 2 — Product tax classification

Goal: every product has KRA tax category + HS code. Bulk-fixable for existing data.

- [ ] Add tax category enum constants (`A=16% VAT`, `B=Zero`, `C=Exempt`, `D=Non-VAT`, `E=RVAT`) in `lib/business-rules.js` or a new `lib/etims-codes.js`
- [ ] Add `taxCategory` + `hsCode` to Product form (create + edit)
- [ ] Add column on Products list page showing classification status (chip: "Classified" / "Needs classification")
- [ ] Bulk-classify action: select multiple products → set tax category in one call
- [ ] Add server-side validator: when eTIMS enabled for tenant, prevent posting invoice with line items pointing to unclassified products (return clear error: "Product X has no tax category set — go to Products → Edit → Classify")
- [ ] Acceptance: existing tenants can classify all their products in <10 minutes; new products require classification before save when eTIMS enabled.

### Phase 3 — Customer KRA PIN capture

Goal: every B2B customer has a valid PIN; UI surfaces missing PINs.

- [ ] Add `kraPin` to Party form
- [ ] PIN format validator: `P[0-9]{9}[A-Z]` regex; show inline error
- [ ] `requiresEtims` toggle on Party (default true for `customerType: "business"`, false for `individual`)
- [ ] Banner on customer list: "X of Y customers missing KRA PIN" with one-click filter
- [ ] On invoice creation, if customer.requiresEtims and !customer.kraPin → warning chip ("Will fail eTIMS submission until customer PIN added")
- [ ] Acceptance: customer list filters work; invoices warn (don't block) when customer is missing PIN.

### Phase 4 — eTIMS API client

Goal: a tested HTTP wrapper around KRA's OSCU endpoints, plus secret management.

- [ ] Store API credentials in a separate secret store, NOT on the Company document. Options:
  - [ ] Encrypted in a dedicated `app/models/etimsCredential.js` model (KMS or app-level encryption)
  - [ ] OR (preferred) env-var per tenant via a secrets vault if one exists
  - [ ] Decide and document the choice here ⚠️
- [ ] Create `lib/etims/client.js`:
  - [ ] `createInvoice(payload, tenantConfig)` → POST to OSCU
  - [ ] `voidInvoice(cuin, tenantConfig)` → POST to OSCU
  - [ ] `getStatus(cuin, tenantConfig)` → GET from OSCU
  - [ ] Handles sandbox vs. production base URL switching
  - [ ] Timeout: 30s
  - [ ] Idempotency: every request carries a UUID; server-side dedupe to avoid double-submit on retry
- [ ] Build the request payload mapper in `lib/etims/mapper.js`:
  - [ ] Invoice → KRA payload (line items, totals, tax breakdown by category, customer block, currency)
  - [ ] Credit note → KRA payload (with reason code + original CUIN reference)
- [ ] Build the response mapper: KRA response → our ETimsSubmission record
- [ ] Add tests (Vitest) for both mappers — these are pure functions and must be correct
- [ ] Acceptance: client can submit a fixture invoice to KRA's sandbox and get back a CUIN, all logged in ETimsSubmission.

### Phase 5 — Submission flow (the user-facing button)

Goal: completed invoices can be submitted by clicking a button.

- [ ] On the invoice detail page, when `status === "completed"` AND tenant `etims.enabled` AND `etims.requiredForThisInvoice`:
  - [ ] Show "Submit to eTIMS" button (role-gated)
  - [ ] Shows current `etims.status` badge
- [ ] Server action `submitInvoiceToEtims(invoiceId)`:
  - [ ] Auth + role check
  - [ ] Validates: customer has PIN, all line items have tax category, invoice not already submitted
  - [ ] Builds payload via mapper
  - [ ] Creates ETimsSubmission with status `pending`
  - [ ] Calls eTIMS client
  - [ ] On success: updates submission + invoice (cuin, signature, qrCode, status = `submitted`)
  - [ ] On failure: updates submission with `failed` + error list; invoice status = `failed` (retryable)
  - [ ] Server-side `redirect()` back to the invoice detail (per the new pattern we use in KPIs)
- [ ] Implement opt-in auto-submit:
  - [ ] If tenant `etims.autoSubmitOnComplete === true` AND invoice eligible, hook into `completeInvoice()` to call `submitInvoiceToEtims()` after successful posting
  - [ ] Failure mode: invoice posts to GL successfully; eTIMS submission failure shows on detail page as retryable
- [ ] Acceptance: a completed invoice can be submitted to sandbox, returns a CUIN, and the invoice detail page shows the badge change without a page reload race.

### Phase 6 — PDF compliance rendering

Goal: invoice PDFs include the eTIMS bits required for the legal tax invoice.

- [ ] Update invoice PDF template (`app/dashboard/invoices/[id]/download.jsx` or equivalent):
  - [ ] CUIN printed near header
  - [ ] Signature string (likely below totals)
  - [ ] eTIMS receipt date / timestamp
  - [ ] QR code rendered (use `qrcode` npm package; KRA returns a URL)
- [ ] Same updates to credit note PDF
- [ ] When `etims.status !== "submitted"`: PDF shows "Not a tax invoice — pending eTIMS" watermark or banner (visual signal so accountants don't accidentally send unsubmitted invoices to customers)
- [ ] Acceptance: a submitted invoice PDF passes visual review against KRA's published spec.

### Phase 7 — Credit notes

Goal: credit notes go through the same flow with reason codes.

- [ ] Reason code enum per KRA spec (price change, return, error correction, discount, other)
- [ ] Credit note form requires reason code when tenant `etims.enabled`
- [ ] Server action `submitCreditNoteToEtims(creditNoteId)` mirrors invoice submission
- [ ] Credit note PDF includes CUIN + reference to original invoice CUIN
- [ ] Acceptance: a credit note against an eTIMS-submitted invoice can be submitted and shows linkage.

### Phase 8 — Monitoring & bulk handling

Goal: accountants can see and fix any failed/pending submissions.

- [ ] Build `app/dashboard/tax/etims/` page:
  - [ ] Tabs: All / Pending / Submitted / Failed
  - [ ] Filterable by date, customer, status
  - [ ] Per-row actions: View payload, View raw response, Retry (failed only)
- [ ] Bulk-retry action: select failed submissions → resubmit
- [ ] Email digest (optional, later): daily summary of failed submissions to Accountant role
- [ ] Acceptance: any failed submission is visible, root-causable from the raw response, and one-click retryable after a fix.

### Phase 9 — Reconciliation & sync

Goal: monthly tax filing matches what eTIMS has on record.

- [ ] Build "eTIMS Reconciliation" report:
  - [ ] Compares Invoice + CreditNote in our DB vs. eTIMS sales register for a period
  - [ ] Flags: in DB but missing from eTIMS, in eTIMS but missing from DB, amount mismatches
- [ ] Optional: scheduled job to pull KRA's record once daily and reconcile automatically
- [ ] Hook into existing VAT Return report so the iTax filing reads from eTIMS-confirmed transactions only
- [ ] Acceptance: VAT return month-end ties cleanly to KRA's eTIMS register; mismatches are surfaced before filing.

---

## 6. What we are deliberately NOT doing

Scope discipline matters; flagging these so they don't creep in:

- **No POS receipts (Type C control units)** — that's a different KRA flow with hardware. Not in scope.
- **No automatic PIN lookup from KRA** — accountants enter PINs; KRA has a verify endpoint we may use later for validation only.
- **No real-time auto-submit on every action** — submissions are deliberate, even when "auto" is enabled (they fire on the completion event, not on every line-item edit).
- **No tax computation override** — we keep our internal tax logic; eTIMS validates it. If KRA disagrees, that's a payload bug, not a UI surface for users.

---

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| KRA API outage during business hours | Medium | High | Queue submissions for retry; never block invoice completion on eTIMS |
| Tenant credentials leak | Low | Catastrophic | Encrypted at rest, never logged, never returned to client |
| Bad data submitted (wrong PIN, wrong tax category) | High | Medium | Validation in Phase 1-3 prevents most; failed submissions are recoverable |
| Schema mismatch when KRA changes API | Medium | High | Mappers are unit-tested; deploy contract tests to sandbox weekly |
| Double-submission on retry | High | Medium | Idempotency UUID in every request; KRA returns 200 with original CUIN on dup |
| Customer doesn't accept the QR-coded PDF | Low | Low | Documented "this is the new legal format" + FAQ link |

---

## 8. Sequencing & estimates

| Phase | Estimate | Dependencies | Notes |
|---|---|---|---|
| 1. Foundations + config | 1 day | None | Pure schema + UI; no external dep |
| 2. Product tax classification | 1 day | Phase 1 | Bulk-classify UI is the heaviest piece |
| 3. Customer PIN capture | 0.5 day | Phase 1 | Mostly form + validator |
| 4. API client + mappers | 2 days | Phases 1-3 | Mapper tests are non-negotiable here |
| 5. Submission flow + button | 1 day | Phase 4 | Server action + UI |
| 6. PDF rendering | 1 day | Phase 5 | QR + signature + layout work |
| 7. Credit notes | 0.5 day | Phase 5 | Mostly re-uses Phase 5 infrastructure |
| 8. Monitoring dashboard | 1 day | Phases 5-7 | Pure read-side |
| 9. Reconciliation | 1.5 days | All prior | Heaviest analytical piece |
| **Total** | **~9 days focused work** | | |

---

## 9. Open questions to resolve before Phase 4

These need answers before we touch the API client:

- [ ] **Credential storage strategy.** App-level encrypted Mongo doc, AWS Secrets Manager, env per tenant, or something else? Affects Phase 4 design.
- [ ] **Which KRA OSCU API version are we targeting?** OSCU v1 vs. v2 — pull current spec at start of Phase 4.
- [ ] **Are we becoming a KRA-authorised software vendor ourselves?** This affects whether each tenant uses their own KRA credentials or whether we get one set of vendor credentials. **Big decision.** Best to assume per-tenant credentials and revisit if KRA's onboarding process favours vendor-level.
- [ ] **Sandbox account procurement.** Who's getting the KRA sandbox credentials, and when? Phase 4 is blocked until we have working sandbox access.
- [ ] **PDF compliance review.** Once Phase 6 is built, have an actual KE accountant review the output before we ship to production.

---

## 10. Sign-off protocol

Before starting Phase N+1:

1. All checkboxes in Phase N ticked
2. Manual smoke test of Phase N in a sandbox tenant — record the test in CHANGELOG.md
3. Update CURRENT-STATE.md to flip the row from ⬜ → ✅ (or 🔧 if partial)
4. Note any deviations from this plan inline in the relevant Phase section

If a phase requires significant deviation from this plan, update this document before proceeding rather than letting reality drift away from the doc.

---

## References

- [KRA eTIMS official portal](https://etims.kra.go.ke/) — sign up for sandbox here
- [KRA Tax Invoice (Electronic Tax Invoice) Regulations, 2023] — the legal text driving this
- [CURRENT-STATE.md](CURRENT-STATE.md) — overall system status
- [HR-ROADMAP.md](../app/dashboard/hr/HR-ROADMAP.md) — the precedent for module-level roadmap docs
