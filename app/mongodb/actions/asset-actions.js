"use server";

import { z } from "zod";
import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  getCompanyIdForCreate,
} from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import { safeErrorMessage } from "@/lib/safe-error";
import Asset from "@/app/models/asset";
import JournalEntry from "@/app/models/JournalEntry";
import ErpCounter from "@/app/models/erp-counter";

// ============================================
// ZOD SCHEMAS
// ============================================
const CreateAssetSchema = z.object({
  name: z.string().min(1, "Asset name is required").max(200).trim(),
  category: z.enum(
    [
      "vehicle",
      "equipment",
      "computer",
      "furniture",
      "building",
      "land",
      "machinery",
      "other",
    ],
    { errorMap: () => ({ message: "Select a valid category" }) },
  ),
  acquisitionCost: z
    .number({ invalid_type_error: "Acquisition cost must be a number" })
    .nonnegative("Acquisition cost cannot be negative")
    .max(1_000_000_000_000, "Acquisition cost exceeds maximum"),
  acquisitionDate: z.coerce.date({
    errorMap: () => ({ message: "Invalid acquisition date" }),
  }),
  depreciationMethod: z
    .enum(["straight_line", "reducing_balance", "none"])
    .default("straight_line"),
  usefulLifeMonths: z
    .number({ invalid_type_error: "Useful life must be a number" })
    .int()
    .min(0, "Useful life cannot be negative")
    .max(1200, "Useful life too long")
    .default(60),
  salvageValue: z
    .number()
    .nonnegative("Salvage value cannot be negative")
    .default(0),
  depreciationRate: z
    .number()
    .min(0, "Depreciation rate cannot be negative")
    .max(1, "Rate must be a decimal (e.g., 0.25 for 25%)")
    .default(0),
  depreciationStartDate: z.coerce.date().optional(),
  kraClass: z
    .enum(["class_I", "class_II", "class_III", "class_IV", "none"])
    .default("none"),
  serialNumber: z.string().max(200).optional().default(""),
  model: z.string().max(200).optional().default(""),
  manufacturer: z.string().max(200).optional().default(""),
  registrationNumber: z.string().max(50).optional().default(""),
  location: z.string().max(200).optional().default(""),
  department: z.string().max(100).optional().default(""),
  description: z.string().max(1000).optional().default(""),
  notes: z.string().max(1000).optional().default(""),
  assetAccountId: z.string().optional().default(""),
  accumulatedDepreciationAccountId: z.string().optional().default(""),
  depreciationExpenseAccountId: z.string().optional().default(""),
  sourceType: z.enum(["bill", "journal", "manual"]).default("manual"),
  sourceId: z.string().optional().default(""),
  sourceReference: z.string().max(200).optional().default(""),
});

const UpdateAssetSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  name: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(1000).optional(),
  location: z.string().max(200).optional(),
  department: z.string().max(100).optional(),
  assignedToPartyId: z.string().optional(),
  assignedToName: z.string().max(200).optional(),
  serialNumber: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  manufacturer: z.string().max(200).optional(),
  registrationNumber: z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
  photoUrl: z.string().max(500).optional(),
  kraClass: z
    .enum(["class_I", "class_II", "class_III", "class_IV", "none"])
    .optional(),
  insuranceProvider: z.string().max(200).optional(),
  insurancePolicyNumber: z.string().max(100).optional(),
  insuranceExpiryDate: z.string().optional(),
  insurancePremium: z.number().nonnegative().optional(),
  inspectionLastDate: z.string().optional(),
  inspectionNextDueDate: z.string().optional(),
  // Pre-depreciation-only updatable fields
  acquisitionCost: z.number().nonnegative().optional(),
  depreciationMethod: z
    .enum(["straight_line", "reducing_balance", "none"])
    .optional(),
  usefulLifeMonths: z.number().int().min(0).max(1200).optional(),
  salvageValue: z.number().nonnegative().optional(),
  depreciationRate: z.number().min(0).max(1).optional(),
  depreciationStartDate: z.string().optional(),
});

const PostDepreciationSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be in YYYY-MM format"),
});

const DisposeAssetSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  disposalMethod: z.enum(["sold", "scrapped", "donated", "lost", "stolen"], {
    errorMap: () => ({ message: "Select a valid disposal method" }),
  }),
  disposalDate: z.coerce.date({
    errorMap: () => ({ message: "Invalid disposal date" }),
  }),
  disposalAmount: z
    .number()
    .nonnegative("Disposal amount cannot be negative")
    .default(0),
  bankAccountId: z.string().optional().default(""),
  gainAccountId: z.string().optional().default(""),
  lossAccountId: z.string().optional().default(""),
  notes: z.string().max(1000).optional().default(""),
});

const CancelDepreciationSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be in YYYY-MM format"),
  reason: z.string().max(500).optional().default(""),
});

// ============================================
// ROLE AUTHORIZATION
// ============================================
const ASSET_ROLES = {
  CREATE: ["Admin", "Accountant"],
  UPDATE: ["Admin", "Accountant"],
  POST_DEPRECIATION: ["Admin", "Accountant"],
  DISPOSE: ["Admin"],
  CANCEL_DEPRECIATION: ["Admin"],
  VIEW_ALL: ["Admin", "Accountant", "Manager"],
};

function hasRole(user, roles) {
  if (user.role === "SuperAdmin") return true;
  return roles.includes(user.role);
}

// ============================================
// GL JOURNAL HELPERS
// ============================================

/**
 * Fetch account details for a list of account IDs.
 * Returns a Map of id.toString() -> { accountCode, accountName, accountType }.
 */
async function fetchAccountDetails(accountIds, session = null) {
  const Account = mongoose.model("Account");
  const ids = accountIds.filter(Boolean);
  if (ids.length === 0) return new Map();
  let query = Account.find(
    { _id: { $in: ids } },
    "accountCode accountName accountType",
  );
  if (session) query = query.session(session);
  const accounts = await query.lean();
  return new Map(accounts.map((a) => [a._id.toString(), a]));
}

/**
 * Build a journal line; returns null if the account is not mapped or amount is zero.
 */
function jeLine(accountMap, accountId, debit, credit, description) {
  if (!accountId) return null;
  const acct = accountMap.get(accountId.toString());
  if (!acct) return null;
  if ((debit || 0) === 0 && (credit || 0) === 0) return null;
  return {
    accountId,
    accountCode: acct.accountCode,
    accountName: acct.accountName,
    accountType: acct.accountType,
    debit: debit || 0,
    credit: credit || 0,
    description,
  };
}

/**
 * Resolve a GL account for an asset, preferring the asset's glMapping,
 * falling back to the company's system account mapping.
 */
async function resolveAccount(
  companyId,
  explicitAccountId,
  systemAccountName,
  session = null,
) {
  if (explicitAccountId) return explicitAccountId;
  const Account = mongoose.model("Account");
  const filter = {
    companyId,
    systemAccount: systemAccountName,
    isActive: true,
  };
  let query = Account.findOne(filter).select("_id");
  if (session) query = query.session(session);
  const acct = await query.lean();
  return acct?._id || null;
}

/**
 * Parse a nullable date string from FormData.
 */
function parseDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// ============================================
// CREATE ASSET
// ============================================
export async function createAsset(_prevState, formData) {
  let mongoSession = null;

  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.CREATE)) {
      return {
        success: false,
        error: "You do not have permission to create assets",
      };
    }

    const tenantCompanyId = getCompanyIdForCreate(
      null,
      companyId,
      isSuperAdmin,
    );

    // Parse and validate with Zod
    const parsed = CreateAssetSchema.safeParse({
      name: formData.get("name")?.toString() || "",
      category: formData.get("category")?.toString(),
      acquisitionCost: parseFloat(formData.get("acquisitionCost")) || 0,
      acquisitionDate: formData.get("acquisitionDate")?.toString(),
      depreciationMethod:
        formData.get("depreciationMethod")?.toString() || "straight_line",
      usefulLifeMonths:
        parseInt(formData.get("usefulLifeMonths"), 10) || 60,
      salvageValue: parseFloat(formData.get("salvageValue") || "0"),
      depreciationRate: parseFloat(formData.get("depreciationRate") || "0"),
      depreciationStartDate:
        formData.get("depreciationStartDate")?.toString() ||
        formData.get("acquisitionDate")?.toString(),
      kraClass: formData.get("kraClass")?.toString() || "none",
      serialNumber: formData.get("serialNumber")?.toString() || "",
      model: formData.get("model")?.toString() || "",
      manufacturer: formData.get("manufacturer")?.toString() || "",
      registrationNumber:
        formData.get("registrationNumber")?.toString() || "",
      location: formData.get("location")?.toString() || "",
      department: formData.get("department")?.toString() || "",
      description: formData.get("description")?.toString() || "",
      notes: formData.get("notes")?.toString() || "",
      assetAccountId: formData.get("assetAccountId")?.toString() || "",
      accumulatedDepreciationAccountId:
        formData.get("accumulatedDepreciationAccountId")?.toString() || "",
      depreciationExpenseAccountId:
        formData.get("depreciationExpenseAccountId")?.toString() || "",
      sourceType: formData.get("sourceType")?.toString() || "manual",
      sourceId: formData.get("sourceId")?.toString() || "",
      sourceReference: formData.get("sourceReference")?.toString() || "",
    });

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      const firstError = Object.values(fieldErrors).flat()[0];
      return {
        success: false,
        error: firstError || "Invalid input",
        fieldErrors,
      };
    }

    const data = parsed.data;

    // Category-based validation
    if (data.category === "land" && data.depreciationMethod !== "none") {
      return {
        success: false,
        error: "Land cannot be depreciated. Set depreciation method to 'none'.",
      };
    }

    if (
      data.depreciationMethod === "reducing_balance" &&
      data.depreciationRate <= 0
    ) {
      return {
        success: false,
        error:
          "Reducing balance method requires a depreciation rate greater than zero",
      };
    }

    if (data.salvageValue > data.acquisitionCost) {
      return {
        success: false,
        error: "Salvage value cannot exceed acquisition cost",
      };
    }

    await dbConnect();

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    const assetNumber = await Asset.generateAssetNumber(
      tenantCompanyId,
      mongoSession,
    );

    const glMapping = {};
    if (data.assetAccountId) glMapping.assetAccount = data.assetAccountId;
    if (data.accumulatedDepreciationAccountId) {
      glMapping.accumulatedDepreciationAccount =
        data.accumulatedDepreciationAccountId;
    }
    if (data.depreciationExpenseAccountId) {
      glMapping.depreciationExpenseAccount =
        data.depreciationExpenseAccountId;
    }

    const asset = new Asset({
      companyId: tenantCompanyId,
      assetNumber,
      name: data.name,
      category: data.category,
      description: data.description || undefined,
      serialNumber: data.serialNumber || undefined,
      model: data.model || undefined,
      manufacturer: data.manufacturer || undefined,
      registrationNumber: data.registrationNumber || undefined,
      location: data.location || undefined,
      department: data.department || undefined,
      acquisitionDate: data.acquisitionDate,
      acquisitionCost: data.acquisitionCost,
      depreciationMethod: data.depreciationMethod,
      usefulLifeMonths:
        data.depreciationMethod === "none" ? 0 : data.usefulLifeMonths,
      salvageValue: data.salvageValue,
      depreciationRate: data.depreciationRate,
      depreciationStartDate:
        data.depreciationStartDate || data.acquisitionDate,
      kraClass: data.kraClass,
      glMapping,
      sourceType: data.sourceType,
      sourceId: data.sourceId || undefined,
      sourceReference: data.sourceReference || undefined,
      notes: data.notes || undefined,
      createdBy: { name: user.name, id: user.id },
    });

    // Generate depreciation schedule
    asset.generateSchedule();

    await asset.save({ session: mongoSession });
    await mongoSession.commitTransaction();

    revalidatePath("/dashboard/assets");

    return { success: true, assetId: asset._id.toString() };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    console.error("createAsset error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to create asset"),
    };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// UPDATE ASSET
