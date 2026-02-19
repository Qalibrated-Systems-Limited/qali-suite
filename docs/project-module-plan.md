# Project Module — Full ERP Implementation

## Context
During a demo, the MD asked: "Before I approve this advance, which project is it for? What's the budget? Is the project already running at a loss?" Every job the company executes is a project. The MD needs profitability visibility at a glance — both when approving spend and on a dedicated project dashboard.

Currently `advanceDetails.projectCode` is a free-text field with no budget, no P&L, no linking to invoices/requests. We need a full Project module where project is a **cross-cutting dimension** across all transaction types.

---

## Step 1: Project Model

**New file:** `app/models/project.js`

```
Project {
  companyId          ObjectId (tenant)
  projectNumber      String (auto: PRJ-QSL-YYYYMM-XXXX)
  name               String (required)
  description        String

  // Client
  client: {
    partyId          ObjectId → Party
    name             String
    email            String
  }

  // Ownership
  projectManager: {
    userId           ObjectId → User
    name             String
  }
  createdBy          { name, id }

  // Lifecycle
  status             enum: planning | active | on_hold | completed | closed
  startDate          Date
  endDate            Date (expected)
  actualEndDate      Date

  // Budget (advisory mode — warn but don't block)
  budget: {
    amount           Number (total approved budget)
    currency         String (default: KES)
  }

  // Cached financials (updated on transaction post)
  financials: {
    totalRevenue     Number (from invoices tagged to project)
    totalCosts       Number (claims + expenses + bills + stock requests)
    totalCommitted   Number (pending/approved but not yet paid)
  }

  // Metadata
  tags               [String] (flexible categorization)
  priority           enum: low | normal | high | critical

  timestamps
}

Indexes:
  { companyId: 1, projectNumber: 1 } unique
  { companyId: 1, status: 1 }
  { companyId: 1, "client.partyId": 1 }
  { companyId: 1, "projectManager.userId": 1 }
```

Static: `generateProjectNumber(companyId)` — same pattern as `generateClaimNumber` in claim-action.js

---

## Step 1b: ProjectBudget Model

**New file:** `app/models/projectBudget.js`

```
ProjectBudget {
  companyId          ObjectId (tenant)
  projectId          ObjectId → Project (required, indexed)
  version            Number (1, 2, 3... auto-incremented per project)
  status             enum: draft | approved | superseded

  lines: [{
    accountId        ObjectId → Account (expense account from CoA)
    accountCode      String (denormalized)
    accountName      String (denormalized)
    description      String (free text context, e.g. "Travel for Mombasa site visit")
    amount           Number (budgeted amount for this line)
  }]

  totalAmount        Number (sum of lines — also synced to project.budget.amount on approve)

  // Approval
  approvedBy         { name, id }
  approvedAt         Date
  revisionNotes      String (why was this revision made?)

  // Audit
  createdBy          { name, id }
  timestamps
}

Indexes:
  { companyId: 1, projectId: 1, version: -1 }
  { companyId: 1, projectId: 1, status: 1 }
```

**Key behaviors:**
- Only ONE budget per project can be `approved` at a time
- Creating a new version sets the old one to `superseded`
- On approve → syncs `totalAmount` to `project.budget.amount`
- Budget lines link to CoA expense accounts for automatic matching with claim expense accounts
- Description field is free text for context

**Budget vs Actual matching:**
When a claim has both `projectId` and `expenseAccountId`, the system matches:
`claim.expenseAccountId` → `budgetLine.accountId` to show per-line budget health

---

## Step 2: Project Server Actions

**New file:** `app/mongodb/actions/project-actions.js`

Actions (all tenant-scoped, role-gated):

- `createProject(prevState, formData)` — Admin/Accountant only. Validates with Zod, generates number, creates with status=planning
- `updateProject(prevState, formData)` — Admin/PM can edit name, description, dates, budget. Cannot edit if closed.
- `updateProjectStatus(projectId, newStatus)` — Status transitions:
  - planning → active (Admin/PM)
  - active → on_hold | completed (Admin/PM)
  - on_hold → active (Admin/PM)
  - completed → closed (Admin/Accountant only — all financials must be settled)
  - closed → nothing (terminal)
