# HR Module — Implementation Roadmap

## Status Legend
- ✅ Done
- 🔧 In progress / partial
- ⬜ Not started

---

## Phase 1 — Data Models ✅

| Model | File | Status |
|---|---|---|
| EmployeeProfile | `app/models/employeeProfile.js` | ✅ |
| Department | `app/models/department.js` | ✅ |
| LeaveRequest | `app/models/leaveRequest.js` | ✅ |
| PayrollRun | `app/models/payrollRun.js` | ✅ |
| PayrollEntry | `app/models/payrollEntry.js` | ✅ |
| PayrollConfig | `app/models/payrollConfig.js` | ✅ |
| PublicHoliday | `app/models/publicHoliday.js` | ✅ |
| SalaryHistory | `app/models/salaryHistory.js` | ✅ |
| EmploymentHistory | `app/models/employmentHistory.js` | ✅ |

---

## Phase 2 — Data Layer (Queries & Actions) ✅

### Queries — `app/mongodb/queries/hr-queries.js`
- `getHRStats` ✅
- `getEmployees` (paginated, filterable) ✅
- `getEmployeeById` ✅
- `getDepartments` ✅
- `getDepartmentById` ✅
- `getLeaveRequests` (paginated, filterable) ✅
- `getLeaveRequestById` ✅
- `getPayrollRuns` ✅
- `getPayrollRunById` (includes entries) ✅
- `getPayrollConfigs` ✅
- `getLeaveCalendarEvents(month, year)` ✅
- `getPublicHolidays` ✅
- `getExpiringContracts(daysAhead)` ✅

### Employee Actions — `app/mongodb/actions/hr-employee-actions.js`
- `createEmployee` ✅
- `updateEmployee` ✅
- `updateCompensation` ✅
- `updateLeaveBalance` ✅
- `confirmEmployee` (probation → active) ✅
- `terminateEmployee` ✅
- `sendEmployeePortalInvite` ✅
- `uploadEmployeePhoto` ✅
- `uploadEmployeeDocument` ✅
- `deleteEmployeeDocument` ✅

### Department Actions — `app/mongodb/actions/hr-department-actions.js`
- `createDepartment` ✅
- `updateDepartment` ✅
- `toggleDepartmentStatus` ✅

### Leave Actions — `app/mongodb/actions/hr-leave-actions.js`
- `createLeaveRequest` (draft or submit, redirects to detail) ✅
- `submitLeaveRequest` ✅
- `approveLeaveRequest` ✅
- `rejectLeaveRequest` ✅
- `recallLeaveRequest` ✅
- Working days calculation now excludes public holidays via `PublicHoliday.getDateSet()` ✅

### Holiday Actions — `app/mongodb/actions/hr-holiday-actions.js`
- `seedKenyaHolidays` — seeds 8 Kenya statutory fixed holidays ✅
- `createPublicHoliday` — recurring or one-off ✅
- `deletePublicHoliday` ✅

### Payroll Actions — `app/mongodb/actions/hr-payroll-actions.js`
- `createPayrollRun` ✅
- `generatePayrollEntries` ✅ (config-driven: reads from active PayrollConfig)
- `approvePayrollRun` ✅
- `voidPayrollRun` ✅
- `markPayrollPaid` ✅
- `updatePayrollEntry` (manual override per employee) ✅

### Payroll Settings Actions — `app/mongodb/actions/hr-settings-actions.js`
- `createPayrollConfig` ✅
- `activatePayrollConfig` ✅

---

## Phase 3 — Navigation ✅

- HR group added to sidebar (`components/sidebar-content-grouped.jsx`)
- Role-gated: Admin/Manager/HR/Employee see HR group; Settings link gated to Admin/Accountant/HR only
- Sub-items: Overview, Employees, Departments, Leave, Payroll
- HR sub-nav bar in `app/dashboard/hr/layout.jsx` (sticky, tabs)

---

## Phase 4 — Pages ✅

### HR Overview
- `app/dashboard/hr/page.jsx` — stats cards, headcount bar, quick actions ✅

