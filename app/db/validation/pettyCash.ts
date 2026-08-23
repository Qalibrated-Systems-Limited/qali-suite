import { z } from "zod";

/**
 * Petty cash payloads.
 *
 * Its own module because the action file is `"use server"` and Next only lets
 * async functions out of one. Money arrives as a number and leaves as a
 * string: numeric(19,4) is exact and JavaScript's float is not, so the
 * boundary is here and it is one-way.
 */

const uuidish = (label: string) =>
  z.string().refine((v) => /^[0-9a-f-]{36}$/i.test(v), `Not a valid ${label}`);

const isoDay = z
  .string()
  .min(1, "A date is required")
  .transform((v) => v.slice(0, 10));

export const createReturnSchema = z
  .object({
    floatAccountId: uuidish("petty cash account"),
    from: isoDay,
    to: isoDay,
    notes: z.string().optional(),
  })
  /**
   * The Mongo action checks both dates were supplied and nothing else — so a
   * period ending before it starts was accepted, and the statement for it was
   * silently empty.
   */
  .refine((d) => d.to >= d.from, {
    message: "The period cannot end before it starts",
    path: ["to"],
  });

export const fundFloatSchema = z.object({
  sourceAccountId: uuidish("source account"),
  amount: z.coerce.number().positive("Enter an amount greater than zero"),
  date: z.string().optional(),
  note: z.string().optional(),
});

export const rejectReturnSchema = z.object({
  /**
   * REQUIRED, where the Mongo action defaults it to "Returned for correction".
   * A rejection with no reason is what sends a custodian back to a form with
   * nothing to fix, and the database now refuses one
   * (`petty_cash_returns_rejection_has_reason`).
   */
  reason: z.string().min(3, "Say why it is being sent back"),
});

export function toMoney(n: number) {
  return n.toFixed(4);
}
