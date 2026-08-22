"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import type { Tx } from "../client";
import {
  ASSET_WRITE_ROLES,
  ASSET_DISPOSE_ROLES,
  ASSET_TRANSFER_ROLES,
  ASSET_USAGE_ROLES,
} from "@/lib/utils/role-gates";
import * as assetsRepo from "../repositories/assets";
import * as accountsRepo from "../repositories/accounts";
import {
  assetSchema,
  disposeAssetSchema,
  impairAssetSchema,
  transferAssetSchema,
  usageReadingSchema,
  periodSchema,
  cancelDepreciationSchema,
  toAssetInput,
  toMoney,
} from "../validation/assets";

/**
 * Fixed asset actions on Postgres (§9I).
 *
 * The three that matter post journal entries — depreciation, impairment and
 * disposal — and in the Mongo module all three went into a ledger no screen
 * reads. Creation posts nothing, here or there: the bill already raised
 * DR Fixed Asset / CR Accounts Payable when it was approved.
 *
 * RESULT SHAPES ARE THE COMPONENTS'. Every asset dialog reads
 * `state.success` and renders `state.error`; `AssetForm` redirects on
 * `state.assetId`; `PostDepreciationDialog` reports `state.processedCount`;
 * `CancelDepreciationButton` reports `state.period`. Each function returns
 * exactly what its caller already expects, so the screens move over by
 * changing an import — the step the quotes port forgot.
 */

export type ActionResult =
  | {
      success: true;
      assetId?: string;
      assetNumber?: string;
      processedCount?: number;
      period?: string;
      journalEntryId?: string;
      message?: string;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

function firstIssue(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): ActionResult {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    fieldErrors[key] ??= issue.message;
  }
  return {
    success: false,
    error: error.issues[0]?.message ?? "Please correct the highlighted fields",
    fieldErrors,
  };
}

function revalidateAsset(assetId?: string) {
  revalidatePath("/dashboard/assets");
  revalidatePath("/dashboard/reports/asset-rollforward");
  if (assetId) revalidatePath(`/dashboard/assets/${assetId}`);
}

/**
 * The GL accounts an asset posts through.
 *
 * Taken from the asset where it names them and from the company's chart where
 * it does not — the same fallback `resolveGlAccounts` performs in Mongo. The
 * lookup lives here because the repository must not read configuration.
 */