// ============================================
export async function updateAsset(_prevState, formData) {
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.UPDATE)) {
      return {
        success: false,
        error: "You do not have permission to update assets",
      };
    }

    const raw = {
      assetId: formData.get("assetId")?.toString(),
    };

    // Only include provided fields — allow partial updates
    const textFields = [
      "name",
      "description",
      "location",
      "department",
      "assignedToPartyId",
      "assignedToName",
      "serialNumber",
      "model",
      "manufacturer",
      "registrationNumber",
      "notes",
      "photoUrl",
      "kraClass",
      "insuranceProvider",
      "insurancePolicyNumber",
      "insuranceExpiryDate",
      "inspectionLastDate",
      "inspectionNextDueDate",
      "depreciationMethod",
      "depreciationStartDate",
    ];
    for (const f of textFields) {
      if (formData.has(f)) {
        raw[f] = formData.get(f)?.toString() || "";
      }
    }

    const numFields = [
      "insurancePremium",
      "acquisitionCost",
      "usefulLifeMonths",
      "salvageValue",
      "depreciationRate",
    ];
    for (const f of numFields) {
      if (formData.has(f)) {
        const v = formData.get(f)?.toString() || "";
        if (v !== "") {
          raw[f] = f === "usefulLifeMonths" ? parseInt(v, 10) : parseFloat(v);
        }
      }
    }

    const parsed = UpdateAssetSchema.safeParse(raw);

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      const firstError = Object.values(fieldErrors).flat()[0];
      return { success: false, error: firstError || "Invalid input" };
    }

    const data = parsed.data;

    await dbConnect();

    const filter = isSuperAdmin
      ? { _id: data.assetId }
      : { _id: data.assetId, companyId };

    const asset = await Asset.findOne(filter);
    if (!asset) {
      return { success: false, error: "Asset not found" };
    }

    // Check whether any depreciation has been posted
    const anyPosted = asset.depreciationSchedule.some(
      (s) => s.status === "posted",
    );

    // Non-financial updates — always allowed while asset is not disposed
    if (asset.status === "disposed" || asset.status === "written_off") {
      return {
        success: false,
        error: `Cannot update an asset with status "${asset.status}"`,
      };
    }

    const simpleFields = [
      "name",
      "description",
      "location",
      "department",
      "assignedToName",
      "serialNumber",
      "model",
      "manufacturer",
      "registrationNumber",
      "notes",
      "photoUrl",
      "kraClass",
    ];
    for (const f of simpleFields) {
      if (data[f] !== undefined) {
        asset[f] = data[f] || undefined;
      }
    }

    if (data.assignedToPartyId !== undefined) {
      asset.assignedToPartyId = data.assignedToPartyId || undefined;
    }

    // Insurance
    if (
      data.insuranceProvider !== undefined ||
      data.insurancePolicyNumber !== undefined ||
      data.insuranceExpiryDate !== undefined ||
      data.insurancePremium !== undefined
    ) {
      asset.insurance = asset.insurance || {};
      if (data.insuranceProvider !== undefined) {
        asset.insurance.provider = data.insuranceProvider || undefined;
      }
      if (data.insurancePolicyNumber !== undefined) {
        asset.insurance.policyNumber =
          data.insurancePolicyNumber || undefined;
      }
      if (data.insuranceExpiryDate !== undefined) {
        asset.insurance.expiryDate = parseDateOrNull(
          data.insuranceExpiryDate,
        );
      }
      if (data.insurancePremium !== undefined) {
        asset.insurance.premium = data.insurancePremium;
      }
    }

    // Inspection
    if (
      data.inspectionLastDate !== undefined ||
      data.inspectionNextDueDate !== undefined
    ) {
      asset.inspection = asset.inspection || {};
      if (data.inspectionLastDate !== undefined) {
        asset.inspection.lastDate = parseDateOrNull(data.inspectionLastDate);
      }
      if (data.inspectionNextDueDate !== undefined) {
        asset.inspection.nextDueDate = parseDateOrNull(
          data.inspectionNextDueDate,
        );
      }
    }

    // Depreciation-related updates
    const financialFields = [
      "acquisitionCost",
      "depreciationMethod",
      "usefulLifeMonths",
      "salvageValue",
      "depreciationRate",
      "depreciationStartDate",
    ];
    const financialTouched = financialFields.some(
      (f) => data[f] !== undefined,
    );

    if (financialTouched) {
      if (anyPosted) {
        return {
          success: false,
          error:
            "Cannot change acquisition cost or depreciation parameters after depreciation has been posted. Reverse the depreciation first.",
        };
      }

      if (data.acquisitionCost !== undefined) {
        asset.acquisitionCost = data.acquisitionCost;
      }
      if (data.depreciationMethod !== undefined) {
        asset.depreciationMethod = data.depreciationMethod;
      }
      if (data.usefulLifeMonths !== undefined) {
        asset.usefulLifeMonths = data.usefulLifeMonths;
      }
      if (data.salvageValue !== undefined) {
        asset.salvageValue = data.salvageValue;
      }
      if (data.depreciationRate !== undefined) {
        asset.depreciationRate = data.depreciationRate;
      }
      if (data.depreciationStartDate !== undefined) {
        const parsedStart = parseDateOrNull(data.depreciationStartDate);
        if (parsedStart) asset.depreciationStartDate = parsedStart;
      }

      if (asset.salvageValue > asset.acquisitionCost) {
        return {
          success: false,
          error: "Salvage value cannot exceed acquisition cost",
        };
      }

      // Regenerate schedule (no postings yet)
      asset.generateSchedule();
    }

    asset.lastModifiedBy = { name: user.name, id: user.id };
    await asset.save();

    revalidatePath("/dashboard/assets");
    revalidatePath(`/dashboard/assets/${asset._id.toString()}`);

    return { success: true, assetId: asset._id.toString() };
  } catch (error) {
    console.error("updateAsset error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to update asset"),
    };
  }
}

