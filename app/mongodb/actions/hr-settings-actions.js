"use server";

import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope, getCompanyIdForCreate } from "@/lib/utils/tenant-utils";
import PayrollConfig from "@/app/models/payrollConfig";
import { requirePlanAccess } from "@/lib/plan-gate";

// ============================================
// ROLE GUARD
// ============================================
const ALLOWED = ["Admin"];

function guard(user) {
  if (!user) return "Not authenticated";
  if (!ALLOWED.includes(user.role)) return "Only Admins can manage payroll configuration";
  return null;
}

// ============================================
// CREATE PAYROLL CONFIG
// ============================================
export async function createPayrollConfig(_prevState, formData) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    const name = formData.get("name")?.toString().trim();
    const effectiveFrom = formData.get("effectiveFrom")?.toString();
    const personalRelief = parseFloat(formData.get("personalRelief") || "0");
    const nssfTierILimit = parseFloat(formData.get("nssfTierILimit") || "0");
    const nssfTierIILimit = parseFloat(formData.get("nssfTierIILimit") || "0");
    const nssfEmployeeRate = parseFloat(formData.get("nssfEmployeeRate") || "0") / 100;
    const nssfEmployerRate = parseFloat(formData.get("nssfEmployerRate") || "0") / 100;
    const shifRate = parseFloat(formData.get("shifRate") || "0") / 100;
    const ahlEmployeeRate = parseFloat(formData.get("ahlEmployeeRate") || "0") / 100;
    const ahlEmployerRate = parseFloat(formData.get("ahlEmployerRate") || "0") / 100;
    const notes = formData.get("notes")?.toString().trim() || "";

    if (!name) return { success: false, error: "Config name is required", fieldErrors: { name: "Required" } };
    if (!effectiveFrom) return { success: false, error: "Effective from date is required", fieldErrors: { effectiveFrom: "Required" } };
    if (personalRelief < 0) return { success: false, error: "Personal relief must be 0 or more" };

    // Parse PAYE brackets from indexed form fields
    const payeBrackets = [];
    let i = 0;
    while (formData.has(`bracket_from_${i}`)) {
      const from = parseFloat(formData.get(`bracket_from_${i}`) || "0");
      const toRaw = formData.get(`bracket_to_${i}`)?.toString().trim();
      const to = toRaw === "" || toRaw === "0" ? null : parseFloat(toRaw);
      const rate = parseFloat(formData.get(`bracket_rate_${i}`) || "0") / 100;
      if (!isNaN(from) && !isNaN(rate) && rate > 0) {
        payeBrackets.push({ from, to, rate });
      }
      i++;
    }

    if (payeBrackets.length === 0) {
      return { success: false, error: "At least one PAYE tax bracket is required" };
    }

    await dbConnect();

    // If setActive checked, deactivate all existing configs first
    const setActive = formData.get("setActive") === "on" || formData.get("setActive") === "true";
    if (setActive) {
      await PayrollConfig.updateMany(
        withTenantScope({ isActive: true }, tenantCompanyId, isSuperAdmin),
        { $set: { isActive: false } }
      );
    }

    await PayrollConfig.create({
      companyId: tenantCompanyId,
      name,
      effectiveFrom: new Date(effectiveFrom),
      isActive: setActive,
      payeBrackets,
      personalRelief,
      nssfTierILimit,
      nssfTierIILimit,
      nssfEmployeeRate,
      nssfEmployerRate,
      shifRate,
      ahlEmployeeRate,
      ahlEmployerRate,
      notes,
      createdBy: { name: user.name, id: user.id },
    });

    revalidatePath("/dashboard/settings/payroll-config");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to save payroll configuration" };
  }
}

// ============================================
// SAVE GL MAPPING FOR ACTIVE PAYROLL CONFIG
// ============================================
export async function savePayrollGlMapping(_prevState, formData) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    const configId = formData.get("configId")?.toString();
    if (!configId) return { success: false, error: "Config ID is required" };

    await dbConnect();

    const config = await PayrollConfig.findOne(
      withTenantScope({ _id: configId }, companyId, isSuperAdmin)
    );
    if (!config) return { success: false, error: "Configuration not found" };

    // Read account IDs — empty string → null (unset mapping)
    function acctId(name) {
      const v = formData.get(name)?.toString().trim();
      return v || null;
    }

    config.glMapping = {
      salaryExpense:       acctId("salaryExpense"),
      employerNssfExpense: acctId("employerNssfExpense"),
      employerAhlExpense:  acctId("employerAhlExpense"),
      salaryPayable:       acctId("salaryPayable"),
      payePayable:         acctId("payePayable"),
      nssfPayable:         acctId("nssfPayable"),
      shifPayable:         acctId("shifPayable"),
      ahlPayable:          acctId("ahlPayable"),
      bankAccount:         acctId("bankAccount"),
    };
    config.lastModifiedBy = { name: user.name, id: user.id };
    await config.save();

    revalidatePath("/dashboard/settings/payroll-config");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to save GL mapping" };
  }
}

// ============================================
// ACTIVATE PAYROLL CONFIG
// ============================================
export async function activatePayrollConfig(configId) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    await dbConnect();

    // Verify the config belongs to this company
    const config = await PayrollConfig.findOne(
      withTenantScope({ _id: configId }, companyId, isSuperAdmin)
    );
    if (!config) return { success: false, error: "Configuration not found" };

    // Deactivate all, then activate the selected one
    await PayrollConfig.updateMany(
      withTenantScope({}, companyId, isSuperAdmin),
      { $set: { isActive: false } }
    );
    await PayrollConfig.findByIdAndUpdate(configId, {
      $set: { isActive: true, lastModifiedBy: { name: user.name, id: user.id } },
    });

    revalidatePath("/dashboard/settings/payroll-config");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to activate configuration" };
  }
}
