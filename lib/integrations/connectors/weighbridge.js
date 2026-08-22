import { BaseConnector } from "./base.js";
// The valid transaction types come from the POSTGRES enum, which is what the
// column is actually constrained by. Reading them off the Mongo model meant
// the connector could accept a value the database would then refuse.
import { wbTransactionTypeEnum } from "@/app/db/schema/enums";

const WB_TRANSACTION_TYPES = wbTransactionTypeEnum.enumValues;
import { withTenant } from "@/app/db/client";
import { findPurchaseOrderByNumber } from "@/app/db/repositories/purchaseOrders";
import {
  openWeighbridgeTicket,
  recordWeighing,
  getWeighbridgeTicketByExternalRef,
  completeWeighbridgeTicket,
} from "@/app/db/repositories/fulfilment";
import { recordMovement } from "@/app/db/repositories/stockMovements";
import {
  findProductByCodeOrName,
  receiveStock,
  issueStock,
} from "@/app/db/repositories/products";
import { createJournalEntry } from "@/app/db/repositories/journal";
import { getSystemAccount } from "@/app/db/repositories/accounts";
import { findInvoiceByNumber } from "@/app/db/repositories/invoices";
import { emitWebhookEvent } from "../webhooks/emitter.js";

// ============================================
// WEIGHBRIDGE CONNECTOR
//
// Two events:
//   "weighbridge.first_weight"  — truck on arrival
//   "weighbridge.second_weight" — truck on departure → completes ticket
//
// Net = |first − second| (always positive)
//
// transactionType (required from gate software) drives all GL.
// See accounting matrix below — direction alone is not sufficient.
//
// ACCOUNTING MATRIX:
//   purchase            DR Inventory          CR GR/IR
//   sale                DR COGS               CR Inventory
//   sale_standalone     DR Stock Variance     CR Inventory
//   transfer_out        DR Goods in Transit   CR Inventory
//   transfer_in         DR Inventory          CR Goods in Transit
//   return_to_supplier  DR GR/IR              CR Inventory
//   customer_return     DR Inventory          CR Sales Returns
// ============================================

// Maps transactionType → [debitAccount, creditAccount] system account names
const ACCOUNT_MATRIX = {
  purchase:           ["inventory",       "grni"],
  sale:               ["cogs",            "inventory"],
  sale_standalone:    ["stock_variance",  "inventory"],
  transfer_out:       ["goods_in_transit","inventory"],
  transfer_in:        ["inventory",       "goods_in_transit"],
  return_to_supplier: ["grni",            "inventory"],
  customer_return:    ["inventory",       "sales_returns"],
};

// transactionTypes that increase stock at this location
const INBOUND_TYPES = new Set(["purchase", "transfer_in", "customer_return"]);

// transactionTypes that require an invoiceRef
const INVOICE_TYPES = new Set(["sale"]);

// transactionTypes that require a transferRef
const TRANSFER_TYPES = new Set(["transfer_out", "transfer_in"]);

export class WeighbridgeConnector extends BaseConnector {
  constructor(companyId, keyId) {
    super(companyId, keyId, "weighbridge");
    this.connectorType = "weighbridge";
  }

  // ── validate ──────────────────────────────────────────────