### Employees
- `app/dashboard/hr/employees/page.jsx` — list (desktop table + mobile cards) ✅
- `app/dashboard/hr/employees/create/page.jsx` — create form ✅
- `app/dashboard/hr/employees/[id]/page.jsx` — detail (profile/leave/payroll/documents tabs) ✅
- `app/dashboard/hr/employees/[id]/edit/page.jsx` — edit form ✅
- `app/dashboard/hr/employees/[id]/compensation/page.jsx` — compensation edit ✅
- `app/dashboard/hr/employees/[id]/leave-balances/page.jsx` — leave balance management ✅

### Departments
- `app/dashboard/hr/departments/page.jsx` — card grid ✅
- `app/dashboard/hr/departments/create/page.jsx` — create form ✅
- `app/dashboard/hr/departments/[id]/page.jsx` — detail + employee list ✅
- `app/dashboard/hr/departments/[id]/edit/page.jsx` — edit form ✅

### Leave
- `app/dashboard/hr/leave/page.jsx` — list with status filter tabs + Calendar link ✅
- `app/dashboard/hr/leave/create/page.jsx` — request form (balance preview, working days calc) ✅
- `app/dashboard/hr/leave/[id]/page.jsx` — detail (period, timeline, approve/reject actions) ✅
- `app/dashboard/hr/leave/calendar/page.jsx` — monthly calendar view (approved + pending) ✅

### Payroll
- `app/dashboard/hr/payroll/page.jsx` — runs list (desktop table + mobile cards) ✅
- `app/dashboard/hr/payroll/create/page.jsx` — new run form ✅
- `app/dashboard/hr/payroll/[id]/page.jsx` — detail (totals, entries table, generate/approve/void) ✅

---

## Phase 5 — Core Completions ✅

### 5A — Employee Profile ✅
- ✅ Compensation edit — `app/dashboard/hr/employees/[id]/compensation/page.jsx`
- ✅ Photo upload — Cloudinary, click avatar to change
- ✅ Documents (upload/view/delete) — `app/dashboard/hr/components/EmployeeDocuments.jsx`; doc types: national ID, passport, KCSE, diploma, degree, masters, PhD, professional cert, membership (EBK/CPA/LSK)
- ✅ Leave balance management — `app/dashboard/hr/employees/[id]/leave-balances/page.jsx`

### 5B — Payroll Settings & Statutory Compliance ✅

#### Compliance fixes applied:
| Issue | Status | Detail |
|---|---|---|
| NHIF → SHIF | ✅ Fixed | `deductions.nhif` renamed to `deductions.shif`; flat % of gross via config |
| Housing Levy | ✅ Fixed | `deductions.housingLevy` (employee) + `employerContributions.housingLevy` added |
| Hardcoded rates | ✅ Fixed | All rates (PAYE brackets, SHIF %, NSSF tiers, AHL %) live in `PayrollConfig` DB document |
| Employer contributions | ✅ Fixed | `employerContributions.{nssf, housingLevy}` tracked on `PayrollEntry`; aggregated to `PayrollRun.totals` |
| `recalculate()` | ✅ Fixed | Pre-save hook now includes SHIF + housingLevy in `totalDeductions` |
| Tenancy | ✅ Audited | All queries/actions scope by `companyId`; `hasOverlap()` and `updateLeaveBalance` gaps patched |

#### What was built:
- ✅ **`app/models/payrollConfig.js`** — effective-date-ranged statutory config per company (PAYE brackets, SHIF, NSSF, AHL, personal relief). `getActive()` and `getForPeriod()` statics.
- ✅ **`app/models/payrollEntry.js`** — `shif`, `housingLevy`, `employerContributions`; `recalculate()` and `aggregateTotals()` updated.
- ✅ **`app/models/payrollRun.js`** — `totalSHIF`, `totalHousingLevy`, `totalEmployerNSSF`, `totalEmployerAHL` in totals.
- ✅ **`app/mongodb/actions/hr-payroll-actions.js`** — config-driven `calculatePAYE()`, `calculateNSSF()`, `calculateSHIF()`, `calculateAHL()`; `syncRunTotals()` helper; `generatePayrollEntries` errors if no active config found.
- ✅ **`app/mongodb/actions/hr-settings-actions.js`** — `createPayrollConfig`, `activatePayrollConfig`.
- ✅ **`app/dashboard/settings/payroll-config/page.jsx`** — Payroll Config UI in central Settings (not a separate HR settings page). Admin can create configs with dynamic PAYE bracket editor; HR can view. Pre-filled with Kenya defaults.

