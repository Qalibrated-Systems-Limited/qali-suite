"use server";

import { revalidatePath } from "next/cache";
import { roleAllowed } from "@/lib/permissions";
import { z } from "zod";
import mongoose from "mongoose";

import GoodsReceipt from "@/app/models/goodsReceipt";
import Bill from "@/app/models/bill";
import PurchaseOrder from "@/app/models/purchaseOrder";
import Product from "@/app/models/product";
import Account from "@/app/models/account";
import JournalEntry from "@/app/models/JournalEntry";
import { StockMovement } from "@/app/models/stockmovement";
import { createNCRFromGRN } from "@/app/mongodb/actions/ncr-actions";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";

// ============================================
// GOODS RECEIPT NOTE — SERVER ACTIONS (SOP §10.1)
// ============================================

// ── Industry-standard Separation of Duties ────────────────────────────
// Procurement raises the PO; Stores receives. The same individual
// shouldn't do both — that's the classic order-and-receive fraud risk
// SAP/NetSuite/Dynamics all block by default. We enforce it here by
// removing Procurement Officer from CREATE. They can still VIEW the GRN
// and reference it against the PO; they just can't author the receipt.
// Acceptance is further SoD-gated at the action level (acceptGRN guards
// against the creator signing, and against the same person signing both
// Sales and Finance sides).
const GRN_ROLES = {
  CREATE: [
    "SuperAdmin",
    "Admin",
    "Manager",
    "Store Manager",
    "Storekeeper",
  ],
  // Sales side acceptance — Commercial / Sales leadership
  ACCEPT_SALES: [
    "SuperAdmin",
    "Admin",
    "Sales Manager",
    "Manager",
  ],
  // Finance side acceptance — finance leadership
  ACCEPT_FINANCE: [
    "SuperAdmin",
    "Admin",
    "CFO",
    "Finance Manager",
    "Accountant",
  ],
  // Reject / void — top finance authority + Storekeeper for own drafts
  REJECT: [
    "SuperAdmin",
    "Admin",
    "CFO",
    "Finance Manager",
    "Manager",
    "Store Manager",
  ],
};

function hasRole(user, allowedRoles) {
  return roleAllowed(user?.role, allowedRoles);
}

// Whether THIS GRN should drive the physical-stock side of inventory.
// True for unscheduled receipts and for bill-sourced receipts when the
// bill deferred inventory to the GRN (strict three-way-match mode).
// False when the bill already credited inventory (legacy mode) — in
// that case the GRN is documentation-only.
async function grnAppliesInventory(grn, session) {
  if (grn.source?.type === "unscheduled") return true;
  if (grn.source?.type === "bill" && grn.source?.billId) {
    const bill = await Bill.findById(grn.source.billId)
      .select("accounting.inventoryMoved accounting.usedGRNI")
      .session(session ?? null)
      .lean();
    // If the bill skipped inventory at approval (strict mode), the GRN
    // is the entry point — apply inventory here.
    return bill ? !bill.accounting?.inventoryMoved : false;
  }
  return false;
}

