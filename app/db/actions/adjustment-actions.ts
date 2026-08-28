"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import * as adjustmentsRepo from "../repositories/stockAdjustments";
import { products } from "../schema";

/**
 * Stock adjustments — the action layer.
 *
 * SEGREGATION OF DUTIES, unchanged from Mongo (adjustment-actions.js:17):
 * physical custody proposes, finance approves. A Storekeeper may raise an
 * adjustment and may not apply one. What decides between the two is below, in
 * `routingFor`, and it is the same three rules — full authority, high-risk
 * type, value threshold — plus the zero-cost guard.
 *
 * THE APPROVAL ENGINE IS STILL MONGO. There is no Postgres table for
 * ApprovalRequest — only `stock_request_approvals`, which belongs to fulfilment
 * — so an adjustment that needs routing is written HERE and its approval
 * request is raised THERE, exactly as expense payments have done since 0059.
 * `applyStockAdjustment` in approval-actions.js is the other end of that wire
 * and now calls the Postgres approve.
 */

const FULL_AUTHORITY_ROLES = new Set(["Admin", "Manager", "SuperAdmin"]);

/**
 * Who may auto-approve their OWN adjustment when it is small and low-risk.
 *
 * A DELIBERATE DIVERGENCE, and the one place this port does not do what the
 * Mongo action did. Its policy header says the value branch is for a caller
 * who "is Store Manager / Accountant AND the type is not high-risk AND the
 * value is under the threshold", and the comment beside CREATE_ROLES says
 * "Storekeeper can now propose, but the approval engine ensures they don't
 * auto-apply". Neither is true of the code:
 *
 *     !hasZeroCostIncrease && (hasFullAuthority || (!isHighRisk && !isHighValue))
 *
 * The second branch tests no role at all. So a Storekeeper — the one role the
 * comment names as unable to auto-apply — auto-approved every adjustment under
 * fifty thousand shillings, posting to the ledger and moving stock with no
 * second signature. That is the segregation of duties this module is built
 * around, absent.
 *
 * The roles here are the ones its own policy header names.
 */
const THRESHOLD_AUTHORITY_ROLES = new Set(["Store Manager", "Accountant"]);
const CREATE_ROLES = [
  "Admin",
  "Manager",
  "Store Manager",
  "Storekeeper",
  "Accountant",
];

export interface AdjustmentActionResult {
  success: boolean;
  message: string;
  adjustmentNumber?: string;
  adjustmentId?: string;
}

interface FormItem {
  productId: string;
  productName?: string;
  adjustmentType: "increase" | "decrease";
  quantity: number;
  reason: string;
}

/**
 * Creates an adjustment, and approves it when the caller is allowed to.
 *
 * The form posts one field, `adjustmentData`, holding JSON — its shape is
 * decided in CreateAdjustmentForm.jsx and is not changed by this port.
 *
 * IT DOES NOT POST A COST. Each line's `unit_cost` is read from the product
 * here, as the Mongo action read `product.costing.costPrice`, so the value of
 * an adjustment is the book cost of the goods and not a number the person
 * counting them typed.
 */