- `deleteProject(projectId)` — Admin only, only if status=planning and no linked transactions
- `getProjectFinancials(projectId)` — Aggregates live P&L from journal entries + pending claims/requests

**Budget actions:**
- `createProjectBudget(prevState, formData)` — Creates a new budget version (draft). Admin/PM.
- `approveProjectBudget(budgetId)` — Approves draft, supersedes previous version, syncs total to project. Admin only.
- `getProjectBudgetVsActual(projectId)` — Per-line comparison: budgeted vs actual vs committed vs available

---

## Step 3: Project Queries

**New file:** `app/mongodb/queries/projectQueries.js`

- `getProjects(filters)` — List with search, status filter, pagination. Returns summary financials.
- `getProjectById(id)` — Full project with live financials
- `getActiveProjects()` — For project picker dropdowns (id, projectNumber, name, budget, financials.totalCosts)
- `getProjectFinancialSummary(projectId)` — Aggregates from:
  - **Revenue**: Invoices where `projectId` matches → sum of `total`
  - **Costs**: Claims (paid) + Expenses (posted) + Bills (completed) where `projectId` matches
  - **Committed**: Claims (submitted/approved) + Stock Requests (approved/pending) where `projectId` matches
- `getProjectTransactions(projectId)` — Recent claims, invoices, requests linked to project

---

## Step 4: Link Project to Existing Modules

**IMPORTANT: projectId is OPTIONAL on all modules. Users can still operate without selecting a project.**

### 4a. Claims — `app/models/employeesClaims.js`
Add field at schema root level (not inside advanceDetails):
```js
projectId: { type: Schema.Types.ObjectId, ref: "Project", index: true }  // OPTIONAL
project: { projectNumber: String, name: String }  // denormalized for display
```
- Remove `advanceDetails.projectCode` (migrate to projectId)
- ALL claim types get project linking (not just "project" advance type)
- Field is optional — users can leave blank and just use description

### 4b. Invoices — `app/models/invoice.js`
Add at invoice header level:
```js
projectId: { type: Schema.Types.ObjectId, ref: "Project", index: true }
project: { projectNumber: String, name: String }
```

### 4c. Stock Requests — `app/models/requests.js`
Add at request header level:
```js
projectId: { type: Schema.Types.ObjectId, ref: "Project", index: true }
project: { projectNumber: String, name: String }
```

### 4d. Bills — `app/models/bill.js`
Add at bill header level:
```js
projectId: { type: Schema.Types.ObjectId, ref: "Project", index: true }
project: { projectNumber: String, name: String }
```

### 4e. Expenses — `app/models/expense.js` (if exists)
Same pattern.

**Why header level not line-item level**: Simpler for Phase 1. Most SME transactions belong to one project. Line-item split can come in Phase 2 if needed.

---

## Step 5: Project Picker Component

**New file:** `components/project-picker.jsx`

Reusable searchable combobox (same pattern as `ExpenseAccountCombobox`):
- Popover + Command + CommandInput
- Fetches active projects via prop
- Shows: projectNumber, name, budget remaining, health indicator (green/yellow/red)
- Used on: Claim forms, Invoice create, Stock Request create, Bill create

---

## Step 6: Project CRUD Pages

### 6a. List Page — `app/dashboard/projects/(projects)/page.jsx`
- Stats cards: Total Projects, Active, Budget Utilization, Projects at Risk
- Table: projectNumber, name, client, PM, status, budget, spent, margin %, health
- Filters: status, priority, PM
- Search: by name, projectNumber, client name
- Link to create page

### 6b. Create Page — `app/dashboard/projects/create/page.jsx`
- Form: name, description, client (party picker), PM (user picker), dates, budget, priority, tags
- Fetches active parties and users for pickers