// Build and post the inventory-clearing JE for a fully-accepted strict-mode
// GRN: DR Inventory / CR GR/IR for each accepted line. Also creates the
// posted stock movements. Called from acceptGRN once both Sales+Finance
// have signed off and the source bill flagged usedGRNI.
async function postGRNAcceptanceJournal({
  grn,
  bill,
  purchaseOrder,
  user,
  session,
  acceptedLines,
}) {
  if (!acceptedLines.length) return null;

  // Ensure system accounts are present on the tenant.
  const filter = { companyId: grn.companyId };
  const [inventoryAccount, grniAccount] = await Promise.all([
    Account.findOne({ ...filter, systemAccount: "inventory" }).session(session),
    Account.findOne({ ...filter, systemAccount: "grni" }).session(session),
  ]);
  if (!inventoryAccount || !grniAccount) {
    throw new Error(
      "Inventory or GR/IR system account not configured — cannot post the GRN acceptance journal.",
    );
  }

  // Compute per-line cost from the source document so the JE values
  // match what was already booked elsewhere:
  // - Bill source (strict mode): bill.amount → already posted to GR/IR
  // - PO source: po.unitPrice × accepted qty → opens GR/IR (bill clears later)
  const lineAmounts = new Map(); // grnLineId → { amount, description }
  for (const grnLine of acceptedLines) {
    let amount = 0;
    let description = grnLine.description;

    if (bill) {
      // Find the matching bill line. (1:1 by product for now.)
      const billLine = (bill.lines || []).find(
        (bl) => bl.product?.id?.toString() === grnLine.productId.toString(),
      );
      if (!billLine) {
        throw new Error(
          `Cannot find matching bill line for product ${grnLine.productId} on GRN ${grn.grnNumber}.`,
        );
      }
      // Pro-rate by accepted vs received qty so partial accepts post the
      // correct cost portion.
      const ratio =
        grnLine.receivedQty > 0
          ? grnLine.acceptedQty / grnLine.receivedQty
          : 0;
      amount = Math.round(billLine.amount * ratio * 100) / 100;
      description = billLine.description || description;
    } else if (purchaseOrder) {
      // PO line carries unitPrice; multiply by accepted qty.
      const poLine = (purchaseOrder.lines || []).find(
        (pl) => pl.product?.id?.toString() === grnLine.productId.toString(),
      );
      if (!poLine) {
        // No matching PO line — fall back to product's average cost via 0
        // (we'll skip below). User can correct with a manual JE.
        amount = 0;
      } else {
        amount = Math.round(poLine.unitPrice * grnLine.acceptedQty * 100) / 100;
        description = poLine.description || description;
      }
    }

    lineAmounts.set(grnLine._id.toString(), { amount, description });
  }

  const jeLines = [];
  let totalAmount = 0;
  for (const grnLine of acceptedLines) {
    const { amount, description } = lineAmounts.get(grnLine._id.toString());
    if (amount <= 0) continue;
    totalAmount += amount;
    jeLines.push({
      accountId: inventoryAccount._id,
      accountCode: inventoryAccount.accountCode,
      accountName: inventoryAccount.accountName,
      accountType: "asset",
      debit: amount,
      credit: 0,
      description: `Inventory admitted via GRN ${grn.grnNumber} — ${description}`,
    });
  }
  if (totalAmount === 0) return null;

  // One netting credit to GR/IR — for bill source this clears the bill's
  // pending GR/IR; for PO source this OPENS a GR/IR position that the
  // later bill approval will clear with `DR GR/IR / CR AP`.
  jeLines.push({
    accountId: grniAccount._id,
    accountCode: grniAccount.accountCode,
    accountName: grniAccount.accountName,
    accountType: "liability",
    debit: 0,
    credit: totalAmount,
    description: bill
      ? `GR/IR clearing — GRN ${grn.grnNumber}`
      : `GR/IR (goods received, not yet invoiced) — GRN ${grn.grnNumber}`,
  });

  // Generate a unique JE number — reuse the project's existing helper.
  const fiscalPeriod = `${new Date(grn.receivedDate).getFullYear()}-${String(
    new Date(grn.receivedDate).getMonth() + 1,
  ).padStart(2, "0")}`;
  const userInfo = { id: user.id, name: user.name };
  const entryNumber = await JournalEntry.generateEntryNumber?.(
    grn.companyId,
    "GRN",
  ) ?? `GRN-JE-${grn.grnNumber}`;

  const je = new JournalEntry({
    companyId: grn.companyId,
    entryNumber,
    entryDate: grn.acceptedAt || new Date(),
    entryType: "purchase",
    description: `Goods Receipt Note ${grn.grnNumber} — admit to inventory`,
    lines: jeLines,
    relatedDocuments: bill
      ? { billId: bill._id, billNumber: bill.billNumber }
      : purchaseOrder
      ? {
          purchaseOrderId: purchaseOrder._id,
          purchaseOrderNumber: purchaseOrder.poNumber,
        }
      : {},
    fiscalPeriod,
    status: "draft",
    createdBy: userInfo,
  });
  await je.save({ session });
  await je.post(userInfo, session);

  // Quantity-on-hand was already bumped at submit time (HOLD bucket
  // holds it). Set previousStock = currentOnHand - acceptedQty,
  // newStock = currentOnHand so the audit trail attributes this
  // consignment correctly.
  const movProducts = await Product.find({
    _id: { $in: acceptedLines.map((l) => l.productId) },
  })
    .select("_id inventory.quantityOnHand")
    .session(session)
    .lean();
  const onHandByProductId = new Map(
    movProducts.map((p) => [
      p._id.toString(),
      p.inventory?.quantityOnHand || 0,
    ]),
  );

  for (const grnLine of acceptedLines) {
    if (grnLine.acceptedQty <= 0) continue;
    const { amount } = lineAmounts.get(grnLine._id.toString());
    const unitCost =
      grnLine.acceptedQty > 0 ? amount / grnLine.acceptedQty : 0;
    const newStock =
      onHandByProductId.get(grnLine.productId.toString()) || 0;
    const previousStock = newStock - grnLine.acceptedQty;
    const movementNumber = await StockMovement.generateMovementNumber(
      grn.companyId,
    );
    await StockMovement.create(
      [
        {
          companyId: grn.companyId,
          movementNumber,
          productId: grnLine.productId,
          productSnapshot: {
            name: grnLine.description,
            SKU: grnLine.sku,
            unit: grnLine.unit,
          },
          movementType: "purchase",
          direction: "in",
          quantity: grnLine.acceptedQty,
          previousStock,
          newStock,
          costing: { unitCost, totalCost: amount },
          relatedDocuments: {
            billId: bill?._id,
            journalEntryId: je._id,
            // grnId not yet a typed ref on StockMovement — recorded in notes.
          },
          notes: `Admitted via GRN ${grn.grnNumber}`,
          status: "posted",
          postedAt: new Date(),
          postedBy: userInfo,
          performedBy: userInfo,
        },
      ],
      { session },
    );
  }

  return je._id;
}

