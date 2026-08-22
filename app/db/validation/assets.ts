import { z } from "zod";

/**
 * What asset payloads must look like, and how they become repository input.
 *
 * Its own module because the action file is `"use server"` and Next only lets
 * async functions out of one — the same reason validation/claims.ts and
 * validation/procurement.ts exist.
 *
 * THE SHAPES ARE THE FORMS'. `AssetForm`, `DisposeAssetDialog`,
 * `ImpairAssetDialog`, `TransferAssetDialog` and `LogUsageDialog` post these
 * exact names. Money arrives as a number and leaves as a string: NUMERIC(19,4)
 * is exact and JavaScript's float is not, so the boundary is here.
 */

const money = (n: number) => n.toFixed(4);

const blankToNull = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v ? String(v) : null));

const optionalUuid = blankToNull.refine(
  (v) => v === null || /^[0-9a-f-]{36}$/i.test(v),
  "Not a valid reference",
);

const optionalText = z.preprocess(
  (v) => (v === null || v === "" ? undefined : v),
  z.string().optional(),
);

export const ASSET_CATEGORIES = [
  "land", "building", "leasehold_improvement", "vehicle", "machinery",
  "office_equipment", "computer", "furniture", "equipment", "other",
] as const;

export const assetSchema = z
  .object({
    name: z.string().min(2, "Give the asset a name"),
    category: z.enum(ASSET_CATEGORIES, { message: "Choose a category" }),
    description: optionalText,
    serialNumber: optionalText,
    model: optionalText,
    manufacturer: optionalText,
    registrationNumber: optionalText,
    location: optionalText,
    department: optionalText,
    notes: optionalText,

    acquisitionDate: z.string().min(1, "When was it acquired?"),
    acquisitionCost: z.coerce
      .number()
      .min(0, "An acquisition cost cannot be negative"),
    currency: z.string().default("KES"),

    depreciationMethod: z
      .enum(["straight_line", "reducing_balance", "none"])
      .default("straight_line"),
    usefulLifeMonths: z.coerce
      .number()
      .int()
      .min(0)
      .max(1200, "A useful life of more than 100 years is not a useful life")
      .default(60),
    salvageValue: z.coerce.number().min(0).default(0),
    /** Stored as a fraction; the form posts a percentage. */
    depreciationRate: z.coerce.number().min(0).max(100).default(0),
    depreciationStartDate: z.string().min(1, "When does depreciation start?"),
    depreciationConvention: z
      .enum(["full_month", "pro_rata"])
      .default("full_month"),
    kraClass: z
      .enum(["class_I", "class_II", "class_III", "class_IV", "none"])
      .default("none"),

    assetAccountId: optionalUuid,
    accumulatedDepreciationAccountId: optionalUuid,
    depreciationExpenseAccountId: optionalUuid,

    sourceType: z.enum(["bill", "journal", "manual"]).default("manual"),
    sourceId: optionalUuid,
    sourceReference: optionalText,
    /** The bill line this was capitalised from, tagged so it cannot be twice. */
    billLineId: optionalUuid,
    usageUnit: z.enum(["km", "miles", "hours"]).default("km"),
    photoUrl: optionalText,
  })
  .superRefine((d, ctx) => {
    if (d.salvageValue > d.acquisitionCost) {
      ctx.addIssue({
        code: "custom",
        message: "The salvage value cannot exceed what the asset cost",
        path: ["salvageValue"],
      });
    }
    if (d.depreciationMethod === "reducing_balance" && d.depreciationRate <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Reducing balance needs a rate above zero",
        path: ["depreciationRate"],
      });
    }
    if (d.depreciationMethod !== "none" && d.usefulLifeMonths <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "A depreciating asset needs a useful life",
        path: ["usefulLifeMonths"],
      });
    }
    if (
      d.depreciationStartDate &&
      d.acquisitionDate &&
      d.depreciationStartDate < d.acquisitionDate
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Depreciation cannot start before the asset was acquired",
        path: ["depreciationStartDate"],
      });
    }
  });

export const disposeAssetSchema = z
  .object({
    assetId: z.string().min(1),
    disposalDate: optionalText,
    disposalMethod: z.enum(["sold", "scrapped", "donated", "lost", "stolen"]),
    disposalAmount: z.coerce.number().min(0).default(0),
    bankAccountId: optionalUuid,
    gainAccountId: optionalUuid,
    lossAccountId: optionalUuid,
    disposalNotes: optionalText,
  })
  .superRefine((d, ctx) => {
    if (d.disposalMethod === "sold" && d.disposalAmount > 0 && !d.bankAccountId) {
      ctx.addIssue({
        code: "custom",
        message: "Say which account received the proceeds",
        path: ["bankAccountId"],
      });
    }
  });

export const impairAssetSchema = z.object({
  assetId: z.string().min(1),
  impairedAt: optionalText,
  amount: z.coerce.number().positive("An impairment must be more than nothing"),
  impairmentLossAccountId: z
    .string()
    .min(1, "Choose the account the write-down charges to"),
  reason: z
    .string()
    .trim()
    .min(10, "Say why the asset is being written down (at least 10 characters)"),
});

export const transferAssetSchema = z.object({
  assetId: z.string().min(1),
  transferredAt: optionalText,
  toLocation: optionalText,
  toDepartment: optionalText,
  toAssignedToName: optionalText,
  toAssignedToPartyId: optionalUuid,
  reason: optionalText,
});

export const usageReadingSchema = z.object({
  reading: z.coerce.number().min(0, "A reading cannot be negative"),
  unit: z.enum(["km", "miles", "hours"]).optional(),
  recordedAt: optionalText,
  source: z.enum(["manual", "fuel", "service", "transfer", "other"]).default("manual"),
  notes: optionalText,
});

/** "2026-03". */
export const periodSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "A period looks like 2026-03"),
});

export const cancelDepreciationSchema = periodSchema.extend({
  assetId: z.string().min(1),
  reason: optionalText,
});

export function toAssetInput(d: z.infer<typeof assetSchema>) {
  return {
    name: d.name,
    category: d.category,
    description: d.description ?? null,
    serialNumber: d.serialNumber ?? null,
    model: d.model ?? null,
    manufacturer: d.manufacturer ?? null,
    registrationNumber: d.registrationNumber ?? null,
    location: d.location ?? null,
    department: d.department ?? null,
    notes: d.notes ?? null,
    acquisitionDate: d.acquisitionDate.slice(0, 10),
    acquisitionCost: money(d.acquisitionCost),
    currency: d.currency,
    depreciationMethod: d.depreciationMethod,
    usefulLifeMonths: d.usefulLifeMonths,
    salvageValue: money(d.salvageValue),
    // The form asks for a percentage; the column holds a fraction, because
    // that is what the arithmetic multiplies by.
    depreciationRate: (d.depreciationRate / 100).toFixed(6),
    depreciationStartDate: d.depreciationStartDate.slice(0, 10),
    depreciationConvention: d.depreciationConvention,
    kraClass: d.kraClass,
    assetAccountId: d.assetAccountId,
    accumulatedDepreciationAccountId: d.accumulatedDepreciationAccountId,
    depreciationExpenseAccountId: d.depreciationExpenseAccountId,
    sourceType: d.sourceType,
    sourceId: d.sourceId,
    sourceReference: d.sourceReference ?? null,
    usageUnit: d.usageUnit,
    photoUrl: d.photoUrl ?? null,
  };
}

export { money as toMoney };