### 6c. Detail Page — `app/dashboard/projects/[id]/page.jsx`
**The key page for the MD.** Shows:

**Header**: Project name, number, status badge, PM name

**Financial Summary Card** (prominent):
```
Budget        KES 500,000
Revenue       KES 800,000
Costs         KES 320,000
Committed     KES  45,000
Available     KES 135,000
Margin        KES 480,000 (60%)
Progress bar  ████████░░░ 73% of budget used
```

**Budget vs Actual Card** (if budget exists):
```
| Category             | Budget    | Actual  | Committed | Available | % Used |
|----------------------|-----------|---------|-----------|-----------|--------|
| 6520 Travel          | 100,000   | 85,000  | 12,000    | 3,000     | 97% ⚠️ |
| 6530 Meals           | 50,000    | 20,000  | 5,000     | 25,000    | 50% ✓  |
| 6570 Repairs         | 200,000   | 150,000 | 0         | 50,000    | 75%    |
| Total                | 350,000   | 255,000 | 17,000    | 78,000    | 78%    |
```

**Transactions tabs**:
- Claims tab — all claims linked to this project
- Invoices tab — all invoices linked
- Stock Requests tab — all requests linked
- Bills tab — all bills linked

**Actions**: Edit, Change Status, Manage Budget

### 6d. Edit Page — `app/dashboard/projects/[id]/edit/page.jsx`
- Same form as create, pre-populated

---

## Step 7: Project Health Card on Claim Approval View

**Modify:** `app/dashboard/claims/[id]/(details)/page.jsx`

When a claim has `projectId`, show a **Project Context Card** between the status badges and the main info card:

```
┌─────────────────────────────────────────────┐
│ 📂 Nairobi Office Renovation  PRJ-QSL-001  │
│ Status: Active     PM: John Doe             │
├─────────────────────────────────────────────┤
│ Budget      KES 500,000                     │
│ Spent       KES 320,000                     │
│ Committed   KES  45,000                     │
│ Available   KES 135,000                     │
│ ────────────────────────────────────────    │
│ This claim  KES  25,000                     │
│ After       KES 110,000 remaining           │
│ ██████████████████░░░░░░░  73%              │
│                                             │
│ ⚠️ Budget warning if > 80%                  │
│ 🔴 Over budget if > 100%                    │
└─────────────────────────────────────────────┘
```

**New component:** `app/dashboard/claims/components/ProjectContextCard.jsx`
- Server component that fetches project financials + approved budget
- Shows overall budget health with progress bar
- Calculates "after approval" projection
- Color-coded: green (< 70%), yellow (70-90%), red (> 90%), over budget banner
- **Per-line budget detail**: If claim has `expenseAccountId` AND project has budget lines for that account, show:
  ```
  Travel budget: KES 100,000 | Spent: KES 85,000 | This claim: KES 12,000
  → After approval: KES 3,000 remaining (97% used) ⚠️
  ```

---

## Step 8: Update Claim Forms with Project Picker

**Modify:** `app/dashboard/claims/components/AdvanceRequestFrom.jsx`
- Replace free-text `projectCode` input with `ProjectPicker` combobox
- Show for ALL advance types (not just "project" type) — any advance can be for a project
- Optional field — not all claims need a project

**Modify:** `app/dashboard/claims/components/ReimbursementForm.jsx`
- Add `ProjectPicker` to the form

**Modify:** `app/dashboard/claims/components/AdvanceSettleForm.jsx`
- Inherit project from parent advance claim (read-only display)

**Modify:** claim-action.js `createAdvanceRequest`, `createReimbursement`, `settleAdvance`, `updateClaim`
- Accept `projectId` from form data
- Lookup project, validate it exists and is active
- Store `projectId` + denormalized `project: { projectNumber, name }`

---

## Step 9: Update Invoice Forms with Project Picker

**Modify:** Invoice create page — add `ProjectPicker` to invoice header
**Modify:** `app/mongodb/invoice-actions.js` — store projectId on invoice

