# ERP Project Module — Updated Architecture Notes (Construction & Engineering)

## 1. Current Status

The existing Project schema is already production-grade and correctly linked to:

* Expenses
* Supplier Bills
* Customer Invoices
* Claims
* Financial journal entries

This is the correct ERP-first design.

Financial linkage is more important than task management.

---

## 2. Important Concerns Identified

The following items should be added to avoid future limitations in construction projects.

These are NOT emergency fixes.
They are structural improvements.

---

## 3. Parent Project / Subproject Support

### Problem

Construction projects are often divided:

Example:

```
Highway Construction
    Section A
    Section B
    Section C
```

or

```
Office Building
    Foundation
    Structure
    Finishing
```

Without hierarchy:

* reporting becomes messy
* managers cannot group related work
* budgeting becomes hard

---

### Solution

Add optional field:

```
parentProjectId
```

IMPORTANT:

This must remain OPTIONAL.

Do NOT force it.

---

### Critical Safety Note

Adding parentProjectId WILL NOT break your system.

Why:

Financial documents already store:

```
projectId
```

They will continue referencing the same project.

Parent project is only for reporting hierarchy.

It does NOT change financial ownership.

---

### How reporting should behave

If project has parent:

```
child revenue rolls into parent totals
```

But transactions remain linked only to the original project.

Never rewrite existing transaction links.

---

---

## 4. Billing Model Support (Very Important)

Construction companies use different billing approaches.

Add:

```
billingModel:
    fixed
    milestone
    time_material
```

This prevents future invoice logic conflicts.

---

---

## 5. Contract Value Storage

Projects should store:

```
contractValue
```

Reason:

Needed for:

* revenue forecasting
* % completion billing
* profitability tracking

---

---

## 6. Progress Tracking

Managers always ask:

```
"How complete is the project?"
```

Add:

```
progressPercent
```

Simple numeric field.

Do NOT overcomplicate.

---

---

## 7. Cost Codes (Highly Recommended)

Construction accounting requires cost categorisation:

Examples:

* Labour
* Materials
* Equipment
* Transport
* Subcontractor

Create separate collection:

```
ProjectCostCode
```

Transactions should optionally store:

```
costCodeId
```

This enables proper financial breakdown reports.

---

---

## 8. What MUST NOT change

The following parts of the current design are correct and should remain:

✔ Financial totals cached on project
✔ Budget advisory only (not blocking)
✔ Project optional in ERP transactions
✔ Company-scoped uniqueness
✔ Lifecycle status transitions

These match real ERP best practices.

---

---

## 9. Migration Safety Strategy

If adding new fields:

Safe approach:

Step 1 — add fields nullable
Step 2 — deploy
Step 3 — populate only for new projects

Do NOT backfill unless needed.

ERP migrations must always be forward-compatible.

---

---

## 10. Final Rule

Transactions own financial truth.

Projects only aggregate.

Never move financial logic into the project table.

This guarantees long-term ERP stability.

END.
