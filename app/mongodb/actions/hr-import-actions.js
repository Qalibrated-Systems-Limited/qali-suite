"use server";

import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, getCompanyIdForCreate } from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import EmployeeProfile from "@/app/models/employeeProfile";
import Party from "@/app/models/parties";
import LeaveType from "@/app/models/leaveType";

const ALLOWED = ["SuperAdmin", "Admin", "HR"];

// ============================================
// BULK EMPLOYEE IMPORT
// ============================================
// Accepts a JSON array (parsed from CSV on the client).
// Each row maps to one employee (Party + EmployeeProfile).
// Returns per-row results: created, skipped (duplicate email), errors.
// ============================================

// Dynamic leave policy — fetched from LeaveType collection, filtered by gender
async function getLeavePolicy(companyId, gender) {
  await LeaveType.seedDefaults(companyId);
  const leaveTypes = await LeaveType.find({ companyId, isActive: true })
    .sort({ sortOrder: 1 })
    .lean();

  return leaveTypes
    .filter((lt) => lt.applicableGender === "all" || lt.applicableGender === gender)
    .map((lt) => ({
      leaveType: lt.code,
      label: lt.name,
      entitledDays: lt.defaultEntitlement,
      carryOver: 0,
    }));
}

export async function bulkImportEmployees(rows) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!ALLOWED.includes(user?.role)) {
      return { success: false, error: "Only Admin or HR can import employees" };
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return { success: false, error: "No data to import" };
    }

    if (rows.length > 200) {
      return { success: false, error: "Maximum 200 rows per import" };
    }

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    await dbConnect();

    const results = [];
    let created = 0;
    let skipped = 0;
    let errors = 0;
    const currentYear = new Date().getFullYear();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // 1-indexed + header row

      try {
        const firstName = row.firstName?.trim();
        const lastName = row.lastName?.trim();
        const email = row.email?.trim().toLowerCase() || null;
        const phone = row.phone?.trim() || null;
        const nationalId = row.nationalId?.trim() || null;
        const kraPin = row.kraPin?.trim().toUpperCase() || null;
        const nssfNumber = row.nssfNumber?.trim() || null;
        // Accept either `shaNumber` (current) or `nhifNumber` (legacy CSV templates)
        const shaNumber = row.shaNumber?.trim() || row.nhifNumber?.trim() || null;
        const gender = row.gender?.toLowerCase() || null;
        const department = row.department?.trim() || null;
        const designation = row.designation?.trim() || null;
        const employmentType = row.employmentType?.trim() || "full_time";
        const hireDate = row.hireDate ? new Date(row.hireDate) : new Date();
        const basicSalary = parseFloat(row.basicSalary || "0");
        const paymentMethod = row.paymentMethod?.trim() || "bank";
        const bankName = row.bankName?.trim() || null;
        const bankAccount = row.bankAccount?.trim() || null;
        const bankBranch = row.bankBranch?.trim() || null;
        const mpesaNumber = row.mpesaNumber?.trim() || null;

        if (!firstName || !lastName) {
          results.push({ row: rowNum, status: "error", message: "First name and last name are required" });
          errors++;
          continue;
        }

        // Check for duplicate email
        if (email) {
          const exists = await Party.findOne({ companyId: tenantCompanyId, email, type: "employee" });
          if (exists) {
            results.push({ row: rowNum, status: "skipped", name: `${firstName} ${lastName}`, message: `Email ${email} already exists` });
            skipped++;
            continue;
          }
        }

        const mongoSession = await mongoose.startSession();
        mongoSession.startTransaction();

        try {
          // Generate employee number
          const employeeNumber = await EmployeeProfile.generateEmployeeNumber(tenantCompanyId, mongoSession);

          // Create Party
          const [party] = await Party.create(
            [{
              companyId: tenantCompanyId,
              name: `${firstName} ${lastName}`,
              type: "employee",
              email,
              phone,
              employeeNumber,
              department,
              designation,
              isActive: true,
              createdBy: { name: user.name, id: user.id },
            }],
            { session: mongoSession }
          );

          // Create EmployeeProfile
          const profileDoc = {
            companyId: tenantCompanyId,
            partyId: party._id,
            employeeNumber,
            personalInfo: { firstName, lastName, nationalId, kraPin, nssfNumber, shaNumber, gender: ["male","female","other"].includes(gender) ? gender : undefined },
            employment: {
              department,
              designation,
              employmentType: ["full_time","part_time","contract","intern","casual"].includes(employmentType) ? employmentType : "full_time",
              hireDate,
              status: "probation",
            },
            compensation: {
              basicSalary,
              currency: "KES",
              paymentMethod: ["bank","mpesa","cash"].includes(paymentMethod) ? paymentMethod : "bank",
              bankName,
              bankAccount,
              bankBranch,
              mpesaNumber,
            },
            createdBy: { name: user.name, id: user.id },
          };

          const [profile] = await EmployeeProfile.create([profileDoc], { session: mongoSession });

          // Init leave balances (dynamic, gender-filtered)
          const leavePolicy = await getLeavePolicy(tenantCompanyId, gender);
          profile.initLeaveBalances(currentYear, leavePolicy);
          await profile.save({ session: mongoSession });

          await mongoSession.commitTransaction();
          mongoSession.endSession();

          results.push({ row: rowNum, status: "created", name: `${firstName} ${lastName}`, employeeNumber });
          created++;
        } catch (innerErr) {
          await mongoSession.abortTransaction();
          mongoSession.endSession();
          throw innerErr;
        }
      } catch (rowErr) {
        results.push({ row: rowNum, status: "error", message: rowErr.message || "Unknown error" });
        errors++;
      }
    }

    revalidatePath("/dashboard/hr/employees");
    return { success: true, created, skipped, errors, results };
  } catch (error) {
    return { success: false, error: error.message || "Import failed" };
  }
}
