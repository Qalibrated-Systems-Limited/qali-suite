import { z } from "zod";

/**
 * What procurement payloads must look like, and how they become repository
 * input.
 *
 * Its own module because the action files are `"use server"` and Next only
 * lets async functions out of one — the same reason validation/quotes.ts and
 * validation/invoices.ts exist.
 *
 * THE SHAPES ARE THE FORMS'. They are deliberately faithful to what
 * CreatePOForm and GRNForm post today, so the screens can move over without
 * being rewritten first. Money arrives as numbers and leaves as strings:
 * numeric(19,4) is exact and JavaScript's float is not, so the boundary is
 * here and it is one-way.
 */

const money = (n: number) => n.toFixed(4);

// ── Purchase orders ──────────────────────────────────────────────────────────

/** An empty string is what an untouched hidden input or <select> posts. */
const blankToNull = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v ? String(v) : null));
const optionalUuidField = blankToNull.refine(
  (v) => v === null || /^[0-9a-f-]{36}$/i.test(v),
  "Not a valid reference",
);

/** POForm's line, verbatim: `lines[0].description`, `lines[0].unitPrice`. */
const poLineSchema = z.object({
  productId: optionalUuidField,
  accountId: optionalUuidField,
  description: z.string().min(1, "Description is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unit: z.string().default("pcs"),
  unitPrice: z.coerce.number().min(0, "A unit price cannot be negative"),
  vatRate: z.coerce.number().min(0).max(100).default(16),
});

/**
 * The order header, in POForm's field names.
 *
 * The supplier arrives as an id ALONE — the form posts a hidden `supplierId`
 * and nothing else about them — so the snapshot is resolved from the party row
 * in the action. That is the right source regardless: what the document says
 * about the supplier should come from the supplier record under RLS, not from
 * what the browser sent.
 */
export const purchaseOrderSchema = z.object({
  supplierId: z.string().uuid("Choose a supplier"),
  poDate: z.string().min(1, "The order date is required"),
  expectedDeliveryDate: blankToNull,
  validUntil: blankToNull,
  reference: z.string().optional().nullable(),
  currency: z.string().default("KES"),
  whtApplicable: z.coerce.boolean().default(false),
  whtRate: z.coerce.number().min(0).max(30).default(0),
  /**
   * How much over the ordered quantity this order will accept. 0 — the
   * default, and what the form posts today — means exactly what was ordered.
   * The buyer grants slack here, in advance, or the dock cannot book an
   * over-delivery at all.
   */
  receiptTolerancePercentage: z.coerce.number().min(0).max(100).default(0),
  deliveryAddress: z.string().optional().nullable(),
  deliveryInstructions: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  /** The form calls it `terms`. */
  terms: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  lines: z.array(poLineSchema).min(1, "Add at least one line"),
});

export type PurchaseOrderPayload = z.infer<typeof purchaseOrderSchema>;

export function toPurchaseOrderInput(data: PurchaseOrderPayload) {
  return {
    supplierId: data.supplierId,
    poDate: data.poDate,
    expectedDeliveryDate: data.expectedDeliveryDate,
    validUntil: data.validUntil,
    currency: data.currency,
    whtApplicable: data.whtApplicable,
    whtRate: money(data.whtRate),
    receiptTolerancePercentage: money(data.receiptTolerancePercentage),
    deliveryAddress: data.deliveryAddress ?? null,
    deliveryInstructions: data.deliveryInstructions ?? null,
    notes: data.notes ?? null,
    termsAndConditions: data.terms ?? null,
    internalNotes: data.internalNotes ?? null,
    lines: data.lines.map((l) => ({
      productId: l.productId,
      description: l.description,
      accountId: l.accountId,
      quantity: money(l.quantity),
      unit: l.unit,
      unitPrice: money(l.unitPrice),
      vatRate: money(l.vatRate),
    })),
  };
}

/** ConvertToBillDialog's fields: `lines[0][lineId]`, `lines[0][quantity]`. */
export const convertToBillSchema = z.object({
  supplierInvoiceNumber: z.string().optional().nullable(),
  billDate: z.string().min(1, "The bill date is required"),
  dueDate: z.string().min(1, "The due date is required"),
  description: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  defaultAccountId: optionalUuidField,
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        quantity: z.coerce.number(),
      }),
    )
    .min(1, "Choose at least one line to bill"),
});