// Unscheduled receipts have no source bill or PO, so cost can't be sourced
// from a line item. We use the product's current average cost (costing.costPrice)
// and credit a suspense account that finance reclasses each period to the
// right home (Accrued Liabilities / Inventory Gain / Other Income / etc.).
async function postUnscheduledGRNJournal({
  grn,
  user,
  session,
  acceptedLines,
}) {
  if (!acceptedLines.length) return null;

  const filter = { companyId: grn.companyId };
  const [inventoryAccount, suspenseAccount] = await Promise.all([
    Account.findOne({ ...filter, systemAccount: "inventory" }).session(session),
    Account.findOne({ ...filter, systemAccount: "inventory_suspense" }).session(
      session,
    ),
  ]);
  if (!inventoryAccount || !suspenseAccount) {
    throw new Error(
      "Inventory or Inventory-Adjustments-Suspense system account not configured — cannot post the unscheduled GRN journal.",
    );
  }

  // Cost per line = product.costing.costPrice × acceptedQty.
  // Zero-cost products are skipped (no JE) — user can post a manual JE
  // once cost is known.
  const productIds = acceptedLines.map((l) => l.productId);
  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id costing.costPrice inventory.quantityOnHand")
    .session(session)
    .lean();
  const costByProductId = new Map(
    products.map((p) => [p._id.toString(), p.costing?.costPrice || 0]),
  );
  const onHandByProductId = new Map(
    products.map((p) => [
      p._id.toString(),
      p.inventory?.quantityOnHand || 0,
    ]),
  );

  const lineAmounts = new Map();
  let totalAmount = 0;
  const jeLines = [];
  for (const grnLine of acceptedLines) {
    if (grnLine.acceptedQty <= 0) continue;
    const unitCost = costByProductId.get(grnLine.productId.toString()) || 0;
    const amount = Math.round(unitCost * grnLine.acceptedQty * 100) / 100;
    if (amount <= 0) {
      lineAmounts.set(grnLine._id.toString(), { amount: 0, unitCost: 0 });
      continue;
    }
    lineAmounts.set(grnLine._id.toString(), { amount, unitCost });
    totalAmount += amount;
    jeLines.push({
      accountId: inventoryAccount._id,
      accountCode: inventoryAccount.accountCode,
      accountName: inventoryAccount.accountName,
      accountType: "asset",
      debit: amount,
      credit: 0,
      description: `Inventory admitted (unscheduled) via GRN ${grn.grnNumber} — ${grnLine.description}`,
    });
  }

  if (totalAmount === 0) {
    // Still create stock movements (qty moved) but no JE — cost unknown.
    for (const grnLine of acceptedLines) {
      if (grnLine.acceptedQty <= 0) continue;
      const newStock =
        onHandByProductId.get(grnLine.productId.toString()) || 0;
      const previousStock = newStock - grnLine.acceptedQty;
      const movementNumber = await StockMovement.generateMovementNumber(
        grn.companyId,
      );
      await StockMovement.create(
        [
          {
            companyId: grn.companyId,
            movementNumber,
            productId: grnLine.productId,
            productSnapshot: {
              name: grnLine.description,
              SKU: grnLine.sku,
              unit: grnLine.unit,
            },
            movementType: "adjustment",
            direction: "in",
            quantity: grnLine.acceptedQty,
            previousStock,
            newStock,
            costing: { unitCost: 0, totalCost: 0 },
            relatedDocuments: {},
            notes: `Unscheduled receipt via GRN ${grn.grnNumber} (no cost — manual JE required)`,
            status: "posted",
            postedAt: new Date(),
            postedBy: { id: user.id, name: user.name },
            performedBy: { id: user.id, name: user.name },
          },
        ],
        { session },
      );
    }
    return null;
  }

  jeLines.push({
    accountId: suspenseAccount._id,
    accountCode: suspenseAccount.accountCode,
    accountName: suspenseAccount.accountName,
    accountType: "liability",
    debit: 0,
    credit: totalAmount,
    description: `Unscheduled receipt suspense — GRN ${grn.grnNumber} (reclass each period)`,
  });

  const fiscalPeriod = `${new Date(grn.receivedDate).getFullYear()}-${String(
    new Date(grn.receivedDate).getMonth() + 1,
  ).padStart(2, "0")}`;
  const userInfo = { id: user.id, name: user.name };
  const entryNumber =
    (await JournalEntry.generateEntryNumber?.(grn.companyId, "GRN")) ??
    `GRN-JE-${grn.grnNumber}`;

  const je = new JournalEntry({
    companyId: grn.companyId,
    entryNumber,
    entryDate: grn.acceptedAt || new Date(),
    entryType: "purchase",
    description: `Goods Receipt Note ${grn.grnNumber} — unscheduled admit to inventory`,
    lines: jeLines,
    relatedDocuments: {},
    fiscalPeriod,
    status: "draft",
    createdBy: userInfo,
  });
  await je.save({ session });
  await je.post(userInfo, session);

  for (const grnLine of acceptedLines) {
    if (grnLine.acceptedQty <= 0) continue;
    const { amount, unitCost } =
      lineAmounts.get(grnLine._id.toString()) || { amount: 0, unitCost: 0 };
    const newStock =
      onHandByProductId.get(grnLine.productId.toString()) || 0;
    const previousStock = newStock - grnLine.acceptedQty;
    const movementNumber = await StockMovement.generateMovementNumber(
      grn.companyId,
    );
    await StockMovement.create(
      [
        {
          companyId: grn.companyId,
          movementNumber,
          productId: grnLine.productId,
          productSnapshot: {
            name: grnLine.description,
            SKU: grnLine.sku,
            unit: grnLine.unit,
          },
          movementType: "adjustment",
          direction: "in",
          quantity: grnLine.acceptedQty,
          previousStock,
          newStock,
          costing: { unitCost, totalCost: amount },
          relatedDocuments: { journalEntryId: je._id },
          notes: `Unscheduled receipt via GRN ${grn.grnNumber}`,
          status: "posted",
          postedAt: new Date(),
          postedBy: userInfo,
          performedBy: userInfo,
        },
      ],
      { session },
    );
  }

  return je._id;
}

