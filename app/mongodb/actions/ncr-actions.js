"use server";

import { revalidatePath } from "next/cache";
import { roleAllowed } from "@/lib/permissions";
import mongoose from "mongoose";

import Nonconformance from "@/app/models/nonconformance";
import GoodsReceipt from "@/app/models/goodsReceipt";
import Product from "@/app/models/product";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";

// ============================================
// NONCONFORMANCE — SERVER ACTIONS (SOP §10.6)
// ============================================

const NCR_ROLES = {
  // Anyone in Stores can raise an NCR — the SOP wants discrepancies
  // logged immediately upon discovery.
  CREATE: [
    "SuperAdmin",
    "Admin",
    "Manager",
    "Store Manager",
    "Storekeeper",
    "Procurement Officer",
    "CFO",
    "Finance Manager",
    "Accountant",
  ],
  // Propose a disposition (return/repair/downgrade/scrap). Wider than
  // authorize because the proposer just makes a recommendation.
  PROPOSE: [
    "SuperAdmin",
    "Admin",
    "Manager",
    "Store Manager",
    "CFO",
    "Finance Manager",
  ],
  // Authorize the disposition — SOP §10.6: "All decisions shall be
  // authorized by the Managing Director and recorded in the NCR
  // Register". MD-equivalent = SuperAdmin/Admin/CFO.
  AUTHORIZE: ["SuperAdmin", "Admin", "CFO"],
};

function hasRole(user, allowedRoles) {
  return roleAllowed(user?.role, allowedRoles);
}

// ============================================
// AUTO-CREATE FROM GRN
// ============================================
// Called by the GRN submit/accept flow when discrepancies are detected.
// Idempotent — if a GRN already has an NCR linked, returns the existing
// one. Caller passes the same Mongoose session so the NCR is part of
// the GRN transaction.
export async function createNCRFromGRN({ grn, user, session }) {
  if (!grn || !grn.hasDiscrepancy) return null;

  // Idempotency: only one NCR per source GRN.
  const existing = await Nonconformance.findOne(
    { companyId: grn.companyId, "source.grnId": grn._id },
    null,
    session ? { session } : {},
  ).lean();
  if (existing) return existing._id;

  const ncrNumber = await Nonconformance.generateNCRNumber(
    grn.companyId,
    session,
  );

  // Build per-line NCR entries for lines that actually have a problem.
  // Pure inspection-good lines don't go on the NCR.
  const ncrLines = (grn.lines || [])
    .filter(
      (l) =>
        l.receivedQty !== l.expectedQty ||
        l.packagingCondition !== "good" ||
        l.physicalCondition !== "good",
    )
    .map((l) => {
      const variance = l.receivedQty - l.expectedQty;
      // Severity heuristic: critical for damaged-on-receipt, major for
      // significant qty miss, otherwise minor. Auditors can re-grade
      // when they review the NCR.
      let severity = "minor";
      if (
        l.physicalCondition === "broken" ||
        l.physicalCondition === "defective" ||
        l.packagingCondition === "tampered"
      ) {
        severity = "critical";
      } else if (l.expectedQty > 0 && Math.abs(variance) / l.expectedQty >= 0.1) {
        severity = "major";
      }
      const notesParts = [];
      if (variance !== 0) {
        notesParts.push(
          variance > 0
            ? `OVER-RECEIPT: +${variance} ${l.unit || ""}`
            : `SHORT: ${variance} ${l.unit || ""}`,
        );
      }
      if (l.packagingCondition !== "good") {
        notesParts.push(`packaging: ${l.packagingCondition}`);
      }
      if (l.physicalCondition !== "good") {
        notesParts.push(`physical: ${l.physicalCondition}`);
      }
      if (l.inspectionNotes) notesParts.push(`"${l.inspectionNotes}"`);
      return {
        productId: l.productId,
        sku: l.sku,
        description: l.description,
        expectedQty: l.expectedQty,
        actualQty: l.receivedQty,
        variance,
        unit: l.unit,
        severity,
        notes: notesParts.join(" · "),
      };
    });

  const anyDamage = ncrLines.some((l) =>
    /damag|broken|defect|tampered/.test(l.notes || ""),
  );
  const category = anyDamage ? "received_damaged" : "received_qty_variance";

  const [ncr] = await Nonconformance.create(
    [
      {
        companyId: grn.companyId,
        ncrNumber,
        category,
        status: "open",
        source: {
          type: "goods_receipt",
          grnId: grn._id,
          reference: grn.grnNumber,
        },
        supplier: grn.supplier
          ? { partyId: grn.supplier.partyId, name: grn.supplier.name }
          : undefined,
        title: `Receiving nonconformance on ${grn.grnNumber}`,
        description: grn.discrepancyNotes
          ? grn.discrepancyNotes
          : `Discrepancies detected during inspection of ${grn.grnNumber}. See line details and resolve disposition.`,
        lines: ncrLines,
        createdBy: { id: user?.id || "system", name: user?.name || "System" },
      },
    ],
    session ? { session } : {},
  );
  return ncr._id;
}