// ============================================
// POST DEPRECIATION (BATCH — RUN MONTHLY)
// ============================================
export async function postDepreciation(_prevState, formData) {
  let mongoSession = null;

  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.POST_DEPRECIATION)) {
      return {
        success: false,
        error: "You do not have permission to post depreciation",
      };
    }

    const parsed = PostDepreciationSchema.safeParse({
      period: formData.get("period")?.toString(),
    });
    if (!parsed.success) {
      const firstError = Object.values(
        parsed.error.flatten().fieldErrors,
      ).flat()[0];
      return { success: false, error: firstError || "Invalid period" };
    }

    const { period } = parsed.data;

    await dbConnect();

    const tenantCompanyId = getCompanyIdForCreate(
      null,
      companyId,
      isSuperAdmin,
    );

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    // Find active assets with pending depreciation for this period
    const assets = await Asset.find({
      companyId: tenantCompanyId,
      status: "active",
      depreciationSchedule: {
        $elemMatch: { period, status: "pending" },
      },
    }).session(mongoSession);

    if (assets.length === 0) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: `No pending depreciation found for period ${period}`,
      };
    }

    let processedCount = 0;
    let totalAmount = 0;
    const journalEntryIds = [];
    const [year, month] = period.split("-").map((v) => parseInt(v, 10));

    for (const asset of assets) {
      const scheduleEntry = asset.depreciationSchedule.find(
        (s) => s.period === period && s.status === "pending",
      );
      if (!scheduleEntry) continue;

      // Resolve GL accounts (asset-level override or company system account)
      const depExpenseAccountId = await resolveAccount(
        tenantCompanyId,
        asset.glMapping?.depreciationExpenseAccount,
        "depreciation_expense",
        mongoSession,
      );
      const accumDepAccountId = await resolveAccount(
        tenantCompanyId,
        asset.glMapping?.accumulatedDepreciationAccount,
        "accumulated_depreciation",
        mongoSession,
      );

      if (!depExpenseAccountId || !accumDepAccountId) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: `Cannot resolve GL accounts for asset ${asset.assetNumber}. Map a Depreciation Expense and Accumulated Depreciation account on the asset or as company defaults.`,
        };
      }

      const accountMap = await fetchAccountDetails(
        [depExpenseAccountId, accumDepAccountId],
        mongoSession,
      );

      const debitLine = jeLine(
        accountMap,
        depExpenseAccountId,
        scheduleEntry.depreciationAmount,
        0,
        `Depreciation — ${asset.name} (${asset.assetNumber}) — ${period}`,
      );
      const creditLine = jeLine(
        accountMap,
        accumDepAccountId,
        0,
        scheduleEntry.depreciationAmount,
        `Accumulated depreciation — ${asset.name} (${asset.assetNumber}) — ${period}`,
      );

      if (!debitLine || !creditLine) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: `Could not build journal lines for asset ${asset.assetNumber}. Ensure GL accounts are active.`,
        };
      }

      // Create journal entry number
      const seq = await ErpCounter.getNextSequence(
        "je-dep",
        tenantCompanyId,
        mongoSession,
      );
      const entryNumber = `JE-DEP-${String(seq).padStart(4, "0")}`;

      // Use last day of period as the entry date
      const entryDate = new Date(Date.UTC(year, month, 0));

      const je = new JournalEntry({
        companyId: tenantCompanyId,
        entryNumber,
        entryDate,
        entryType: "depreciation",
        description: `Monthly depreciation — ${asset.name} (${asset.assetNumber}) — ${period}`,
        reference: asset.assetNumber,
        lines: [debitLine, creditLine],
        fiscalYear: year,
        fiscalMonth: month,
        createdBy: { name: user.name, id: user.id },
      });

      await je.post({ name: user.name, id: user.id }, mongoSession);

      // Update asset
      asset.recordDepreciation(period, je._id);
      asset.lastModifiedBy = { name: user.name, id: user.id };
      await asset.save({ session: mongoSession });

      processedCount++;
      totalAmount += scheduleEntry.depreciationAmount;
      journalEntryIds.push(je._id.toString());
    }

    await mongoSession.commitTransaction();

    revalidatePath("/dashboard/assets");
    revalidatePath("/dashboard/accounts/journal");

    return {
      success: true,
      period,
      processedCount,
      totalAmount,
      journalEntryIds,
    };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    console.error("postDepreciation error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to post depreciation"),
    };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// DISPOSE ASSET