  async validate(payload) {
    const { event, transactionType } = payload;

    if (!["weighbridge.first_weight", "weighbridge.second_weight"].includes(event)) {
      throw new Error(
        `Unknown event: "${event}". ` +
        `Expected "weighbridge.first_weight" or "weighbridge.second_weight".`
      );
    }

    if (!payload.ticketRef?.toString().trim()) {
      throw new Error("ticketRef is required — the gate software's unique ticket identifier");
    }

    const weight = Number(payload.weight);
    if (!weight || weight <= 0) {
      throw new Error("weight must be a positive number in kg");
    }

    if (!transactionType) {
      throw new Error(
        `transactionType is required. Valid values: ${WB_TRANSACTION_TYPES.join(", ")}`
      );
    }

    if (!WB_TRANSACTION_TYPES.includes(transactionType)) {
      throw new Error(
        `Invalid transactionType: "${transactionType}". ` +
        `Valid values: ${WB_TRANSACTION_TYPES.join(", ")}`
      );
    }

    if (payload.direction && !["inbound", "outbound"].includes(payload.direction)) {
      throw new Error('direction must be "inbound" or "outbound"');
    }

    if (TRANSFER_TYPES.has(transactionType) && !payload.transferRef?.toString().trim()) {
      throw new Error(
        `transferRef is required for transactionType "${transactionType}". ` +
        `Both legs of a transfer must carry the same transferRef.`
      );
    }

    return {
      ...payload,
      ticketRef:        payload.ticketRef.toString().trim(),
      weight,
      weightUnit:       payload.weightUnit || "kg",
      transactionType,
      // direction is informational — still accepted but not used for accounting
      direction:        payload.direction || (INBOUND_TYPES.has(transactionType) ? "inbound" : "outbound"),
      vehicleReg:       payload.vehicleReg?.toString().trim()   || null,
      driverName:       payload.driverName?.toString().trim()   || null,
      driverPhone:      payload.driverPhone?.toString().trim()  || null,
      productCode:      payload.productCode?.toString().trim()  || null,
      partyName:        payload.partyName?.toString().trim()    || null,
      notes:            payload.notes?.toString().trim()        || "",
      purchaseOrderRef: payload.purchaseOrderRef?.toString().trim() || null,
      invoiceRef:       payload.invoiceRef?.toString().trim()   || null,
      transferRef:      payload.transferRef?.toString().trim()  || null,
    };
  }

  // ── map ────────────────────────────────────────────────────

  async map(validated) {
    const result = { ...validated };

    // Everything this resolves is in POSTGRES now — the product catalogue, the
    // purchase order and the invoice. One transaction, so the three reads see
    // the same snapshot instead of three independent ones.
    await withTenant(this.companyId, async (tx) => {
      if (validated.productCode) {
        const product = await findProductByCodeOrName(tx, validated.productCode);
        if (product) {
          result.productId = product.id;
          result.productName = product.name;
          result.productSnapshot = {
            name: product.name,
            SKU: product.sku,
            unit: product.unit,
          };
          result.unitCost = product.costPrice;
        }
      }

      const PO_TYPES = new Set(["purchase", "return_to_supplier"]);
      if (validated.purchaseOrderRef && PO_TYPES.has(validated.transactionType)) {
        const po = await findPurchaseOrderByNumber(tx, validated.purchaseOrderRef);
        if (po) {
          result.purchaseOrderId = po.id;
          result.purchaseOrderRef = po.poNumber;
        }
        // Soft — the gate may quote a PO before it is raised in the ERP.
      }

      if (validated.invoiceRef && INVOICE_TYPES.has(validated.transactionType)) {
        const invoice = await findInvoiceByNumber(tx, validated.invoiceRef);
        if (invoice) {
          result.invoiceId = invoice.id;
          result.invoiceRef = invoice.invoiceNumber;
          result.invoiceStatus = invoice.status;
        }
        // Also soft — the invoice may follow the truck.
      }
    });

    return result;
  }

  // ── execute ────────────────────────────────────────────────

  async execute(mapped) {
    if (mapped.event === "weighbridge.first_weight") {
      return this._recordFirstWeight(mapped);
    }
    return this._recordSecondWeight(mapped);
  }