// ============================================
// MANUAL CREATE
// ============================================
export async function createNCRManually(prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!hasRole(user, NCR_ROLES.CREATE)) {
      return { success: false, error: "You don't have permission to raise NCRs." };
    }
    void isSuperAdmin;

    const title = formData.get("title")?.toString().trim();
    const description = formData.get("description")?.toString().trim();
    const category = formData.get("category")?.toString();
    if (!title || !description || !category) {
      return { success: false, error: "Title, description, and category are required." };
    }

    await dbConnect();
    const ncrNumber = await Nonconformance.generateNCRNumber(companyId);
    const ncr = await Nonconformance.create({
      companyId,
      ncrNumber,
      category,
      status: "open",
      source: { type: "manual" },
      title,
      description,
      createdBy: { id: user.id, name: user.name },
    });

    revalidatePath("/dashboard/ncr");
    return { success: true, ncrId: ncr._id.toString(), ncrNumber };
  } catch (error) {
    console.error("createNCRManually error:", error);
    return { success: false, error: error.message || "Failed to create NCR" };
  }
}

// ============================================
// PROPOSE DISPOSITION
// ============================================
export async function proposeDisposition(ncrId, dispositionType, reason) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!hasRole(user, NCR_ROLES.PROPOSE)) {
      return { success: false, error: "You don't have permission to propose a disposition." };
    }
    if (
      !["return_to_supplier", "repair", "downgrade", "scrap", "accept_as_is"].includes(
        dispositionType,
      )
    ) {
      return { success: false, error: "Invalid disposition type." };
    }
    if (!reason || !reason.trim()) {
      return { success: false, error: "Reason is required." };
    }

    await dbConnect();
    const ncr = await Nonconformance.findOne(
      withTenantScope({ _id: ncrId }, companyId, isSuperAdmin),
    );
    if (!ncr) return { success: false, error: "NCR not found" };
    if (ncr.status !== "open" && ncr.status !== "disposition_proposed") {
      return {
        success: false,
        error: `Cannot propose disposition in ${ncr.status} status.`,
      };
    }
    if (
      ncr.disposition?.proposedBy?.id &&
      ncr.disposition.proposedBy.id.toString() === user.id &&
      ncr.disposition.type !== "pending"
    ) {
      // Allow re-proposal if the user owns this NCR; otherwise SoD check below.
    }

    // SoD: proposer cannot be the same as the NCR creator (otherwise a
    // single person can self-resolve).
    if (
      ncr.createdBy?.id &&
      ncr.createdBy.id.toString() === user.id
    ) {
      return {
        success: false,
        error:
          "You can't propose a disposition for an NCR you raised. Ask a colleague to review.",
      };
    }

    ncr.disposition = {
      type: dispositionType,
      reason,
      proposedBy: { id: user.id, name: user.name, at: new Date() },
    };
    ncr.status = "disposition_proposed";
    ncr.lastModifiedBy = { id: user.id, name: user.name };
    await ncr.save();

    revalidatePath("/dashboard/ncr");
    revalidatePath(`/dashboard/ncr/${ncrId}`);
    return { success: true };
  } catch (error) {
    console.error("proposeDisposition error:", error);
    return { success: false, error: error.message || "Failed to propose disposition" };
  }
}

