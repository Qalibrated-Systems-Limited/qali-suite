import { z } from "zod";

/**
 * What claim payloads must look like, and how they become repository input.
 *
 * Its own module because the action files are `"use server"` and Next only
 * lets async functions out of one — the same reason validation/procurement.ts
 * and validation/quotes.ts exist. It also means the `/api/v1` path can share
 * one definition of "a valid claim" rather than growing a second.
 *
 * THE SHAPES ARE THE FORMS'. `AdvanceRequestForm` and `ReimbursementForm` post
 * these exact names — `requestedAmount`, `travelFromDate`, and `items` as a
 * JSON string — so the screens move over without being rewritten first.
 * Money arrives as a number and leaves as a string: numeric(19,4) is exact and
 * JavaScript's float is not, so the boundary is here and it is one-way.
 */

const money = (n: number) => n.toFixed(4);

/** An empty string is what an untouched hidden input or <select> posts. */
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

/**
 * One receipt.
 *
 * `expenseAccountId` is REQUIRED, where the Mongo item schema also says
 * `min(1)` but the action then writes `item.expenseAccountId || null` and the
 * database accepts it. That gap is what makes posting throw later: the two
 * journal builders group by `expenseAccountId || category` and look the group
 * up in a map keyed only by account id. Here it is required in the schema, in
 * the repository input, and in the column.
 */
export const claimItemSchema = z.object({
  date: z.string().min(1, "A date is required"),
  category: z.string().min(1, "Category is required"),
  expenseAccountId: z
    .string()
    .min(1, "Choose an expense account for this line")
    .refine((v) => /^[0-9a-f-]{36}$/i.test(v), "Not a valid expense account"),
  description: z.string().min(3, "Say what this was for"),
  amount: z.coerce.number().positive("An amount must be greater than zero"),
  notes: optionalText,
  receiptFilename: optionalText,
  receiptUrl: optionalText,
});

/** The forms post `items` as a JSON string in a hidden input. */
const itemsField = z.preprocess((value) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}, z.array(claimItemSchema).min(1, "Add at least one expense line").max(50, "A claim can carry at most 50 lines"));

/** `receipts` is posted the same way, by the uploader component. */
const attachmentsField = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === "") return [];
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return value;
  },
  z
    .array(
      z.object({
        filename: z.string(),
        url: z.string(),
        publicId: optionalText,
        resourceType: optionalText,
        size: z.coerce.number().optional(),
        mimeType: optionalText,
      }),
    )
    .default([]),
);

export const advanceRequestSchema = z
  .object({
    advanceType: z.enum(["travel", "petty_cash", "operational"], {
      message: "Please select an advance type",
    }),
    requestedAmount: z.coerce
      .number()
      .positive("Requested amount must be greater than zero"),
    purpose: z
      .string()
      .min(5, "Purpose is required")
      .max(200, "Purpose is too long"),
    destination: optionalText.pipe(
      z.string().max(100, "Destination is too long").optional(),
    ),
    travelFromDate: optionalText,
    travelToDate: optionalText,
    projectId: optionalUuid,
    estimatedExpenses: optionalText.pipe(
      z.string().max(200, "Estimated expenses too long").optional(),
    ),
    notes: optionalText.pipe(
      z.string().max(500, "Notes too long").optional(),
    ),
    onBehalfUserId: optionalText,
    receipts: attachmentsField,
  })
  .superRefine((data, ctx) => {
    // Travel needs somewhere to go and dates to be away. Transcribed from the
    // Mongo validator, including the message text.
    if (data.advanceType !== "travel") return;

    if (!data.destination?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Destination is required for travel advances",
        path: ["destination"],
      });
    }
    if (!data.travelFromDate) {
      ctx.addIssue({
        code: "custom",
        message: "Travel start date is required",
        path: ["travelFromDate"],
      });
    }
    if (!data.travelToDate) {
      ctx.addIssue({
        code: "custom",
        message: "Travel end date is required",
        path: ["travelToDate"],
      });
    }
    if (
      data.travelFromDate &&
      data.travelToDate &&
      new Date(data.travelToDate) < new Date(data.travelFromDate)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Travel end date cannot be before start date",
        path: ["travelToDate"],
      });
    }
  });

export const reimbursementSchema = z.object({
  description: z
    .string()
    .min(10, "Description must be at least 10 characters long")
    .max(200, "Description must be at most 200 characters long"),
  notes: optionalText.pipe(
    z.string().max(500, "Notes must be at most 500 characters long").optional(),
  ),
  projectId: optionalUuid,
  items: itemsField,
  receipts: attachmentsField,
});

export const settleAdvanceSchema = z.object({
  items: itemsField,
  notes: optionalText.pipe(
    z.string().max(500, "Notes too long").optional(),
  ),
  receipts: attachmentsField,
});

/** Every money-moving claim action posts this. */
export const claimPaymentSchema = z.object({
  paymentAccountId: z
    .string()
    .min(1, "Please select a payment account")
    .refine((v) => /^[0-9a-f-]{36}$/i.test(v), "Not a valid account"),
  paymentMethod: z.enum(["cash", "bank", "mpesa"]).optional(),
  paymentReference: optionalText.pipe(
    z.string().max(100, "Reference too long").optional(),
  ),
  paymentNotes: optionalText.pipe(
    z.string().max(500, "Notes too long").optional(),
  ),
});

/** Recording cash back, or paying the employee what they are owed. */
export const settlementCashSchema = claimPaymentSchema.extend({
  amount: z.coerce.number().positive("An amount must be greater than zero"),
  reference: optionalText.pipe(
    z.string().max(100, "Reference too long").optional(),
  ),
});

export const rejectClaimSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(
      10,
      "Please provide a detailed reason for rejection (minimum 10 characters)",
    )
    .max(500, "Reason too long"),
});

// ── Form data → repository input ─────────────────────────────────────────────

export type ClaimItemInputData = z.infer<typeof claimItemSchema>;

export function toClaimItems(items: ClaimItemInputData[]) {
  return items.map((item) => ({
    itemDate: item.date.slice(0, 10),
    category: item.category,
    expenseAccountId: item.expenseAccountId,
    description: item.description,
    amount: money(item.amount),
    receiptFilename: item.receiptFilename ?? null,
    receiptUrl: item.receiptUrl ?? null,
    notes: item.notes ?? null,
  }));
}

export function toClaimAttachments(
  receipts: z.infer<typeof attachmentsField>,
  by: { id?: string | null; name?: string | null },
) {
  return receipts.map((r) => ({
    filename: r.filename,
    url: r.url,
    publicId: r.publicId ?? null,
    resourceType: r.resourceType ?? null,
    size: r.size ?? null,
    mimeType: r.mimeType ?? null,
    uploadedById: by.id ?? null,
    uploadedByName: by.name ?? null,
  }));
}

export { money as toMoney };