export type ConvertToBillPayload = z.infer<typeof convertToBillSchema>;

// ── Goods receipts ───────────────────────────────────────────────────────────

/**
 * GRNForm's line, verbatim — `receivedQty`, not `receivedQuantity`.
 *
 * The names here are the COMPONENT's. An empty string is what an untouched
 * <select> posts, so the optional ids coerce it to null rather than failing a
 * uuid check on a field the operator never filled.
 */
const grnLineSchema = z.object({
  /**
   * The order line this receives against. Without it a PO-sourced receipt
   * links to nothing: the tolerance trigger cannot fire, and
   * `purchase_order_line_received` reports the order as never delivered. The
   * Mongo form never carried it, because that model matched lines by product.
   */
  purchaseOrderLineId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  productId: z.string().uuid("Every receipt line names a product"),
  description: z.string().min(1, "Description is required"),
  sku: z.string().optional().nullable(),
  productName: z.string().optional().nullable(),
  unit: z.string().default("pcs"),
  expectedQty: z.coerce.number().min(0).default(0),
  receivedQty: z.coerce.number().min(0, "Quantity cannot be negative"),
  /**
   * What these goods cost. Carried on the line so acceptance posts a figure
   * decided while somebody could still see the delivery note, rather than
   * hunting the bill for a line with a matching product id.
   */
  unitCost: z.coerce.number().min(0).default(0),
  packagingCondition: z
    .enum(["good", "damaged", "moisture", "tampered"])
    .default("good"),
  physicalCondition: z
    .enum(["good", "broken", "deformed", "defective"])
    .default("good"),
  inspectionNotes: z.string().optional().nullable(),
  photoUrls: z.array(z.string()).default([]),
  storageLocation: z.string().optional().nullable(),
});

const optionalUuid = z
  .union([z.string().uuid(), z.literal("")])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const goodsReceiptSchema = z
  .object({
    sourceType: z.enum(["purchase_order", "bill", "unscheduled"]),
    purchaseOrderId: optionalUuid,
    billId: optionalUuid,
    proformaInvoiceNumber: z.string().optional().nullable(),
    packingListNumber: z.string().optional().nullable(),
    /** The form calls it supplierPartyId. */
    supplierPartyId: optionalUuid,
    supplierName: z.string().optional().nullable(),
    receivedDate: z.string().min(1, "The date received is required"),
    notes: z.string().optional().nullable(),
    lines: z.array(grnLineSchema).min(1, "Add at least one line"),
  })
  // The database says this too. Saying it here as well means the user gets a
  // sentence about the form they are looking at rather than a constraint name.
  .refine(
    (d) => d.sourceType !== "purchase_order" || !!d.purchaseOrderId,
    { message: "Choose the purchase order this receives against", path: ["purchaseOrderId"] },
  )
  .refine((d) => d.sourceType !== "bill" || !!d.billId, {
    message: "Choose the bill this receives against",
    path: ["billId"],
  });

export type GoodsReceiptPayload = z.infer<typeof goodsReceiptSchema>;

export function toGoodsReceiptInput(data: GoodsReceiptPayload) {
  return {
    sourceType: data.sourceType,
    purchaseOrderId: data.purchaseOrderId || null,
    billId: data.billId || null,
    proformaInvoiceNumber: data.proformaInvoiceNumber ?? null,
    packingListNumber: data.packingListNumber ?? null,
    supplierId: data.supplierPartyId || null,
    supplierName: data.supplierName ?? null,
    receivedDate: data.receivedDate,
    notes: data.notes ?? null,
    lines: data.lines.map((l) => ({
      purchaseOrderLineId: l.purchaseOrderLineId || null,
      productId: l.productId,
      // The form fills `description` and `sku` from the product on select, so
      // the snapshot the receipt freezes is what the storekeeper was looking
      // at. Falling back to the description keeps NOT NULL satisfiable when a
      // line was typed rather than picked.
      productName: l.productName || l.description,
      productSku: l.sku ?? null,
      description: l.description,
      unit: l.unit,
      expectedQuantity: money(l.expectedQty),
      receivedQuantity: money(l.receivedQty),
      unitCost: money(l.unitCost),
      packagingCondition: l.packagingCondition,
      physicalCondition: l.physicalCondition,
      inspectionNotes: l.inspectionNotes ?? null,
      photoUrls: l.photoUrls,
      storageLocation: l.storageLocation ?? null,
    })),
  };
}

