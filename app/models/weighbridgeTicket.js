import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// WEIGHBRIDGE TICKET MODEL
//
// Two-pass weighing. Net = |first − second|.
//
// transactionType drives all accounting — direction
// alone is insufficient. Gate software must declare
// the purpose of each trip.
//
// ACCOUNTING MATRIX (see WB connector):
//
//   purchase          DR Inventory        CR GR/IR
//   sale              DR COGS             CR Inventory
//   sale_standalone   DR Stock Variance   CR Inventory
//   transfer_out      DR Goods in Transit CR Inventory
//   transfer_in       DR Inventory        CR Goods in Transit
//   return_to_supplier DR GR/IR           CR Inventory
//   customer_return   DR Inventory        CR Sales Returns
// ============================================

// Transaction type values exported for reuse in API validation and UI
export const WB_TRANSACTION_TYPES = [
  "purchase",           // Inbound from supplier (clears via bill → GR/IR)
  "sale",               // Outbound to customer against invoice
  "sale_standalone",    // Outbound to customer, no invoice
  "transfer_out",       // Outbound to own location (clears via transfer_in)
  "transfer_in",        // Inbound from own location
  "return_to_supplier", // Outbound back to supplier (clears GR/IR or AP)
  "customer_return",    // Inbound goods returned by customer
];

export const WB_TRANSACTION_LABELS = {
  purchase:           "Purchase Receipt",
  sale:               "Sale Dispatch",
  sale_standalone:    "Dispatch (No Invoice)",
  transfer_out:       "Transfer Out",
  transfer_in:        "Transfer In",
  return_to_supplier: "Return to Supplier",
  customer_return:    "Customer Return",
};

const weighbridgeTicketSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    // ── Identity ──────────────────────────────
    ticketNumber: {
      type: String,
      required: true,
      index: true,
    },

    // Gate software's reference (idempotency key)
    externalRef: {
      type: String,
      default: null,
      index: true,
    },

    // ── Transaction type (drives GL) ──────────
    // Gate software MUST send this. Direction alone is not enough.
    transactionType: {
      type: String,
      enum: WB_TRANSACTION_TYPES,
      required: true,
      index: true,
    },

    // Physical direction — describes the truck, not the accounting
    direction: {
      type: String,
      enum: ["inbound", "outbound"],
      required: true,
    },

    // ── Vehicle & Driver ──────────────────────
    vehicleReg:  { type: String, trim: true, default: null },
    driverName:  { type: String, trim: true, default: null },
    driverPhone: { type: String, trim: true, default: null },

    // ── Product ───────────────────────────────
    productId:   { type: Schema.Types.ObjectId, ref: "Product", default: null },
    productName: { type: String, trim: true, default: null },
    productCode: { type: String, trim: true, default: null },

    // ── Party ─────────────────────────────────
    // purchase / return_to_supplier → supplier
    // sale / customer_return         → customer
    // transfer_*                     → destination/source location name
    partyId:   { type: Schema.Types.ObjectId, default: null },
    partyName: { type: String, trim: true, default: null },

    // ── Weights ───────────────────────────────
    // firstWeight  = reading on arrival
    // secondWeight = reading on departure
    // Net          = |first − second| (always positive)
    firstWeight:  { type: Number, default: null },
    secondWeight: { type: Number, default: null },
    netWeight:    { type: Number, default: null },
    weightUnit:   { type: String, enum: ["kg", "t"], default: "kg" },

    firstWeightRecordedAt:  { type: Date, default: null },
    secondWeightRecordedAt: { type: Date, default: null },
    firstWeightKeyId:  { type: Schema.Types.ObjectId, default: null },
    secondWeightKeyId: { type: Schema.Types.ObjectId, default: null },

    // ── Status ────────────────────────────────
    status: {
      type: String,
      enum: ["pending", "first_recorded", "completed", "voided"],
      default: "pending",
      index: true,
    },

    // ── ERP document created on completion ────
    internalRef: { type: String, default: null },
    internalId:  { type: Schema.Types.ObjectId, default: null },

    // ── Document linkage ──────────────────────

    // purchase / return_to_supplier → PO reference
    purchaseOrderId:  { type: Schema.Types.ObjectId, default: null },
    purchaseOrderRef: { type: String, default: null },

    // sale → invoice linkage
    // Controls inventory deduction path:
    //   invoiceId set  → quantityOnHand ↓, quantityCommitted ↓
    //   invoiceId null → quantityOnHand ↓, quantityAvailable ↓
    invoiceId:  { type: Schema.Types.ObjectId, ref: "Invoice", default: null },
    invoiceRef: { type: String, default: null },

    // sale → marks the invoice item as WB-fulfilled (set on completion)
    // Prevents invoice posting from double-posting COGS
    // See: invoice item.weighbridgeTicketId
    invoiceItemFulfilled: { type: Boolean, default: false },

    // purchase / customer_return inbound → bill that cleared GR/IR
    // Set when accountant approves a bill with this ticket linked
    billId:  { type: Schema.Types.ObjectId, ref: "Bill", default: null },
    billRef: { type: String, default: null },

    // transfer_out / transfer_in → links both legs of the transfer
    // Gate software sends the same transferRef on both the outbound
    // and inbound ticket. When transfer_in completes, the connector
    // looks up the matching transfer_out and links them via linkedTicketId.
    transferRef:     { type: String, default: null, index: true },
    linkedTicketId:  { type: Schema.Types.ObjectId, ref: "WeighbridgeTicket", default: null },
    transferCleared: { type: Boolean, default: false }, // true = both legs matched, GIT balance = 0

    // ── Metadata ──────────────────────────────
    completedAt: { type: Date, default: null },
    voidedAt:    { type: Date, default: null },
    voidReason:  { type: String, default: null },
    voidedBy:    { id: { type: String }, name: { type: String } },
    notes:       { type: String, maxlength: 500, default: "" },

    // Non-blocking warnings set on completion — surfaced in UI
    warnings: { type: [String], default: [] },

    integrationKeyId: { type: Schema.Types.ObjectId, default: null },
  },
  {
    timestamps: true,
    collection: "weighbridgeTickets",
  }
);

weighbridgeTicketSchema.index({ companyId: 1, status: 1, createdAt: -1 });
weighbridgeTicketSchema.index({ companyId: 1, transactionType: 1, createdAt: -1 });
weighbridgeTicketSchema.index({ companyId: 1, externalRef: 1 });
weighbridgeTicketSchema.index({ companyId: 1, vehicleReg: 1 });
weighbridgeTicketSchema.index({ companyId: 1, ticketNumber: 1 }, { unique: true });
weighbridgeTicketSchema.index({ companyId: 1, transferRef: 1 }); // transfer leg lookup

weighbridgeTicketSchema.virtual("netWeightDisplay").get(function () {
  if (this.netWeight == null) return "Pending";
  return `${this.netWeight.toLocaleString()} ${this.weightUnit}`;
});

const WeighbridgeTicket =
  mongoose.models.WeighbridgeTicket ||
  mongoose.model("WeighbridgeTicket", weighbridgeTicketSchema);

export default WeighbridgeTicket;
