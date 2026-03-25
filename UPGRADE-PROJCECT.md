# Project Management Module — Implementation Documentation

## Status: Implemented

All items from the original architecture notes have been built. This document describes the current state of the project management module.

---

## 1. Data Models

### Project (`app/models/project.js`)

| Field | Type | Purpose |
|---|---|---|
| `companyId` | ObjectId | Multi-tenant scope |
| `projectNumber` | String | Auto-generated: `PRJ-{CODE}-{YYYYMM}-{SEQ}` |
| `name` | String | Project name (max 200 chars) |
| `description` | String | Optional (max 2000 chars) |
| `client.partyId` | ObjectId | Linked customer/client (Party) |
| `client.name/email` | String | Snapshot for display |
| `projectManager.userId` | ObjectId | Assigned PM (User) |
| `projectManager.name` | String | Snapshot for display |
| `parentProjectId` | ObjectId | Optional — subproject hierarchy |
| `billingModel` | Enum | `fixed`, `milestone`, `time_material` |
| `contractValue` | Number | Total contract value |
| `progressPercent` | Number | 0–100, manual update |
| `status` | Enum | `planning`, `active`, `on_hold`, `completed`, `closed` |
| `startDate / endDate` | Date | Planned timeline |
| `actualEndDate` | Date | Set on completion/close |
| `budget.amount` | Number | Advisory budget (synced from approved ProjectBudget) |
| `budget.currency` | String | Default `KES` |
| `financials.totalRevenue` | Number | Cached — updated by `$inc` from other modules |
| `financials.totalCosts` | Number | Cached — actual paid costs |
| `financials.totalCommitted` | Number | Cached — approved but unpaid |
| `tags` | [String] | Free-form tags |
| `priority` | Enum | `low`, `normal`, `high`, `critical` |
| `createdBy / lastModifiedBy` | Object | Audit trail |

**Status transitions (enforced by state machine):**
```
planning → active → on_hold → active
                  → completed → closed
```

**Indexes:**
- `{ companyId, projectNumber }` — unique
- `{ companyId, status }`
- `{ companyId, client.partyId }`
- `{ companyId, projectManager.userId }`
- `{ companyId, parentProjectId }`

**Virtuals:**
- `budgetUtilization` — `(costs + committed) / budget × 100`
- `margin` — `revenue - costs`
- `marginPercent` — `margin / revenue × 100`

---

### ProjectBudget (`app/models/projectBudget.js`)

Versioned, line-item budgets linked to Chart of Accounts.

| Field | Type | Purpose |
|---|---|---|
| `projectId` | ObjectId | Parent project |
| `version` | Number | Auto-incremented per project |
| `status` | Enum | `draft`, `approved`, `superseded` |
| `lines[]` | Array | Budget line items |
| `lines[].accountId` | ObjectId | GL account |
| `lines[].accountCode/Name` | String | Snapshot |
| `lines[].amount` | Number | Budgeted amount |
| `totalAmount` | Number | Auto-calculated on save |
| `approvedBy / approvedAt` | Object/Date | Approval audit |
| `revisionNotes` | String | Why this revision |

**Workflow:**
1. Create draft budget with line items per GL account
2. Approve → supersedes any prior approved budget, syncs `totalAmount` to `project.budget.amount`
3. Need changes? Create new version (v2, v3...), approve to supersede

---

### ProjectCostCode (`app/models/projectCostCode.js`)

Categorisation codes for cost tracking (Labour, Materials, Equipment, etc.)

| Field | Type | Purpose |
|---|---|---|
| `code` | String | Short code (e.g. `LAB`, `MAT`) |
| `name` | String | Display name |
| `projectId` | ObjectId | `null` = company-wide, or scoped to one project |
| `isActive` | Boolean | Soft delete |

**Index:** `{ companyId, code, projectId }` unique

---

## 2. Cross-Module Integration