// ============================================
export async function disposeAsset(_prevState, formData) {
  let mongoSession = null;

  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.DISPOSE)) {
      return {
        success: false,
        error: "You do not have permission to dispose of assets",
      };
    }

    const parsed = DisposeAssetSchema.safeParse({
      assetId: formData.get("assetId")?.toString(),
      disposalMethod: formData.get("disposalMethod")?.toString(),
      disposalDate: formData.get("disposalDate")?.toString(),
      disposalAmount: parseFloat(formData.get("disposalAmount") || "0"),
      bankAccountId: formData.get("bankAccountId")?.toString() || "",
      gainAccountId: formData.get("gainAccountId")?.toString() || "",
      lossAccountId: formData.get("lossAccountId")?.toString() || "",
      notes: formData.get("notes")?.toString() || "",
    });

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      const firstError = Object.values(fieldErrors).flat()[0];
      return { success: false, error: firstError || "Invalid disposal data" };
    }

    const {
      assetId,
      disposalMethod,
      disposalDate,
      disposalAmount,
      bankAccountId,
      gainAccountId,
      lossAccountId,
      notes,
    } = parsed.data;

    // "sold" must have a bank/cash account and a positive amount
    if (disposalMethod === "sold") {
      if (!bankAccountId) {
        return {
          success: false,
          error: "Select a bank/cash account to record the sale proceeds",
        };
      }
      if (disposalAmount <= 0) {
        return {
          success: false,
          error: "Disposal amount must be greater than zero for a sale",
        };
      }
    }

    await dbConnect();

    const filter = isSuperAdmin
      ? { _id: assetId }
      : { _id: assetId, companyId };

    const asset = await Asset.findOne(filter);
    if (!asset) {
      return { success: false, error: "Asset not found" };
    }

    if (asset.status === "disposed" || asset.status === "written_off") {
      return {
        success: false,
        error: `Asset is already ${asset.status}`,
      };
    }

    const tenantCompanyId = asset.companyId;

    const cost = asset.acquisitionCost || 0;
    const accumDep = asset.accumulatedDepreciation || 0;
    const bookValue = Math.max(0, cost - accumDep);
    const gainOrLoss = (disposalAmount || 0) - bookValue; // + gain, - loss

    // Resolve accounts
    const assetAccountId = await resolveAccount(
      tenantCompanyId,
      asset.glMapping?.assetAccount,
      "fixed_asset",
    );
    const accumDepAccountId = await resolveAccount(
      tenantCompanyId,
      asset.glMapping?.accumulatedDepreciationAccount,
      "accumulated_depreciation",
    );

    if (!assetAccountId || !accumDepAccountId) {
      return {
        success: false,
        error:
          "Cannot resolve GL accounts. Set Fixed Asset and Accumulated Depreciation accounts on the asset or as company defaults.",
      };
    }

    let gainResolvedId = null;
    let lossResolvedId = null;
    if (gainOrLoss > 0) {
      gainResolvedId = await resolveAccount(
        tenantCompanyId,
        gainAccountId,
        "gain_on_disposal",
      );
      if (!gainResolvedId) {
        return {
          success: false,
          error:
            "Cannot resolve Gain on Disposal account. Provide it or map a company default.",
        };
      }
    } else if (gainOrLoss < 0) {
      lossResolvedId = await resolveAccount(
        tenantCompanyId,
        lossAccountId,
        "loss_on_disposal",
      );
      if (!lossResolvedId) {
        return {
          success: false,
          error:
            "Cannot resolve Loss on Disposal account. Provide it or map a company default.",
        };
      }
    }

    // Collect all account IDs used across lines
    const accountIds = [
      assetAccountId,
      accumDepAccountId,
      bankAccountId || null,
      gainResolvedId,
      lossResolvedId,
    ].filter(Boolean);

    const accountMap = await fetchAccountDetails(accountIds);

    // Build journal lines
    const lines = [];
    const refLabel = `${asset.name} (${asset.assetNumber})`;

    // DR Bank (if sold)
    if (disposalMethod === "sold" && disposalAmount > 0 && bankAccountId) {
      const line = jeLine(
        accountMap,
        bankAccountId,
        disposalAmount,
        0,
        `Proceeds from disposal — ${refLabel}`,
      );
      if (!line) {
        return {
          success: false,
          error: "Bank/cash account could not be resolved",
        };
      }
      lines.push(line);
    }

    // DR Accumulated Depreciation (remove balance)
    if (accumDep > 0) {
      const line = jeLine(
        accountMap,
        accumDepAccountId,
        accumDep,
        0,
        `Remove accumulated depreciation — ${refLabel}`,
      );
      if (!line) {
        return {
          success: false,
          error: "Accumulated depreciation account could not be resolved",
        };
      }
      lines.push(line);
    }

    // DR Loss on Disposal (if loss)
    if (gainOrLoss < 0 && lossResolvedId) {
      const line = jeLine(
        accountMap,
        lossResolvedId,
        Math.abs(gainOrLoss),
        0,
        `Loss on disposal — ${refLabel}`,
      );
      if (line) lines.push(line);
    }

    // CR Fixed Asset (remove original cost)
    if (cost > 0) {
      const line = jeLine(
        accountMap,
        assetAccountId,
        0,
        cost,
        `Dispose fixed asset cost — ${refLabel}`,
      );
      if (!line) {
        return {
          success: false,
          error: "Fixed asset account could not be resolved",
        };
      }
      lines.push(line);
    }

    // CR Gain on Disposal (if gain)
    if (gainOrLoss > 0 && gainResolvedId) {
      const line = jeLine(
        accountMap,
        gainResolvedId,
        0,
        gainOrLoss,
        `Gain on disposal — ${refLabel}`,
      );
      if (line) lines.push(line);
    }

    if (lines.length < 2) {
      return {
        success: false,
        error:
          "Unable to construct a valid disposal journal entry. Check account mappings and asset values.",
      };
    }

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    const seq = await ErpCounter.getNextSequence(
      "je-ast-disp",
      tenantCompanyId,
      mongoSession,
    );
    const entryNumber = `JE-AST-DISP-${String(seq).padStart(4, "0")}`;

    const je = new JournalEntry({
      companyId: tenantCompanyId,
      entryNumber,
      entryDate: disposalDate,
      entryType: "asset_disposal",
      description: `Asset disposal — ${asset.name} (${asset.assetNumber}) — ${disposalMethod}`,
      reference: asset.assetNumber,
      lines,
      fiscalYear: disposalDate.getUTCFullYear(),
      fiscalMonth: disposalDate.getUTCMonth() + 1,
      createdBy: { name: user.name, id: user.id },
    });

    await je.post({ name: user.name, id: user.id }, mongoSession);

    asset.status = "disposed";
    asset.disposedAt = disposalDate;
    asset.disposedBy = { name: user.name, id: user.id };
    asset.disposalMethod = disposalMethod;
    asset.disposalAmount = disposalAmount;
    asset.disposalJournalId = je._id;
    asset.gainOrLoss = gainOrLoss;
    asset.disposalNotes = notes || undefined;
    asset.journalEntryIds.push(je._id);
    asset.lastModifiedBy = { name: user.name, id: user.id };

    // Cancel any pending depreciation entries after disposal
    for (const entry of asset.depreciationSchedule) {
      if (entry.status === "pending") entry.status = "skipped";
    }
    asset.bookValue = 0;

    await asset.save({ session: mongoSession });
    await mongoSession.commitTransaction();

    revalidatePath("/dashboard/assets");
    revalidatePath(`/dashboard/assets/${asset._id.toString()}`);

    return {
      success: true,
      assetId: asset._id.toString(),
      gainOrLoss,
      journalEntryId: je._id.toString(),
    };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    console.error("disposeAsset error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to dispose asset"),
    };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// CANCEL DEPRECIATION POSTING (UNPOST MOST RECENT)
