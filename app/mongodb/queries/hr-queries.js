// ============================================
// HR QUERIES — Server-only read functions
// ============================================
// NO "use server" — these are imported directly into Server Components (page.jsx)
// All queries:
//   1. Use .lean() — returns plain JS objects, no Mongoose overhead
//   2. Scope by companyId — multi-tenant safety
//   3. Serialize ObjectIds/Dates to strings — safe for client props
//   4. Never use $lookup/$populate in hot list paths — embedded snapshots used instead
// ============================================

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";

// Lazy model imports — avoid circular deps, only load what's needed
import Department from "@/app/models/department";
import EmployeeProfile from "@/app/models/employeeProfile";
import LeaveRequest from "@/app/models/leaveRequest";
import PayrollRun from "@/app/models/payrollRun";
import PayrollEntry from "@/app/models/payrollEntry";
import PayrollConfig from "@/app/models/payrollConfig";
import PublicHoliday from "@/app/models/publicHoliday";
import Attendance from "@/app/models/attendance";

// ============================================
// SERIALIZERS
// ============================================
// Convert MongoDB documents to plain JSON for client components.
// ObjectIds and Dates must be strings — Next.js cannot serialize them.

function serializeDepartment(dept) {
  if (!dept) return null;
  return {
    _id: dept._id.toString(),
    code: dept.code,
    name: dept.name,
    description: dept.description || null,
    head: dept.head?.partyId
      ? { partyId: dept.head.partyId.toString(), name: dept.head.name, employeeNumber: dept.head.employeeNumber }
      : null,
    costCenter: dept.costCenter?.accountId
      ? { accountId: dept.costCenter.accountId.toString(), accountCode: dept.costCenter.accountCode, accountName: dept.costCenter.accountName }
      : null,
    parentDepartmentId: dept.parentDepartmentId?.toString() || null,
    isActive: dept.isActive,
    createdAt: dept.createdAt?.toISOString() || null,
    updatedAt: dept.updatedAt?.toISOString() || null,
  };
}

function serializeEmployee(profile) {
  if (!profile) return null;
  return {
    _id: profile._id.toString(),
    partyId: profile.partyId?.toString() || null,
    userId: profile.userId?.toString() || null,
    employeeNumber: profile.employeeNumber || null,
    personalInfo: {
      firstName: profile.personalInfo?.firstName || "",
      lastName: profile.personalInfo?.lastName || "",
      dateOfBirth: profile.personalInfo?.dateOfBirth?.toISOString() || null,
      gender: profile.personalInfo?.gender || null,
      nationalId: profile.personalInfo?.nationalId || null,
      kraPin: profile.personalInfo?.kraPin || null,
      nssfNumber: profile.personalInfo?.nssfNumber || null,
      // Fall back to legacy `nhifNumber` for records created before the rename.
      shaNumber:
        profile.personalInfo?.shaNumber ||
        profile.personalInfo?.nhifNumber ||
        null,
      nationality: profile.personalInfo?.nationality || null,
      photo: profile.personalInfo?.photo || null,
    },
    employment: {
      departmentId: profile.employment?.departmentId?.toString() || null,
      department: profile.employment?.department || null,
      designation: profile.employment?.designation || null,
      employmentType: profile.employment?.employmentType || null,
      status: profile.employment?.status || null,
      hireDate: profile.employment?.hireDate?.toISOString() || null,
      confirmationDate: profile.employment?.confirmationDate?.toISOString() || null,
      terminationDate: profile.employment?.terminationDate?.toISOString() || null,
      managerId: profile.employment?.managerId?.toString() || null,
      managerName: profile.employment?.managerName || null,
      workLocation: profile.employment?.workLocation || null,
      jobGrade: profile.employment?.jobGrade || null,
    },
    compensation: {
      basicSalary: profile.compensation?.basicSalary || 0,
      currency: profile.compensation?.currency || "KES",
      allowances: profile.compensation?.allowances || {},
      paymentMethod: profile.compensation?.paymentMethod || "bank",
      bankName: profile.compensation?.bankName || null,
      bankAccount: profile.compensation?.bankAccount || null,
      mpesaNumber: profile.compensation?.mpesaNumber || null,
      lastReviewDate: profile.compensation?.lastReviewDate?.toISOString() || null,
    },
    leaveBalances: (profile.leaveBalances || []).map((b) => ({
      leaveType: b.leaveType,
      label: b.label,
      entitledDays: b.entitledDays,
      usedDays: b.usedDays,
      pendingDays: b.pendingDays,
      balanceDays: b.balanceDays,
      carryOver: b.carryOver,
      year: b.year,
    })),
    emergencyContact: profile.emergencyContact || null,
    documents: (profile.documents || []).map((d) => ({
      _id: d._id?.toString() || null,
      docType: d.docType,
      name: d.name || null,
      url: d.url || null,
      publicId: d.publicId || null,
      expiryDate: d.expiryDate?.toISOString() || null,
      uploadedAt: d.uploadedAt?.toISOString() || null,
      uploadedBy: d.uploadedBy || null,
    })),
    notes: profile.notes || null,
    createdAt: profile.createdAt?.toISOString() || null,
    updatedAt: profile.updatedAt?.toISOString() || null,
  };
}