  // ── Pass 1: first weight ───────────────────────────────────
  async _recordFirstWeight(mapped) {
    const { ticketRef, weight, weightUnit, transactionType } = mapped;

    const ticket = await withTenant(this.companyId, async (tx) => {
      const existing = await getWeighbridgeTicketByExternalRef(tx, ticketRef);

      if (existing) {
        if (["completed", "voided"].includes(existing.status)) {
          throw new Error(
            `Ticket ${existing.ticketNumber} is already ${existing.status}`,
          );
        }
        // A correction from the gate. `recordWeighing` refuses to overwrite a
        // weighing that is already down — 0022 makes a recorded weight
        // immutable — so a genuine re-send of the first weight is rejected
        // rather than silently changing what the ticket says. That is the
        // point: the Mongo version overwrites `firstWeight` in place, and the
        // net weight, the stock movement and the GL entry all follow from it.
        if (existing.firstWeight !== null) {
          throw new Error(
            `Ticket ${existing.ticketNumber} already has a first weight of ` +
            `${existing.firstWeight} ${existing.weightUnit}. Void it and ` +
            `re-open if the gate reading was wrong.`,
          );
        }
        return recordWeighing(tx, existing.id, String(weight), this.keyId);
      }

      // `direction` is derived from the transaction type inside the
      // repository, not taken from the payload — see openWeighbridgeTicket.
      const opened = await openWeighbridgeTicket(tx, {
        companyId: this.companyId,
        transactionType,
        externalRef: ticketRef,
        productId: mapped.productId || null,
        // Kept even when it matches nothing, so the completion warning can
        // name the code the gate actually sent.
        productCodeAtTicket: mapped.productCode || null,
        partyName: mapped.partyName || null,
        vehicleReg: mapped.vehicleReg || null,
        driverName: mapped.driverName || null,
        invoiceId: mapped.invoiceId || null,
        invoiceRef: mapped.invoiceRef || null,
        transferRef: mapped.transferRef || null,
      });
      return recordWeighing(tx, opened.id, String(weight), this.keyId);
    });

    return {
      internalRef: ticket.ticketNumber,
      internalId: ticket.id,
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      transactionType,
      status: ticket.status,
      firstWeight: weight,
      weightUnit,
      message:
        `First weight ${weight} ${weightUnit} recorded for ${ticket.ticketNumber} ` +
        `(${transactionType}). Awaiting second weight.`,
    };
  }

  // ── Pass 2: second weight → completion ────────────────────
  async _recordSecondWeight(mapped) {
    const { ticketRef, weight } = mapped;

    const outcome = await withTenant(this.companyId, async (tx) => {
      const found = await getWeighbridgeTicketByExternalRef(tx, ticketRef);
      if (!found) {
        throw new Error(
          `No ticket found for ref "${ticketRef}". ` +
          `Record first weight before second weight.`,
        );
      }
      if (found.status === "completed") {
        throw new Error(`Ticket ${found.ticketNumber} is already completed`);
      }
      if (found.status === "voided") {
        throw new Error(`Ticket ${found.ticketNumber} has been voided`);
      }
      if (found.firstWeight === null) {
        throw new Error(
          `Ticket ${found.ticketNumber} has no first weight recorded yet`,
        );
      }

      // If the linked invoice has already posted, it took COGS and the stock
      // with it. Complete the ticket but raise nothing, or the sale is counted
      // twice. Recoverable — an accountant can post by hand.
      let invoiceAlreadyPosted = false;
      if (found.transactionType === "sale" && found.invoiceId) {
        const linked = await findInvoiceByNumber(tx, found.invoiceRef ?? "");
        if (linked?.status === "completed") invoiceAlreadyPosted = true;
      }

      // The weighing itself. `net_weight` is a GENERATED column — the model
      // documents it as |first - second| and then stores it as an independent
      // number that nothing recomputes; here it cannot disagree.
      const ticket = await recordWeighing(tx, found.id, String(weight), this.keyId);
      const netWeight = Number(ticket.netWeight);

      // A sale whose invoice only turned up on the second pass.
      let invoiceId = ticket.invoiceId;
      let invoiceRef = ticket.invoiceRef;
      if (!invoiceId && mapped.invoiceRef && INVOICE_TYPES.has(ticket.transactionType)) {
        const invoice = await findInvoiceByNumber(tx, mapped.invoiceRef);
        if (invoice) {
          invoiceId = invoice.id;
          invoiceRef = invoice.invoiceNumber;
        }
      }

      let movementRef = null;
      let movementId = null;
      const warnings = [];

      if (invoiceAlreadyPosted) {
        warnings.push(
          `Invoice ${invoiceRef} was posted before this WB ticket completed. ` +
          `Stock movement and GL entry skipped — invoice posting already covered COGS and inventory. ` +
          `Verify the invoice quantity matches the WB net weight of ${netWeight} ${ticket.weightUnit}.`,
        );
      } else if (ticket.productId) {
        const moved = await this._createStockMovement(tx, ticket, netWeight, mapped);
        movementRef = moved.ref;
        movementId = moved.id;
        if (moved.warning) warnings.push(moved.warning);

        const jeWarning = await this._createJournalEntry(tx, {
          ticket,
          netWeight,
          totalCost: Number(mapped.unitCost ?? 0) * netWeight,
        });
        if (jeWarning) warnings.push(jeWarning);
      } else if (ticket.productCodeAtTicket) {
        warnings.push(
          `productCode "${ticket.productCodeAtTicket}" not found in catalogue — ` +
          `stock movement skipped. Create the product with this SKU, then post manually.`,
        );
      }

      const completed = await completeWeighbridgeTicket(tx, ticket.id, {
        internalRef: movementRef,
        internalId: movementId,
        invoiceId,
        invoiceRef,
        partyName: ticket.partyNameAtTicket ?? mapped.partyName ?? null,
        warnings,
      });

      return { ticket: completed, netWeight, movementRef, movementId, warnings };
    });

    const { ticket, netWeight, movementRef, movementId, warnings } = outcome;

    emitWebhookEvent({
      companyId: this.companyId,
      event: "weighbridge.ticket_completed",
      payload: {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        transactionType: ticket.transactionType,
        externalRef: ticketRef,
        direction: ticket.direction,
        firstWeight: Number(ticket.firstWeight),
        secondWeight: weight,
        netWeight,
        weightUnit: ticket.weightUnit,
        vehicleReg: ticket.vehicleReg,
        productName: ticket.productNameAtTicket,
        invoiceRef: ticket.invoiceRef || null,
        transferRef: ticket.transferRef || null,
        movementRef,
        warnings,
      },
      connectorType: "weighbridge",
    });

    return {
      internalRef: movementRef || ticket.ticketNumber,
      internalId: movementId || ticket.id,
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      transactionType: ticket.transactionType,
      status: "completed",
      firstWeight: Number(ticket.firstWeight),
      secondWeight: weight,
      netWeight,
      weightUnit: ticket.weightUnit,
      movementRef,
      warnings,
      message:
        `Ticket ${ticket.ticketNumber} completed (${ticket.transactionType}). ` +
        `Net: ${netWeight} ${ticket.weightUnit}.` +
        (movementRef ? ` Movement: ${movementRef}.` : "") +
        (warnings.length ? ` Warnings: ${warnings.length}` : ""),
    };
  }

