import { z } from "zod";

/**
 * What an invoice payload must look like, and how it becomes repository input.
 *
 * IN ITS OWN MODULE BECAUSE THE ACTION FILE IS `"use server"`. Next allows only
 * async functions to be exported from one of those, so a schema declared beside
 * the action cannot be shared — and the alternative, an API route re-declaring
 * the rules, is two definitions of "what a valid invoice is" that drift the
 * first time one of them is corrected.
 *
 * Both callers import from here: the server action behind the dashboard form,
 * and the /api/v1 endpoint behind an API key. Neither owns the rules.
 */

export const stockItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  sellingPrice: z.coerce.number().min(0, "Price cannot be negative"),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  unit: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  checkoutId: z.string().optional().nullable(),
  stockRequestId: z.string().optional().nullable(),
  weighbridgeTicketId: z.string().optional().nullable(),
});

export const serviceItemSchema = z.object({
  name: z.string().min(1, "Service name is required"),
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
    .default("other"),
  description: z.string().optional(),
  unit: z.string().optional(),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unitPrice: z.coerce.number().min(0, "Price cannot be negative"),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});

export const invoiceDataSchema = z
  .object({
    customerId: z.string().min(1, "Customer is required"),
    invoiceDate: z.string().min(1, "Invoice date is required"),
    dueDate: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    stockItems: z.array(stockItemSchema).default([]),
    serviceItems: z.array(serviceItemSchema).default([]),
  })
  .refine((d) => d.stockItems.length + d.serviceItems.length > 0, {
    message: "Add at least one item or service",
    path: ["stockItems"],
  });

/** Dates arrive as ISO strings or datetime-local values; the column is a date. */
export const toDateOnly = (v?: string | null) =>
  v ? String(v).slice(0, 10) : undefined;

/** Money crosses this boundary as a string and stays one. */
const money = (n: number) => n.toFixed(4);

/**
 * Deliberately the shape app/mongodb/invoice-actions.js returns, so a component
 * can change data source without changing.
 */

export function toRepositoryInput(d: z.infer<typeof invoiceDataSchema>) {
  return {
    customerId: d.customerId,
    invoiceDate: toDateOnly(d.invoiceDate)!,
    dueDate: toDateOnly(d.dueDate) ?? null,
    title: d.title ?? null,
    notes: d.notes ?? null,
    lines: [
      ...d.stockItems.map((it) => ({
        itemType: "product" as const,
        productId: it.productId,
        description: it.description || it.name || null,
        unit: it.unit,
        quantity: money(it.quantity),
        unitPrice: money(it.sellingPrice),
        taxRate: money(it.taxRate),
        // §8.1: single-valued and mandatory. The form sets at most one.
        fulfilmentSource: it.weighbridgeTicketId
          ? ("weighbridge" as const)
          : it.stockRequestId
            ? ("stock_request" as const)
            : it.checkoutId
              ? ("checkout" as const)
              : ("inventory" as const),
        checkoutId: it.checkoutId || null,
        stockRequestId: it.stockRequestId || null,
        weighbridgeTicketId: it.weighbridgeTicketId || null,
      })),
      ...d.serviceItems.map((it) => ({
        itemType: "service" as const,
        serviceCategory: it.serviceCategory,
        description: it.description || it.name,
        unit: it.unit,
        quantity: money(it.quantity),
        unitPrice: money(it.unitPrice),
        taxRate: money(it.taxRate),
      })),
    ],
  };
}