function serializeLeaveRequest(leave) {
  if (!leave) return null;
  return {
    _id: leave._id.toString(),
    leaveNumber: leave.leaveNumber,
    employee: {
      partyId: leave.employee?.partyId?.toString(),
      profileId: leave.employee?.profileId?.toString(),
      name: leave.employee?.name,
      employeeNumber: leave.employee?.employeeNumber || null,
      department: leave.employee?.department || null,
    },
    leaveType: leave.leaveType,
    dates: {
      from: leave.dates?.from?.toISOString() || null,
      to: leave.dates?.to?.toISOString() || null,
      totalDays: leave.dates?.totalDays || 0,
      halfDay: leave.dates?.halfDay || false,
    },
    reason: leave.reason || null,
    status: leave.status,
    submittedAt: leave.submittedAt?.toISOString() || null,
    approvedAt: leave.approvedAt?.toISOString() || null,
    rejectedAt: leave.rejectedAt?.toISOString() || null,
    rejectionReason: leave.rejectionReason || null,
    balanceSnapshot: leave.balanceSnapshot || null,
    createdAt: leave.createdAt?.toISOString() || null,
    updatedAt: leave.updatedAt?.toISOString() || null,
  };
}

function serializePayrollRun(run) {
  if (!run) return null;
  return {
    _id: run._id.toString(),
    payrollNumber: run.payrollNumber,
    period: {
      month: run.period?.month,
      year: run.period?.year,
      from: run.period?.from?.toISOString() || null,
      to: run.period?.to?.toISOString() || null,
      label: run.period?.label,
    },
    scope: run.scope,
    departmentId: run.departmentId?.toString() || null,
    departmentName: run.departmentName || null,
    totals: run.totals || {},
    currency: run.currency,
    status: run.status,
    preparedBy: run.preparedBy || null,
    approvedBy: run.approvedBy || null,
    postedBy: run.postedBy || null,
    approvedAt: run.approvedAt?.toISOString() || null,
    postedAt: run.postedAt?.toISOString() || null,
    paidAt: run.paidAt?.toISOString() || null,
    notes: run.notes || null,
    journalEntryIds: (run.journalEntryIds || []).map((id) => id.toString()),
    createdAt: run.createdAt?.toISOString() || null,
    updatedAt: run.updatedAt?.toISOString() || null,
  };
}

function serializePayrollEntry(entry) {
  if (!entry) return null;
  return {
    _id: entry._id.toString(),
    payrollRunId: entry.payrollRunId.toString(),
    partyId: entry.partyId.toString(),
    employeeNumber: entry.employeeNumber || null,
    employeeName: entry.employeeName || null,
    department: entry.department || null,
    designation: entry.designation || null,
    period: entry.period || null,
    earnings: entry.earnings || {},
    deductions: entry.deductions || {},
    netPay: entry.netPay || 0,
    currency: entry.currency || "KES",
    paymentStatus: entry.paymentStatus,
    paidAt: entry.paidAt?.toISOString() || null,
    workingDays: entry.workingDays || null,
    notes: entry.notes || null,
  };
}

// ============================================
// DEPARTMENT QUERIES
// ============================================

