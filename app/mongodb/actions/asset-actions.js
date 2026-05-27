"use server";

import { z } from "zod";
import { roleAllowed } from "@/lib/permissions";
import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import { safeErrorMessage } from "@/lib/safe-error";
import Asset from "@/app/models/asset";
import Bill from "@/app/models/bill";
import Expense from "@/app/models/expenses";
import JournalEntry from "@/app/models/JournalEntry";
import ErpCounter from "@/app/models/erp-counter";

// ============================================
// CAPITALIZE-FROM-BILL HELPERS
// ============================================

/**
 * Parse a "billId:lineId" string into its parts. Returns null if malformed.
 */
function parseBillLineRef(raw) {
  if (!raw || typeof raw !== "string") return null;
  const [billId, lineId] = raw.split(":");
  if (!billId || !lineId) return null;
  if (
    !mongoose.Types.ObjectId.isValid(billId) ||
    !mongoose.Types.ObjectId.isValid(lineId)
  ) {
    return null;
  }
  return { billId, lineId };
}

/**
 * Public read used by the asset create page to pre-fill from a bill line.
 * Returns serialized prefill values, or an error/redirect signal.
 */
export async function loadBillLineForCapitalization(billLineRef) {
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.CREATE)) {
      return { error: "You do not have permission to capitalize bills" };
    }

    const parsed = parseBillLineRef(billLineRef);
    if (!parsed) return { error: "Invalid bill line reference" };

    await dbConnect();
    const result = await loadCapitalizableLine({
      billId: parsed.billId,
      lineId: parsed.lineId,
      companyId,
      isSuperAdmin,
      mongoSession: null,
    });
    if (result.error) {
      return {
        error: result.error,
        alreadyCapitalizedAssetId: result.alreadyCapitalizedAssetId || null,
      };
    }

    return {
      prefill: {
        name: result.line.description?.slice(0, 200) || "",
        description: result.line.description || "",
        acquisitionCost: result.line.amount || 0,
        acquisitionDate:
          result.bill.billDate?.toISOString?.() ?? result.bill.billDate ?? null,
        sourceType: "bill",
        sourceId: result.bill._id.toString(),
        sourceReference: result.bill.billNumber,
        billLineId: `${result.bill._id.toString()}:${result.line._id.toString()}`,
      },
    };
  } catch (error) {
    console.error("loadBillLineForCapitalization error:", error);
    return {
      error: safeErrorMessage(error, "Failed to load bill line"),
    };
  }
}

/**
 * Verify a bill line is eligible to be capitalized:
 * - Bill belongs to tenant
 * - Bill is approved (i.e., posted with a JE) — drafts/submitted/cancelled/rejected are rejected
 * - Line exists, is asset-type, and is not already capitalized
 *
 * Why approved-only: capitalization writes journal entries that depend on the
 * source bill's accounts payable being on the books. Capitalizing from a draft
 * leaves the asset orphaned if the draft is later edited or deleted.
 */
async function loadCapitalizableLine({
  billId,
  lineId,
  companyId,
  isSuperAdmin,
  mongoSession,
}) {
  const filter = isSuperAdmin
    ? { _id: billId }
    : { _id: billId, companyId };
  const query = Bill.findOne(filter).select(
    "billNumber billDate companyId status lines._id lines.account lines.description lines.amount lines.capitalizedAssetId",
  );
  if (mongoSession) query.session(mongoSession);
  const bill = await query.lean();
  if (!bill) return { error: "Bill not found" };
  if (bill.status !== "approved") {
    return {
      error: `Bill must be approved before capitalizing. Current status: ${bill.status}.`,
    };
  }
  const line = (bill.lines || []).find(
    (l) => l._id?.toString() === lineId,
  );
  if (!line) return { error: "Bill line not found" };
  if (line.account?.type !== "asset") {
    return {
      error:
        "Only asset-type lines can be capitalized. Re-classify the line first.",
    };
  }
  if (line.capitalizedAssetId) {
    return {
      error: "This line has already been capitalized",
      alreadyCapitalizedAssetId: line.capitalizedAssetId.toString(),
    };
  }
  return { bill, line };
}

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
  depreciationConvention: z
    .enum(["full_month", "pro_rata"])
    .default("full_month"),
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
// Asset authority. CFO and Finance Manager are senior finance roles and
// should be able to do everything Accountant can do (and more); they were
// missing previously, blocking capitalization-from-bill and asset CRUD
// for those users. SuperAdmin still bypasses via hasRole().
const ASSET_ROLES = {
  CREATE: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"],
  UPDATE: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"],
  POST_DEPRECIATION: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"],
  // Disposal removes the asset and books gain/loss — finance leadership only.
  DISPOSE: ["SuperAdmin", "Admin", "CFO", "Finance Manager"],
  CANCEL_DEPRECIATION: ["SuperAdmin", "Admin", "CFO", "Finance Manager"],
  TRANSFER: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant", "Manager"],
  IMPAIR: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"],
  RECORD_USAGE: [
    "Admin",
    "CFO",
    "Finance Manager",
    "Accountant",
    "Manager",
    "Employee",
  ],
  VIEW_ALL: [
    "Admin",
    "CFO",
    "Finance Manager",
    "Accountant",
    "Manager",
  ],
};