export async function createStockAdjustmentPg(
  _prevState: unknown,
  formData: FormData,
): Promise<AdjustmentActionResult> {
  try {
    return await withAuthorizedTenant(CREATE_ROLES, async (tx, { user, companyId }) => {
      const raw = formData.get("adjustmentData");
      if (typeof raw !== "string") {
        return { success: false, message: "No adjustment was submitted." };
      }

      const { adjustmentDate, adjustmentType, description, notes, items } =
        JSON.parse(raw) as {
          adjustmentDate?: string;
          adjustmentType?: string;
          description?: string;
          notes?: string;
          items?: FormItem[];
        };

      if (!adjustmentDate || !adjustmentType) {
        return {
          success: false,
          message: "Adjustment date and type are required",
        };
      }
      if (!items || items.length === 0) {
        return {
          success: false,
          message: "At least one adjustment item is required",
        };
      }

      for (const item of items) {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
          return {
            success: false,
            message: `Invalid quantity for ${item.productName || "item"}: must be a positive whole number`,
          };
        }
      }

      // The system quantity is read HERE, inside the transaction, not taken
      // from the `currentStock` the browser was holding when the row was
      // added. A count keyed at 9am and submitted at noon would otherwise
      // adjust to a level that has since moved, and the difference would post
      // to the ledger as if it were a discrepancy.
      const lines: adjustmentsRepo.AdjustmentLineInput[] = [];
      for (const item of items) {
        const [product] = await tx
          .select({
            id: products.id,
            name: products.name,
            onHand: products.quantityOnHand,
            cost: products.costPrice,
          })
          .from(products)
          .where(eq(products.id, item.productId));

        if (!product) {
          return {
            success: false,
            message: `Product not found: ${item.productName || item.productId}`,
          };
        }

        const delta =
          item.adjustmentType === "increase" ? item.quantity : -item.quantity;

        lines.push({
          productId: product.id,
          systemQuantity: product.onHand,
          physicalQuantity: (Number(product.onHand) + delta).toFixed(4),
          unitCost: product.cost,
          reason: item.reason,
        });
      }

      const adjustment = await adjustmentsRepo.createAdjustment(tx, {
        companyId,
        adjustmentType:
          adjustmentType as adjustmentsRepo.CreateAdjustmentInput["adjustmentType"],
        adjustmentDate,
        description: description ?? null,
        notes: notes ?? null,
        lines,
        createdById: user.id ?? null,
        createdByName: user.name || user.email || "Unknown User",
      });

      const routing = await routingFor(
        tx,
        adjustment.id,
        companyId,
        adjustmentType,
        user.role,
        lines,
      );

      if (routing.autoApprove) {
        await adjustmentsRepo.approveAdjustment(tx, adjustment.id, {
          id: user.id ?? null,
          name: user.name || user.email || "Unknown User",
        });

        revalidatePath("/dashboard/adjustments");
        return {
          success: true,
          message: `Stock adjustment ${adjustment.adjustmentNumber} created and approved successfully`,
          adjustmentNumber: adjustment.adjustmentNumber,
          adjustmentId: adjustment.id,
        };
      }

      // The draft stands whatever the engine does with it. Raising the request
      // is a separate logical step, as it was in Mongo — the difference is
      // that a failure there no longer leaves a half-written adjustment,
      // because this transaction has not committed until the handler returns.
      const { submitApproval } = await import(
        "@/app/mongodb/actions/approval-actions"
      );
      const result = await submitApproval({
        type: routing.isHighRisk ? "stock_writeoff" : "stock_adjustment",
        targetRef: {
          kind: "InventoryAdjustment",
          id: adjustment.id,
          label: `${adjustment.adjustmentNumber} — ${adjustmentType} — KES ${routing.totalValue.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`,
        },
        payload: { adjustmentId: adjustment.id },
        reason: routing.reason,
        context: {
          amount: routing.totalValue,
          threshold: routing.threshold,
        },
      });

      revalidatePath("/dashboard/adjustments");

      if (!result?.success) {
        return {
          success: false,
          message: result?.error ?? "Could not raise the approval.",
        };
      }

      return {
        success: true,
        message: `Stock adjustment ${adjustment.adjustmentNumber} submitted for approval (${result.approval.requestNumber})`,
        adjustmentNumber: adjustment.adjustmentNumber,
        adjustmentId: adjustment.id,
      };
    });
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Could not create the stock adjustment.",
    };
  }
}

/**
 * Auto-approve, or route?
 *
 * THE ZERO-COST GUARD IS THE ONE THAT MATTERS, and it is why this cannot be a
 * simple value comparison. An increase admitting stock at a `unit_cost` of zero
 * — because the product's cost price was never set — posts inventory at no
 * value: it understates the balance sheet, wrongs COGS when the item later
 * sells, AND defeats the threshold below, since a total of zero never exceeds
 * anything and would auto-approve every time. SAP and NetSuite refuse a
 * zero-cost receipt outright; here it goes to finance to establish a cost.
 * Mongo's comment (adjustment-actions.js:169) says the same and is worth
 * keeping.
 */