export async function getDepartments({ page = 1, limit = 20, search = "", isActive = "" } = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const scope = withTenantScope({}, companyId, isSuperAdmin);

  if (isActive !== "") scope.isActive = isActive === "true";
  if (search) {
    scope.$or = [
      { name: new RegExp(search, "i") },
      { code: new RegExp(search, "i") },
    ];
  }

  const [departments, total] = await Promise.all([
    Department.find(scope)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Department.countDocuments(scope),
  ]);

  return {
    departments: departments.map(serializeDepartment),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getDepartmentById(id) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const dept = await Department.findOne(
    withTenantScope({ _id: id }, companyId, isSuperAdmin)
  ).lean();

  return { department: serializeDepartment(dept) };
}

// ============================================
// EMPLOYEE QUERIES
// ============================================

export async function getEmployees({
  page = 1,
  limit = 20,
  search = "",
  departmentId = "",
  status = "",
} = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const scope = withTenantScope({}, companyId, isSuperAdmin);

  if (departmentId) scope["employment.departmentId"] = departmentId;
  if (status) scope["employment.status"] = status;
  else scope["employment.status"] = { $ne: "terminated" }; // Default: hide terminated

  if (search) {
    scope.$or = [
      { employeeNumber: new RegExp(search, "i") },
      { "personalInfo.firstName": new RegExp(search, "i") },
      { "personalInfo.lastName": new RegExp(search, "i") },
      { "employment.designation": new RegExp(search, "i") },
    ];
  }

  const [employees, total] = await Promise.all([
    EmployeeProfile.find(scope)
      // Select only list-view fields — never fetch full doc for list
      .select(
        "employeeNumber personalInfo.firstName personalInfo.lastName personalInfo.photo " +
        "employment.department employment.designation employment.status employment.hireDate " +
        "employment.employmentType compensation.basicSalary"
      )
      .sort({ "personalInfo.lastName": 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    EmployeeProfile.countDocuments(scope),
  ]);

  return {
    employees: employees.map(serializeEmployee),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getEmployeeById(id) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const profile = await EmployeeProfile.findOne(
    withTenantScope({ _id: id }, companyId, isSuperAdmin)
  ).lean();

  if (!profile) return { employee: null, error: "Employee not found" };

  // Fetch contact info from Party (email, phone live there)
  let contactEmail = null;
  let contactPhone = null;
  if (profile.partyId) {
    const Party = (await import("@/app/models/parties")).default;
    const party = await Party.findById(profile.partyId).select("email phone").lean();
    contactEmail = party?.email || null;
    contactPhone = party?.phone || null;
  }

  const serialized = serializeEmployee(profile);
  serialized.contactEmail = contactEmail;
  serialized.contactPhone = contactPhone;
  return { employee: serialized };
}

export async function getEmployeeByPartyId(partyId) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const profile = await EmployeeProfile.findOne(
    withTenantScope({ partyId }, companyId, isSuperAdmin)
  ).lean();

  return { employee: serializeEmployee(profile) };
}

export async function getHRStats() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const scope = withTenantScope({}, companyId, isSuperAdmin);

  const [
    totalActive,
    totalOnLeave,
    totalProbation,
    pendingLeaveApprovals,
    headcountByDept,
  ] = await Promise.all([
    EmployeeProfile.countDocuments({ ...scope, "employment.status": "active" }),
    EmployeeProfile.countDocuments({ ...scope, "employment.status": "on_leave" }),
    EmployeeProfile.countDocuments({ ...scope, "employment.status": "probation" }),
    LeaveRequest.countDocuments({ ...scope, status: "submitted" }),
    EmployeeProfile.getHeadcountByDepartment(companyId),
  ]);

  return {
    totalActive,
    totalOnLeave,
    totalProbation,
    totalHeadcount: totalActive + totalOnLeave + totalProbation,
    pendingLeaveApprovals,
    headcountByDept: headcountByDept.map((d) => ({
      departmentId: d._id?.toString() || null,
      department: d.department || "Unassigned",
      count: d.count,
    })),
  };
}

// ============================================
// CONTRACT EXPIRY ALERTS
// ============================================
export async function getExpiringContracts(daysAhead = 30) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const today = new Date();
  const cutoff = new Date();
  cutoff.setDate(today.getDate() + daysAhead);

  const profiles = await EmployeeProfile.find(
    withTenantScope(
      {
        "employment.status": { $nin: ["terminated"] },
        "employment.contractEnd": { $gte: today, $lte: cutoff },
      },
      companyId,
      isSuperAdmin
    )
  )
    .select("employeeNumber personalInfo.firstName personalInfo.lastName employment.department employment.designation employment.contractEnd employment.contractType")
    .sort({ "employment.contractEnd": 1 })
    .lean();

  return profiles.map((p) => ({
    _id: p._id.toString(),
    employeeNumber: p.employeeNumber,
    name: `${p.personalInfo?.firstName} ${p.personalInfo?.lastName}`.trim(),
    department: p.employment?.department,
    designation: p.employment?.designation,
    contractEnd: p.employment?.contractEnd?.toISOString() || null,
    contractType: p.employment?.contractType || null,
    daysRemaining: Math.ceil((new Date(p.employment.contractEnd) - today) / (1000 * 60 * 60 * 24)),
  }));
}

// ============================================
// LEAVE QUERIES
// ============================================

export async function getLeaveRequests({
  page = 1,
  limit = 20,
  search = "",
  status = "",
  leaveType = "",
  partyId = "",
  year = "",
} = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Self-heal: transition expired approved leaves to "completed" and
  // restore employees stuck on "on_leave" with no current overlap. Best
  // effort — never blocks the page.
  if (companyId) {
    const { sweepCompletedLeaves } = await import("@/lib/hr/leave-sweep");
    await sweepCompletedLeaves(companyId);
  }

  const scope = withTenantScope({}, companyId, isSuperAdmin);

  if (status) scope.status = status;
  if (leaveType) scope.leaveType = leaveType;
  if (partyId) scope["employee.partyId"] = partyId;
  if (year) {
    const y = parseInt(year);
    scope["dates.from"] = {
      $gte: new Date(y, 0, 1),
      $lt: new Date(y + 1, 0, 1),
    };
  }
  if (search) {
    scope.$or = [
      { leaveNumber: new RegExp(search, "i") },
      { "employee.name": new RegExp(search, "i") },
      { "employee.employeeNumber": new RegExp(search, "i") },
    ];
  }

  const [requests, total] = await Promise.all([
    LeaveRequest.find(scope)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    LeaveRequest.countDocuments(scope),
  ]);

  return {
    leaveRequests: requests.map(serializeLeaveRequest),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getLeaveRequestById(id) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const leave = await LeaveRequest.findOne(
    withTenantScope({ _id: id }, companyId, isSuperAdmin)
  ).lean();

  if (!leave) return { leaveRequest: null, error: "Leave request not found" };
  return { leaveRequest: serializeLeaveRequest(leave) };
}

// ============================================
// PAYROLL QUERIES
// ============================================

export async function getPayrollRuns({
  page = 1,
  limit = 12,
  status = "",
  year = "",
} = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const scope = withTenantScope({}, companyId, isSuperAdmin);

  if (status) scope.status = status;
  if (year) scope["period.year"] = parseInt(year);

  const [runs, total] = await Promise.all([
    PayrollRun.find(scope)
      .sort({ "period.year": -1, "period.month": -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PayrollRun.countDocuments(scope),
  ]);

  return {
    payrollRuns: runs.map(serializePayrollRun),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getPayrollRunById(id) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const run = await PayrollRun.findOne(
    withTenantScope({ _id: id }, companyId, isSuperAdmin)
  ).lean();

  if (!run) return { payrollRun: null, error: "Payroll run not found" };

  // Fetch entries separately (parent-ref pattern — no $lookup)
  const entries = await PayrollEntry.find({ payrollRunId: run._id })
    .sort({ employeeName: 1 })
    .lean();

  return {
    payrollRun: serializePayrollRun(run),
    entries: entries.map(serializePayrollEntry),
  };
}

// ============================================
// PAYROLL CONFIGS
// ============================================
export async function getPayrollConfigs() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const configs = await PayrollConfig.find(
    withTenantScope({}, companyId, isSuperAdmin)
  )
    .sort({ effectiveFrom: -1 })
    .lean();

  return configs.map((c) => ({
    _id: c._id.toString(),
    name: c.name,
    effectiveFrom: c.effectiveFrom?.toISOString() || null,
    effectiveTo: c.effectiveTo?.toISOString() || null,
    isActive: c.isActive,
    currency: c.currency,
    payeBrackets: (c.payeBrackets || []).map((b) => ({
      from: b.from,
      to: b.to ?? null,
      rate: b.rate,
    })),
    personalRelief: c.personalRelief,
    insuranceReliefRate: c.insuranceReliefRate,
    insuranceReliefCap: c.insuranceReliefCap,
    nssfTierILimit: c.nssfTierILimit,
    nssfTierIILimit: c.nssfTierIILimit,
    nssfEmployeeRate: c.nssfEmployeeRate,
    nssfEmployerRate: c.nssfEmployerRate,
    shifRate: c.shifRate,
    ahlEmployeeRate: c.ahlEmployeeRate,
    ahlEmployerRate: c.ahlEmployerRate,
    notes: c.notes || null,
    createdBy: c.createdBy || null,
    createdAt: c.createdAt?.toISOString() || null,
  }));
}

// ============================================
// PUBLIC HOLIDAYS
// ============================================
// ============================================
// LEAVE CALENDAR
// ============================================
export async function getLeaveCalendarEvents(month, year) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const from = new Date(year, month - 1, 1);         // First day of month
  const to = new Date(year, month, 0, 23, 59, 59);   // Last day of month

  const leaves = await LeaveRequest.find(
    withTenantScope(
      {
        status: { $in: ["approved", "submitted"] },
        "dates.from": { $lte: to },
        "dates.to": { $gte: from },
      },
      companyId,
      isSuperAdmin
    )
  )
    .select("employee.name employee.department leaveType dates.from dates.to dates.totalDays status")
    .sort({ "dates.from": 1 })
    .lean();

  return leaves.map((l) => ({
    _id: l._id.toString(),
    employeeName: l.employee?.name || "",
    department: l.employee?.department || "",
    leaveType: l.leaveType,
    from: l.dates?.from?.toISOString() || null,
    to: l.dates?.to?.toISOString() || null,
    totalDays: l.dates?.totalDays || 0,
    status: l.status,
  }));
}

// ============================================
// PUBLIC HOLIDAYS
// ============================================
export async function getPublicHolidays() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const holidays = await PublicHoliday.find(
    withTenantScope({}, companyId, isSuperAdmin)
  )
    .sort({ month: 1, day: 1 })
    .lean();

  return holidays.map((h) => ({
    _id: h._id.toString(),
    name: h.name,
    month: h.month,
    day: h.day,
    year: h.year || null,
    isRecurring: h.isRecurring,
    createdAt: h.createdAt?.toISOString() || null,
  }));
}

// ============================================
// ATTENDANCE QUERIES
// ============================================

function serializeAttendance(a) {
  if (!a) return null;
  return {
    _id:            a._id.toString(),
    profileId:      a.profileId?.toString() || null,
    partyId:        a.partyId?.toString() || null,
    employeeName:   a.employeeName || "",
    employeeNumber: a.employeeNumber || "",
    department:     a.department || "",
    date:           a.date?.toISOString() || null,
    shift:          a.shift || "morning",
    checkIn:        a.checkIn?.toISOString() || null,
    checkOut:       a.checkOut?.toISOString() || null,
    hoursWorked:    a.hoursWorked || 0,
    overtime:       a.overtime || 0,
    status:         a.status || "absent",
    method:         a.method || "manual",
    notes:          a.notes || null,
    overriddenBy:   a.overriddenBy ? { name: a.overriddenBy.name } : null,
    overriddenAt:   a.overriddenAt?.toISOString() || null,
    createdAt:      a.createdAt?.toISOString() || null,
  };
}

// Daily roster — all attendance records for a given date
// Joined with active employees so absent employees are also shown
export async function getAttendanceByDate(dateStr) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const dateKey = new Date(dateStr);
  dateKey.setUTCHours(0, 0, 0, 0);

  const [records, employees] = await Promise.all([
    Attendance.find(
      withTenantScope({ date: dateKey }, companyId, isSuperAdmin)
    )
      .sort({ employeeName: 1 })
      .lean(),

    EmployeeProfile.find(
      withTenantScope(
        // Include on_leave and suspended — they appear in the roster with their status
        { "employment.status": { $in: ["active", "probation", "on_leave", "suspended"] } },
        companyId,
        isSuperAdmin
      )
    )
      .select("_id partyId personalInfo employeeNumber employment.department employment.status companyId")
      .sort({ "personalInfo.firstName": 1 })
      .lean(),
  ]);

  // Map of existing records keyed by profileId
  const recordMap = Object.fromEntries(records.map((r) => [r.profileId.toString(), r]));

  // Map profile employment.status (underscore) → attendance status (hyphen)
  const profileStatusToAttendance = {
    on_leave:  "on-leave",
    suspended: "absent",
    active:    "absent",
    probation: "absent",
  };

  // Merge: for every employee show their record or a synthetic stub
  const roster = employees.map((emp) => {
    const existing = recordMap[emp._id.toString()];
    if (existing) return serializeAttendance(existing);
    const defaultStatus = profileStatusToAttendance[emp.employment?.status] || "absent";
    return {
      _id:            null,
      profileId:      emp._id.toString(),
      partyId:        emp.partyId?.toString() || null,
      employeeName:   `${emp.personalInfo?.firstName || ""} ${emp.personalInfo?.lastName || ""}`.trim(),
      employeeNumber: emp.employeeNumber || "",
      department:     emp.employment?.department || "",
      date:           dateKey.toISOString(),
      shift:          "morning",
      checkIn:        null,
      checkOut:       null,
      hoursWorked:    0,
      overtime:       0,
      status:         defaultStatus,
      method:         null,
      notes:          null,
      overriddenBy:   null,
      overriddenAt:   null,
      createdAt:      null,
    };
  });

  const summary = {
    total:     roster.length,
    present:   roster.filter((r) => r.status === "present" || r.status === "late").length,
    absent:    roster.filter((r) => r.status === "absent").length,
    late:      roster.filter((r) => r.status === "late").length,
    onLeave:   roster.filter((r) => r.status === "on-leave").length,
    halfDay:   roster.filter((r) => r.status === "half-day").length,
  };

  return { roster, summary, date: dateKey.toISOString() };
}

// Per-employee attendance history (paginated)
export async function getAttendanceByEmployee({ profileId, page = 1, limit = 30, month, year } = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const scope = withTenantScope({ profileId }, companyId, isSuperAdmin);
  if (month && year) {
    const from = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, 1));
    const to = new Date(Date.UTC(parseInt(year), parseInt(month), 0, 23, 59, 59));
    scope.date = { $gte: from, $lte: to };
  } else if (year) {
    const from = new Date(Date.UTC(parseInt(year), 0, 1));
    const to = new Date(Date.UTC(parseInt(year), 11, 31, 23, 59, 59));
    scope.date = { $gte: from, $lte: to };
  }

  const [records, total] = await Promise.all([
    Attendance.find(scope)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Attendance.countDocuments(scope),
  ]);

  return {
    records: records.map(serializeAttendance),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// Summary for payroll period — days worked, overtime per employee
export async function getAttendanceSummary({ companyId: cId, profileIds, from, to } = {}) {
  await dbConnect();
  const { companyId: tenantCompanyId, isSuperAdmin } = await getTenantContext();
  const companyId = cId || tenantCompanyId;

  const scope = { companyId, date: { $gte: new Date(from), $lte: new Date(to) } };
  if (profileIds?.length) scope.profileId = { $in: profileIds };

  const records = await Attendance.find(scope)
    .select("profileId status hoursWorked overtime date")
    .lean();

  // Aggregate per employee
  const summaryMap = {};
  for (const r of records) {
    const pid = r.profileId.toString();
    if (!summaryMap[pid]) {
      summaryMap[pid] = { daysPresent: 0, daysAbsent: 0, daysLate: 0, daysOnLeave: 0, totalHours: 0, totalOvertime: 0 };
    }
    const s = summaryMap[pid];
    if (r.status === "present") s.daysPresent++;
    else if (r.status === "late") { s.daysPresent++; s.daysLate++; }
    else if (r.status === "absent") s.daysAbsent++;
    else if (r.status === "on-leave") s.daysOnLeave++;
    s.totalHours += r.hoursWorked || 0;
    s.totalOvertime += r.overtime || 0;
  }
  return summaryMap;
}

// Today's attendance stats for HR overview widget
export async function getTodayAttendanceStats() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const dateKey = new Date();
  dateKey.setUTCHours(0, 0, 0, 0);

  const [records, totalActive, profileOnLeave] = await Promise.all([
    Attendance.find(withTenantScope({ date: dateKey }, companyId, isSuperAdmin))
      .select("status")
      .lean(),
    EmployeeProfile.countDocuments(
      withTenantScope({ "employment.status": { $in: ["active", "probation", "on_leave", "suspended"] } }, companyId, isSuperAdmin)
    ),
    // Count employees whose HR status is on_leave — authoritative even before any
    // attendance records are created (Attendance collection may be empty on day 1)
    EmployeeProfile.countDocuments(
      withTenantScope({ "employment.status": "on_leave" }, companyId, isSuperAdmin)
    ),
  ]);

  const present = records.filter((r) => r.status === "present" || r.status === "late").length;
  // Use the higher of: attendance-recorded on-leave OR profile employment status
  const onLeaveFromRecords = records.filter((r) => r.status === "on-leave").length;
  const onLeave = Math.max(onLeaveFromRecords, profileOnLeave);
  const absent  = Math.max(0, totalActive - present - onLeave);

  return { totalActive, present, absent: Math.max(0, absent), onLeave };
}