function hasRole(user, roles) {
  return roleAllowed(user?.role, roles);
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
      depreciationConvention:
        formData.get("depreciationConvention")?.toString() || "full_month",
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

    // Optional: capitalizing from a specific bill line.
    const billLineRef = parseBillLineRef(
      formData.get("billLineId")?.toString() || "",
    );

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
      depreciationConvention: data.depreciationConvention,
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

    // Capitalize-from-bill: re-validate the line under the same transaction
    // and atomically tag it so we can't double-capitalize.
    if (billLineRef) {
      const lineCheck = await loadCapitalizableLine({
        billId: billLineRef.billId,
        lineId: billLineRef.lineId,
        companyId: tenantCompanyId,
        isSuperAdmin,
        mongoSession,
      });
      if (lineCheck.error) {
        await mongoSession.abortTransaction();
        return { success: false, error: lineCheck.error };
      }

      const update = await Bill.updateOne(
        {
          _id: billLineRef.billId,
          "lines._id": billLineRef.lineId,
          "lines.capitalizedAssetId": null,
        },
        { $set: { "lines.$.capitalizedAssetId": asset._id } },
        { session: mongoSession },
      );
      if (update.modifiedCount !== 1) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: "Failed to link bill line — it may have been capitalized concurrently",
        };
      }

      revalidatePath(`/dashboard/bills/${billLineRef.billId}`);
    }

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

/**
 * Bills tagged to a given asset (maintenance, repairs, fuel, insurance, etc.).
 * Returns matching lines with their bill metadata. Cancelled bills excluded.
 * Total reflects line amount (excluding VAT) — that's the cost net to the asset.
 */
export async function getAssetExpenses(assetId) {
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.VIEW_ALL)) {
      return { success: false, error: "Access denied", entries: [], total: 0 };
    }

    if (!mongoose.Types.ObjectId.isValid(assetId)) {
      return {
        success: false,
        error: "Invalid asset id",
        entries: [],
        total: 0,
      };
    }

    await dbConnect();

    const assetObjectId = new mongoose.Types.ObjectId(assetId);
    const billMatch = isSuperAdmin
      ? { "lines.asset.id": assetObjectId, status: { $ne: "cancelled" } }
      : {
          companyId,
          "lines.asset.id": assetObjectId,
          status: { $ne: "cancelled" },
        };
    const expenseMatch = isSuperAdmin
      ? { "asset.id": assetObjectId, status: { $nin: ["void", "rejected"] } }
      : {
          companyId,
          "asset.id": assetObjectId,
          status: { $nin: ["void", "rejected"] },
        };

    const [bills, expenses] = await Promise.all([
      Bill.find(billMatch)
        .select(
          "billNumber billDate status paymentStatus supplier.name lines._id lines.asset lines.description lines.amount lines.lineTotal lines.account",
        )
        .sort({ billDate: -1 })
        .lean(),
      Expense.find(expenseMatch)
        .select(
          "expenseNumber expenseDate status paymentStatus paymentMethod vendor.name asset description amount total accountCode accountName",
        )
        .sort({ expenseDate: -1 })
        .lean(),
    ]);

    const entries = [];
    let total = 0;

    for (const bill of bills) {
      for (const line of bill.lines || []) {
        if (line.asset?.id?.toString() !== assetId) continue;
        const amount = line.amount || 0;
        total += amount;
        entries.push({
          source: "bill",
          billId: bill._id.toString(),
          billNumber: bill.billNumber,
          billDate: bill.billDate?.toISOString?.() ?? bill.billDate ?? null,
          billStatus: bill.status,
          paymentStatus: bill.paymentStatus,
          supplierName: bill.supplier?.name || "—",
          lineDescription: line.description || "",
          accountName: line.account?.name || "",
          accountCode: line.account?.code || "",
          amount,
          lineTotal: line.lineTotal || amount,
        });
      }
    }

    for (const e of expenses) {
      const amount = e.total || e.amount || 0;
      total += amount;
      entries.push({
        source: "expense",
        expenseId: e._id.toString(),
        billId: e._id.toString(), // alias so existing UI links work
        billNumber: e.expenseNumber,
        billDate: e.expenseDate?.toISOString?.() ?? e.expenseDate ?? null,
        billStatus: e.status,
        paymentStatus: e.paymentStatus || e.paymentMethod || null,
        supplierName: e.vendor?.name || "—",
        lineDescription: e.description || "",
        accountName: e.accountName || "",
        accountCode: e.accountCode || "",
        amount,
        lineTotal: amount,
      });
    }

    entries.sort((a, b) => {
      const dateA = a.billDate ? new Date(a.billDate).getTime() : 0;
      const dateB = b.billDate ? new Date(b.billDate).getTime() : 0;
      return dateB - dateA;
    });

    return { success: true, entries, total };
  } catch (error) {
    console.error("getAssetExpenses error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to load asset expenses"),
      entries: [],
      total: 0,
    };
  }
}

