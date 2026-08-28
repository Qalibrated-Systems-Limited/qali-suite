"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import * as countsRepo from "../repositories/stockCounts";
import * as adjustmentsRepo from "../repositories/stockAdjustments";
import { products, stockCounts } from "../schema";

/**
 * Stocktakes — the action layer.
 *
 * WHO DOES WHAT. Counting is warehouse work and posting is not: a Storekeeper
 * may open a sheet and enter counts, and cannot turn the result into a ledger
 * entry. That is the same segregation the adjustments module is built around,
 * and posting goes THROUGH that module rather than around it, so a stocktake
 * inherits its zero-cost guard, its value threshold and its approval routing
 * instead of reimplementing them.
 *
 * The whole posting is one transaction. The count is marked posted and the
 * adjustment is raised together, or neither happens — a sheet marked posted
 * with no adjustment behind it would be a stocktake that silently changed
 * nothing.
 */

const COUNT_ROLES = [
  "Admin",
  "Manager",
  "Store Manager",
  "Storekeeper",
  "Accountant",
];

/** Posting moves the books, so it is the finance/management set. */
const POST_ROLES = ["SuperAdmin", "Admin", "Manager", "Store Manager", "Accountant"];

export interface CountActionResult {
  success: boolean;
  message: string;
  countId?: string;
  countNumber?: string;
  adjustmentId?: string | null;
}

function fail(error: unknown, fallback: string): CountActionResult {
  return {
    success: false,
    message: error instanceof Error ? error.message : fallback,
  };
}

/** Opens a sheet. Nothing is frozen until it is generated. */
export async function createStockCountPg(
  _prevState: unknown,
  formData: FormData,
): Promise<CountActionResult> {
  try {
    return await withAuthorizedTenant(
      COUNT_ROLES,
      async (tx, { user, companyId }) => {
        const name = String(formData.get("name") ?? "").trim();
        if (!name) {
          return { success: false, message: "Give the count a name." };
        }

        const categoryId = (formData.get("categoryId") as string) || null;
        const count = await countsRepo.createCount(tx, {
          companyId,
          name,
          countDate: (formData.get("countDate") as string) || undefined,
          notes: (formData.get("notes") as string) || null,
          categoryId: categoryId === "all" ? null : categoryId,
          // Blind unless explicitly turned off: a counter who can see the
          // expected number tends to find it.
          isBlind: formData.get("isBlind") !== "false",
          createdById: user.id ?? null,
          createdByName: user.name || user.email || "Unknown User",
        });

        revalidatePath("/dashboard/stock-counts");
        return {
          success: true,
          message: `Stock count ${count.countNumber} opened`,
          countId: count.id,
          countNumber: count.countNumber,
        };
      },
    );
  } catch (error) {
    return fail(error, "Could not open the stock count.");
  }
}

/** Generates the sheet and freezes the book against it. */
export async function generateCountSheetPg(
  countId: string,
): Promise<CountActionResult> {
  try {
    return await withAuthorizedTenant(COUNT_ROLES, async (tx) => {
      const frozen = await countsRepo.freezeSheet(tx, countId);

      revalidatePath(`/dashboard/stock-counts/${countId}`);
      return {
        success: true,
        message: `${frozen.lineCount} product${frozen.lineCount === 1 ? "" : "s"} on the sheet. Counting is open.`,
        countId,
        countNumber: frozen.countNumber,
      };
    });
  } catch (error) {
    return fail(error, "Could not generate the count sheet.");
  }
}

/** Records what was found on the shelf for one line. A recount overwrites. */
export async function recordCountPg(
  countId: string,
  lineId: string,
  quantity: string,
  notes?: string | null,
): Promise<CountActionResult> {
  try {
    return await withAuthorizedTenant(COUNT_ROLES, async (tx, { user }) => {
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty < 0) {
        return { success: false, message: "A counted quantity cannot be negative." };
      }

      await countsRepo.recordCount(tx, countId, lineId, {
        quantity: qty.toFixed(4),
        countedById: user.id ?? null,
        notes: notes ?? null,
      });

      revalidatePath(`/dashboard/stock-counts/${countId}`);
      return { success: true, message: "Counted", countId };
    });
  } catch (error) {
    return fail(error, "Could not record the count.");
  }
}

export async function submitCountForReviewPg(
  countId: string,
): Promise<CountActionResult> {
  try {
    return await withAuthorizedTenant(COUNT_ROLES, async (tx) => {
      const moved = await countsRepo.submitForReview(tx, countId);
      revalidatePath(`/dashboard/stock-counts/${countId}`);
      return {
        success: true,
        message: `${moved.countNumber} is ready for review`,
        countId,
        countNumber: moved.countNumber,
      };
    });
  } catch (error) {
    return fail(error, "Could not submit the count.");
  }
}