export const lineDecisionsSchema = z
  .array(
    z.object({
      goodsReceiptLineId: z.string().uuid(),
      acceptedQuantity: z.coerce.number().min(0),
      lineStatus: z.enum(["accepted", "rejected", "hold"]).optional(),
      rejectReason: z.string().optional().nullable(),
    }),
  )
  .min(1, "Decide at least one line");

export type LineDecisionsPayload = z.infer<typeof lineDecisionsSchema>;

export function toLineDecisions(data: LineDecisionsPayload) {
  return data.map((d) => ({
    goodsReceiptLineId: d.goodsReceiptLineId,
    acceptedQuantity: money(d.acceptedQuantity),
    lineStatus: d.lineStatus,
    rejectReason: d.rejectReason ?? null,
  }));
}

// ── Nonconformance ───────────────────────────────────────────────────────────

export const nonconformanceSchema = z.object({
  category: z.enum([
    "received_qty_variance",
    "received_damaged",
    "stock_deterioration",
    "tool_damage",
    "stock_count_variance",
    "other",
  ]),
  sourceType: z.enum([
    "goods_receipt",
    "stock_count",
    "tool_return",
    "stock_deterioration",
    "manual",
  ]),
  goodsReceiptId: z.string().uuid().optional().nullable(),
  sourceReference: z.string().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  supplierName: z.string().optional().nullable(),
  title: z.string().min(1, "A title is required"),
  description: z.string().min(1, "Describe what is wrong"),
  photoUrls: z.array(z.string()).default([]),
  estimatedImpact: z.coerce.number().min(0).optional().nullable(),
  requiresCar: z.coerce.boolean().default(false),
  lines: z
    .array(
      z.object({
        goodsReceiptLineId: z.string().uuid().optional().nullable(),
        productId: z.string().uuid().optional().nullable(),
        productName: z.string().optional().nullable(),
        productSku: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        unit: z.string().optional().nullable(),
        expectedQuantity: z.coerce.number().min(0).default(0),
        actualQuantity: z.coerce.number().min(0).default(0),
        severity: z.enum(["minor", "major", "critical"]).default("minor"),
        notes: z.string().optional().nullable(),
      }),
    )
    .default([]),
});

export type NonconformancePayload = z.infer<typeof nonconformanceSchema>;

export function toNonconformanceInput(data: NonconformancePayload) {
  return {
    category: data.category,
    sourceType: data.sourceType,
    goodsReceiptId: data.goodsReceiptId || null,
    sourceReference: data.sourceReference ?? null,
    supplierId: data.supplierId || null,
    supplierName: data.supplierName ?? null,
    title: data.title,
    description: data.description,
    photoUrls: data.photoUrls,
    estimatedImpact:
      data.estimatedImpact === null || data.estimatedImpact === undefined
        ? null
        : money(data.estimatedImpact),
    requiresCar: data.requiresCar,
    lines: data.lines.map((l) => ({
      goodsReceiptLineId: l.goodsReceiptLineId || null,
      productId: l.productId || null,
      productName: l.productName ?? null,
      productSku: l.productSku ?? null,
      description: l.description ?? null,
      unit: l.unit ?? null,
      expectedQuantity: money(l.expectedQuantity),
      actualQuantity: money(l.actualQuantity),
      severity: l.severity,
      notes: l.notes ?? null,
    })),
  };
}
