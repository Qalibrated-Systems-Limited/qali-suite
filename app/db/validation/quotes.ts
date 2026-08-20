import { z } from "zod";

/**
 * What a quote payload must look like, and how it becomes repository input.
 *
 * Its own module because the action file is `"use server"` and Next only lets
 * async functions out of one — the same reason app/db/validation/invoices.ts
 * exists. The dashboard form and any future /api/v1 endpoint validate against
 * this one definition rather than two that drift.
 *
 * The SHAPE IS THE FORM'S. CreateQuoteForm posts a single `data` blob with a
 * flat `items` array carrying itemType, which is what this parses. Changing it
 * here changes the contract with a component, so it is deliberately faithful.
 */

const itemSchema = z
  .object({
    itemType: z.enum(["product", "service"]).default("product"),
    productId: z.string().optional().nullable(),
    serviceCategory: z
      .enum([
        "labor",
        "mileage",
        "accommodation",
        "installation",
        "consultation",
        "maintenance",
        "repair",
        "other",
      ])
      .optional(),
    // The form sends the display name as `description` and any longer text as
    // `notes`; the repository keeps one description per line.
    description: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    unit: z.string().optional().nullable(),
    quantity: z.coerce.number().positive("Quantity must be greater than zero"),
    unitPrice: z.coerce.number().min(0, "Price cannot be negative"),
    discountPercentage: z.coerce.number().min(0).max(100).default(0),
    taxRate: z.coerce.number().min(0).max(100).default(0),
  })
  .refine((i) => i.itemType !== "product" || !!i.productId, {
    message: "A product line must name a product",
    path: ["productId"],
  });

export const quoteDataSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  quoteDate: z.string().min(1, "Quote date is required"),
  validUntil: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  salespersonPartyId: z.string().optional().nullable(),
  salespersonName: z.string().optional().nullable(),
  salespersonEmployeeNumber: z.string().optional().nullable(),
  commissionRate: z.coerce.number().min(0).max(100).default(0),
  items: z.array(itemSchema).min(1, "Add at least one item or service"),
});

/** Dates arrive as ISO strings or datetime-local values; the column is a date. */
export const toDateOnly = (v?: string | null) =>
  v ? String(v).slice(0, 10) : undefined;

/** Money and rates cross this boundary as strings and stay strings. */
const dec = (n: number) => n.toFixed(4);

export function toRepositoryInput(d: z.infer<typeof quoteDataSchema>) {
  return {
    customerId: d.customerId,
    quoteDate: toDateOnly(d.quoteDate)!,
    validUntil: toDateOnly(d.validUntil) ?? null,
    title: d.title ?? null,
    notes: d.notes ?? null,
    internalNotes: d.internalNotes ?? null,
    terms: d.termsAndConditions ?? null,
    reference: d.reference ?? null,
    salespersonPartyId: d.salespersonPartyId || null,
    salespersonName: d.salespersonName ?? null,
    salespersonEmployeeNumber: d.salespersonEmployeeNumber ?? null,
    commissionRate: dec(d.commissionRate),
    lines: d.items.map((i) => ({
      itemType: i.itemType,
      serviceCategory: i.itemType === "service" ? (i.serviceCategory ?? "other") : null,
      productId: i.itemType === "product" ? (i.productId ?? null) : null,
      // notes is the longer text where the form sends both.
      description: i.notes || i.description || null,
      unit: i.unit ?? "pcs",
      quantity: dec(i.quantity),
      unitPrice: dec(i.unitPrice),
      discountPercentage: dec(i.discountPercentage),
      taxRate: dec(i.taxRate),
    })),
  };
}