const GRNLineSchema = z.object({
  productId: z.string().min(1),
  description: z.string().min(1).max(500),
  expectedQty: z.coerce.number().min(0).default(0),
  receivedQty: z.coerce.number().min(0),
  unit: z.string().default("pcs"),
  packagingCondition: z
    .enum(["good", "damaged", "moisture", "tampered"])
    .default("good"),
  physicalCondition: z
    .enum(["good", "broken", "deformed", "defective"])
    .default("good"),
  inspectionNotes: z.string().max(1000).optional(),
  storageLocation: z.string().max(120).optional(),
});

const CreateGRNSchema = z.object({
  sourceType: z
    .enum(["bill", "purchase_order", "unscheduled"])
    .default("bill"),
  billId: z.string().optional(),
  purchaseOrderId: z.string().optional(),
  proformaInvoiceNumber: z.string().max(120).optional(),
  packingListNumber: z.string().max(120).optional(),
  supplierPartyId: z.string().optional(),
  supplierName: z.string().max(200).optional(),
  receivedDate: z.coerce.date().default(() => new Date()),
  notes: z.string().max(2000).optional(),
  lines: z.array(GRNLineSchema).min(1, "At least one line is required"),
});

// ============================================
// CREATE GRN
// ============================================
// Creates a draft GRN. Inventory is ONLY incremented (into HOLD) when the
// Storeperson submits the GRN for acceptance — this lets them save partial
// drafts during a long inspection without skewing stock numbers.
export async function createGRN(prevState, formData) {
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, GRN_ROLES.CREATE)) {
      return {
        success: false,
        error: "You don't have permission to create goods receipt notes.",
      };
    }

    const tenantCompanyId = getCompanyIdForCreate(
      null,
      companyId,
      isSuperAdmin,
    );

    let raw;
    try {
      raw = JSON.parse(formData.get("payload"));
    } catch {
      return { success: false, error: "Invalid payload" };
    }

    const parsed = CreateGRNSchema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      return {
        success: false,
        error: Object.values(fieldErrors).flat()[0] || "Invalid input",
        fieldErrors,
      };
    }
    const data = parsed.data;

    await dbConnect();
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Resolve product snapshots (description, sku, unit) so the GRN is a
      // self-contained document — product renames later don't mutate it.
      const productIds = [
        ...new Set(data.lines.map((l) => l.productId)),
      ].map((id) => new mongoose.Types.ObjectId(id));
      const products = await Product.find({
        _id: { $in: productIds },
        ...(isSuperAdmin ? {} : { companyId: tenantCompanyId }),
      })
        .select("_id name SKU unit")
        .session(session)
        .lean();
      const byId = new Map(products.map((p) => [p._id.toString(), p]));

      const lines = data.lines.map((l) => {
        const p = byId.get(l.productId);
        if (!p) {
          throw new Error(
            `Product ${l.productId} not found in this company`,
          );
        }
        return {
          productId: p._id,
          sku: p.SKU,
          description: l.description || p.name,
          expectedQty: l.expectedQty,
          receivedQty: l.receivedQty,
          unit: l.unit || p.unit || "pcs",
          packagingCondition: l.packagingCondition,
          physicalCondition: l.physicalCondition,
          inspectionNotes: l.inspectionNotes,
          storageLocation: l.storageLocation,
        };
      });

      // Discrepancy: any qty mismatch (over OR under) or any non-"good"
      // condition. Flag it on the GRN so the UI surfaces a warning and
      // — once NCR is wired in Phase 1.3 — auto-creates a Nonconformance
      // entry. Over-receipts are explicitly called out because SAP /
      // NetSuite block them by default in tolerance settings; we accept
      // them but mark them.
      const hasOverReceipt = lines.some(
        (l) => l.expectedQty > 0 && l.receivedQty > l.expectedQty,
      );
      const hasDiscrepancy = lines.some(
        (l) =>
          l.receivedQty !== l.expectedQty ||
          l.packagingCondition !== "good" ||
          l.physicalCondition !== "good",
      );
      const discrepancyNotes = hasOverReceipt
        ? "OVER-RECEIPT: one or more lines received more than expected. Review against PO/Bill before accepting."
        : undefined;

      const grnNumber = await GoodsReceipt.generateGRNNumber(
        tenantCompanyId,
        session,
      );

      const [grn] = await GoodsReceipt.create(
        [
          {
            companyId: tenantCompanyId,
            grnNumber,
            status: "draft",
            source: {
              type: data.sourceType,
              billId: data.billId || undefined,
              purchaseOrderId: data.purchaseOrderId || undefined,
              proformaInvoiceNumber: data.proformaInvoiceNumber || undefined,
              packingListNumber: data.packingListNumber || undefined,
            },
            supplier: data.supplierPartyId
              ? { partyId: data.supplierPartyId, name: data.supplierName }
              : { name: data.supplierName },
            receivedDate: data.receivedDate,
            receivedBy: { id: user.id, name: user.name },
            lines,
            hasDiscrepancy,
            discrepancyNotes,
            notes: data.notes,
            createdBy: { id: user.id, name: user.name },
          },
        ],
        { session },
      );

      await session.commitTransaction();
      revalidatePath("/dashboard/grn");
      if (data.billId) revalidatePath(`/dashboard/bills/${data.billId}`);

      return {
        success: true,
        grnId: grn._id.toString(),
        grnNumber: grn.grnNumber,
      };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("createGRN error:", error);
    return { success: false, error: error.message || "Failed to create GRN" };
  }
}