// ============================================
// TRANSFER ASSET
// ============================================
// Logs a location / department / custodian change. Append-only history.
// Skips no-op transfers (nothing actually changed).
// ============================================
const TransferAssetSchema = z.object({
  assetId: z.string().min(1, "Asset id is required"),
  toLocation: z.string().max(200).optional().default(""),
  toDepartment: z.string().max(100).optional().default(""),
  toAssignedToName: z.string().max(200).optional().default(""),
  reason: z.string().min(1, "Reason is required").max(500),
  transferredAt: z.coerce.date().optional(),
});

export async function transferAsset(_prevState, formData) {
  let mongoSession = null;
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.TRANSFER)) {
      return {
        success: false,
        error: "You do not have permission to transfer assets",
      };
    }

    const parsed = TransferAssetSchema.safeParse({
      assetId: formData.get("assetId")?.toString() || "",
      toLocation: formData.get("toLocation")?.toString() || "",
      toDepartment: formData.get("toDepartment")?.toString() || "",
      toAssignedToName: formData.get("toAssignedToName")?.toString() || "",
      reason: formData.get("reason")?.toString() || "",
      transferredAt: formData.get("transferredAt")?.toString() || undefined,
    });

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      return {
        success: false,
        error: Object.values(fieldErrors).flat()[0] || "Invalid input",
        fieldErrors,
      };
    }
    const data = parsed.data;

    if (!mongoose.Types.ObjectId.isValid(data.assetId)) {
      return { success: false, error: "Invalid asset id" };
    }

    await dbConnect();
    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    const filter = isSuperAdmin
      ? { _id: data.assetId }
      : { _id: data.assetId, companyId };

    const asset = await Asset.findOne(filter).session(mongoSession);
    if (!asset) {
      await mongoSession.abortTransaction();
      return { success: false, error: "Asset not found" };
    }
    if (["disposed", "written_off"].includes(asset.status)) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: `Cannot transfer a ${asset.status.replace("_", " ")} asset`,
      };
    }

    const fromLocation = asset.location || "";
    const fromDepartment = asset.department || "";
    const fromAssignedToName = asset.assignedToName || "";

    const noChange =
      fromLocation === data.toLocation &&
      fromDepartment === data.toDepartment &&
      fromAssignedToName === data.toAssignedToName;
    if (noChange) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "No change — at least one of location, department, or custodian must differ",
      };
    }

    asset.transfers.push({
      transferredAt: data.transferredAt || new Date(),
      fromLocation,
      toLocation: data.toLocation,
      fromDepartment,
      toDepartment: data.toDepartment,
      fromAssignedToName,
      toAssignedToName: data.toAssignedToName,
      reason: data.reason,
      transferredBy: { id: user.id, name: user.name },
    });

    asset.location = data.toLocation;
    asset.department = data.toDepartment;
    asset.assignedToName = data.toAssignedToName;
    asset.lastModifiedBy = { id: user.id, name: user.name };

    await asset.save({ session: mongoSession });
    await mongoSession.commitTransaction();

    revalidatePath(`/dashboard/assets/${data.assetId}`);
    revalidatePath("/dashboard/assets");

    return { success: true, assetId: data.assetId };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    console.error("transferAsset error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to transfer asset"),
    };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// IMPAIR ASSET
// ============================================
// Records a partial write-down (IFRS impairment).
// JE: Dr Impairment Loss / Cr Accumulated Depreciation.
// Future depreciation schedule is revised over the remaining useful life.
// ============================================
const ImpairAssetSchema = z.object({
  assetId: z.string().min(1, "Asset id is required"),
  amount: z.coerce
    .number()
    .positive("Impairment amount must be greater than zero"),
  reason: z.string().min(1, "Reason is required").max(500),
  impairedAt: z.coerce.date().optional(),
  impairmentLossAccountId: z
    .string()
    .min(1, "Impairment loss account is required"),
});

