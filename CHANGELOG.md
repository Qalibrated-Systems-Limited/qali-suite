# Changelog

Notable changes shipped to the ERP. Newest at the top. Each entry is
self-contained — file pointers reference the work; the rationale and any
follow-up work are captured here so you don't need the chat history.

---

## Unreleased — Roles, HR, Bank Reconciliation, Multi-tenant Users

### Added

#### Multi-tenant Users page (Super Admin)
- SuperAdmin can now see all users across companies and filter by company.
- Cross-tenant filtering implemented in `searchUsers` / `fetchUserPages` /
  `getUserStats` ([app/mongodb/queries/user-queries.js](app/mongodb/queries/user-queries.js)).
  SuperAdmin path fetches the company list once and joins in memory rather
  than per-row `$lookup` (cheaper and reuses the dropdown's data).
- New `UserCompanyFilter` ([app/dashboard/users/components/UserFilters.jsx](app/dashboard/users/components/UserFilters.jsx))
  rendered only when the caller is a "true" SuperAdmin (role + no
  `companyId`, matching `getTenantContext`'s contract).
- Users table now has a Company column (desktop + mobile), gated on
  `isSuperAdmin` ([app/dashboard/users/components/UserTable.jsx](app/dashboard/users/components/UserTable.jsx)).

#### Bank statement balance reconciliation
- `BankStatement` schema gained `openingBalance`, `closingBalance`,
  `balanceSource` ([app/models/bankFeed.js](app/models/bankFeed.js)).
- Import flow auto-derives opening / closing from first/last
  `runningBalance` (rounded to cents); falls back to `unavailable` when
  the source file lacks a balance column.
- New `ReconciliationCard` on the statement page shows
  `opening + credits − debits = closing` with a Balanced/Drift pill
  ([app/dashboard/banking/[id]/page.jsx](app/dashboard/banking/%5Bid%5D/page.jsx)).

#### HR — leave self-healing sweep
- New `sweepCompletedLeaves(companyId)`
  ([lib/hr/leave-sweep.js](lib/hr/leave-sweep.js)):
  - Marks `approved` leaves with past `dates.to` as `completed`.
  - Restores `employment.status` from `on_leave` to `active` for
    employees with no currently overlapping approved leave.
- Wired into `getLeaveRequests` so the leave page is the natural trigger
  ([app/mongodb/queries/hr-queries.js](app/mongodb/queries/hr-queries.js)).
  Best-effort; never blocks the page.

#### HR — attendance timezone + auto-close stale clock-ins
- `AttendanceConfig` gained a `timezone` field (default `Africa/Nairobi`)
  ([app/models/attendanceConfig.js](app/models/attendanceConfig.js)).
- New DST-safe time helpers ([lib/hr/time.js](lib/hr/time.js)):
  `getTimezone`, `getLocalYMD`, `getLocalDateKey`,
  `getLocalMinutesSinceMidnight`, `localDateTime`,
  `getTimezoneOffsetMinutes`.
- New `closeStaleAttendance(companyId)`
  ([lib/hr/attendance-sweep.js](lib/hr/attendance-sweep.js)) — auto-closes
  records where `checkIn` was set on a prior local day but `checkOut` was
  never recorded; sets `checkOut = shiftEnd` of that local date,
  computes `hoursWorked` / `overtime`, and stamps `autoClosedOut` /
  `autoClosedAt` on the record.
- Wired into both `clockIn` and `getMyTodayAttendance` so the system
  heals on natural traffic.
- New audit fields on the `Attendance` model: `autoClosedOut`,
  `autoClosedAt`.

#### Command palette — HR + Finance + Reports
- `PAGES` entries now support optional `category` and `aliases` so search
  matches synonyms (e.g. `"PAYE"` → Payroll, `"P&L"` → Profit & Loss,
  `"GL"` → General Ledger, `"WHT"`, `"COA"`).
- Categories render as separate `CommandGroup`s in stable order
  (`General → HR → Finance → Reports`). 30+ new entries.
  ([components/command-palette.jsx](components/command-palette.jsx))

#### Centralized role-gates helper
- New [lib/utils/role-gates.js](lib/utils/role-gates.js) with named role
  groups (`FINANCE_WRITE_ROLES`, `FINANCE_APPROVE_ROLES`,
  `CATEGORY_MANAGE_ROLES`, `INVENTORY_WRITE_ROLES`,
  `PRICING_OVERRIDE_ROLES`, `PRICING_EDIT_ROLES`, `PROCUREMENT_ROLES`,
  `PARTY_MANAGE_ROLES`, `STOCK_REQUEST_APPROVE_ROLES`,
  `PROJECT_MANAGE_ROLES`, `PERIOD_CLOSE_ROLES`,
  `APPROVAL_CONFIG_ROLES`) and a `hasRole(user, ROLES)` predicate.
- Use these in new code instead of hand-rolled `["Admin", ...]` arrays
  to avoid drift.

### Fixed

#### Permissions / role gates
- **CRITICAL — `requests-actions.js`:266**: lowercase role comparison
  against canonical capitalised role names meant **nobody** could
  reject a stock request, including admins. Reject + approve now use
  exact canonical names with SuperAdmin / Admin / Manager / Store Manager.
- **`category-actions.js`** + 3 category pages: CFO / SuperAdmin /
  Finance Manager were locked out of category management. Now use a
  shared `CATEGORY_MANAGE_ROLES` set including all of these +
  Manager / Store Manager.
- **`invoice-actions.js`** (6 gates): create / update / payment /
  cancel / convert-checkout — CFO + Finance Manager were missing.
  Now use `FINANCE_WRITE_ROLES`.
- **`credit-note-actions.js`** (6 gates): create / issue / apply /
  refund / void — same fix. Void narrowed to top-level
  (SuperAdmin / Admin / CFO).
- **`bill-actions.js`** `BILL_ROLES`: SuperAdmin / CFO / Finance Manager
  / Procurement Officer added across CREATE / APPROVE / CANCEL /
  PAYMENT.
- **`account-actions.js`** (5 gates): create / update / sync /
  ensure-advance — CFO / Finance Manager added.
- **`project-actions.js`** (10 gates): SuperAdmin / CFO / Finance
  Manager added.
- **`party-actions.js`** (9 gates): broad CRUD opened to
  SuperAdmin / CFO / Finance Manager / Sales Manager / Procurement
  Officer; destructive ops (delete / convert / refresh-all-balances /
  link-user) narrowed to SuperAdmin / Admin / CFO.
- **`stock-actions.js`**: removed `.toLowerCase()` brittleness; pricing
  edit authority now SuperAdmin / Admin / CFO / Finance Manager / Sales
  Manager / Manager.
- **`fiscal-period-actions.js`**: close / reopen / lock — Admin-only
  → SuperAdmin / Admin / CFO / Finance Manager (Accountant for close
  only).
- **`hr-payroll-actions.js`** `PAYROLL_ROLES`: APPROVE / POST / VOID
  no longer Admin-only — CFO / Finance Manager added.
- **`loan-actions.js`** `LOAN_ROLES.DISBURSE`: was Admin-only. CFO +
  Finance Manager added (disbursement releases cash).
- **`payment-actions.js`** `checkRole`: SuperAdmin / CFO / Finance
  Manager added to all checkRole sites.
- **`claim-action.js`** (8 gates): approve / reject / settle / close —
  CFO / Finance Manager / SuperAdmin added.
- **`quote-queries.js`**: visibility scope now lets CFO / Finance
  Manager / Sales Manager see all quotes (not just their own).
- **`coffee-coop-actions.js`**: opened from Admin-only to
  SuperAdmin / Admin / Manager / Procurement Officer.
- **Invoice page-level gate** ([app/dashboard/invoices/(invoices)/page.jsx](app/dashboard/invoices/(invoices)/page.jsx)):
  was misaligned with the action gate; now matches.
- **Categories pages** (3): same fix applied at page level.

#### HR — security
- **CRITICAL — SHIF export tenant leak**
  ([app/api/hr/payroll/[id]/shif-export/route.js](app/api/hr/payroll/%5Bid%5D/shif-export/route.js)):
  `EmployeeProfile.find({_id: {$in: profileIds}})` lacked a `companyId`
  filter — known profile IDs from another tenant could leak personal
  info into the export. Now scoped to `run.companyId`.
- **My-payslip defense-in-depth**
  ([app/api/hr/my-payslip/[entryId]/route.js](app/api/hr/my-payslip/%5BentryId%5D/route.js)):
  `PayrollRun.findById` widened to `findOne({_id, companyId: entry.companyId})`.

#### HR — leave correctness
- **Overlap re-check on resubmit**
  ([app/mongodb/actions/hr-leave-actions.js](app/mongodb/actions/hr-leave-actions.js)):
  between draft creation and submit, another leave for the same period
  may have been approved. `submitLeaveRequest` now re-runs
  `LeaveRequest.hasOverlap(..., excludeId: leave._id)` and rejects
  with a clear error if so.

#### Invite flow performance
- **`sendInvite`** ([app/mongodb/actions/invite-actions.js](app/mongodb/actions/invite-actions.js)):
  was 3 reads → sequential `checkUserLimit` (which itself fired 2 more
  reads, including a duplicate `Company.findById`). Now one
  `Promise.all` of 4 parallel reads + inline limit evaluation via the
  new pure helper `evaluateUserLimit`
  ([lib/check-user-limit.js](lib/check-user-limit.js)). For SuperAdmin
  who bypasses the limit, the user count query is skipped entirely.
- Email send remains deferred via Next.js `after()`.

#### NHIF → SHA / SHIF rename (Kenya, Oct 2024 statutory)
- Schema field `personalInfo.nhifNumber` → `personalInfo.shaNumber`
  ([app/models/employeeProfile.js](app/models/employeeProfile.js)).
- `TaxTransaction.taxType` enum gained `"shif"`; `"nhif"` retained for
  legacy records ([app/models/taxTransactions.js](app/models/taxTransactions.js)).
- Tenant onboarding now creates `SHIF Payable` /
  `systemAccount: "shif_payable"`; `nhif_payable` retained as legacy
  alias ([app/mongodb/services/companyOnboardingService.js](app/mongodb/services/companyOnboardingService.js),
  [lib/utils.js](lib/utils.js)).
- All UI labels updated; tax UI displays `"NHIF (legacy)"` for
  historical records.
- **Read fallback** added in `hr-queries.js` and the SHIF export route
  so lean reads of `shaNumber` fall back to `nhifNumber` until the DB
  migration runs.
- **Form / CSV import** accepts both `shaNumber` and `nhifNumber` keys.
- **Migration script:** [scripts/migrate-nhif-to-sha.mjs](scripts/migrate-nhif-to-sha.mjs)
  — idempotent. Run with `MONGODB_URI=... node scripts/migrate-nhif-to-sha.mjs`.
  Once run, the read fallbacks and legacy enum can be removed.

---

## How to maintain this without AI assist

### Conventions to keep
- **Permissions:** new gates → import from
  [lib/utils/role-gates.js](lib/utils/role-gates.js). Don't write new
  hand-rolled `["Admin", "Accountant"].includes(user.role)` lists.
- **Tenant scope:** every read uses
  [lib/utils/tenant-utils.js](lib/utils/tenant-utils.js)
  (`getTenantContext` / `withTenantScope` / `validateTenantAccess`).
  Reads scoped via `withTenantScope`; writes include `companyId`
  explicitly.
- **Money:** [lib/money.js](lib/money.js) — line-level rounding via
  `roundCurrency` / `applyRate`. Never accumulate floats.
- **Dates:** [lib/dates.js](lib/dates.js) `addMonths` (clamps DOM) for
  subscription / period math. For HR / attendance use
  [lib/hr/time.js](lib/hr/time.js) — never `setUTCHours(0,0,0,0)` for
  "today's date".
- **Self-healing sweeps:** the leave + attendance sweeps are the
  template. Cheap, idempotent, try/catch wrapped, never block the page.

### Patterns to watch for in PRs
- Hand-rolled `["Admin", ...].includes(user.role)` — use `role-gates.js`
  instead.
- `.toLowerCase()` role comparisons — brittle.
- `setUTCHours(0,0,0,0)` for "today" — likely a timezone bug.
- `findById(someEntity.companyId)` after the entity is already scoped —
  technically fine but cheap defense-in-depth to use
  `findOne({_id, companyId})`.

### Backlog (no AI required)
1. Run `scripts/migrate-nhif-to-sha.mjs` and remove the back-compat
   fallbacks.
2. Settings UI to expose `attendanceConfig.timezone`.
3. Manual entry UI for bank statement opening / closing when
   `balanceSource === "unavailable"`.
4. Surface `autoClosedOut: true` on the daily attendance roster with a
   one-click "review" → manual entry flow.
5. Audit log for payroll entry edits (currently only `lastModifiedBy`).
6. Department snapshot drift — renaming a department doesn't propagate
   to embedded `employment.department` strings.
7. Sweep cron (or "post journal" button) for payroll runs whose GL
   journal failed.