// ============================================
export async function cancelDepreciationPosting(_prevState, formData) {
  let mongoSession = null;

  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.CANCEL_DEPRECIATION)) {
      return {
        success: false,
        error: "You do not have permission to cancel depreciation postings",
      };
    }

    const parsed = CancelDepreciationSchema.safeParse({
      assetId: formData.get("assetId")?.toString(),
      period: formData.get("period")?.toString(),
      reason: formData.get("reason")?.toString() || "",
    });

    if (!parsed.success) {
      const firstError = Object.values(
        parsed.error.flatten().fieldErrors,
      ).flat()[0];
      return { success: false, error: firstError || "Invalid input" };
    }

    const { assetId, period, reason } = parsed.data;

    await dbConnect();

    const filter = isSuperAdmin
      ? { _id: assetId }
      : { _id: assetId, companyId };

    const asset = await Asset.findOne(filter);
    if (!asset) {
      return { success: false, error: "Asset not found" };
    }

    // Must only allow cancelling the most recent posted entry
    const postedEntries = asset.depreciationSchedule
      .filter((s) => s.status === "posted")
      .sort((a, b) => a.period.localeCompare(b.period));

    if (postedEntries.length === 0) {
      return {
        success: false,
        error: "No posted depreciation entries exist for this asset",
      };
    }

    const mostRecent = postedEntries[postedEntries.length - 1];
    if (mostRecent.period !== period) {
      return {
        success: false,
        error: `Can only cancel the most recent posted period. The most recent is ${mostRecent.period}.`,
      };
    }

    const targetEntry = asset.depreciationSchedule.find(
      (s) => s.period === period && s.status === "posted",
    );
    if (!targetEntry) {
      return {
        success: false,
        error: `No posted depreciation found for period ${period}`,
      };
    }

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    // Reverse the journal entry if present
    if (targetEntry.journalEntryId) {
      const originalJe = await JournalEntry.findById(
        targetEntry.journalEntryId,
      ).session(mongoSession);
      if (originalJe && originalJe.status === "posted") {
        await originalJe.reverse(
          { name: user.name, id: user.id },
          reason || `Cancel depreciation for ${period}`,
        );
      }
    }

    // Revert the schedule entry and running totals
    targetEntry.status = "pending";
    targetEntry.journalEntryId = undefined;
    targetEntry.postedAt = undefined;

    // Recompute running totals from remaining posted entries
    const remainingPosted = asset.depreciationSchedule
      .filter((s) => s.status === "posted")
      .sort((a, b) => a.period.localeCompare(b.period));
    const last = remainingPosted[remainingPosted.length - 1];
    asset.accumulatedDepreciation = last ? last.accumulatedDepreciation : 0;
    asset.bookValue = last
      ? last.bookValue
      : asset.acquisitionCost;
    asset.lastModifiedBy = { name: user.name, id: user.id };

    await asset.save({ session: mongoSession });
    await mongoSession.commitTransaction();

    revalidatePath("/dashboard/assets");
    revalidatePath(`/dashboard/assets/${asset._id.toString()}`);

    return { success: true, assetId: asset._id.toString(), period };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    console.error("cancelDepreciationPosting error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to cancel depreciation"),
    };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// READ FUNCTIONS (not server actions — helpers for pages)