### 5C — Payroll Outputs ✅
- ✅ **Payslip PDF** — `@react-pdf/renderer`; per-employee on demand via `GET /api/hr/payroll/[id]/payslip/[entryId]`. Includes company header, employee snapshot, earnings table, deductions table (PAYE/NSSF/SHIF/AHL), employer contributions, net pay, masked bank/M-Pesa details. Opens inline in browser (print to PDF).
- ✅ **Bank payment CSV** — `GET /api/hr/payroll/[id]/bank-export`; filters `paymentMethod=bank`; columns: name, employee no, department, bank, branch, account, amount, narrative. Available on approved/paid runs.
- ✅ **M-Pesa bulk CSV** — `GET /api/hr/payroll/[id]/mpesa-export`; Safaricom B2C format (PhoneNumber, Amount, Occasion, Remarks); auto-normalises phone to 254XXXXXXXXX.
- ✅ **Bank details snapshot** — `bankName`, `bankBranch`, `bankAccount`, `mpesaNumber` added to `PayrollEntry` and snapshotted during `generatePayrollEntries` — no `$lookup` at export time.
- ✅ **Payroll summary PDF** — `GET /api/hr/payroll/[id]/summary-pdf`; A4 landscape, `@react-pdf/renderer`; all employees, totals, employer contributions, authorisation signatures. Available on approved/paid runs.

### 5D — Statutory Remittance Reports ✅
> Legal obligations. All available on approved/paid runs. Accessible to Admin, HR, Accountant.

- ✅ **PAYE P10 CSV** — `GET /api/hr/payroll/[id]/p10`; per-employee: KRA PIN, national ID, gross, taxable (gross-NSSF), PAYE, NSSF, SHIF, AHL; totals row.
- ✅ **NSSF CSV** — `GET /api/hr/payroll/[id]/nssf-export`; employee + employer NSSF; NSSF number.
- ✅ **SHIF CSV** — `GET /api/hr/payroll/[id]/shif-export`; per-employee SHIF; NHIF/SHIF number.
- ✅ **AHL CSV** — `GET /api/hr/payroll/[id]/ahl-export`; employee + employer AHL; KRA PIN.
- ✅ **PAYE P9A annual certificate** — `GET /api/hr/p9a?year=YYYY`; wide CSV with 12-month breakdown per employee (gross, taxable, PAYE per month) + annual totals; KRA PIN + national ID joined from EmployeeProfile. Download button on Payroll list page header.

### 5E — Employee Lifecycle ✅
> Real ERPs (SAP HCM, Oracle HCM, Workday) log every employment event with effective dates for audit and statutory reporting.

- ✅ **`app/models/salaryHistory.js`** — every compensation change snapshotted: previous/updated basic + allowances + grossSalary, effectiveDate, reason, changedBy. Written on every `updateCompensation` call.
- ✅ **`app/models/employmentHistory.js`** — 11 event types (hire, probation_confirmation, promotion, department_change, designation_change, grade_change, employment_type_change, status_change, termination, contract_renewal, other). Written on confirmEmployee, terminateEmployee.
- ✅ **Contract management** — `contractStart`, `contractEnd`, `contractType` on `EmployeeProfile.employment`; `getExpiringContracts(daysAhead=30)` query; amber/red alert banner on HR overview page.
- ✅ **Pro-rata payroll** — mid-month joiner/leaver gets `(daysWorked / totalWorkingDays) × salary`. Triggered when `hireDate` or `terminationDate` falls within the payroll period. Working days computed via `PublicHoliday.getDateSet()`.
- ✅ **Leave without pay (LWOP) deduction** — batch-fetches all approved unpaid leaves for the period; per-employee LWOP days deducted proportionally from basic salary.
- ✅ **Bulk employee import** — `app/dashboard/hr/employees/import/page.jsx`; CSV template download; client-side parser; per-row results (created/skipped/error); max 200 rows; action: `app/mongodb/actions/hr-import-actions.js`.