Projects link to **5 transaction types** via optional `projectId` field on each model:

| Model | Field | Revenue or Cost |
|---|---|---|
| `Invoice` | `projectId` | Revenue (completed/posted invoices) |
| `Bill` | `projectId` | Cost (paid bills) / Committed (approved unpaid) |
| `Expense` | `projectId` | Cost (paid) / Committed (approved) |
| `EmployeeClaim` | `projectId` | Cost (paid/settled) / Committed (submitted/approved) |
| `StockRequest` | `projectId` | Committed (approved/partially fulfilled) |

The `updateProjectFinancials(projectId, { revenue, cost, committed })` helper uses `$inc` to update cached totals — called by invoice, bill, expense, and claim actions when transactions are posted.

**Live aggregation** via `getProjectFinancialSummary(projectId)` runs 9 parallel aggregation pipelines across all 5 collections for real-time accuracy — used on the project detail page.

---

## 3. Server Actions (`app/mongodb/actions/project-actions.js`)

| Action | Role Gate | Description |
|---|---|---|
| `createProject` | Admin/Accountant/Manager | Transactional, auto-generates project number |
| `updateProject` | Admin/Accountant/Manager | Blocks edits on closed projects |
| `updateProjectStatus` | Admin/Accountant/Manager | Enforced state machine. Only Admin/Accountant can close |
| `deleteProject` | Admin only | Only `planning` status. Checks linked claims |
| `createProjectBudget` | Admin/Accountant/Manager | Versioned, draft by default |
| `updateProjectBudget` | Admin/Accountant/Manager | Draft only |
| `approveProjectBudget` | Admin/Accountant | Auto-supersedes prior approved, syncs to project |
| `updateProjectProgress` | Admin/Accountant/Manager | Manual % slider |
| `createCostCode` | Admin/Accountant/Manager | Unique per company+project |
| `updateCostCode` | Admin/Accountant/Manager | |
| `toggleCostCodeActive` | Admin/Accountant | Soft activate/deactivate |
| `updateProjectFinancials` | Internal | `$inc` helper called by other modules |

---

## 4. Queries (`app/mongodb/queries/projectQueries.js`)

| Query | Purpose |
|---|---|
| `searchProjects` | Paginated list with search (name, number, client, PM) and status/priority filters |
| `fetchProjectPages` | Page count for pagination |
| `getProjectStats` | Counts by status + budget utilisation across active projects |
| `getProjectById` | Single project with full detail |
| `getActiveProjects` | For picker dropdowns (planning + active only) |
| `getProjectFinancialSummary` | Live aggregation: revenue, costs, committed from 5 collections |
| `getProjectBudgetVsActual` | Per-account breakdown: budgeted vs actual vs committed |
| `getProjectTransactions` | Claims, invoices, bills, expenses, stock requests linked to project |
| `getProjectBudgets` | All budget versions for a project |
| `getCostCodes` | Company-wide + project-specific active codes |
| `getAllCostCodes` | Including inactive (for management page) |
| `getSubprojects` | Children of a parent project |
| `getProjectsForParentPicker` | Excludes self and own children |

---

## 5. UI Pages

| Page | Path | Description |
|---|---|---|
| Project list | `app/dashboard/projects/(projects)/page.jsx` | Search, filter by status/priority, stats cards, budget summary |
| Create | `app/dashboard/projects/create/page.jsx` | Full form: name, client, PM, dates, budget, billing model, parent project, tags |
| Detail | `app/dashboard/projects/[id]/page.jsx` | Info card, status actions, subprojects, live financial summary, budget vs actual, linked transactions |
| Edit | `app/dashboard/projects/[id]/edit/page.jsx` | All fields editable (except closed projects) |
| Budget | `app/dashboard/projects/[id]/budget/page.jsx` | Budget management: create/edit/approve versions |

### Components