async function resolveAssetAccounts(
  tx: Tx,
  asset: { glMapping: Record<string, string | null> },
) {
  const bySystem = async (key: string) =>
    (await accountsRepo.getSystemAccount(tx, key))?.id ?? null;

  const depreciationExpenseAccountId =
    asset.glMapping.depreciationExpenseAccount ??
    (await bySystem("depreciation_expense"));
  const accumulatedDepreciationAccountId =
    asset.glMapping.accumulatedDepreciationAccount ??
    (await bySystem("accumulated_depreciation"));
  /**
   * The asset account has no system-account fallback, and in Mongo it pretends
   * to: `resolveAccount(companyId, ..., "fixed_asset")` looks for a system
   * account by that name and there is no such thing — `fixed_asset` is a
   * SUB-TYPE in the chart, held by several accounts (Property Plant &
   * Equipment, Motor Vehicles, Furniture & Fittings). So the fallback always
   * returned null, and any asset without an explicit mapping failed disposal
   * with a message about depreciation accounts, which are not the problem.
   *
   * Here it falls back only when the answer is unambiguous — exactly one
   * fixed-asset account in the chart. Where there are several, nobody can
   * choose for the user, and `disposeAssetPg` says which field to fill in.
   */
  let assetAccountId = asset.glMapping.assetAccount ?? null;
  if (!assetAccountId) {
    const candidates = (await tx.execute(sql`
      SELECT id FROM accounts
       WHERE sub_type = 'fixed_asset' AND is_active = true AND can_post = true
       LIMIT 2
    `)) as unknown as Array<{ id: string }>;
    if (candidates.length === 1) assetAccountId = candidates[0].id;
  }

  return {
    depreciationExpenseAccountId,
    accumulatedDepreciationAccountId,
    assetAccountId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────────────────────────────────────

export async function createAssetPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = assetSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  try {
    const asset = await withAuthorizedTenant(
      [...ASSET_WRITE_ROLES],
      async (tx, { user, companyId }) => {
        const created = await assetsRepo.createAsset(tx, {
          companyId,
          ...toAssetInput(d),
          createdById: user.id,
          createdByName: user.name,
        });

        // Tag the bill line so the same spend cannot be capitalised twice.
        // In Mongo this is a findOneAndUpdate guarded on
        // `lines.capitalizedAssetId: null`; the same guard, in the WHERE.
        if (d.billLineId) {
          const updated = (await tx.execute(sql`
            UPDATE bill_lines
               SET capitalized_asset_id = ${created.id}
             WHERE id = ${d.billLineId}::uuid
               AND capitalized_asset_id IS NULL
            RETURNING id
          `)) as unknown as Array<{ id: string }>;
          if (!updated.length) {
            throw new Error(
              "That bill line has already been capitalised into an asset.",
            );
          }
        }
        return created;
      },
    );

    revalidateAsset(asset.id);
    if (d.billLineId) revalidatePath("/dashboard/bills");
    return {
      success: true,
      assetId: asset.id,
      assetNumber: asset.assetNumber,
      message: `Asset ${asset.assetNumber} registered`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not register the asset") };
  }
}

export async function updateAssetPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const assetId = String(formData.get("assetId") ?? "");
  if (!assetId) return { success: false, error: "Which asset?" };

  const parsed = assetSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return firstIssue(parsed.error);

  try {
    await withAuthorizedTenant([...ASSET_WRITE_ROLES], (tx, { user }) =>
      assetsRepo.updateAsset(tx, assetId, {
        ...toAssetInput(parsed.data),
        lastModifiedById: user.id,
        lastModifiedByName: user.name,
      }),
    );
    revalidateAsset(assetId);
    return { success: true, assetId, message: "Asset updated" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not update the asset") };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The three postings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Month-end: every active asset with a pending row for the period.
 *
 * One asset failing does not stop the rest — the Mongo version collects
 * per-asset errors the same way — but each asset's entry and schedule update
 * are one transaction, so an asset is either posted and recorded or neither.
 */
export async function postDepreciationPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = periodSchema.safeParse({ period: formData.get("period") });
  if (!parsed.success) return firstIssue(parsed.error);
  const { period } = parsed.data;

  try {
    const result = await withAuthorizedTenant(
      [...ASSET_WRITE_ROLES],
      async (tx, { user }) => {
        const due = await assetsRepo.listPendingDepreciation(tx, period);
        if (!due.length) {
          throw new Error(`No pending depreciation found for period ${period}`);
        }

        let processed = 0;
        const failures: string[] = [];

        for (const asset of due) {
          const accounts = await resolveAssetAccounts(tx, asset);
          if (
            !accounts.depreciationExpenseAccountId ||
            !accounts.accumulatedDepreciationAccountId
          ) {
            failures.push(
              `${asset.assetNumber}: map a Depreciation Expense and an Accumulated Depreciation account on the asset, or as company defaults`,
            );
            continue;
          }
          const posted = await assetsRepo.postDepreciationForAsset(
            tx,
            asset.id,
            period,
            {
              depreciationExpenseAccountId: accounts.depreciationExpenseAccountId,
              accumulatedDepreciationAccountId:
                accounts.accumulatedDepreciationAccountId,
            },
            { id: user.id, name: user.name },
          );
          if (posted) processed++;
        }

        if (processed === 0 && failures.length) {
          throw new Error(failures[0]);
        }
        return { processed, failures };
      },
    );

    revalidateAsset();
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      processedCount: result.processed,
      period,
      message: result.failures.length
        ? `Posted ${result.processed}; ${result.failures.length} could not be posted`
        : `Posted depreciation for ${result.processed} asset(s)`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not post depreciation") };
  }
}

export async function cancelDepreciationPostingPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = cancelDepreciationSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  try {
    await withAuthorizedTenant([...ASSET_DISPOSE_ROLES], (tx, { user }) =>
      assetsRepo.cancelDepreciationPosting(tx, d.assetId, d.period, {
        reason: d.reason ?? null,
        by: { id: user.id, name: user.name },
      }),
    );
    revalidateAsset(d.assetId);
    revalidatePath("/dashboard/journal");
    return { success: true, assetId: d.assetId, period: d.period };
  } catch (err) {
    return {
      success: false,
      error: userMessage(err, "Could not cancel that posting"),
    };
  }
}

export async function impairAssetPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = impairAssetSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  try {
    const result = await withAuthorizedTenant(
      [...ASSET_WRITE_ROLES],
      async (tx, { user }) => {
        const asset = await assetsRepo.getAsset(tx, d.assetId);
        if (!asset) throw new Error("Asset not found");

        const loss = await accountsRepo.getAccount(tx, d.impairmentLossAccountId);
        if (!loss) throw new Error("Impairment loss account not found");
        if (loss.accountType !== "expense") {
          throw new Error("Impairment loss must post to an expense account");
        }

        const accounts = await resolveAssetAccounts(tx, asset);
        if (!accounts.accumulatedDepreciationAccountId) {
          throw new Error(
            "No Accumulated Depreciation account is mapped for this asset",
          );
        }

        return assetsRepo.impairAsset(tx, d.assetId, {
          amount: toMoney(d.amount),
          reason: d.reason,
          impairedAt: d.impairedAt ?? null,
          accounts: {
            impairmentLossAccountId: d.impairmentLossAccountId,
            accumulatedDepreciationAccountId:
              accounts.accumulatedDepreciationAccountId,
          },
          by: { id: user.id, name: user.name },
        });
      },
    );

    revalidateAsset(d.assetId);
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      assetId: d.assetId,
      journalEntryId: result.entry.id,
      message: "Impairment posted",
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not impair the asset") };
  }
}

export async function disposeAssetPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = disposeAssetSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  try {
    const result = await withAuthorizedTenant(
      [...ASSET_DISPOSE_ROLES],
      async (tx, { user }) => {
        const asset = await assetsRepo.getAsset(tx, d.assetId);
        if (!asset) throw new Error("Asset not found");

        const accounts = await resolveAssetAccounts(tx, asset);
        if (!accounts.assetAccountId) {
          throw new Error(
            `Asset ${asset.assetNumber} has no Fixed Asset account mapped, and the chart has more than one to choose from. Edit the asset and set its Fixed Asset account before disposing of it.`,
          );
        }
        if (!accounts.accumulatedDepreciationAccountId) {
          throw new Error(
            "No Accumulated Depreciation account is mapped for this asset",
          );
        }

        return assetsRepo.disposeAsset(tx, d.assetId, {
          disposalMethod: d.disposalMethod,
          disposalAmount: toMoney(d.disposalAmount),
          disposalDate: d.disposalDate ?? null,
          notes: d.disposalNotes ?? null,
          accounts: {
            assetAccountId: accounts.assetAccountId,
            accumulatedDepreciationAccountId:
              accounts.accumulatedDepreciationAccountId,
            bankAccountId: d.bankAccountId,
            gainAccountId: d.gainAccountId,
            lossAccountId: d.lossAccountId,
          },
          by: { id: user.id, name: user.name },
        });
      },
    );

    revalidateAsset(d.assetId);
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      assetId: d.assetId,
      journalEntryId: result.entry.id,
      message:
        result.gainOrLoss === 0
          ? "Asset disposed"
          : result.gainOrLoss > 0
            ? `Asset disposed at a gain of ${result.gainOrLoss.toFixed(2)}`
            : `Asset disposed at a loss of ${Math.abs(result.gainOrLoss).toFixed(2)}`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not dispose of the asset") };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custody and usage
// ─────────────────────────────────────────────────────────────────────────────

export async function transferAssetPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = transferAssetSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  try {
    await withAuthorizedTenant([...ASSET_TRANSFER_ROLES], (tx, { user }) =>
      assetsRepo.transferAsset(tx, d.assetId, {
        toLocation: d.toLocation ?? null,
        toDepartment: d.toDepartment ?? null,
        toAssignedToName: d.toAssignedToName ?? null,
        toAssignedToPartyId: d.toAssignedToPartyId,
        transferredAt: d.transferredAt ?? null,
        reason: d.reason ?? null,
        by: { id: user.id, name: user.name },
      }),
    );
    revalidateAsset(d.assetId);
    return { success: true, assetId: d.assetId, message: "Asset transferred" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not transfer the asset") };
  }
}

export async function recordUsageReadingPg(
  assetId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = usageReadingSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  try {
    await withAuthorizedTenant([...ASSET_USAGE_ROLES], (tx, { user }) =>
      assetsRepo.recordUsageReading(tx, assetId, {
        reading: toMoney(d.reading),
        recordedAt: d.recordedAt ?? null,
        source: d.source,
        notes: d.notes ?? null,
        by: { id: user.id, name: user.name },
      }),
    );
    revalidateAsset(assetId);
    return { success: true, assetId, message: "Reading recorded" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not record the reading") };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads the screens call
// ─────────────────────────────────────────────────────────────────────────────

export async function getAssets(filters: assetsRepo.ListAssetsOptions = {}) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      assetsRepo.listAssets(tx, filters),
    );
  } catch {
    return { assets: [], total: 0 };
  }
}

export async function getAssetById(assetId: string) {
  if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) return null;
  try {
    return await withAuthorizedTenant([], (tx) =>
      assetsRepo.getAssetDetail(tx, assetId),
    );
  } catch {
    return null;
  }
}

export async function getAssetsTotals() {
  try {
    return await withAuthorizedTenant([], (tx) =>
      assetsRepo.getAssetTotals(tx),
    );
  } catch {
    return {
      count: 0, active: 0, disposed: 0, totalCost: 0,
      totalDepreciation: 0, totalBookValue: 0, periodsMissed: 0,
    };
  }
}

export async function getPendingDepreciation(period: string) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      assetsRepo.listPendingDepreciation(tx, period),
    );
  } catch {
    return [];
  }
}