// ============================================
// AUTHORIZE DISPOSITION (MD)
// ============================================
export async function authorizeDisposition(ncrId, notes = "") {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!hasRole(user, NCR_ROLES.AUTHORIZE)) {
      return {
        success: false,
        error: "Only the Managing Director (Admin / CFO) can authorize NCR dispositions.",
      };
    }

    await dbConnect();
    const ncr = await Nonconformance.findOne(
      withTenantScope({ _id: ncrId }, companyId, isSuperAdmin),
    );
    if (!ncr) return { success: false, error: "NCR not found" };
    if (ncr.status !== "disposition_proposed") {
      return {
        success: false,
        error: "Only proposed dispositions can be authorized.",
      };
    }
    // SoD: authorizer cannot be the proposer.
    if (
      ncr.disposition?.proposedBy?.id &&
      ncr.disposition.proposedBy.id.toString() === user.id
    ) {
      return {
        success: false,
        error:
          "You proposed this disposition — ask another authority to authorize it.",
      };
    }

    ncr.disposition.authorizedBy = {
      id: user.id,
      name: user.name,
      at: new Date(),
      notes,
    };
    ncr.status = "authorized";
    ncr.lastModifiedBy = { id: user.id, name: user.name };
    await ncr.save();

    revalidatePath("/dashboard/ncr");
    revalidatePath(`/dashboard/ncr/${ncrId}`);
    return { success: true };
  } catch (error) {
    console.error("authorizeDisposition error:", error);
    return { success: false, error: error.message || "Failed to authorize disposition" };
  }
}

// ============================================
// CLOSE NCR (after execution)
// ============================================
// When a GRN-sourced NCR is closed, items the GRN parked on HOLD must
// physically leave HOLD according to the disposition. Without this they
// sit in `inventory.quantityOnHold` forever (a real data integrity bug
// pre-fix). The per-line `inventoryApplied` flag on the GRN makes this
// idempotent with the GRN.accept path — whichever side runs first wins,
// the other no-ops on those lines.
//
// Disposition → inventory move:
//   return_to_supplier / scrap   → getRejectFromHoldUpdate (items leave)
//   accept_as_is   / downgrade   → getAcceptFromHoldUpdate (HOLD → available)
//   repair                       → no-op (stays on HOLD until repair workflow completes)
//
// NOTE: journal-entry posting for return/scrap (supplier debit-note /
// write-off) is intentionally out of scope here — separate ledger work.
function inventoryActionForDisposition(dispositionType) {
  switch (dispositionType) {
    case "return_to_supplier":
    case "scrap":
      return "reject";
    case "accept_as_is":
    case "downgrade":
      return "accept";
    case "repair":
    default:
      return "none";
  }
}