/**
 * Posts a reviewed sheet: one adjustment, built from what was COUNTED.
 *
 * THE SYSTEM QUANTITY IS READ NOW, not taken from the frozen figure on the
 * line. Stock keeps moving while people count, and a sale between the freeze
 * and this moment is a real movement rather than a discrepancy — correcting
 * from the frozen number would silently reverse it. The count says what is on
 * the shelf; the adjustment takes the book there from wherever it currently
 * is. The frozen number stays on the line, where it answers the different and
 * equally real question of how far out the book had drifted.
 *
 * THE COST IS READ NOW TOO, for the same reason: a sheet open for a week
 * should not price today's correction at last week's cost basis. The frozen
 * cost prices the variance REPORT.
 *
 * A sheet whose lines all agreed posts no adjustment at all, and that is the
 * good outcome — `stock_counts_adjustment_only_when_posted` allows the null.
 */
export async function postStockCountPg(
  countId: string,
): Promise<CountActionResult> {
  try {
    return await withAuthorizedTenant(
      POST_ROLES,
      async (tx, { user, companyId }) => {
        const [count] = await tx
          .select()
          .from(stockCounts)
          .where(eq(stockCounts.id, countId));

        if (!count) return { success: false, message: "Stock count not found" };

        const variances = await countsRepo.varianceLinesFor(tx, countId);
        const actor = {
          id: user.id ?? null,
          name: user.name || user.email || "Unknown User",
        };

        if (variances.length === 0) {
          const posted = await countsRepo.markPosted(tx, countId, actor, null);
          revalidatePath("/dashboard/stock-counts");
          return {
            success: true,
            message: `${posted.countNumber} posted. Every line agreed with the book — no adjustment was needed.`,
            countId,
            countNumber: posted.countNumber,
            adjustmentId: null,
          };
        }

        const lines: adjustmentsRepo.AdjustmentLineInput[] = [];
        for (const v of variances) {
          const [product] = await tx
            .select({
              onHand: products.quantityOnHand,
              cost: products.costPrice,
            })
            .from(products)
            .where(eq(products.id, v.productId));

          if (!product) {
            return {
              success: false,
              message: `${v.productName} is no longer in the catalogue, so this sheet cannot be posted.`,
            };
          }

          lines.push({
            productId: v.productId,
            systemQuantity: product.onHand,
            physicalQuantity: Number(v.countedQuantity).toFixed(4),
            unitCost: product.cost,
            reason: v.notes?.trim()
              ? `${count.countNumber}: ${v.notes.trim()}`
              : `Counted on ${count.countNumber}`,
          });
        }

        const adjustment = await adjustmentsRepo.createAdjustment(tx, {
          companyId,
          adjustmentType: "physical_count",
          adjustmentDate: count.countDate,
          description: `Stock count ${count.countNumber} — ${count.name}`,
          referenceNumber: count.countNumber,
          lines,
          createdById: user.id ?? null,
          createdByName: actor.name,
        });

        const routing = await adjustmentsRepo.decideRouting(
          tx,
          adjustment.id,
          companyId,
          "physical_count",
          user.role,
          lines,
        );

        if (routing.autoApprove) {
          await adjustmentsRepo.approveAdjustment(tx, adjustment.id, actor);
        }

        const posted = await countsRepo.markPosted(
          tx,
          countId,
          actor,
          adjustment.id,
        );

        revalidatePath("/dashboard/stock-counts");
        revalidatePath("/dashboard/adjustments");

        return {
          success: true,
          message: routing.autoApprove
            ? `${posted.countNumber} posted. Adjustment ${adjustment.adjustmentNumber} applied for ${lines.length} product${lines.length === 1 ? "" : "s"}.`
            : `${posted.countNumber} posted. Adjustment ${adjustment.adjustmentNumber} is waiting for approval — ${routing.reason}.`,
          countId,
          countNumber: posted.countNumber,
          adjustmentId: adjustment.id,
        };
      },
    );
  } catch (error) {
    return fail(error, "Could not post the stock count.");
  }
}

export async function cancelStockCountPg(
  countId: string,
  reason: string,
): Promise<CountActionResult> {
  try {
    return await withAuthorizedTenant(POST_ROLES, async (tx, { user }) => {
      const cancelled = await countsRepo.cancelCount(
        tx,
        countId,
        { id: user.id ?? null, name: user.name || user.email || "Unknown User" },
        reason,
      );
      revalidatePath("/dashboard/stock-counts");
      return {
        success: true,
        message: `${cancelled.countNumber} cancelled`,
        countId,
        countNumber: cancelled.countNumber,
      };
    });
  } catch (error) {
    return fail(error, "Could not cancel the stock count.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function getStockCountPg(countId: string) {
  return withAuthorizedTenant([], (tx) => countsRepo.getCount(tx, countId));
}

export async function getCountVariancesPg(countId: string) {
  return withAuthorizedTenant([], (tx) => countsRepo.getVariances(tx, countId));
}

export async function listStockCountsPg(
  opts: { status?: string; limit?: number } = {},
) {
  return withAuthorizedTenant([], (tx) =>
    countsRepo.listCounts(tx, {
      status: opts.status as Parameters<typeof countsRepo.listCounts>[1]["status"],
      limit: opts.limit,
    }),
  );
}