// ============================================
// EMPLOYEE SELF-SERVICE QUERIES
// ============================================

/**
 * Get the EmployeeProfile for the currently logged-in user (by userId).
 * Returns null if the user has no employee profile.
 */
export async function getMyEmployeeProfile() {
  await dbConnect();
  const { companyId, isSuperAdmin, user } = await getTenantContext();
  if (!user?.id) return null;

  const profile = await EmployeeProfile.findOne(
    withTenantScope({ userId: user.id }, companyId, isSuperAdmin)
  )
    .select(
      "employeeNumber partyId " +
      "personalInfo.firstName personalInfo.lastName personalInfo.photo " +
      "personalInfo.gender personalInfo.dateOfBirth personalInfo.nationality " +
      // Select both new + legacy field so records created before the rename still surface.
      "personalInfo.nationalId personalInfo.kraPin personalInfo.nssfNumber personalInfo.shaNumber personalInfo.nhifNumber " +
      "employment.department employment.designation employment.employmentType " +
      "employment.hireDate employment.confirmationDate employment.status " +
      "employment.workLocation employment.managerName employment.jobGrade " +
      "employment.contractStart employment.contractEnd employment.contractType " +
      "employment.shiftStart employment.shiftEnd " +
      "compensation.basicSalary compensation.currency " +
      "emergencyContact " +
      "leaveBalances"
    )
    .lean();

  if (!profile) return null;

  return {
    _id: profile._id.toString(),
    partyId: profile.partyId?.toString() || null,
    employeeNumber: profile.employeeNumber || null,
    name: `${profile.personalInfo?.firstName || ""} ${profile.personalInfo?.lastName || ""}`.trim(),
    photo: profile.personalInfo?.photo?.url || null,
    // Personal info
    gender: profile.personalInfo?.gender || null,
    dateOfBirth: profile.personalInfo?.dateOfBirth?.toISOString() || null,
    nationality: profile.personalInfo?.nationality || null,
    nationalId: profile.personalInfo?.nationalId || null,
    kraPin: profile.personalInfo?.kraPin || null,
    nssfNumber: profile.personalInfo?.nssfNumber || null,
    // Fall back to legacy `nhifNumber` for records created before the rename.
    shaNumber:
      profile.personalInfo?.shaNumber ||
      profile.personalInfo?.nhifNumber ||
      null,
    // Employment
    department: profile.employment?.department || null,
    designation: profile.employment?.designation || null,
    employmentType: profile.employment?.employmentType || null,
    hireDate: profile.employment?.hireDate?.toISOString() || null,
    confirmationDate: profile.employment?.confirmationDate?.toISOString() || null,
    status: profile.employment?.status || null,
    workLocation: profile.employment?.workLocation || null,
    managerName: profile.employment?.managerName || null,
    jobGrade: profile.employment?.jobGrade || null,
    contractStart: profile.employment?.contractStart?.toISOString() || null,
    contractEnd: profile.employment?.contractEnd?.toISOString() || null,
    contractType: profile.employment?.contractType || null,
    shiftStart: profile.employment?.shiftStart || null,
    shiftEnd: profile.employment?.shiftEnd || null,
    // Compensation
    basicSalary: profile.compensation?.basicSalary || 0,
    currency: profile.compensation?.currency || "KES",
    // Emergency contact
    emergencyContact: profile.emergencyContact
      ? {
          name: profile.emergencyContact.name || null,
          relationship: profile.emergencyContact.relationship || null,
          phone: profile.emergencyContact.phone || null,
        }
      : null,
    leaveBalances: profile.leaveBalances || [],
  };
}

