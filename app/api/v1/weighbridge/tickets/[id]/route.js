import { withApiKeyTenant } from "@/app/db/apiTenant";
import {
  getWeighbridgeTicketById,
  voidWeighbridgeTicket,
} from "@/app/db/repositories/fulfilment";
import { okResponse, errorResponse } from "@/lib/integrations/utils/envelope";

// ============================================
// GET    /api/v1/weighbridge/tickets/:id
// DELETE /api/v1/weighbridge/tickets/:id  (void ticket)
//
// POSTGRES since 0102. The tickets themselves have been in Postgres since
// 0022 — these two handlers were still reading the Mongo collection, so the
// API was serving a DIFFERENT SET OF TICKETS from the one the connector on
// the same endpoint was writing to.
// ============================================

const num = (v) => (v == null ? null : Number(v));
const iso = (v) => (v == null ? null : new Date(v).toISOString());

function serializeTicket(t) {
  return {
    id: String(t.id),
    ticketNumber: t.ticketNumber,
    externalRef: t.externalRef,
    transactionType: t.transactionType,
    direction: t.direction,
    status: t.status,
    vehicleReg: t.vehicleReg,
    driverName: t.driverName,
    driverPhone: t.driverPhone,
    /**
     * The columns are `*_at_ticket` — the product and party AS THEY WERE when
     * the truck was weighed, which is the point of storing them rather than
     * joining. The API's field names are unchanged so consumers are not broken
     * by where the row now comes from.
     */
    productName: t.productNameAtTicket,
    productCode: t.productCodeAtTicket,
    partyName: t.partyNameAtTicket,
    /**
     * numeric(19,4) crosses the driver boundary as a STRING. Left as-is these
     * would serialize as `"5200.0000"` where the Mongo API returned `5200`,
     * and any consumer doing arithmetic on them would concatenate.
     */
    firstWeight: num(t.firstWeight),
    secondWeight: num(t.secondWeight),
    netWeight: num(t.netWeight),
    weightUnit: t.weightUnit,
    firstWeightRecordedAt: iso(t.firstWeightRecordedAt),
    secondWeightRecordedAt: iso(t.secondWeightRecordedAt),
    internalRef: t.internalRef,
    purchaseOrderId: t.purchaseOrderId ? String(t.purchaseOrderId) : null,
    purchaseOrderRef: t.purchaseOrderRef,
    invoiceId: t.invoiceId ? String(t.invoiceId) : null,
    invoiceRef: t.invoiceRef,
    invoiceItemFulfilled: t.invoiceItemFulfilled ?? false,
    billId: t.billId ? String(t.billId) : null,
    billRef: t.billRef,
    transferRef: t.transferRef,
    linkedTicketId: t.linkedTicketId ? String(t.linkedTicketId) : null,
    transferCleared: t.transferCleared ?? false,
    warnings: t.warnings ?? [],
    notes: t.notes,
    voidReason: t.voidReason ?? null,
    voidedAt: iso(t.voidedAt),
    completedAt: iso(t.completedAt),
    createdAt: iso(t.createdAt),
  };
}

export async function GET(request, { params }) {
  // Awaited: `params` is a Promise in Next 16, and reading `.id` off the
  // Promise gave `undefined` — see the DELETE handler below for what that
  // did to the Mongo query.
  const { id } = await params;
  if (!id) return errorResponse("VALIDATION_ERROR", "id is required", 400);

  return withApiKeyTenant(
    request,
    { requireScope: "inventory:read" },
    async (tx) => {
      const ticket = await getWeighbridgeTicketById(tx, id);
      if (!ticket) return errorResponse("NOT_FOUND", "Ticket not found", 404);
      return okResponse(serializeTicket(ticket));
    },
  );
}

export async function DELETE(request, { params }) {
  /**
   * The Mongo version read `params.id` synchronously — `undefined` — so the
   * query was `findOne({ _id: undefined, companyId })`, which Mongoose matches
   * against the FIRST ticket for the tenant. Voiding ticket A could void
   * ticket B, and the response would name B's ticket number, so it did not
   * even look wrong from the outside.
   */
  const { id } = await params;
  if (!id) return errorResponse("VALIDATION_ERROR", "id is required", 400);

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* void reason optional */
  }

  return withApiKeyTenant(
    request,
    { requireScope: "inventory:write" },
    async (tx, ctx) => {
      const ticket = await getWeighbridgeTicketById(tx, id);
      if (!ticket) return errorResponse("NOT_FOUND", "Ticket not found", 404);

      /**
       * A completed ticket has posted stock and a journal entry, and unwinding
       * those is a decision with an audit trail behind it — the admin action
       * (app/db/actions/integration-actions.ts) does the reversal under a
       * named user. An API key does not get to do it silently.
       */
      if (ticket.status === "completed") {
        return errorResponse(
          "BUSINESS_RULE",
          "Completed tickets cannot be voided — reverse the stock movement manually",
          409,
        );
      }
      if (ticket.status === "voided") {
        return errorResponse("BUSINESS_RULE", "Ticket is already voided", 409);
      }

      await voidWeighbridgeTicket(
        tx,
        id,
        // The person the key acts for; null for a key issued before that was
        // recorded, which the column allows.
        ctx.actorId,
        body.reason || "Voided via API",
      );

      return okResponse({ voided: true, ticketNumber: ticket.ticketNumber });
    },
  );
}