---

## Step 10: Update Stock Request Forms with Project Picker

**Modify:** Stock request create page — add `ProjectPicker`
**Modify:** `app/mongodb/actions/requests-actions.js` (or equivalent) — store projectId

---

## Step 11: Navigation & Search Integration

**Modify:** `components/sidebar-content.jsx`
- Add Projects item (FolderKanban icon) after Requests, visible to Admin/Accountant/Manager

**Modify:** `components/command-palette.jsx`
- Add "Projects" to PAGES array
- Add "Create Project" to ACTIONS array
- Add projects to global search results

**Modify:** `app/mongodb/actions/global-search-action.js`
- Add Project query: search by projectNumber, name, client.name

---

## Step 12: Update Project Financials on Transaction Events

When claims are paid, invoices posted, stock requests fulfilled:
- Update `project.financials.totalRevenue`, `totalCosts`, `totalCommitted`
- Use atomic `$inc` updates on Project model
- Add helper: `updateProjectFinancials(projectId, { revenue, cost, committed })`

This is called from:
- `claim-action.js` → when claim is paid or approved
- `invoice-actions.js` → when invoice is completed/posted
- `requests-actions.js` → when request is approved/fulfilled

---

## Files to Create
1. `app/models/project.js` — Project model
2. `app/models/projectBudget.js` — Budget model (versioned, line-item, linked to CoA)
3. `app/mongodb/actions/project-actions.js` — CRUD + budget actions
4. `app/mongodb/queries/projectQueries.js` — Queries + budget vs actual
5. `components/project-picker.jsx` — Reusable combobox
6. `app/dashboard/projects/(projects)/page.jsx` — List page
7. `app/dashboard/projects/create/page.jsx` — Create page
8. `app/dashboard/projects/[id]/page.jsx` — Detail page with Budget vs Actual
9. `app/dashboard/projects/[id]/edit/page.jsx` — Edit page
10. `app/dashboard/projects/[id]/budget/page.jsx` — Budget management page (create/revise)
11. `app/dashboard/claims/components/ProjectContextCard.jsx` — Approval context card

## Files to Modify
1. `app/models/employeesClaims.js` — Add projectId field
2. `app/models/invoice.js` — Add projectId field
3. `app/models/requests.js` — Add projectId field
4. `app/models/bill.js` — Add projectId field
5. `app/mongodb/actions/claim-action.js` — Store projectId on create/update
6. `app/mongodb/invoice-actions.js` — Store projectId
7. `app/dashboard/claims/[id]/(details)/page.jsx` — Show ProjectContextCard
8. `app/dashboard/claims/components/AdvanceRequestFrom.jsx` — Project picker
9. `app/dashboard/claims/components/ReimbursementForm.jsx` — Project picker
10. `components/sidebar-content.jsx` — Add Projects nav item
11. `components/command-palette.jsx` — Add Projects to search
12. `app/mongodb/actions/global-search-action.js` — Add Projects search

## Existing Patterns to Reuse
- `generateClaimNumber()` in claim-action.js → pattern for generateProjectNumber
- `ExpenseAccountCombobox` in ReimbursementForm.jsx → pattern for ProjectPicker
- `getExpenseAccountsForCategories()` in claimQueries.js → pattern for getActiveProjects
- `ensureAdvanceAccountsExist()` in account-actions.js → tenant-scoped creation pattern
- `AccountSetupCard` → pattern for card UI components
- `withTenantScope()` / `getTenantContext()` → all queries/actions

## Verification
1. Create a project with budget KES 500,000, assign PM
2. Create an advance request, select the project from picker
3. Submit the advance → on approval page, see Project Context Card showing budget health
4. Create an invoice tagged to the same project
5. On project detail page: see revenue from invoice + costs from claim = margin
6. Search "PRJ" in Cmd+K → project appears in results
7. Sidebar shows Projects link
8. Close project → verify no new transactions can be tagged to it