async function routingFor(
  tx: Parameters<Parameters<typeof withAuthorizedTenant>[1]>[0],
  adjustmentId: string,
  companyId: string,
  adjustmentType: string,
  userRole: string | undefined,
  lines: adjustmentsRepo.AdjustmentLineInput[],
) {
  const { net, increase, decrease } = await adjustmentsRepo.summariseAdjustment(
    tx,
    adjustmentId,
  );
  void net;

  // The threshold is compared against the GROSS movement, as in Mongo: a
  // count that writes off a million and finds a million back is not a small
  // adjustment just because it nets to nothing.
  const totalValue = Number(increase) + Number(decrease);

  const hasZeroCostIncrease = lines.some(
    (l) =>
      Number(l.physicalQuantity) > Number(l.systemQuantity) &&
      Number(l.unitCost) <= 0,
  );

  const { getCompanyThresholds } = await import("@/app/db/companyConfig");
  const thresholds = await getCompanyThresholds(companyId);

  const isHighRisk = new Set(thresholds.stockHighRiskTypes).has(adjustmentType);
  const threshold = Number(thresholds.stockAdjustmentValue);
  const isHighValue = totalValue > threshold;
  const hasFullAuthority = FULL_AUTHORITY_ROLES.has(userRole ?? "");

  const reasonParts: string[] = [];
  if (hasZeroCostIncrease)
    reasonParts.push("Stock admitted with no cost basis");
  if (isHighRisk) reasonParts.push(`High-risk type: ${adjustmentType}`);
  if (isHighValue)
    reasonParts.push(
      `Value KES ${totalValue.toLocaleString("en-KE", { maximumFractionDigits: 0 })} exceeds auto-approve threshold`,
    );

  const mayAutoApproveSmall = THRESHOLD_AUTHORITY_ROLES.has(userRole ?? "");
  if (!hasFullAuthority && !mayAutoApproveSmall) {
    reasonParts.push(`${userRole ?? "This role"} proposes; it does not apply`);
  }

  return {
    autoApprove:
      !hasZeroCostIncrease &&
      (hasFullAuthority || (mayAutoApproveSmall && !isHighRisk && !isHighValue)),
    isHighRisk,
    totalValue,
    threshold,
    reason: reasonParts.join("; ") || "Requires approval",
  };
}

/**
 * Applies an adjustment the approval engine has already signed off.
 *
 * Called from `app/mongodb/actions/approval-actions.js` — the ApprovalRequest
 * engine is not ported, so this is the seam. It replaces a call to
 * `adjustment.approve()`, which posted the journal entry into the MONGO
 * ledger: an adjustment routed for sign-off, approved by a manager, and then
 * booked where no ledger screen reads it.
 *
 * THE ROLE LIST IS THE UNION OF `APPROVER_MATRIX`'s two stock rows
 * (approvalRequest.js:196) — `stock_adjustment` admits Store Manager,
 * `stock_writeoff` admits CFO and Finance Manager. The engine has already
 * checked the row for THIS approval's type, so re-checking a narrower list
 * here would refuse an approver the engine just accepted. Getting this wrong
 * is silent: the approval sits in the queue and the approver is told they lack
 * a permission they have.
 */
export async function applyApprovedStockAdjustmentPg(
  adjustmentId: string,
): Promise<AdjustmentActionResult> {
  try {
    return await withAuthorizedTenant(
      ["SuperAdmin", "Admin", "Manager", "Store Manager", "CFO", "Finance Manager"],
      async (tx, { user }) => {
        const adjustment = await adjustmentsRepo.approveAdjustment(
          tx,
          adjustmentId,
          {
            id: user.id ?? null,
            name: user.name || user.email || "Approver",
          },
        );

        revalidatePath("/dashboard/adjustments");
        revalidatePath(`/dashboard/adjustments/${adjustmentId}`);

        return {
          success: true,
          message: `Stock adjustment ${adjustment.adjustmentNumber} approved`,
          adjustmentNumber: adjustment.adjustmentNumber,
          adjustmentId: adjustment.id,
        };
      },
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Could not approve the adjustment.",
    };
  }
}

/**
 * Voids a DRAFT adjustment whose approval was rejected or cancelled.
 *
 * Reached from `voidApprovalTarget` in the Mongo approval engine, which is the
 * only caller `inventoryAdjustment.cancel()` ever had. It looked the
 * adjustment up in MONGO by `targetRef.id` — a Postgres uuid since this port —
 * so the lookup threw a CastError that the engine's own catch swallowed as a
 * log line, and a rejected adjustment stayed a live draft, re-submittable, as
 * though the rejection had not happened. The same defect the CreditNote branch
 * above it was written to fix.
 *
 * Role list as `applyApprovedStockAdjustmentPg`: whoever the engine let decide
 * the approval is who is cleaning up after it.
 */
