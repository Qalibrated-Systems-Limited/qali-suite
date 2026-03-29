import dbConnect from "@/app/config/dbConnect";
import WeighbridgeTicket from "@/app/models/weighbridgeTicket";
import { WeighbridgeConnector } from "@/lib/integrations/connectors/weighbridge";
import { apiKeyAuth } from "@/lib/integrations/middleware/apiKeyAuth";
import { okResponse, createdResponse, errorResponse, listResponse } from "@/lib/integrations/utils/envelope";

// ============================================
// POST /api/v1/weighbridge/tickets
//   Record a weight pass. Single endpoint for
//   both passes — event field distinguishes them.
//
// GET /api/v1/weighbridge/tickets
//   List tickets (filterable).
//
// Required scope: inventory:write (POST)
//                 inventory:read  (GET)
//
// ── PAYLOAD ─────────────────────────────────
//
// Pass 1 — first weight (truck on arrival)
// {
//   "event":           "weighbridge.first_weight",
//   "ticketRef":       "WB-001",         // gate software's unique ID per trip
//   "transactionType": "purchase",        // REQUIRED — drives GL (see matrix below)
//   "direction":       "inbound",         // informational only
//   "weight":          5200,              // kg
//   "vehicleReg":      "KBZ 123A",
//   "productCode":     "COFFEE-AA",       // matches product SKU — enables stock movement
//   "partyName":       "Kamau Suppliers",
//
//   // sale only — links to invoice for committed-stock deduction
//   "invoiceRef":      "INV-000123",
//
//   // transfer_out / transfer_in only — links both legs
//   "transferRef":     "TR-2026-001"
// }
//
// Pass 2 — second weight (truck on departure) → completes ticket
// {
//   "event":     "weighbridge.second_weight",
//   "ticketRef": "WB-001",
//   "weight":    1800,
//   // invoiceRef and transferRef can also be sent here if missed on pass 1
// }
//
// ── TRANSACTION TYPE (transactionType) ──────
//
//   purchase           Inbound from supplier
//                        DR Inventory / CR GR/IR
//                        Clears when supplier bill is posted (DR GR/IR / CR AP)
//
//   sale               Outbound to customer against invoice
//                        DR COGS / CR Inventory (at gate crossing)
//                        Invoice posts revenue only (DR AR / CR Revenue)
//
//   sale_standalone    Outbound to customer, no invoice
//                        DR Stock Variance / CR Inventory
//
//   transfer_out       Outbound to own location
//                        DR Goods in Transit / CR Inventory
//                        Send same transferRef on the inbound leg to clear
//
//   transfer_in        Inbound from own location
//                        DR Inventory / CR Goods in Transit
//                        Connector auto-links to matching transfer_out ticket
//
//   return_to_supplier Outbound — returning goods to supplier
//                        DR GR/IR / CR Inventory
//
//   customer_return    Inbound — goods returned by customer
//                        DR Inventory / CR Sales Returns
// ============================================

export async function POST(request) {
  const ctx = await apiKeyAuth(request, { requireScope: "inventory:write" });
  if (!ctx.ok) return ctx.response;

  if (ctx.connectorType !== "weighbridge") {
    return errorResponse(
      "FORBIDDEN_SCOPE",
      `This key is issued to a "${ctx.connectorType}" connector, not weighbridge`,
      403
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const { event, ticketRef } = body;

  if (!event) {
    return errorResponse(
      "VALIDATION_ERROR",
      'event is required: "weighbridge.first_weight" or "weighbridge.second_weight"',
      400
    );
  }

  await dbConnect();

  const connector = new WeighbridgeConnector(ctx.companyId, ctx.keyId);

  const externalRef = ticketRef
    ? `${ticketRef}_${event === "weighbridge.first_weight" ? "first" : "second"}`
    : null;

  try {
    const result = await connector.process(body, externalRef);

    if (result.cached) {
      return okResponse(result, 200, { cached: true });
    }

    return createdResponse(result);
  } catch (err) {
    const status = err.message?.includes("not found") ? 404
      : err.message?.includes("already")              ? 409
      : 422;
    return errorResponse("BUSINESS_RULE", err.message, status);
  }
}

export async function GET(request) {
  const ctx = await apiKeyAuth(request, { requireScope: "inventory:read" });
  if (!ctx.ok) return ctx.response;

  await dbConnect();

  const { searchParams } = new URL(request.url);
  const status          = searchParams.get("status");
  const transactionType = searchParams.get("transactionType");
  const vehicleReg      = searchParams.get("vehicleReg");
  const limit  = Math.min(parseInt(searchParams.get("limit")  || "50"), 200);
  const offset =          parseInt(searchParams.get("offset") || "0");

  const query = { companyId: ctx.companyId };
  if (status)          query.status          = status;
  if (transactionType) query.transactionType = transactionType;
  if (vehicleReg)      query.vehicleReg      = new RegExp(vehicleReg, "i");

  const [tickets, total] = await Promise.all([
    WeighbridgeTicket.find(query)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    WeighbridgeTicket.countDocuments(query),
  ]);

  return listResponse(
    tickets.map(serializeTicket),
    { total, limit, offset }
  );
}

function serializeTicket(t) {
  return {
    id:              t._id.toString(),
    ticketNumber:    t.ticketNumber,
    externalRef:     t.externalRef,
    transactionType: t.transactionType,
    direction:       t.direction,
    status:          t.status,
    vehicleReg:      t.vehicleReg,
    driverName:      t.driverName,
    productName:     t.productName,
    productCode:     t.productCode,
    partyName:       t.partyName,
    firstWeight:     t.firstWeight,
    secondWeight:    t.secondWeight,
    netWeight:       t.netWeight,
    weightUnit:      t.weightUnit,
    internalRef:     t.internalRef,
    invoiceRef:      t.invoiceRef,
    purchaseOrderRef: t.purchaseOrderRef,
    transferRef:     t.transferRef,
    transferCleared: t.transferCleared,
    linkedTicketId:  t.linkedTicketId?.toString() ?? null,
    warnings:        t.warnings ?? [],
    completedAt:     t.completedAt?.toISOString() ?? null,
    createdAt:       t.createdAt.toISOString(),
  };
}