### 5F — Leave ✅
- ✅ **Leave calendar** — `app/dashboard/hr/leave/calendar/page.jsx`; monthly grid showing approved + pending leaves; color-coded by leave type; prev/next month nav.
- ✅ **Public holiday config** — `app/models/publicHoliday.js`; `getDateSet()` excludes holidays from working-day calc in leave actions. Settings → HR → Public Holidays; seed button for Kenya's 8 fixed statutory holidays; one-off entries for Good Friday/Easter/Idd-ul-Fitr each year.
- ✅ **Working days exclude holidays** — `calcWorkingDays()` in `hr-leave-actions.js` is async, uses `PublicHoliday.getDateSet()`.
- ✅ **Leave balance carry-over** — `runLeaveCarryOver({ fromYear, toYear, maxCarryOver, leaveType })` in `hr-leave-admin-actions.js`; per-employee unused days rolled with configurable cap. UI at `app/dashboard/hr/leave/admin/page.jsx`.
- ✅ **Leave accrual** — `runLeaveAccrual({ year, month, leaveType, accrualDays })` monthly batch `$inc` on balanceDays + entitledDays.
- ✅ **Leave encashment** — `encashLeave({ profileId, leaveType, daysToEncash, dailyRate })` validates balance, debits days, returns encashmentAmount.

---

## Phase 6 — Attendance & Time Tracking ✅

> Software-first approach. No hardware required for core functionality.

### Data Model — `app/models/attendance.js` ✅
```
Attendance
 ├ companyId        (tenant scope)
 ├ profileId        (ref: EmployeeProfile, unique per date)
 ├ partyId          (ref: Party)
 ├ employeeName / employeeNumber / department  (snapshot, no $lookup on list)
 ├ date             (Date, midnight UTC — the day key)
 ├ shift            (morning | afternoon | night | custom)
 ├ shiftStart       (HH:MM, default "08:00")
 ├ standardHours    (Number, default 8)
 ├ checkIn          (Date, datetime)
 ├ checkOut         (Date, datetime)
 ├ hoursWorked      (Number, calculated on clockOut)
 ├ overtime         (Number, max(0, hoursWorked - standardHours))
 ├ overtimePay      (Number, computed at payroll time)
 ├ status           (present | absent | late | half-day | on-leave | holiday)
 ├ method           (web | mobile | qr | biometric | manual)
 ├ ipAddress        (web/mobile audit trail)
 ├ location         (lat, lng, accuracy — optional GPS)
 ├ notes            (HR override reason)
 └ overriddenBy/At  (audit trail for manual overrides)
```
Indexes: `{ profileId, date }` unique; `{ companyId, date }` for daily roster; `{ companyId, profileId, date: -1 }` for history.

### Clock-In Methods

| Method | Status | Best For |
|---|---|---|
| Web — server action `clockIn()` | ✅ | Office workers |
| Mobile web — same server action | ✅ | Field staff |
| QR Code — URL redirect to API | 🔧 Future | Warehouse/factory |
| Biometric — device pushes to API | 🔧 Future | High-security / large headcount |
| Manager manual entry | ✅ | Small teams / fallback |

### Actions — `app/mongodb/actions/hr-attendance-actions.js` ✅
- ✅ `clockIn({ profileId, method, ipAddress, location })` — upserts record, detects late (15-min grace on shiftStart)
- ✅ `clockOut({ profileId, method })` — calculates hoursWorked + overtime; half-day if < 4h
- ✅ `manualAttendanceEntry(formData)` — HR override for any employee any date (Admin/HR/Manager)
- ✅ `bulkMarkAbsent(dateStr)` — marks all active employees with no record as absent

### Queries — `app/mongodb/queries/hr-queries.js` ✅
- ✅ `getAttendanceByDate(dateStr)` — daily roster merged with all active employees (shows absent stubs for employees with no record); summary counts
- ✅ `getAttendanceByEmployee({ profileId, page, month, year })` — paginated per-employee history
- ✅ `getAttendanceSummary({ profileIds, from, to })` — aggregates daysPresent/Absent/Late/OnLeave, totalHours, totalOvertime per employee (for payroll)
- ✅ `getTodayAttendanceStats()` — present/absent/onLeave counts for HR overview widget