export async function impairAsset(_prevState, formData) {
  let mongoSession = null;
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.IMPAIR)) {
      return {
        success: false,
        error: "You do not have permission to impair assets",
      };
    }

    const parsed = ImpairAssetSchema.safeParse({
      assetId: formData.get("assetId")?.toString() || "",
      amount: formData.get("amount")?.toString() || "0",
      reason: formData.get("reason")?.toString() || "",
      impairedAt: formData.get("impairedAt")?.toString() || undefined,
      impairmentLossAccountId:
        formData.get("impairmentLossAccountId")?.toString() || "",
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      return {
        success: false,
        error: Object.values(fieldErrors).flat()[0] || "Invalid input",
        fieldErrors,
      };
    }
    const data = parsed.data;

    if (!mongoose.Types.ObjectId.isValid(data.assetId)) {
      return { success: false, error: "Invalid asset id" };
    }

    await dbConnect();
    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    const filter = isSuperAdmin
      ? { _id: data.assetId }
      : { _id: data.assetId, companyId };
    const asset = await Asset.findOne(filter).session(mongoSession);
    if (!asset) {
      await mongoSession.abortTransaction();
      return { success: false, error: "Asset not found" };
    }
    if (asset.status !== "active" && asset.status !== "idle") {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: `Cannot impair an asset with status "${asset.status}"`,
      };
    }

    const ceiling = (asset.bookValue || 0) - (asset.salvageValue || 0);
    if (ceiling <= 0) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "Asset's book value is already at or below salvage — nothing to impair",
      };
    }
    if (data.amount > ceiling) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: `Impairment cannot exceed depreciable book value of KES ${ceiling.toLocaleString()}`,
      };
    }

    // Resolve GL accounts
    const accumDepAccountId = await resolveAccount(
      asset.companyId,
      asset.glMapping?.accumulatedDepreciationAccount?.toString() || "",
      "accumulated_depreciation",
      mongoSession,
    );
    if (!accumDepAccountId) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "Could not resolve the accumulated depreciation account",
      };
    }

    // Verify the impairment loss account belongs to the tenant and is an expense
    const Account = mongoose.model("Account");
    const lossAccount = await Account.findOne({
      _id: data.impairmentLossAccountId,
      companyId: asset.companyId,
      isActive: true,
    })
      .session(mongoSession)
      .lean();
    if (!lossAccount) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "Impairment loss account not found",
        fieldErrors: { impairmentLossAccountId: "Account not found" },
      };
    }
    if (lossAccount.accountType !== "expense") {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "Impairment loss must post to an expense account",
        fieldErrors: {
          impairmentLossAccountId: "Must be an expense account",
        },
      };
    }

    const accountMap = await fetchAccountDetails(
      [data.impairmentLossAccountId, accumDepAccountId.toString()],
      mongoSession,
    );

    const entryDate = data.impairedAt || new Date();
    const description = `Impairment — ${asset.name} (${asset.assetNumber})`;

    const seq = await ErpCounter.getNextSequence(
      "je-impair",
      asset.companyId,
      mongoSession,
    );
    const entryNumber = `JE-IMP-${String(seq).padStart(4, "0")}`;

    const debitLine = jeLine(
      accountMap,
      data.impairmentLossAccountId,
      data.amount,
      0,
      description,
    );
    const creditLine = jeLine(
      accountMap,
      accumDepAccountId.toString(),
      0,
      data.amount,
      description,
    );

    const je = new JournalEntry({
      companyId: asset.companyId,
      entryNumber,
      entryDate,
      entryType: "impairment",
      description,
      reference: asset.assetNumber,
      lines: [debitLine, creditLine],
      fiscalYear: entryDate.getUTCFullYear(),
      fiscalMonth: entryDate.getUTCMonth() + 1,
      createdBy: { name: user.name, id: user.id },
    });
    await je.post({ name: user.name, id: user.id }, mongoSession);

    // Update asset: book value, accumulated dep, schedule, history
    asset.applyImpairment(data.amount);
    asset.impairments.push({
      impairedAt: entryDate,
      amount: data.amount,
      reason: data.reason,
      journalEntryId: je._id,
      impairedBy: { id: user.id, name: user.name },
    });
    asset.journalEntryIds.push(je._id);
    asset.lastModifiedBy = { id: user.id, name: user.name };

    await asset.save({ session: mongoSession });
    await mongoSession.commitTransaction();

    revalidatePath(`/dashboard/assets/${data.assetId}`);
    revalidatePath("/dashboard/assets");
    revalidatePath("/dashboard/journal");

    return { success: true, assetId: data.assetId, journalEntryId: je._id.toString() };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    console.error("impairAsset error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to impair asset"),
    };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// ASSET ROLLFORWARD REPORT
// ============================================
// Audit-grade report: opening + additions − disposals = closing,
// for both Cost and Accumulated Depreciation, grouped by category.
// Default window is the current calendar year if no dates supplied.
// ============================================
const CATEGORY_LABELS = {
  vehicle: "Vehicles",
  equipment: "Equipment",
  computer: "Computers",
  furniture: "Furniture",
  building: "Buildings",
  land: "Land",
  machinery: "Machinery",
  other: "Other",
};

function emptyBucket() {
  return {
    openingCost: 0,
    additions: 0,
    disposalsCost: 0,
    closingCost: 0,
    openingAccDep: 0,
    chargeAccDep: 0,
    disposalsAccDep: 0,
    closingAccDep: 0,
    count: 0,
  };
}