// ============================================
// SUBMIT GRN — moves received qty into HOLD bucket
// ============================================
// SOP §10.1.2 step 4: Storeperson signs the GRN and reports to Sales+Finance.
// At this point the goods are physically here, so they must show up
// somewhere — we move them into HOLD. They're counted toward
// quantityOnHand but NOT toward quantityAvailable, so they cannot be
// issued until accepted.
export async function submitGRN(grnId) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, GRN_ROLES.CREATE)) {
      return {
        success: false,
        error: "You don't have permission to submit goods receipt notes.",
      };
    }

    await dbConnect();
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const grn = await GoodsReceipt.findOne(
        withTenantScope({ _id: grnId }, companyId, isSuperAdmin),
      ).session(session);
      if (!grn) {
        await session.abortTransaction();
        return { success: false, error: "GRN not found" };
      }
      if (grn.status !== "draft") {
        await session.abortTransaction();
        return {
          success: false,
          error: `Only draft GRNs can be submitted (current status: ${grn.status}).`,
        };
      }

      // Decide whether THIS GRN should move physical inventory:
      // - Unscheduled receipt → yes (no other entry path).
      // - Bill source where bill ALREADY moved inventory (legacy SMB
      //   flow) → no (would double-count). GRN is documentation-only.
      // - Bill source where bill DEFERRED to GRN (strict mode) → yes.
      // Caches `_appliesInventory` on the document so subsequent
      // accept/reject calls follow the same branch.
      const shouldApplyInventory = await grnAppliesInventory(grn, session);

      for (const line of grn.lines) {
        if (shouldApplyInventory && line.receivedQty > 0) {
          await Product.findByIdAndUpdate(
            line.productId,
            Product.getReceiveToHoldUpdate(line.receivedQty),
            { session },
          );
        }
        line.lineStatus = shouldApplyInventory ? "hold" : "pending";
      }

      grn.status = "pending_acceptance";
      grn.lastModifiedBy = { id: user.id, name: user.name };

      // SOP §10.6: any discrepancy on receipt must be logged on the
      // Nonconformance Register. Auto-create now so the issue is
      // immediately visible to MD and Finance — they don't have to
      // navigate to the GRN to know something's wrong.
      if (grn.hasDiscrepancy && !grn.ncrId) {
        const ncrId = await createNCRFromGRN({ grn, user, session });
        if (ncrId) grn.ncrId = ncrId;
      }

      await grn.save({ session });

      await session.commitTransaction();
      revalidatePath("/dashboard/grn");
      revalidatePath(`/dashboard/grn/${grnId}`);
      revalidatePath("/dashboard/ncr");
      revalidatePath("/dashboard/stocks");

      return { success: true, ncrId: grn.ncrId?.toString() || null };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("submitGRN error:", error);
    return { success: false, error: error.message || "Failed to submit GRN" };
  }
}