### Pages ✅
- ✅ `app/dashboard/hr/attendance/page.jsx` — daily roster with date prev/next nav, summary cards (total/present/absent/onLeave), desktop table + mobile cards
- ✅ `app/dashboard/hr/employees/[id]/attendance/page.jsx` — per-employee history with month/year filter, summary strip (present/absent/late/hours/OT)
- ✅ `app/dashboard/hr/employees/[id]/attendance/AttendanceManualEntryForm.jsx` — collapsible HR override form (date, status, shift, checkIn, checkOut, notes)
- ✅ HR Overview page — Today's Attendance widget (progress bar, present/absent/onLeave counts)

### Navigation ✅
- ✅ Attendance tab added to HR sub-nav (`app/dashboard/hr/layout.jsx`)
- ✅ Attendance item added to sidebar HR group (`components/sidebar-content-grouped.jsx`) — visible to Admin/HR/Manager

### Payroll Integration 🔧
- ⬜ Pull `getAttendanceSummary` when generating payroll entries: overtime pay line item, absent-deduction override.
  - Infrastructure is ready (`getAttendanceSummary` returns the right shape); wiring into `generatePayrollEntries` pending.

---

## Phase 7 — GL Integration ⬜
> The app already has chart of accounts and journal entries. Payroll must post to GL.

- [ ] **Payroll journal on approve** — Dr Salary Expense accounts, Cr Salary Payable / NSSF Payable / SHIF Payable / AHL Payable / PAYE Payable. Uses existing `JournalEntry` model.
- [ ] **Payment posting on paid** — Dr Salary Payable, Cr Bank account. Clears net pay liability.
- [ ] **Statutory remittance posting** — when PAYE/NSSF/SHIF/AHL paid to authority: clears respective liability accounts.

---

## Phase 8 — Reporting ⬜

- [ ] Headcount report — hire/termination trend (monthly chart)
- [ ] Leave utilisation — per employee, per department, per leave type
- [ ] Payroll cost — month-over-month, by department
- [ ] Salary variance — month-on-month changes per employee
- [ ] Attendance summary — days worked / late / absent per employee
- [ ] Overtime report — hours and cost

---

## Phase 9 — Advanced / ERP-Level ⬜

### Performance Management
- [ ] `app/models/performanceReview.js` — rating, goals, feedback, reviewer, review cycle
- [ ] Performance review cycle pages

### Recruitment Pipeline
- [ ] `app/models/candidate.js` — applied → screening → interview → offer → hired
- [ ] Recruitment board (kanban-style)
- [ ] Convert hired candidate → `createEmployee` (pre-fills form)

### Training & Certification
- [ ] `app/models/trainingRecord.js` — course, provider, certificationDate, expiryDate
- [ ] Expiry alerts — notify HR 30 days before expiry

### Employee Self-Service
- [ ] Separate dashboard view for Employee role
- [ ] View own payslips
- [ ] Submit / track own leave requests
- [ ] Clock in/out
- [ ] View own compensation and leave balances
- [ ] Update personal details (emergency contact, bank details)

### System
- [ ] Audit log — entity, action, before/after snapshot, changedBy, timestamp
- [ ] In-app notifications — leave approved/rejected, payroll ready, contract expiring, probation due
- [ ] Fine-grained permissions — HR Manager vs HR Officer vs Finance vs Employee

---

## Design Conventions

- **Theme**: CSS tokens only — `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`
- **Primary color**: Yellow — `bg-primary`, `text-primary`
- **Status badges**: `bg-{color}-500/15 text-{color}-700 dark:text-{color}-400`
- **Buttons**: Always `<Button>` from `@/components/ui/button`
- **Mobile**: `hidden md:block` table + `md:hidden` cards; `hidden sm:inline` labels
- **Page padding**: `p-4 sm:p-6`
- **Forms**: `SectionCard` wrapper, `bg-background border-border` inputs, `<Button>` submit
- **Suspense pattern**: Auth at page level (instant); data in async `Loader` in `<Suspense>`