/**
 * Sum posted depreciation for an asset where postedAt strictly before `boundary`.
 * Falls back to schedule date if postedAt is missing on legacy entries.
 */
function depPostedBefore(asset, boundary) {
  let total = 0;
  for (const e of asset.depreciationSchedule || []) {
    if (e.status !== "posted") continue;
    const posted =
      e.postedAt instanceof Date
        ? e.postedAt
        : e.postedAt
          ? new Date(e.postedAt)
          : null;
    if (!posted) continue;
    if (posted < boundary) total += e.depreciationAmount || 0;
  }
  return total;
}

export async function getAssetRollforward({ startDate, endDate } = {}) {
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.VIEW_ALL)) {
      return {
        success: false,
        error: "Access denied",
        rows: [],
        totals: emptyBucket(),
        period: null,
      };
    }

    // Default to current calendar year
    const now = new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const end = endDate
      ? new Date(endDate)
      : new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59, 999));

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return {
        success: false,
        error: "Invalid date range",
        rows: [],
        totals: emptyBucket(),
        period: null,
      };
    }
    if (start > end) {
      return {
        success: false,
        error: "Start date must be before end date",
        rows: [],
        totals: emptyBucket(),
        period: null,
      };
    }

    await dbConnect();

    const baseFilter = isSuperAdmin ? {} : { companyId };
    // Assets that touched the books at any point during the period:
    //   acquired on/before period end, AND not disposed before period start.
    const filter = {
      ...baseFilter,
      acquisitionDate: { $lte: end },
      $or: [
        { disposedAt: { $exists: false } },
        { disposedAt: null },
        { disposedAt: { $gte: start } },
      ],
    };

    const assets = await Asset.find(filter)
      .select(
        "category acquisitionDate acquisitionCost status disposedAt depreciationSchedule",
      )
      .lean();

    // Bucket by category
    const buckets = new Map();
    const ensure = (cat) => {
      if (!buckets.has(cat)) buckets.set(cat, emptyBucket());
      return buckets.get(cat);
    };

    for (const asset of assets) {
      const cat = asset.category || "other";
      const b = ensure(cat);
      b.count += 1;

      const acqDate = asset.acquisitionDate
        ? new Date(asset.acquisitionDate)
        : null;
      const disposedAt = asset.disposedAt
        ? new Date(asset.disposedAt)
        : null;

      const acquiredInPeriod = acqDate && acqDate >= start && acqDate <= end;
      const disposedInPeriod =
        disposedAt && disposedAt >= start && disposedAt <= end;

      const cost = asset.acquisitionCost || 0;

      // Cost rollforward
      if (acquiredInPeriod) {
        b.additions += cost;
      } else {
        b.openingCost += cost;
      }
      if (disposedInPeriod) {
        b.disposalsCost += cost;
      } else {
        b.closingCost += cost;
      }

      // Accumulated depreciation rollforward
      const depBeforeStart = acquiredInPeriod ? 0 : depPostedBefore(asset, start);
      // Up to end-of-period boundary (use one tick past end for "<=" semantics)
      const endBoundary = new Date(end.getTime() + 1);
      const depToEnd = depPostedBefore(asset, endBoundary);

      const charge = Math.max(0, depToEnd - depBeforeStart);

      b.openingAccDep += depBeforeStart;
      b.chargeAccDep += charge;

      if (disposedInPeriod) {
        // All depreciation accumulated up to disposal exits via the disposal row
        b.disposalsAccDep += depBeforeStart + charge;
      } else {
        b.closingAccDep += depBeforeStart + charge;
      }
    }

    // Convert map → rows array, sorted by category label
    const rows = Array.from(buckets.entries())
      .map(([category, b]) => ({
        category,
        label: CATEGORY_LABELS[category] || category,
        ...b,
        openingNBV: b.openingCost - b.openingAccDep,
        closingNBV: b.closingCost - b.closingAccDep,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const totals = rows.reduce((acc, r) => {
      acc.openingCost += r.openingCost;
      acc.additions += r.additions;
      acc.disposalsCost += r.disposalsCost;
      acc.closingCost += r.closingCost;
      acc.openingAccDep += r.openingAccDep;
      acc.chargeAccDep += r.chargeAccDep;
      acc.disposalsAccDep += r.disposalsAccDep;
      acc.closingAccDep += r.closingAccDep;
      acc.count += r.count;
      return acc;
    }, emptyBucket());
    totals.openingNBV = totals.openingCost - totals.openingAccDep;
    totals.closingNBV = totals.closingCost - totals.closingAccDep;

    return {
      success: true,
      rows,
      totals,
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    };
  } catch (error) {
    console.error("getAssetRollforward error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to load asset rollforward"),
      rows: [],
      totals: emptyBucket(),
      period: null,
    };
  }
}

