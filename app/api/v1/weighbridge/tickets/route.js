import { WeighbridgeConnector } from "@/lib/integrations/connectors/weighbridge";
import { apiKeyAuth } from "@/lib/integrations/middleware/apiKeyAuth";
import { withApiKeyTenant } from "@/app/db/apiTenant";
import { searchWeighbridgeTicketsForApi } from "@/app/db/repositories/fulfilment";
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

  /**
   * No dbConnect. The connector opens its own tenant-scoped Postgres
   * transactions, and since 0102 so does its integration log.
   *
   * `ctx.companyId` IS NOW A POSTGRES UUID. It used to be the Mongo id carried
   * on the key document, and the connector passes it straight to
   * `withTenant()` — which sets `app.company_id` and lets the policies cast it
   * with `::uuid`. A 24-character ObjectId does not cast, so this endpoint
   * raised 22P02 on every call that got as far as touching a ticket. Moving
   * the keys into Postgres is what fixes it: the column is a real foreign key
   * to `companies`, so the id that comes out is the id `withTenant` wants.
   */
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
  return withApiKeyTenant(
    request,
    { requireScope: "inventory:read" },
    async (tx) => {
      const { searchParams } = new URL(request.url);

      const { rows, total, limit, offset } =
        await searchWeighbridgeTicketsForApi(tx, {
          status: searchParams.get("status") || undefined,
          transactionType: searchParams.get("transactionType") || undefined,
          vehicleReg: searchParams.get("vehicleReg") || undefined,
          limit: parseInt(searchParams.get("limit") || "50"),
          offset: parseInt(searchParams.get("offset") || "0"),
        });

      return listResponse(rows.map(serializeTicket), { total, limit, offset });
    },
  );
}

const num = (v) => (v == null ? null : Number(v));
const iso = (v) => (v == null ? null : new Date(v).toISOString());

/**
 * Snake_case in, because this reads the raw row rather than a Drizzle select.
 *
 * The weights are numeric(19,4) and arrive as STRINGS; unconverted they would
 * serialize as `"5200.0000"` where the Mongo API returned `5200`, and any
 * consumer adding them up would concatenate instead. The `*_at_ticket` columns
 * keep their old API names — they are the product and party as they were when
 * the truck was weighed.
 */
function serializeTicket(t) {
  return {
    id: String(t.id),
    ticketNumber: t.ticket_number,
    externalRef: t.external_ref,
    transactionType: t.transaction_type,
    direction: t.direction,
    status: t.status,
    vehicleReg: t.vehicle_reg,
    driverName: t.driver_name,
    productName: t.product_name_at_ticket,
    productCode: t.product_code_at_ticket,
    partyName: t.party_name_at_ticket,
    firstWeight: num(t.first_weight),
    secondWeight: num(t.second_weight),
    netWeight: num(t.net_weight),
    weightUnit: t.weight_unit,
    internalRef: t.internal_ref,
    invoiceRef: t.invoice_ref,
    purchaseOrderRef: t.purchase_order_ref,
    transferRef: t.transfer_ref,
    transferCleared: t.transfer_cleared ?? false,
    linkedTicketId: t.linked_ticket_id ? String(t.linked_ticket_id) : null,
    warnings: t.warnings ?? [],
    completedAt: iso(t.completed_at),
    createdAt: iso(t.created_at),
  };
}