export async function getAssetRollforward(opts: {
  startDate?: string;
  endDate?: string;
} = {}) {
  const now = new Date();
  const startDate = opts.startDate || `${now.getUTCFullYear()}-01-01`;
  const endDate = opts.endDate || `${now.getUTCFullYear()}-12-31`;

  try {
    const result = await withAuthorizedTenant([], (tx) =>
      assetsRepo.getAssetRollforward(tx, { startDate, endDate }),
    );
    return { success: true as const, ...result };
  } catch (err) {
    return {
      success: false as const,
      error: userMessage(err, "Could not build the rollforward"),
      rows: [],
      totals: null,
      period: { startDate, endDate },
    };
  }
}


/** The bills half of an asset's running costs. See asset-cost-queries.js. */
export async function listAssetBillCostsPg(assetId: string) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      assetsRepo.listAssetBillCosts(tx, assetId),
    );
  } catch {
    return [];
  }
}

/**
 * The bill line an asset is being capitalised from, and whether it may be.
 *
 * Four rules, all of them Mongo's: the bill must be APPROVED (a draft has not
 * posted DR Fixed Asset / CR Accounts Payable yet, so there is nothing to
 * capitalise), the line must be charged to an ASSET account, and it must not
 * already carry an asset. The `billLineId` returned is the plain line id —
 * Mongo compounds it as `billId:lineId` because its lines are subdocuments;
 * here a line has its own primary key.
 */