  // ── Stock movement + GL ────────────────────────────────────
  async _createStockMovement(tx, ticket, netWeight, mapped) {
    const isInbound = INBOUND_TYPES.has(ticket.transactionType);

    // What kind of movement the ledger calls this.
    const movementTypeMap = {
      purchase: "purchase",
      sale: "sale",
      sale_standalone: "sale",
      transfer_out: "transfer",
      transfer_in: "transfer",
      return_to_supplier: "return",
      customer_return: "return",
    };

    const movement = await recordMovement(tx, {
      companyId: this.companyId,
      productId: ticket.productId,
      movementType: movementTypeMap[ticket.transactionType],
      direction: isInbound ? "in" : "out",
      quantity: String(netWeight),
      unitCost: String(mapped.unitCost ?? "0"),
      sourceReference: ticket.ticketNumber,
      performedById: null,
      performedByName: "Weighbridge Integration",
      affectsAccounting: true,
    });

    // ── Inventory counters, AFTER the movement ────────────────
    //
    // Order matters: `recordMovement` derives previous and new stock from
    // what the product currently holds, so moving the stock first makes it
    // subtract the same quantity twice and trip
    // `stock_movements_levels_non_negative`. Record what happened, then
    // make it happen — the order goodsReceipts uses.
    //
    // Mongo maintains these here by hand, with a different $inc per
    // transaction type: onHand and available for most, onHand and committed
    // for an invoice-linked sale. Two counters, five branches, and any path
    // that updates one and forgets the other leaves them disagreeing.
    //
    // `quantity_available` is a GENERATED column here — on_hand less committed
    // less on_hold — so there is only ever one number to move and the other
    // follows. `issueStock` also clamps the commitment at zero, which is what
    // makes it right for a standalone sale as well as an invoiced one.
    if (isInbound) {
      // Re-costs on a weighted average, which Mongo does not do at all — it
      // increments the quantity and leaves the cost price where it was, so a
      // delivery at a different price never reaches the valuation. Receiving
      // at the current average is a no-op for a transfer or a return, which is
      // the right answer for those.
      await receiveStock(tx, ticket.productId, String(netWeight), String(mapped.unitCost ?? "0"));
    } else {
      await issueStock(tx, ticket.productId, String(netWeight));
    }

    return {
      ref: movement.movementNumber,
      id: movement.id,
      warning: null,
    };
  }