// ============================================

/**
 * Paginated, filterable list of assets.
 * @param {object} filters - { status, category, search, page, limit }
 */
export async function getAssets(filters = {}) {
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.VIEW_ALL)) {
      return { success: false, error: "Access denied", assets: [], total: 0 };
    }

    await dbConnect();

    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(filters.limit, 10) || 20),
    );
    const skip = (page - 1) * limit;

    const query = isSuperAdmin ? {} : { companyId };

    if (filters.status) query.status = filters.status;
    if (filters.category) query.category = filters.category;
    if (filters.search) {
      const searchRegex = new RegExp(
        filters.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      query.$or = [
        { assetNumber: searchRegex },
        { name: searchRegex },
        { serialNumber: searchRegex },
        { registrationNumber: searchRegex },
      ];
    }

    const [assets, total] = await Promise.all([
      Asset.find(query)
        .select(
          "assetNumber name category status acquisitionCost acquisitionDate accumulatedDepreciation bookValue location department registrationNumber",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Asset.countDocuments(query),
    ]);

    return { success: true, assets, total, page, limit };
  } catch (error) {
    console.error("getAssets error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to load assets"),
      assets: [],
      total: 0,
    };
  }
}

/**
 * Get a single asset with its full depreciation schedule.
 */
export async function getAssetById(assetId) {
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.VIEW_ALL)) {
      return { success: false, error: "Access denied", asset: null };
    }

    await dbConnect();

    const filter = isSuperAdmin
      ? { _id: assetId }
      : { _id: assetId, companyId };

    const asset = await Asset.findOne(filter).lean();
    if (!asset) {
      return { success: false, error: "Asset not found", asset: null };
    }

    return { success: true, asset };
  } catch (error) {
    console.error("getAssetById error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to load asset"),
      asset: null,
    };
  }
}

/**
 * Totals by category (for dashboard stats cards).
 */
export async function getAssetsTotals() {
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.VIEW_ALL)) {
      return { success: false, error: "Access denied", totals: [] };
    }

    await dbConnect();

    const scopeCompanyId = isSuperAdmin ? null : companyId;

    if (!scopeCompanyId) {
      // SuperAdmin — aggregate across all companies
      const result = await Asset.aggregate([
        { $match: { status: "active" } },
        {
          $group: {
            _id: "$category",
            count: { $sum: 1 },
            totalCost: { $sum: "$acquisitionCost" },
            totalAccumulatedDep: { $sum: "$accumulatedDepreciation" },
            totalBookValue: { $sum: "$bookValue" },
          },
        },
      ]);
      return { success: true, totals: result };
    }

    const totals = await Asset.getTotals(scopeCompanyId);
    return { success: true, totals };
  } catch (error) {
    console.error("getAssetsTotals error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to load asset totals"),
      totals: [],
    };
  }
}