export async function loadBillLineForCapitalization(billLineRef: string) {
  // Tolerate Mongo's `billId:lineId` shape as well as a bare line id.
  const lineId = String(billLineRef ?? "").split(":").pop() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(lineId)) {
    return { error: "Invalid bill line reference" };
  }

  try {
    return await withAuthorizedTenant(
      [...ASSET_WRITE_ROLES],
      async (tx) => {
        const rows = (await tx.execute(sql`
          SELECT l.id, l.description, l.line_total, l.capitalized_asset_id,
                 b.id AS bill_id, b.bill_number, b.bill_date::text AS bill_date,
                 b.status::text AS bill_status,
                 a.account_type::text AS account_type
            FROM bill_lines l
            JOIN bills b ON b.id = l.bill_id
            LEFT JOIN accounts a ON a.id = l.account_id
           WHERE l.id = ${lineId}::uuid
        `)) as unknown as Array<Record<string, unknown>>;

        if (!rows.length) return { error: "Bill line not found" };
        const r = rows[0];

        if (r.bill_status !== "approved") {
          return {
            error: `Bill must be approved before capitalizing. Current status: ${r.bill_status}.`,
          };
        }
        if (r.account_type !== "asset") {
          return {
            error:
              "Only asset-type lines can be capitalized. Re-classify the line first.",
          };
        }
        if (r.capitalized_asset_id) {
          return {
            error: "This line has already been capitalized",
            alreadyCapitalizedAssetId: String(r.capitalized_asset_id),
          };
        }

        const description = (r.description as string) ?? "";
        return {
          prefill: {
            name: description.slice(0, 200),
            description,
            acquisitionCost: Number(r.line_total ?? 0),
            acquisitionDate: (r.bill_date as string) ?? null,
            sourceType: "bill" as const,
            sourceId: String(r.bill_id),
            sourceReference: String(r.bill_number),
            billLineId: String(r.id),
          },
        };
      },
    );
  } catch (err) {
    return { error: userMessage(err, "Failed to load bill line") };
  }
}