// ============================================
// RUNNING-COST ANALYTICS
// ============================================
// Cost-bucket categorization rules. Expense.category gets first priority
// (already structured). Bill lines fall back to keyword matching on the
// account name/code + line description, since bills don't carry a category.
const COST_BUCKETS = ["fuel", "maintenance", "insurance", "other"];

const EXPENSE_CATEGORY_TO_BUCKET = {
  transport: "fuel",
  maintenance: "maintenance",
  insurance: "insurance",
};

const BUCKET_KEYWORDS = {
  fuel: ["fuel", "petrol", "diesel", "gasoline", "gas station"],
  maintenance: [
    "maintenance",
    "service",
    "repair",
    "parts",
    "tyre",
    "tire",
    "spare",
    "lubric",
    "oil change",
    "engine oil",
  ],
  insurance: ["insurance", "premium", "cover", "policy"],
};

function classifyEntry(entry) {
  if (entry.source === "expense" && entry.category) {
    const direct = EXPENSE_CATEGORY_TO_BUCKET[entry.category];
    if (direct) return direct;
  }
  const haystack = `${entry.accountName || ""} ${entry.accountCode || ""} ${entry.lineDescription || ""}`.toLowerCase();
  for (const bucket of ["fuel", "maintenance", "insurance"]) {
    if (BUCKET_KEYWORDS[bucket].some((kw) => haystack.includes(kw))) {
      return bucket;
    }
  }
  return "other";
}

function emptyBucketTotals() {
  return COST_BUCKETS.reduce((acc, b) => ({ ...acc, [b]: 0 }), {});
}

function periodKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function median(values) {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute trailing 12-month running cost for a list of asset IDs in a single
 * pair of queries (one to Bills, one to Expenses). Returns Map<assetIdStr, total>.
 *
 * Used both per-asset (with 1 id) and fleet-wide (with many ids) so we never
 * fan out N queries.
 */
async function rollupRunningCosts({
  assetIds,
  start,
  end,
  companyId,
  isSuperAdmin,
}) {
  const idObjs = assetIds.map((id) => new mongoose.Types.ObjectId(id));
  const tenantClause = isSuperAdmin ? {} : { companyId };

  const [billRows, expenseRows] = await Promise.all([
    Bill.aggregate([
      {
        $match: {
          ...tenantClause,
          status: { $ne: "cancelled" },
          billDate: { $gte: start, $lte: end },
          "lines.asset.id": { $in: idObjs },
        },
      },
      { $unwind: "$lines" },
      { $match: { "lines.asset.id": { $in: idObjs } } },
      {
        $group: {
          _id: "$lines.asset.id",
          total: { $sum: { $ifNull: ["$lines.amount", 0] } },
        },
      },
    ]),
    Expense.aggregate([
      {
        $match: {
          ...tenantClause,
          status: { $nin: ["void", "rejected"] },
          expenseDate: { $gte: start, $lte: end },
          "asset.id": { $in: idObjs },
        },
      },
      {
        $group: {
          _id: "$asset.id",
          total: { $sum: { $ifNull: ["$total", "$amount"] } },
        },
      },
    ]),
  ]);

  const result = new Map();
  for (const id of assetIds) result.set(id.toString(), 0);
  for (const row of billRows) {
    const k = row._id.toString();
    result.set(k, (result.get(k) || 0) + (row.total || 0));
  }
  for (const row of expenseRows) {
    const k = row._id.toString();
    result.set(k, (result.get(k) || 0) + (row.total || 0));
  }
  return result;
}

/**
 * Detailed running-cost analytics for a single asset:
 *   - Trailing 12-month total + per-month breakdown
 *   - By-bucket totals (fuel / maintenance / insurance / other)
 *   - Cost per km/hour (uses earliest+latest readings in window)
 *   - Peer comparison (same category, active/idle) — median + ratio
 *   - Health classification (healthy / watch / high)
 */
export async function getAssetRunningCosts(assetId) {
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.VIEW_ALL)) {
      return { success: false, error: "Access denied" };
    }

    if (!mongoose.Types.ObjectId.isValid(assetId)) {
      return { success: false, error: "Invalid asset id" };
    }

    await dbConnect();

    const asset = await Asset.findOne(
      withTenantScope({ _id: assetId }, companyId, isSuperAdmin),
    )
      .select(
        "_id assetNumber name category status acquisitionCost bookValue usageUnit usageReadings currentUsage",
      )
      .lean();
    if (!asset) {
      return { success: false, error: "Asset not found" };
    }

    // Reuse the existing entries source so categorization is consistent
    const entriesResult = await getAssetExpenses(assetId);
    if (!entriesResult.success) {
      return { success: false, error: entriesResult.error };
    }

    // Enrich expense entries with their category (getAssetExpenses doesn't
    // currently surface it — fetch once, map by id)
    const expenseIds = entriesResult.entries
      .filter((e) => e.source === "expense" && e.expenseId)
      .map((e) => new mongoose.Types.ObjectId(e.expenseId));
    let categoryMap = new Map();
    if (expenseIds.length > 0) {
      const cats = await Expense.find({ _id: { $in: expenseIds } })
        .select("_id category")
        .lean();
      categoryMap = new Map(cats.map((c) => [c._id.toString(), c.category]));
    }

    const now = new Date();
    const windowEnd = new Date(now);
    const windowStart = new Date(now);
    windowStart.setFullYear(windowStart.getFullYear() - 1);

    // 12 monthly buckets, oldest first — easier for sparkline rendering
    const monthlyBuckets = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthlyBuckets.push({
        period: periodKey(d),
        total: 0,
        ...emptyBucketTotals(),
      });
    }
    const periodIndex = new Map(
      monthlyBuckets.map((b, i) => [b.period, i]),
    );

    const bucketTotals = emptyBucketTotals();
    let trailing12Total = 0;
    let allTimeTotal = 0;

    for (const e of entriesResult.entries) {
      const date = e.billDate ? new Date(e.billDate) : null;
      const amt = Number(e.amount) || 0;
      if (!date) continue;

      allTimeTotal += amt;

      // Attach category for classification
      const enriched = {
        ...e,
        category: e.source === "expense" ? categoryMap.get(e.expenseId) : null,
      };
      const bucket = classifyEntry(enriched);

      if (date >= windowStart && date <= windowEnd) {
        trailing12Total += amt;
        bucketTotals[bucket] += amt;

        const idx = periodIndex.get(periodKey(date));
        if (idx !== undefined) {
          monthlyBuckets[idx].total += amt;
          monthlyBuckets[idx][bucket] += amt;
        }
      }
    }

    // Usage in window: earliest + latest reading inside window → distance
    const readings = (asset.usageReadings || [])
      .map((r) => ({
        recordedAt: r.recordedAt ? new Date(r.recordedAt) : null,
        reading: Number(r.reading) || 0,
      }))
      .filter((r) => r.recordedAt && r.recordedAt >= windowStart && r.recordedAt <= windowEnd)
      .sort((a, b) => a.recordedAt - b.recordedAt);

    let distance = null;
    let costPerUnit = null;
    if (readings.length >= 2) {
      const delta = readings[readings.length - 1].reading - readings[0].reading;
      if (delta > 0) {
        distance = delta;
        costPerUnit = trailing12Total / delta;
      }
    }

    // Peer comparison: same category, active/idle, has at least one expense
    const peerAssets = await Asset.find(
      withTenantScope(
        {
          category: asset.category,
          status: { $in: ["active", "idle"] },
          _id: { $ne: asset._id },
        },
        companyId,
        isSuperAdmin,
      ),
    )
      .select("_id bookValue")
      .lean();

    const peerIds = peerAssets.map((a) => a._id.toString());
    let peerStats = null;
    if (peerIds.length >= 1) {
      const peerTotals = await rollupRunningCosts({
        assetIds: peerIds,
        start: windowStart,
        end: windowEnd,
        companyId,
        isSuperAdmin,
      });
      const totals = Array.from(peerTotals.values()).filter((v) => v > 0);
      const med = median(totals);
      peerStats = {
        peerCount: peerIds.length,
        peersWithSpend: totals.length,
        median: med,
        ratio: med && med > 0 ? trailing12Total / med : null,
      };
    }

    // Health classification
    const bookValue = Number(asset.bookValue) || 0;
    const maintenancePctOfBook =
      bookValue > 0 ? (bucketTotals.maintenance / bookValue) * 100 : null;
    const totalPctOfBook =
      bookValue > 0 ? (trailing12Total / bookValue) * 100 : null;

    let health = "healthy";
    let healthReasons = [];
    const ratio = peerStats?.ratio;
    if (ratio !== null && ratio !== undefined) {
      if (ratio > 1.5) {
        health = "high";
        healthReasons.push(
          `Spend is ${ratio.toFixed(1)}× the median for ${asset.category}s`,
        );
      } else if (ratio > 1.0) {
        if (health !== "high") health = "watch";
        healthReasons.push(
          `Spend is ${ratio.toFixed(1)}× the peer median`,
        );
      }
    }
    if (maintenancePctOfBook !== null) {
      if (maintenancePctOfBook > 50) {
        health = "high";
        healthReasons.push(
          `Maintenance is ${maintenancePctOfBook.toFixed(0)}% of book value`,
        );
      } else if (maintenancePctOfBook > 30 && health === "healthy") {
        health = "watch";
        healthReasons.push(
          `Maintenance is ${maintenancePctOfBook.toFixed(0)}% of book value`,
        );
      }
    }
    if (totalPctOfBook !== null && totalPctOfBook > 100) {
      health = "high";
      healthReasons.push(
        `12-month running cost exceeds book value (${totalPctOfBook.toFixed(0)}%)`,
      );
    }
    if (healthReasons.length === 0) {
      healthReasons.push("Running costs within healthy range");
    }

    // Recent readings — last 6, newest first
    const allReadings = (asset.usageReadings || [])
      .map((r) => ({
        _id: r._id?.toString?.() ?? null,
        recordedAt: r.recordedAt?.toISOString?.() ?? r.recordedAt ?? null,
        reading: Number(r.reading) || 0,
        unit: r.unit || asset.usageUnit || "km",
        source: r.source || "manual",
        notes: r.notes || "",
        recordedBy: r.recordedBy?.name || "",
      }))
      .sort((a, b) =>
        a.recordedAt && b.recordedAt
          ? new Date(b.recordedAt) - new Date(a.recordedAt)
          : 0,
      );

    return {
      success: true,
      window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
      },
      asset: {
        _id: asset._id.toString(),
        assetNumber: asset.assetNumber,
        name: asset.name,
        category: asset.category,
        status: asset.status,
        bookValue,
        acquisitionCost: Number(asset.acquisitionCost) || 0,
        usageUnit: asset.usageUnit || "km",
        currentUsage: Number(asset.currentUsage) || 0,
      },
      trailing12: {
        total: trailing12Total,
        byBucket: bucketTotals,
        byMonth: monthlyBuckets,
      },
      allTimeTotal,
      usage: {
        unit: asset.usageUnit || "km",
        distance,
        costPerUnit,
        readingsInWindow: readings.length,
      },
      peers: peerStats,
      ratios: {
        maintenancePctOfBook,
        totalPctOfBook,
      },
      health: {
        level: health,
        reasons: healthReasons,
      },
      readings: allReadings.slice(0, 8),
      readingsTotal: allReadings.length,
    };
  } catch (error) {
    console.error("getAssetRunningCosts error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to compute running costs"),
    };
  }
}