  /**
   * The GL entry for a completed trip.
   *
   * THIS IS THE POSTING §9G IS ABOUT. It went into the Mongo ledger while
   * every ledger screen read Postgres — and for `purchase` in particular it
   * raises DR Inventory / CR GR/IR, the receipt's own half of a pair whose
   * other half (an approved bill clearing GR/IR) was already being written to
   * Postgres. Half of each pair in each store, so the clearing account could
   * only ever grow.
   *
   * The account matrix is unchanged; see the top of this file.
   */
  async _createJournalEntry(tx, { ticket, netWeight, totalCost }) {
    const [debitName, creditName] = ACCOUNT_MATRIX[ticket.transactionType];
    const [debitAcct, creditAcct] = await Promise.all([
      getSystemAccount(tx, debitName),
      getSystemAccount(tx, creditName),
    ]);

    if (!debitAcct || !creditAcct) {
      const missing = [
        !debitAcct ? debitName : null,
        !creditAcct ? creditName : null,
      ].filter(Boolean);
      const msg =
        `Journal entry skipped for ${ticket.ticketNumber} — ` +
        `system account(s) not configured: ${missing.join(", ")}. ` +
        `Set up chart of accounts to enable automatic GL posting.`;
      console.warn(`[WB] ${msg}`);
      return msg;
    }

    if (!(totalCost > 0)) {
      // A zero-value entry balances and says nothing. Mongo posts it anyway.
      return (
        `Journal entry skipped for ${ticket.ticketNumber} — the product has no ` +
        `cost price, so the movement is worth nothing to post. Set a cost and ` +
        `post manually.`
      );
    }

    const productName = ticket.productNameAtTicket || "Goods";
    const vehicleInfo = ticket.vehicleReg ? ` · ${ticket.vehicleReg}` : "";

    const entryTypeMap = {
      purchase: "goods_receipt",
      sale: "goods_dispatch",
      sale_standalone: "goods_dispatch",
      transfer_out: "goods_dispatch",
      transfer_in: "goods_receipt",
      return_to_supplier: "goods_dispatch",
      customer_return: "goods_receipt",
    };
    const descriptionMap = {
      purchase: `Goods received (purchase) — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
      sale: `Goods dispatched (sale) — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
      sale_standalone: `Goods dispatched (no invoice) — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
      transfer_out: `Transfer out — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
      transfer_in: `Transfer in — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
      return_to_supplier: `Return to supplier — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
      customer_return: `Customer return — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
    };

    const amount = Number(totalCost).toFixed(4);
    const lineNote = `${netWeight} ${ticket.weightUnit} — ${productName}`;

    await createJournalEntry(tx, {
      companyId: this.companyId,
      entryDate: new Date().toISOString().slice(0, 10),
      entryType: entryTypeMap[ticket.transactionType],
      description: descriptionMap[ticket.transactionType],
      reference: ticket.ticketNumber,
      sourceType: "weighbridge_ticket",
      sourceId: ticket.id,
      lines: [
        { accountId: debitAcct.id, debit: amount, description: lineNote },
        { accountId: creditAcct.id, credit: amount, description: lineNote },
      ],
      createdById: null,
      postImmediately: true,
    });

    return null;
  }
}

// The two Mongo counter helpers that used to live here are gone. Ticket
// numbers come from `next_entry_number` inside `openWeighbridgeTicket`, and
// journal entry numbers from the same function inside `createJournalEntry` —
// an atomic per-company sequence rather than a global `Counter` document that
// two tenants shared and two concurrent gate calls raced for.