/**
 * The chart of accounts, for the GL pickers on the asset form and dialogs.
 *
 * POSTGRES. Both pages read the Mongo `Account` collection, which the chart
 * of accounts stopped writing to when it ported — so the Fixed Asset,
 * Accumulated Depreciation, Depreciation Expense, gain, loss and impairment
 * dropdowns have been offering a stale list, or none at all.
 */
export async function getAssetGlAccounts() {
  try {
    return await withAuthorizedTenant([], async (tx) => {
      const rows = await accountsRepo.listAccounts(tx, {
        activeOnly: true,
        postableOnly: true,
      });
      return rows.map((a) => ({
        _id: a.id,
        id: a.id,
        accountCode: a.accountCode,
        accountName: a.accountName,
        accountType: a.accountType,
        subType: a.subType,
        systemAccount: a.systemAccount,
      }));
    });
  } catch {
    return [];
  }
}

/** Fleet analytics: in-service assets and their usage inside a window. */
export async function getFleetUsagePg(opts: {
  category?: string;
  since: string;
  until: string;
}) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      assetsRepo.listFleetUsage(tx, opts),
    );
  } catch {
    return [];
  }
}

export async function countFleetAssetsPg(category?: string) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      assetsRepo.countFleetAssets(tx, category || undefined),
    );
  } catch {
    return 0;
  }
}

/** Spend per asset from the bills side; expenses are merged on the Mongo side. */
export async function sumAssetBillCostsPg(opts: {
  assetIds: string[];
  since: string;
  until: string;
}) {
  try {
    const map = await withAuthorizedTenant([], (tx) =>
      assetsRepo.sumAssetBillCosts(tx, opts),
    );
    return Object.fromEntries(map);
  } catch {
    return {};
  }
}