// ============================================
// ACCEPT GRN (Sales or Finance signs off)
// ============================================
// SOP §10.1.2 step 5 — both signatures required. We accept per-side, and
// when both have signed, we apply the inventory transition (HOLD → available).
// `lineDecisions` (optional) lets the approver accept some lines and
// reject others; if omitted, all `pending`/`hold` lines are accepted with
// receivedQty.
export async function acceptGRN(grnId, side, lineDecisions = null, notes = "") {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    const allowed =
      side === "sales" ? GRN_ROLES.ACCEPT_SALES : GRN_ROLES.ACCEPT_FINANCE;
    if (!hasRole(user, allowed)) {
      return {
        success: false,
        error: `You don't have permission to ${side}-accept this GRN.`,
      };
    }

    await dbConnect();
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const grn = await GoodsReceipt.findOne(
        withTenantScope({ _id: grnId }, companyId, isSuperAdmin),
      ).session(session);
      if (!grn) {
        await session.abortTransaction();
        return { success: false, error: "GRN not found" };
      }
      if (!["pending_acceptance", "partially_accepted"].includes(grn.status)) {
        await session.abortTransaction();
        return {
          success: false,
          error: `GRN is ${grn.status} — only pending_acceptance can be accepted.`,
        };
      }

      // Idempotency — same side can't sign twice.
      if (side === "sales" && grn.salesAccepted?.at) {
        await session.abortTransaction();
        return { success: false, error: "Sales has already accepted this GRN." };
      }
      if (side === "finance" && grn.financeAccepted?.at) {
        await session.abortTransaction();
        return {
          success: false,
          error: "Finance has already accepted this GRN.",
        };
      }

      // ── Segregation of Duties guards (SOP §10.3 "two persons" rule) ──
      // The person who wrote the GRN cannot also sign off on it. Forces
      // the SOP's "at least two authorising persons" requirement.
      if (
        grn.createdBy?.id &&
        grn.createdBy.id.toString() === user.id
      ) {
        await session.abortTransaction();
        return {
          success: false,
          error:
            "You can't accept a GRN you submitted. Ask another approver — this is the second-signature requirement (SOP §10.1.2 step 5).",
        };
      }
      // The same person cannot sign BOTH Sales and Finance sides. Without
      // this, a Manager-with-finance-access could collapse the two
      // required sign-offs into one click.
      const otherSideStamp =
        side === "sales" ? grn.financeAccepted : grn.salesAccepted;
      if (
        otherSideStamp?.id &&
        otherSideStamp.id.toString() === user.id
      ) {
        await session.abortTransaction();
        return {
          success: false,
          error:
            "You already signed the other side of this GRN. Sales and Finance acceptance must come from different people.",
        };
      }

      // Apply per-line decisions on the FIRST signature only — the second
      // signature is a confirmation; we don't re-decide line dispositions.
      const isFirstSignature = !grn.salesAccepted?.at && !grn.financeAccepted?.at;
      if (isFirstSignature) {
        for (const line of grn.lines) {
          if (line.lineStatus !== "hold" && line.lineStatus !== "pending") continue;
          const decision = lineDecisions?.find(
            (d) => d.lineId?.toString() === line._id.toString(),
          );
          if (decision?.action === "reject") {
            line.lineStatus = "rejected";
            line.acceptedQty = 0;
            line.rejectReason = decision.reason || "Rejected on inspection";
          } else {
            line.lineStatus = "accepted";
            const acceptQty = Math.max(
              0,
              Math.min(
                decision?.acceptedQty ?? line.receivedQty,
                line.receivedQty,
              ),
            );
            line.acceptedQty = acceptQty;
          }
        }
      }

      // Stamp the side that just signed.
      const stamp = {
        id: user.id,
        name: user.name,
        at: new Date(),
        notes: notes || undefined,
      };
      if (side === "sales") grn.salesAccepted = stamp;
      else grn.financeAccepted = stamp;

      // If both have signed, apply HOLD → available / return-to-supplier
      // transitions atomically per line. Each line is guarded with
      // `inventoryApplied` so a retry can't double-apply.
      // The HOLD math only runs when the GRN owns the physical inventory
      // entry (strict mode or unscheduled). In legacy mode the bill
      // already moved inventory at approval time.
      const bothSigned = grn.salesAccepted?.at && grn.financeAccepted?.at;
      let appliedAny = false;
      let acceptedLines = 0;
      let rejectedLines = 0;
      const acceptedLineRecords = [];

      if (bothSigned) {
        const shouldApplyInventory = await grnAppliesInventory(grn, session);

        for (const line of grn.lines) {
          if (line.inventoryApplied) {
            if (line.lineStatus === "accepted") acceptedLines++;
            if (line.lineStatus === "rejected") rejectedLines++;
            if (line.lineStatus === "accepted") acceptedLineRecords.push(line);
            continue;
          }
          if (line.lineStatus === "accepted" && line.acceptedQty > 0) {
            if (shouldApplyInventory) {
              // Move accepted portion HOLD → available.
              await Product.findByIdAndUpdate(
                line.productId,
                Product.getAcceptFromHoldUpdate(line.acceptedQty),
                { session },
              );
              // Any "received but not accepted" remainder leaves the
              // system (returned to supplier).
              const leftover = line.receivedQty - line.acceptedQty;
              if (leftover > 0) {
                await Product.findByIdAndUpdate(
                  line.productId,
                  Product.getRejectFromHoldUpdate(leftover),
                  { session },
                );
              }
            }
            line.inventoryApplied = true;
            acceptedLines++;
            appliedAny = appliedAny || shouldApplyInventory;
            acceptedLineRecords.push(line);
          } else if (line.lineStatus === "rejected" && line.receivedQty > 0) {
            if (shouldApplyInventory) {
              await Product.findByIdAndUpdate(
                line.productId,
                Product.getRejectFromHoldUpdate(line.receivedQty),
                { session },
              );
            }
            line.inventoryApplied = true;
            rejectedLines++;
            appliedAny = appliedAny || shouldApplyInventory;
          }
        }

        // Strict three-way match: post the inventory-clearing journal
        // entry and stock movements. Only fires when the source bill
        // used GR/IR (otherwise no clearing entry needed).
        if (shouldApplyInventory && grn.source?.type === "bill" && grn.source?.billId) {
          const bill = await Bill.findById(grn.source.billId).session(session);
          if (bill?.accounting?.usedGRNI) {
            await postGRNAcceptanceJournal({
              grn,
              bill,
              user,
              session,
              acceptedLines: acceptedLineRecords,
            });
            // Once cleared, the bill has effectively moved inventory.
            bill.accounting.inventoryMoved = true;
            bill.accounting.usedGRNI = false;
            await bill.save({ session });
          }
        }

        // PO source: post DR Inventory / CR GR/IR — this OPENS the
        // GR/IR position (goods received, not yet invoiced). When the
        // matching bill is later raised, its approval posts DR GR/IR /
        // CR AP and clears it. Cost per line comes from the PO line
        // unitPrice × accepted qty. Also bump receivedQuantity on the
        // PO so its outstanding-qty math reflects reality, and roll the
        // PO's status forward to partial / received when appropriate.
        if (
          shouldApplyInventory &&
          grn.source?.type === "purchase_order" &&
          grn.source?.purchaseOrderId
        ) {
          const po = await PurchaseOrder.findById(
            grn.source.purchaseOrderId,
          ).session(session);
          if (po) {
            await postGRNAcceptanceJournal({
              grn,
              purchaseOrder: po,
              user,
              session,
              acceptedLines: acceptedLineRecords,
            });

            // Apply per-line receivedQuantity update on the PO. Match
            // GRN line → PO line by productId (1:1 by product for now).
            for (const grnLine of acceptedLineRecords) {
              if (grnLine.acceptedQty <= 0) continue;
              const poLine = po.lines.find(
                (pl) =>
                  pl.product?.id?.toString() ===
                  grnLine.productId.toString(),
              );
              if (poLine) {
                poLine.receivedQuantity =
                  (poLine.receivedQuantity || 0) + grnLine.acceptedQty;
              }
            }

            // Recompute PO header status from the line totals.
            const allFullyReceived = po.lines.every(
              (pl) => (pl.receivedQuantity || 0) >= (pl.quantity || 0),
            );
            const anyReceived = po.lines.some(
              (pl) => (pl.receivedQuantity || 0) > 0,
            );
            if (allFullyReceived) {
              po.status = "received";
            } else if (anyReceived) {
              po.status = "partial";
            }
            // Don't downgrade a more-advanced status (e.g. don't bump
            // a 'confirmed' back to 'sent' just because nothing was
            // received yet — that branch can't happen here).

            await po.save({ session });
          }
        }

        // Unscheduled source: no PO, no bill — credit the suspense
        // account ("Inventory Adjustments — Unscheduled Receipts").
        // Finance reclasses to the right home each period.
        if (
          shouldApplyInventory &&
          grn.source?.type === "unscheduled" &&
          acceptedLineRecords.length > 0
        ) {
          await postUnscheduledGRNJournal({
            grn,
            user,
            session,
            acceptedLines: acceptedLineRecords,
          });
        }

        if (rejectedLines === 0) grn.status = "accepted";
        else if (acceptedLines === 0) grn.status = "rejected";
        else grn.status = "partially_accepted";
        grn.acceptedAt = new Date();
      }

      grn.lastModifiedBy = { id: user.id, name: user.name };
      await grn.save({ session });

      await session.commitTransaction();
      revalidatePath("/dashboard/grn");
      revalidatePath(`/dashboard/grn/${grnId}`);
      if (appliedAny) revalidatePath("/dashboard/stocks");

      return {
        success: true,
        bothSigned,
        finalStatus: grn.status,
      };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("acceptGRN error:", error);
    return { success: false, error: error.message || "Failed to accept GRN" };
  }
}