export async function voidDraftStockAdjustmentPg(
  adjustmentId: string,
  reason: string,
): Promise<AdjustmentActionResult> {
  try {
    return await withAuthorizedTenant(
      ["SuperAdmin", "Admin", "Manager", "Store Manager", "CFO", "Finance Manager"],
      async (tx, { user }) => {
        const adjustment = await adjustmentsRepo.cancelAdjustment(
          tx,
          adjustmentId,
          { id: user.id ?? null, name: user.name || user.email || "Unknown User" },
          reason,
        );

        revalidatePath("/dashboard/adjustments");
        return {
          success: true,
          message: `Stock adjustment ${adjustment.adjustmentNumber} cancelled`,
          adjustmentNumber: adjustment.adjustmentNumber,
          adjustmentId: adjustment.id,
        };
      },
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Could not cancel the adjustment.",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
//
// THE SHAPES BELOW ARE THE MONGO SHAPES, not the repository's.
// `_id`, a `lines` array the table takes `.length` from, `createdBy.name`, and
// NUMBERS rather than the strings Postgres returns for NUMERIC. Three ported
// shapes were "improved" during the dashboard port and tsc caught all three;
// these screens are JSX, where it would not have.
// ─────────────────────────────────────────────────────────────────────────────

export async function getAdjustments(
  opts: {
    page?: number;
    limit?: number;
    status?: string | null;
    adjustmentType?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  } = {},
) {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  return withAuthorizedTenant([], async (tx) => {
    const rows = await adjustmentsRepo.listAdjustments(tx, {
      status:
        opts.status && opts.status !== "all"
          ? (opts.status as "draft" | "approved" | "cancelled")
          : undefined,
      adjustmentType:
        opts.adjustmentType && opts.adjustmentType !== "all"
          ? (opts.adjustmentType as adjustmentsRepo.CreateAdjustmentInput["adjustmentType"])
          : undefined,
      startDate: opts.startDate ?? undefined,
      endDate: opts.endDate ?? undefined,
      limit: limit + 1,
      offset: (page - 1) * limit,
    });

    // One row over the page size answers hasNext without a second COUNT over
    // the whole table — the pagination block is the only thing that needed it,
    // and it only ever asks whether there is more.
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;

    return {
      adjustments: pageRows.map((row) => ({
        _id: row.id,
        adjustmentNumber: row.adjustmentNumber,
        adjustmentDate: row.adjustmentDate,
        adjustmentType: row.adjustmentType,
        status: row.status,
        description: row.description,
        journalEntryId: row.journalEntryId,
        totalIncreaseValue: Number(row.totalIncreaseValue),
        totalDecreaseValue: Number(row.totalDecreaseValue),
        // The table renders `adjustment.lines?.length`. It never reads a line,
        // so the count is carried as an array of that length rather than
        // fetching every line of every row to be measured and thrown away.
        lines: Array.from({ length: row.lineCount }),
        createdBy: { name: row.createdByName },
        createdAt: row.createdAt,
      })),
      pagination: {
        page,
        limit,
        total: (page - 1) * limit + pageRows.length + (hasNext ? 1 : 0),
        totalPages: hasNext ? page + 1 : page,
        hasNext,
        hasPrev: page > 1,
      },
    };
  });
}

export async function getAdjustmentById(adjustmentId: string) {
  return withAuthorizedTenant([], async (tx) => {
    const adjustment = await adjustmentsRepo.getAdjustment(tx, adjustmentId);
    if (!adjustment) return null;

    return {
      ...adjustment,
      _id: adjustment.id,
      totalIncreaseValue: Number(adjustment.increase),
      totalDecreaseValue: Number(adjustment.decrease),
      totalAdjustmentValue: Number(adjustment.net),
      createdBy: { name: adjustment.createdByName },
      lines: adjustment.lines.map((line) => ({
        ...line,
        productSKU: line.productSkuAtAdjustment,
        productName: line.productNameAtAdjustment,
        productUnit: line.productUnitAtAdjustment,
        systemQuantity: Number(line.systemQuantity),
        physicalQuantity: Number(line.physicalQuantity),
        adjustmentQuantity: Number(line.adjustmentQuantity),
        unitCost: Number(line.unitCost),
        adjustmentValue: Number(line.adjustmentValue),
      })),
    };
  });
}

export async function getAdjustmentStats(
  opts: { startDate?: string | null; endDate?: string | null } = {},
) {
  return withAuthorizedTenant([], async (tx) => {
    const stats = await adjustmentsRepo.getAdjustmentStats(tx, {
      startDate: opts.startDate ?? undefined,
      endDate: opts.endDate ?? undefined,
    });

    return {
      ...stats,
      totalIncreaseValue: Number(stats.totalIncreaseValue),
      totalDecreaseValue: Number(stats.totalDecreaseValue),
      netValue: Number(stats.netValue),
      byType: stats.byType.map((t) => ({ ...t, value: Number(t.value) })),
    };
  });
}

export async function getRecentAdjustments(limit = 5) {
  const { adjustments } = await getAdjustments({ limit });
  return adjustments;
}
