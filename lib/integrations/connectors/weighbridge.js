import { BaseConnector } from "./base.js";
import WeighbridgeTicket, { WB_TRANSACTION_TYPES } from "@/app/models/weighbridgeTicket.js";
import Product from "@/app/models/product.js";
import Invoice from "@/app/models/invoice.js";
import PurchaseOrder from "@/app/models/purchaseOrder.js";
import Account from "@/app/models/account.js";
import JournalEntry from "@/app/models/JournalEntry.js";
import { StockMovement } from "@/app/models/stockmovement.js";
import Counter from "@/app/models/counter.js";
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

    // Resolve product by SKU or name
    if (validated.productCode) {
      const product = await Product.findOne({
        companyId: this.companyId,
        $or: [
          { SKU: validated.productCode },
          { name: { $regex: new RegExp(`^${validated.productCode}$`, "i") } },
        ],
      }).lean();

      if (product) {
        result.productId       = product._id;
        result.productName     = product.name;
        result.productSnapshot = { name: product.name, SKU: product.SKU, unit: product.unit };
        result.unitCost        = product.costing?.costPrice ?? 0;
      }
    }

    // Resolve purchase order (purchase / return_to_supplier)
    const PO_TYPES = new Set(["purchase", "return_to_supplier"]);
    if (validated.purchaseOrderRef && PO_TYPES.has(validated.transactionType)) {
      const po = await PurchaseOrder.findOne({
        companyId: this.companyId,
        poNumber:  validated.purchaseOrderRef,
      }).lean();

      if (po) {
        result.purchaseOrderId  = po._id;
        result.purchaseOrderRef = po.poNumber;
      }
      // Soft — gate software may send PO ref before PO is raised in ERP
    }

    // Resolve invoice (sale only)
    if (validated.invoiceRef && INVOICE_TYPES.has(validated.transactionType)) {
      const invoice = await Invoice.findOne({
        companyId: this.companyId,
        invoiceNumber: validated.invoiceRef,
      }).lean();

      if (invoice) {
        result.invoiceId  = invoice._id;
        result.invoiceRef = invoice.invoiceNumber;
      }
      // No hard error — gate software may send invoiceRef before invoice is raised
    }

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
    const { ticketRef, weight, weightUnit, transactionType, direction } = mapped;

    let ticket = await WeighbridgeTicket.findOne({
      companyId: this.companyId,
      externalRef: ticketRef,
    });

    if (ticket) {
      if (["completed", "voided"].includes(ticket.status)) {
        throw new Error(`Ticket ${ticket.ticketNumber} is already ${ticket.status}`);
      }
      // Correction from gate software — update first weight
      ticket.firstWeight           = weight;
      ticket.firstWeightRecordedAt = new Date();
      ticket.firstWeightKeyId      = this.keyId || null;
      ticket.status                = "first_recorded";
      await ticket.save();
    } else {
      const ticketNumber = await generateTicketNumber();

      ticket = await WeighbridgeTicket.create({
        companyId:           this.companyId,
        ticketNumber,
        externalRef:         ticketRef,
        transactionType,
        direction,
        vehicleReg:          mapped.vehicleReg,
        driverName:          mapped.driverName,
        driverPhone:         mapped.driverPhone,
        productId:           mapped.productId   || null,
        productName:         mapped.productName || mapped.productCode || null,
        productCode:         mapped.productCode || null,
        partyName:           mapped.partyName   || null,
        firstWeight:         weight,
        weightUnit,
        firstWeightRecordedAt: new Date(),
        firstWeightKeyId:    this.keyId || null,
        status:              "first_recorded",
        notes:               mapped.notes,
        purchaseOrderId:     mapped.purchaseOrderId  || null,
        purchaseOrderRef:    mapped.purchaseOrderRef || null,
        invoiceId:           mapped.invoiceId  || null,
        invoiceRef:          mapped.invoiceRef || null,
        transferRef:         mapped.transferRef || null,
        integrationKeyId:    this.keyId || null,
      });
    }

    return {
      internalRef:      ticket.ticketNumber,
      internalId:       ticket._id,
      ticketId:         ticket._id.toString(),
      ticketNumber:     ticket.ticketNumber,
      transactionType,
      status:           ticket.status,
      firstWeight:      weight,
      weightUnit,
      message: `First weight ${weight} ${weightUnit} recorded for ${ticket.ticketNumber} (${transactionType}). Awaiting second weight.`,
    };
  }

  // ── Pass 2: second weight → completion ────────────────────

  async _recordSecondWeight(mapped) {
    const { ticketRef, weight } = mapped;

    const ticket = await WeighbridgeTicket.findOne({
      companyId: this.companyId,
      externalRef: ticketRef,
    });

    if (!ticket) {
      throw new Error(
        `No ticket found for ref "${ticketRef}". ` +
        `Record first weight before second weight.`
      );
    }
    if (ticket.status === "completed") {
      throw new Error(`Ticket ${ticket.ticketNumber} is already completed`);
    }
    if (ticket.status === "voided") {
      throw new Error(`Ticket ${ticket.ticketNumber} has been voided`);
    }
    if (ticket.firstWeight == null) {
      throw new Error(`Ticket ${ticket.ticketNumber} has no first weight recorded yet`);
    }

    const netWeight = Math.abs(ticket.firstWeight - weight);

    // Guard: if the linked invoice was already posted before WB completed,
    // the invoice posting already did DR COGS + CR Inventory + inventory counters.
    // Mark the ticket as completed but skip the stock movement and JE to
    // avoid double-posting. This is recoverable — accountant can post manually.
    let invoiceAlreadyPosted = false;
    if (ticket.transactionType === "sale" && ticket.invoiceId) {
      const linkedInvoice = await Invoice.findById(ticket.invoiceId)
        .select("status invoiceNumber")
        .lean();
      if (linkedInvoice?.status === "completed") {
        invoiceAlreadyPosted = true;
      }
    }

    ticket.secondWeight           = weight;
    ticket.netWeight              = netWeight;
    ticket.secondWeightRecordedAt = new Date();
    ticket.secondWeightKeyId      = this.keyId || null;
    ticket.status                 = "completed";
    ticket.completedAt            = new Date();

    if (mapped.partyName && !ticket.partyName) {
      ticket.partyName = mapped.partyName;
    }

    // Resolve invoice on second pass if not captured on first pass (sale only)
    if (!ticket.invoiceId && mapped.invoiceRef && INVOICE_TYPES.has(ticket.transactionType)) {
      const invoice = await Invoice.findOne({
        companyId: this.companyId,
        invoiceNumber: mapped.invoiceRef,
      }).lean();
      if (invoice) {
        ticket.invoiceId  = invoice._id;
        ticket.invoiceRef = invoice.invoiceNumber;
      }
    }

    // ── Stock movement + GL ────────────────────────────────
    let movementRef = null;
    let movementId  = null;
    const warnings  = [];

    if (invoiceAlreadyPosted) {
      // Invoice was posted before WB completed — it already ran DR COGS + CR Inventory
      // and updated inventory counters. Skip movement to avoid double-posting.
      warnings.push(
        `Invoice ${ticket.invoiceRef} was posted before this WB ticket completed. ` +
        `Stock movement and GL entry skipped — invoice posting already covered COGS and inventory. ` +
        `Verify the invoice quantity matches the WB net weight of ${netWeight} ${ticket.weightUnit}.`
      );
    } else if (ticket.productId) {
      const movResult = await this._createStockMovement(ticket, netWeight, mapped);
      movementRef = movResult.ref;
      movementId  = movResult.id;
      if (movResult.warning) warnings.push(movResult.warning);
      ticket.internalRef = movementRef;
      ticket.internalId  = movementId;
    } else if (ticket.productCode) {
      warnings.push(
        `productCode "${ticket.productCode}" not found in catalogue — ` +
        `stock movement skipped. Create the product with this SKU, then post manually.`
      );
    }

    // ── Invoice item fulfillment flag (sale only, invoice not yet posted) ────
    if (ticket.transactionType === "sale" && ticket.invoiceId && ticket.productId && !invoiceAlreadyPosted) {
      await Invoice.updateOne(
        {
          _id: ticket.invoiceId,
          "items.productId": ticket.productId,
        },
        {
          $set: {
            "items.$[item].weighbridgeTicketId":     ticket._id,
            "items.$[item].weighbridgeTicketNumber": ticket.ticketNumber,
          },
        },
        {
          arrayFilters: [
            {
              "item.productId": ticket.productId,
              "item.weighbridgeTicketId": null,
            },
          ],
        }
      );
      ticket.invoiceItemFulfilled = true;
    }

    // ── Transfer leg matching ──────────────────────────────
    if (ticket.transactionType === "transfer_in" && ticket.transferRef) {
      const outboundTicket = await WeighbridgeTicket.findOne({
        companyId:       this.companyId,
        transferRef:     ticket.transferRef,
        transactionType: "transfer_out",
        status:          "completed",
      });

      if (outboundTicket) {
        ticket.linkedTicketId  = outboundTicket._id;
        ticket.transferCleared = true;
        // Mark the outbound leg as cleared too
        await WeighbridgeTicket.updateOne(
          { _id: outboundTicket._id },
          { $set: { linkedTicketId: ticket._id, transferCleared: true } }
        );
      } else {
        warnings.push(
          `No matching transfer_out ticket found for transferRef "${ticket.transferRef}". ` +
          `Goods in Transit account will remain open until the outbound leg is matched.`
        );
      }
    }

    if (warnings.length) ticket.warnings = warnings;

    await ticket.save();

    emitWebhookEvent({
      companyId:     this.companyId,
      event:         "weighbridge.ticket_completed",
      payload: {
        ticketId:        ticket._id.toString(),
        ticketNumber:    ticket.ticketNumber,
        transactionType: ticket.transactionType,
        externalRef:     ticketRef,
        direction:       ticket.direction,
        firstWeight:     ticket.firstWeight,
        secondWeight:    weight,
        netWeight,
        weightUnit:      ticket.weightUnit,
        vehicleReg:      ticket.vehicleReg,
        productName:     ticket.productName,
        invoiceRef:      ticket.invoiceRef || null,
        transferRef:     ticket.transferRef || null,
        movementRef,
        warnings,
      },
      connectorType: "weighbridge",
    });

    return {
      internalRef:     movementRef || ticket.ticketNumber,
      internalId:      movementId  || ticket._id,
      ticketId:        ticket._id.toString(),
      ticketNumber:    ticket.ticketNumber,
      transactionType: ticket.transactionType,
      status:          "completed",
      firstWeight:     ticket.firstWeight,
      secondWeight:    weight,
      netWeight,
      weightUnit:      ticket.weightUnit,
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

  async _createStockMovement(ticket, netWeight, mapped) {
    const product = await Product.findById(ticket.productId).lean();
    if (!product) return { ref: null, id: null };

    this.assertTenant(product);

    const isInbound  = INBOUND_TYPES.has(ticket.transactionType);
    const totalCost  = (mapped.unitCost ?? 0) * netWeight;
    const currentOnHand = product.inventory?.quantityOnHand ?? 0;
    const newOnHand     = isInbound ? currentOnHand + netWeight : currentOnHand - netWeight;
    const movementNumber = await StockMovement.generateMovementNumber(this.companyId);

    // Determine movement type for stock movement record
    const movementTypeMap = {
      purchase:           "purchase",
      sale:               "sale",
      sale_standalone:    "sale",
      transfer_out:       "transfer",
      transfer_in:        "transfer",
      return_to_supplier: "return",
      customer_return:    "return",
    };

    const movement = await StockMovement.create({
      companyId:       this.companyId,
      movementNumber,
      productId:       ticket.productId,
      productSnapshot: mapped.productSnapshot || { name: ticket.productName },
      movementType:    movementTypeMap[ticket.transactionType],
      direction:       isInbound ? "in" : "out",
      quantity:        netWeight,
      previousStock:   currentOnHand,
      newStock:        newOnHand,
      costing: {
        unitCost:  mapped.unitCost ?? 0,
        totalCost,
      },
      accounting: {
        affectsAccounting: true,
        accountingPosted:  false,
      },
      performedBy: {
        name: "Weighbridge Integration",
        id:   this.keyId?.toString() || "system",
        role: "system",
      },
      notes: `Auto-created from WB ticket ${ticket.ticketNumber} (${ticket.transactionType}). Vehicle: ${ticket.vehicleReg || "N/A"}`,
    });

    // ── Inventory counters ──────────────────────────────────
    //
    // sale (invoice-linked): onHand ↓  committed ↓
    //   (invoice already reduced available at draft time)
    // sale (standalone):     onHand ↓  available ↓
    // all inbound types:     onHand ↑  available ↑
    // transfer_out:          onHand ↓  available ↓  (no prior commitment)
    // return_to_supplier:    onHand ↓  available ↓

    if (isInbound) {
      await Product.updateOne(
        { _id: ticket.productId },
        { $inc: {
          "inventory.quantityOnHand":    netWeight,
          "inventory.quantityAvailable": netWeight,
        }}
      );
    } else if (ticket.transactionType === "sale" && ticket.invoiceId) {
      await Product.updateOne(
        { _id: ticket.productId },
        { $inc: {
          "inventory.quantityOnHand":    -netWeight,
          "inventory.quantityCommitted": -netWeight,
        }}
      );
    } else {
      await Product.updateOne(
        { _id: ticket.productId },
        { $inc: {
          "inventory.quantityOnHand":    -netWeight,
          "inventory.quantityAvailable": -netWeight,
        }}
      );
    }

    // ── Journal entry ───────────────────────────────────────
    let jeWarning = null;
    if (totalCost > 0) {
      jeWarning = await this._createJournalEntry({ ticket, movement, movementNumber, netWeight, totalCost });
    }

    return { ref: movementNumber, id: movement._id, warning: jeWarning };
  }

  // ── Journal entry ──────────────────────────────────────────

  async _createJournalEntry({ ticket, movement, movementNumber, netWeight, totalCost }) {
    const [debitName, creditName] = ACCOUNT_MATRIX[ticket.transactionType];

    const [debitAcct, creditAcct] = await Promise.all([
      Account.findOne({ companyId: this.companyId, systemAccount: debitName,  isActive: true }).lean(),
      Account.findOne({ companyId: this.companyId, systemAccount: creditName, isActive: true }).lean(),
    ]);

    if (!debitAcct || !creditAcct) {
      const missing = [
        !debitAcct  ? debitName  : null,
        !creditAcct ? creditName : null,
      ].filter(Boolean);
      const msg =
        `Journal entry skipped for ${ticket.ticketNumber} — ` +
        `system account(s) not configured: ${missing.join(", ")}. ` +
        `Set up chart of accounts to enable automatic GL posting.`;
      console.warn(`[WB] ${msg}`);
      return msg;
    }

    const entryNumber  = await generateJournalEntryNumber();
    const productName  = ticket.productName || "Goods";
    const vehicleInfo  = ticket.vehicleReg  ? ` · ${ticket.vehicleReg}` : "";

    const entryTypeMap = {
      purchase:           "goods_receipt",
      sale:               "goods_dispatch",
      sale_standalone:    "goods_dispatch",
      transfer_out:       "goods_dispatch",
      transfer_in:        "goods_receipt",
      return_to_supplier: "goods_dispatch",
      customer_return:    "goods_receipt",
    };

    const descriptionMap = {
      purchase:           `Goods received (purchase) — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
      sale:               `Goods dispatched (sale) — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
      sale_standalone:    `Goods dispatched (no invoice) — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
      transfer_out:       `Transfer out — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
      transfer_in:        `Transfer in — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
      return_to_supplier: `Return to supplier — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
      customer_return:    `Customer return — ${productName}${vehicleInfo} · ${ticket.ticketNumber}`,
    };

    const je = await JournalEntry.create([{
      companyId:   this.companyId,
      entryNumber,
      entryDate:   ticket.completedAt || new Date(),
      entryType:   entryTypeMap[ticket.transactionType],
      description: descriptionMap[ticket.transactionType],
      reference:   ticket.ticketNumber,
      lines: [
        {
          accountId:   debitAcct._id,
          accountCode: debitAcct.accountCode,
          accountName: debitAcct.accountName,
          accountType: debitAcct.accountType,
          debit:       totalCost,
          credit:      0,
          description: `${netWeight} ${ticket.weightUnit} — ${productName}`,
        },
        {
          accountId:   creditAcct._id,
          accountCode: creditAcct.accountCode,
          accountName: creditAcct.accountName,
          accountType: creditAcct.accountType,
          debit:       0,
          credit:      totalCost,
          description: `${netWeight} ${ticket.weightUnit} — ${productName}`,
        },
      ],
      relatedDocuments: {
        stockMovementId:         movement._id,
        weighbridgeTicketId:     ticket._id,
        weighbridgeTicketNumber: ticket.ticketNumber,
      },
      status:    "draft",
      createdBy: { name: "Weighbridge Integration", id: this.keyId?.toString() || "system" },
    }]);

    await je[0].post({ name: "Weighbridge Integration", id: this.keyId?.toString() || "system" });

    await StockMovement.updateOne(
      { _id: movement._id },
      { $set: {
        "accounting.journalEntryId":     je[0]._id,
        "accounting.accountingPosted":   true,
        "accounting.accountingPostedAt": new Date(),
      }}
    );

    return null; // no warning
  }
}

// ── Number generators ──────────────────────────────────────

async function generateTicketNumber() {
  const { format } = await import("date-fns");
  const today     = format(new Date(), "yyMMdd");
  const counterId = `WBT-${today}`;
  const counter   = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `WBT-${today}-${String(counter.seq).padStart(3, "0")}`;
}


async function generateJournalEntryNumber() {
  const { format } = await import("date-fns");
  const today     = format(new Date(), "yyMM");
  const counterId = `JE-${today}`;
  const counter   = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `JE-${today}-${String(counter.seq).padStart(4, "0")}`;
}
