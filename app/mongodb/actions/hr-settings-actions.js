"use server";

import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope, getCompanyIdForCreate } from "@/lib/utils/tenant-utils";
import PayrollConfig from "@/app/models/payrollConfig";
import { requirePlanAccess } from "@/lib/plan-gate";

// ============================================
// ROLE GUARD
// ============================================
const ALLOWED = ["SuperAdmin", "Admin"];

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
    const insuranceReliefRate = parseFloat(formData.get("insuranceReliefRate") || "0.15");
    const insuranceReliefCap = parseFloat(formData.get("insuranceReliefCap") || "5000");
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
      insuranceReliefRate,
      insuranceReliefCap,
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

    const mapping = {
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

    // Validate all account IDs exist and belong to the company
    const accountIds = Object.values(mapping).filter(Boolean);
    if (accountIds.length > 0) {
      const Account = mongoose.model("Account");
      const validCount = await Account.countDocuments({
        _id: { $in: accountIds },
        companyId,
      });
      if (validCount !== accountIds.length) {
        return { success: false, error: "One or more GL accounts are invalid or do not belong to this company" };
      }
    }

    config.glMapping = mapping;
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

// ============================================
// BACKFILL STATUTORY ACCOUNTS
// Creates the payroll accounts that were added after this company was onboarded
// (AHL Payable, Salaries Payable, Employer AHL). Idempotent — skips anything
// already present (keyed by systemAccount marker, not accountCode).
// Also tags an existing untagged "Employer NSSF" (6110) with its systemAccount
// so backfills/lookups can find it reliably.
// ============================================
const STATUTORY_ACCOUNTS_TO_BACKFILL = [
  {
    systemAccount: "ahl_payable",
    accountCode: "2155",
    accountName: "Affordable Housing Levy Payable",
    accountType: "liability",
    subType: "payroll",
    parentCode: "2100",
    description: "Employee + employer AHL — remit to KRA",
  },
  {
    systemAccount: "salaries_payable",
    accountCode: "2185",
    accountName: "Salaries Payable",
    accountType: "liability",
    subType: "payroll",
    parentCode: "2100",
    description: "Net pay accrued on payroll approve; cleared when bank disbursement posts",
  },
  {
    systemAccount: "employer_ahl_expense",
    accountCode: "6115",
    accountName: "Employer AHL",
    accountType: "expense",
    subType: "payroll",
    parentCode: "6000",
    description: "Employer share of Affordable Housing Levy",
  },
];

export async function backfillStatutoryAccounts() {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    await dbConnect();

    const Account = mongoose.model("Account");
    const tenantFilter = withTenantScope({}, companyId, isSuperAdmin);
    const tenantId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    const desiredSystemAccounts = STATUTORY_ACCOUNTS_TO_BACKFILL.map((s) => s.systemAccount);

    const existing = await Account.find({
      ...tenantFilter,
      systemAccount: { $in: [...desiredSystemAccounts, "employer_nssf_expense"] },
    })
      .select("systemAccount accountCode")
      .lean();
    const existingMarkers = new Set(existing.map((a) => a.systemAccount));

    const parentCodes = [...new Set(STATUTORY_ACCOUNTS_TO_BACKFILL.map((s) => s.parentCode))];
    const parents = await Account.find({
      ...tenantFilter,
      accountCode: { $in: parentCodes },
    }).lean();
    const parentByCode = new Map(parents.map((p) => [p.accountCode, p]));

    const created = [];
    const collisions = [];

    for (const spec of STATUTORY_ACCOUNTS_TO_BACKFILL) {
      if (existingMarkers.has(spec.systemAccount)) continue;

      const codeCollision = await Account.findOne({
        ...tenantFilter,
        accountCode: spec.accountCode,
      })
        .select("_id accountName")
        .lean();
      if (codeCollision) {
        collisions.push(`${spec.accountCode} (${codeCollision.accountName})`);
        continue;
      }

      const parent = parentByCode.get(spec.parentCode);
      const ancestors = parent ? [...(parent.ancestors || []), parent._id] : [];
      const level = parent ? (parent.level || 0) + 1 : 0;
      const path = parent?.path ? `${parent.path}/${spec.accountCode}` : spec.accountCode;

      await Account.create({
        companyId: tenantId,
        accountCode: spec.accountCode,
        accountName: spec.accountName,
        accountType: spec.accountType,
        subType: spec.subType,
        canPost: true,
        isActive: true,
        systemAccount: spec.systemAccount,
        parentAccount: parent?._id || null,
        ancestors,
        level,
        path,
        description: spec.description,
        balance: 0,
        createdBy: { name: user.name, id: user.id },
      });

      created.push(`${spec.accountCode} — ${spec.accountName}`);
    }

    let taggedNssf = false;
    if (!existingMarkers.has("employer_nssf_expense")) {
      const nssfDoc = await Account.findOne({
        ...tenantFilter,
        accountCode: "6110",
        systemAccount: { $in: [null, undefined] },
      });
      if (nssfDoc) {
        nssfDoc.systemAccount = "employer_nssf_expense";
        await nssfDoc.save();
        taggedNssf = true;
      }
    }

    revalidatePath("/dashboard/settings/payroll-config");

    const parts = [];
    if (created.length > 0) parts.push(`Created: ${created.join(", ")}`);
    if (taggedNssf) parts.push("Tagged Employer NSSF (6110) with systemAccount marker");
    if (collisions.length > 0) {
      parts.push(`Skipped due to code collision: ${collisions.join(", ")} — rename existing accounts or use a different code`);
    }
    const message = parts.length > 0 ? parts.join(". ") : "All statutory accounts already present";

    return { success: true, message, created, taggedNssf, collisions };
  } catch (error) {
    console.error("backfillStatutoryAccounts:", error);
    return { success: false, error: error.message || "Failed to backfill statutory accounts" };
  }
}