// ============================================
// RECORD USAGE READING (odometer / hours-meter)
// ============================================
const UsageReadingSchema = z.object({
  reading: z.coerce.number().min(0, "Reading must be ≥ 0"),
  unit: z.enum(["km", "miles", "hours"]).optional(),
  recordedAt: z.string().optional(),
  source: z.enum(["manual", "fuel", "service", "transfer", "other"]).optional(),
  notes: z.string().max(500).optional().default(""),
});

export async function recordUsageReading(assetId, _prevState, formData) {
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, ASSET_ROLES.RECORD_USAGE)) {
      return { success: false, error: "You don't have permission to log readings" };
    }

    if (!mongoose.Types.ObjectId.isValid(assetId)) {
      return { success: false, error: "Invalid asset id" };
    }

    const raw = Object.fromEntries(formData.entries());
    const parsed = UsageReadingSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: "Invalid input",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }
    const data = parsed.data;

    await dbConnect();

    const asset = await Asset.findOne(
      withTenantScope({ _id: assetId }, companyId, isSuperAdmin),
    );
    if (!asset) {
      return { success: false, error: "Asset not found" };
    }
    if (["disposed", "written_off"].includes(asset.status)) {
      return {
        success: false,
        error: "Cannot log readings for disposed or written-off assets",
      };
    }

    const unit = data.unit || asset.usageUnit || "km";
    const recordedAt = data.recordedAt ? new Date(data.recordedAt) : new Date();
    if (Number.isNaN(recordedAt.getTime())) {
      return { success: false, error: "Invalid date" };
    }

    // Sanity guard: warn (don't block) if new reading is less than the
    // previous one — could be a meter rollover or a typo. Block if it's
    // wildly negative (>50% less). The dialog can warn separately.
    const lastReading = (asset.usageReadings || [])
      .filter((r) => r.recordedAt)
      .sort(
        (a, b) =>
          new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
      )[0];
    if (lastReading && data.reading < lastReading.reading * 0.5) {
      return {
        success: false,
        error: `Reading ${data.reading} is far below the last logged value (${lastReading.reading} ${lastReading.unit}). Check the value and try again.`,
      };
    }

    const userInfo = { name: user.name, id: user.id };
    asset.usageReadings.push({
      recordedAt,
      reading: data.reading,
      unit,
      source: data.source || "manual",
      notes: data.notes || "",
      recordedBy: userInfo,
    });

    // Cache: currentUsage = the reading with the latest recordedAt
    const newest = [...asset.usageReadings]
      .filter((r) => r.recordedAt)
      .sort(
        (a, b) =>
          new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
      )[0];
    if (newest) {
      asset.currentUsage = newest.reading;
      asset.lastReadingAt = newest.recordedAt;
      asset.usageUnit = newest.unit;
    }
    asset.lastModifiedBy = userInfo;

    await asset.save();

    revalidatePath(`/dashboard/assets/${assetId}`);
    revalidatePath("/dashboard/assets/insights");

    return {
      success: true,
      reading: {
        reading: data.reading,
        unit,
        recordedAt: recordedAt.toISOString(),
      },
    };
  } catch (error) {
    console.error("recordUsageReading error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to log reading"),
    };
  }
}