| Component | Purpose |
|---|---|
| `ProjectStats.jsx` | Stats cards: total, active, on hold, completed + budget summary |
| `ProjectForm.jsx` | Create/edit form with client picker, PM picker, parent project picker |
| `BudgetForm.jsx` | Budget line editor with account picker |
| `ProjectListServerComp.jsx` | Server component data loader |
| `ProjectListWithFilters.jsx` | Client component with search, status/priority tabs |
| `ProjectStatusActions.jsx` | Status transition buttons with role gating |

---

## 6. Project Detail Page Features

The detail page (`[id]/page.jsx`) includes:

**Project Info Card:**
- Client, PM, start/end dates
- Contract value, billing model
- Parent project link (clickable)
- Progress bar
- Tags

**Status Actions:**
- Role-gated buttons for valid transitions
- Only Admin/Accountant can close

**Subprojects:**
- List of child projects with status, budget, progress

**Financial Summary (live):**
- Revenue, costs (paid), committed, available
- Budget utilisation progress bar with 70%/90% warnings
- Margin and margin %

**Budget vs Actual:**
- Per GL account breakdown
- Budgeted, actual, committed, available, % used
- Desktop table + mobile cards
- Colour-coded warnings at 70%/90%

**Linked Transactions:**
- Claims (with employee, amount, status)
- Invoices (with customer, amount, status)
- Bills (with vendor, amount, status)
- Expenses (with account, amount, status)
- Stock Requests (with requester, value, status)
- All clickable → navigate to transaction detail

---

## 7. Design Principles (Enforced)

1. **Transactions own financial truth.** Projects only aggregate. Financial logic never lives in the project table.
2. **Budget is advisory, not blocking.** Warn at 90% but never prevent a transaction.
3. **Project is optional** on all ERP transactions. Not every invoice needs a project.
4. **Company-scoped.** All queries/actions scope by `companyId` via `withTenantScope`.
5. **Forward-compatible migration.** All new fields added as nullable. No backfills required.
6. **Cached totals + live verification.** `financials.*` cached via `$inc` for list performance; detail page runs live aggregation for accuracy.

---

## 8. Known Gaps (Future Work)

| Gap | Priority | Notes |
|---|---|---|
| Task/WBS tracking | High | Progress is manual %. No tasks, milestones, or dependencies |
| Timesheet / time tracking | High | `time_material` billing model exists but no hour logging |
| Milestone billing | Medium | Enum exists, no milestone model or partial invoicing workflow |
| GL journal posting for project costs | Medium | Costs don't post project-specific journals |
| Delete only checks claims | Low | Should check all 5 linked collections |
| PurchaseOrder has no `projectId` | Medium | Can't track procurement per project |
| Quote has no `projectId` | Low | Can't trace sales pipeline → project |
| Subproject financial rollup | Medium | Parent doesn't aggregate children's financials |
| Project-level permissions | Low | Any Admin/Manager sees all projects |
| Change orders / variations | Medium | No formal scope change tracking |
| Document attachments | Low | No file uploads on projects |
| Earned value management (EVM) | Low | PV, EV, AC, CPI, SPI for construction |
| Retention tracking | Low | 5-10% retention not modelled |

---

## 9. File Index

```
app/models/
  project.js              — Project schema
  projectBudget.js        — Versioned budget schema
  projectCostCode.js      — Cost code schema

app/mongodb/actions/
  project-actions.js      — 11 server actions

app/mongodb/queries/
  projectQueries.js       — 13 query functions

app/dashboard/projects/
  (projects)/page.jsx     — List page
  create/page.jsx         — Create page
  [id]/page.jsx           — Detail page
  [id]/edit/page.jsx      — Edit page
  [id]/budget/page.jsx    — Budget page
  components/
    ProjectStats.jsx
    ProjectForm.jsx
    BudgetForm.jsx
    ProjectListServerComp.jsx
    ProjectListWithFilters.jsx
    ProjectStatusActions.jsx
```