/**
 * Get payslips (paid PayrollEntry records) for the current employee.
 * Sorted newest first. Limit 24 months.
 */
export async function getMyPayslips({ page = 1, limit = 12 } = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin, user } = await getTenantContext();
  if (!user?.id) return { payslips: [], pagination: { page, limit, total: 0, totalPages: 0 } };

  // Find the employee's profile ID
  const profile = await EmployeeProfile.findOne(
    withTenantScope({ userId: user.id }, companyId, isSuperAdmin),
    "_id"
  ).lean();

  if (!profile) return { payslips: [], pagination: { page, limit, total: 0, totalPages: 0 } };

  const scope = withTenantScope({ profileId: profile._id }, companyId, isSuperAdmin);

  const [entries, total] = await Promise.all([
    PayrollEntry.find(scope)
      .sort({ "period.year": -1, "period.month": -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PayrollEntry.countDocuments(scope),
  ]);

  const payslips = entries.map((e) => ({
    _id: e._id.toString(),
    payrollRunId: e.payrollRunId?.toString() || null,
    period: {
      month: e.period?.month,
      year: e.period?.year,
      label: e.period?.label || `${e.period?.month}/${e.period?.year}`,
    },
    employeeName: e.employeeName || null,
    employeeNumber: e.employeeNumber || null,
    department: e.department || null,
    designation: e.designation || null,
    earnings: {
      basicSalary: e.earnings?.basicSalary || 0,
      housingAllowance: e.earnings?.housingAllowance || 0,
      transportAllowance: e.earnings?.transportAllowance || 0,
      medicalAllowance: e.earnings?.medicalAllowance || 0,
      overtime: e.earnings?.overtime || 0,
      bonus: e.earnings?.bonus || 0,
      grossPay: e.earnings?.grossPay || 0,
    },
    deductions: {
      paye: e.deductions?.paye || 0,
      nssf: e.deductions?.nssf || 0,
      shif: e.deductions?.shif || 0,
      housingLevy: e.deductions?.housingLevy || 0,
      totalDeductions: e.deductions?.totalDeductions || 0,
    },
    netPay: e.netPay || 0,
    currency: e.currency || "KES",
    paymentStatus: e.paymentStatus || "pending",
    paidAt: e.paidAt?.toISOString() || null,
  }));

  return {
    payslips,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Get today's attendance record for the current employee.
 * Used in the employee dashboard to show clock-in status.
 */
export async function getMyTodayAttendanceSummary() {
  await dbConnect();
  const { companyId, isSuperAdmin, user } = await getTenantContext();
  if (!user?.id) return null;

  const profile = await EmployeeProfile.findOne(
    withTenantScope({ userId: user.id }, companyId, isSuperAdmin),
    "_id"
  ).lean();
  if (!profile) return null;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const record = await Attendance.findOne({ profileId: profile._id, date: today })
    .select("status checkIn checkOut hoursWorked")
    .lean();

  if (!record) return { status: "not-clocked-in", checkIn: null, checkOut: null, hoursWorked: 0 };

  return {
    status: record.status,
    checkIn: record.checkIn?.toISOString() || null,
    checkOut: record.checkOut?.toISOString() || null,
    hoursWorked: record.hoursWorked || 0,
  };
}

/**
 * Get company users who have no linked EmployeeProfile.
 * Used by HR to identify legacy/unlinked accounts that need profiles created.
 * Excludes SuperAdmin (system-wide, not company employees).
 */
export async function getUsersWithoutProfiles() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  if (isSuperAdmin) return []; // SuperAdmin sees all companies — not meaningful here

  const User = (await import("@/app/models/user")).default;

  // Get all userIds already linked to an EmployeeProfile in this company
  const linkedUserIds = await EmployeeProfile.distinct(
    "userId",
    withTenantScope({ userId: { $ne: null } }, companyId, isSuperAdmin)
  );

  // Find company Users not in that set, excluding SuperAdmin
  const users = await User.find({
    companyId,
    role: { $ne: "SuperAdmin" },
    _id: { $nin: linkedUserIds },
  })
    .select("name email role createdAt")
    .sort({ createdAt: 1 })
    .lean();

  return users.map((u) => ({
    _id: u._id.toString(),
    name: u.name,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt?.toISOString() || null,
  }));
}