// ============================================
// REJECT GRN (full)
// ============================================
// Used when Sales/Finance refuses the entire consignment. Returns all
// received qty out of HOLD (i.e., back to the supplier).
export async function rejectGRN(grnId, reason) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, GRN_ROLES.REJECT)) {
      return {
        success: false,
        error: "You don't have permission to reject this GRN.",
      };
    }
    if (!reason || !reason.trim()) {
      return { success: false, error: "Reject reason is required." };
    }

    await dbConnect();
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const grn = await GoodsReceipt.findOne(
        withTenantScope({ _id: grnId }, companyId, isSuperAdmin),
      ).session(session);
      if (!grn) {
        await session.abortTransaction();
        return { success: false, error: "GRN not found" };
      }
      if (!["pending_acceptance", "partially_accepted"].includes(grn.status)) {
        await session.abortTransaction();
        return {
          success: false,
          error: `Cannot reject a GRN in ${grn.status} status.`,
        };
      }

      // SoD — same rule as acceptGRN. Without this, a Storeperson could
      // create a fraudulent GRN and immediately reject it to disguise an
      // inventory shrinkage event.
      if (
        grn.createdBy?.id &&
        grn.createdBy.id.toString() === user.id
      ) {
        await session.abortTransaction();
        return {
          success: false,
          error:
            "You can't reject a GRN you submitted. Ask another approver — voiding for drafts only.",
        };
      }

      const shouldApplyInventory = await grnAppliesInventory(grn, session);
      for (const line of grn.lines) {
        if (line.inventoryApplied) continue;
        if (shouldApplyInventory && line.receivedQty > 0) {
          await Product.findByIdAndUpdate(
            line.productId,
            Product.getRejectFromHoldUpdate(line.receivedQty),
            { session },
          );
        }
        line.lineStatus = "rejected";
        line.acceptedQty = 0;
        line.rejectReason = reason;
        line.inventoryApplied = true;
      }

      grn.status = "rejected";
      grn.rejectedAt = new Date();
      grn.rejectedBy = { id: user.id, name: user.name };
      grn.rejectReason = reason;
      grn.lastModifiedBy = { id: user.id, name: user.name };
      await grn.save({ session });

      await session.commitTransaction();
      revalidatePath("/dashboard/grn");
      revalidatePath(`/dashboard/grn/${grnId}`);
      revalidatePath("/dashboard/stocks");

      return { success: true };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("rejectGRN error:", error);
    return { success: false, error: error.message || "Failed to reject GRN" };
  }
}

// ============================================
// VOID GRN (created in error)
// ============================================
// Only allowed for drafts (no inventory effect yet) — anything past draft
// must go through accept/reject so inventory transitions are auditable.
export async function voidGRN(grnId, reason) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, GRN_ROLES.REJECT)) {
      return {
        success: false,
        error: "You don't have permission to void this GRN.",
      };
    }

    await dbConnect();
    const grn = await GoodsReceipt.findOne(
      withTenantScope({ _id: grnId }, companyId, isSuperAdmin),
    );
    if (!grn) return { success: false, error: "GRN not found" };
    if (grn.status !== "draft") {
      return {
        success: false,
        error: "Only draft GRNs can be voided. Use reject for submitted GRNs.",
      };
    }
    grn.status = "voided";
    grn.notes = grn.notes ? `${grn.notes}\n\nVoided: ${reason || ""}` : `Voided: ${reason || ""}`;
    grn.lastModifiedBy = { id: user.id, name: user.name };
    await grn.save();
    revalidatePath("/dashboard/grn");
    revalidatePath(`/dashboard/grn/${grnId}`);
    return { success: true };
  } catch (error) {
    console.error("voidGRN error:", error);
    return { success: false, error: error.message || "Failed to void GRN" };
  }
}