export async function closeNCR(ncrId, executionNotes = "") {
  const sessionRoot = await mongoose.startSession();
  sessionRoot.startTransaction();
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!hasRole(user, NCR_ROLES.PROPOSE)) {
      await sessionRoot.abortTransaction();
      return { success: false, error: "You don't have permission to close NCRs." };
    }

    await dbConnect();
    const ncr = await Nonconformance.findOne(
      withTenantScope({ _id: ncrId }, companyId, isSuperAdmin),
    ).session(sessionRoot);
    if (!ncr) {
      await sessionRoot.abortTransaction();
      return { success: false, error: "NCR not found" };
    }
    if (ncr.status !== "authorized") {
      await sessionRoot.abortTransaction();
      return {
        success: false,
        error: "NCR must be authorized before it can be closed.",
      };
    }

    // Release HOLD inventory per disposition (GRN-sourced NCRs only).
    const action = inventoryActionForDisposition(ncr.disposition?.type);
    if (action !== "none" && ncr.source?.type === "goods_receipt" && ncr.source.grnId) {
      const grn = await GoodsReceipt.findOne({
        _id: ncr.source.grnId,
        companyId: ncr.companyId,
      }).session(sessionRoot);

      if (grn?.lines?.length) {
        // Map productId → NCR line (which carries actualQty == GRN receivedQty
        // for the discrepant lines this NCR covers).
        const ncrByProduct = new Map();
        for (const nl of ncr.lines || []) {
          if (nl.productId) {
            ncrByProduct.set(nl.productId.toString(), nl);
          }
        }

        let grnDirty = false;
        for (const gline of grn.lines) {
          if (gline.inventoryApplied) continue;
          if (gline.lineStatus !== "hold") continue;
          const nl = gline.productId
            ? ncrByProduct.get(gline.productId.toString())
            : null;
          if (!nl) continue; // GRN line wasn't on the NCR — leave for acceptGRN

          const qty = gline.receivedQty || 0;
          if (qty <= 0) continue;

          if (action === "accept") {
            await Product.findByIdAndUpdate(
              gline.productId,
              Product.getAcceptFromHoldUpdate(qty),
              { session: sessionRoot },
            );
            gline.lineStatus = "accepted";
            gline.acceptedQty = qty;
          } else {
            // reject path: items leave the system
            await Product.findByIdAndUpdate(
              gline.productId,
              Product.getRejectFromHoldUpdate(qty),
              { session: sessionRoot },
            );
            gline.lineStatus = "rejected";
            gline.rejectReason =
              ncr.disposition?.type === "scrap"
                ? "Scrapped via NCR"
                : "Returned to supplier via NCR";
          }
          gline.inventoryApplied = true;
          grnDirty = true;
        }

        if (grnDirty) {
          await grn.save({ session: sessionRoot });
        }
      }
    }

    ncr.disposition.executedAt = new Date();
    ncr.disposition.executedBy = { id: user.id, name: user.name };
    ncr.disposition.executionNotes = executionNotes;
    ncr.status = "closed";
    ncr.lastModifiedBy = { id: user.id, name: user.name };
    await ncr.save({ session: sessionRoot });

    await sessionRoot.commitTransaction();

    revalidatePath("/dashboard/ncr");
    revalidatePath(`/dashboard/ncr/${ncrId}`);
    if (action !== "none") {
      revalidatePath("/dashboard/stocks");
      if (ncr.source?.grnId) {
        revalidatePath(`/dashboard/grn/${ncr.source.grnId}`);
      }
    }
    return { success: true };
  } catch (error) {
    if (sessionRoot.inTransaction()) await sessionRoot.abortTransaction();
    console.error("closeNCR error:", error);
    return { success: false, error: error.message || "Failed to close NCR" };
  } finally {
    sessionRoot.endSession();
  }
}

// ============================================
// CANCEL NCR (raised in error)
// ============================================
export async function cancelNCR(ncrId, reason) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!hasRole(user, NCR_ROLES.AUTHORIZE)) {
      return {
        success: false,
        error: "Only senior authority can cancel an NCR.",
      };
    }
    if (!reason || !reason.trim()) {
      return { success: false, error: "Cancellation reason is required." };
    }

    await dbConnect();
    const ncr = await Nonconformance.findOne(
      withTenantScope({ _id: ncrId }, companyId, isSuperAdmin),
    );
    if (!ncr) return { success: false, error: "NCR not found" };
    if (ncr.status === "closed" || ncr.status === "cancelled") {
      return { success: false, error: `NCR is already ${ncr.status}.` };
    }

    ncr.status = "cancelled";
    ncr.disposition.executionNotes = `Cancelled: ${reason}`;
    ncr.lastModifiedBy = { id: user.id, name: user.name };
    await ncr.save();

    revalidatePath("/dashboard/ncr");
    revalidatePath(`/dashboard/ncr/${ncrId}`);
    return { success: true };
  } catch (error) {
    console.error("cancelNCR error:", error);
    return { success: false, error: error.message || "Failed to cancel NCR" };
  }
}
