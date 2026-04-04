import dbConnect from "@/app/config/dbConnect";
import WeighbridgeTicket from "@/app/models/weighbridgeTicket";
import { apiKeyAuth } from "@/lib/integrations/middleware/apiKeyAuth";
import { okResponse, errorResponse } from "@/lib/integrations/utils/envelope";

// ============================================
// GET    /api/v1/weighbridge/tickets/:id
// DELETE /api/v1/weighbridge/tickets/:id  (void ticket)
// ============================================

export async function GET(request, { params }) {
  const ctx = await apiKeyAuth(request, { requireScope: "inventory:read" });
  if (!ctx.ok) return ctx.response;

  await dbConnect();

  const ticket = await WeighbridgeTicket.findOne({
    _id: params.id,
    companyId: ctx.companyId,
  }).lean();

  if (!ticket) return errorResponse("NOT_FOUND", "Ticket not found", 404);

  return okResponse({
    id:              ticket._id.toString(),
    ticketNumber:    ticket.ticketNumber,
    externalRef:     ticket.externalRef,
    transactionType: ticket.transactionType,
    direction:       ticket.direction,
    status:          ticket.status,
    vehicleReg:      ticket.vehicleReg,
    driverName:      ticket.driverName,
    driverPhone:     ticket.driverPhone,
    productName:     ticket.productName,
    productCode:     ticket.productCode,
    partyName:       ticket.partyName,
    firstWeight:     ticket.firstWeight,
    secondWeight:    ticket.secondWeight,
    netWeight:       ticket.netWeight,
    weightUnit:      ticket.weightUnit,
    firstWeightRecordedAt:  ticket.firstWeightRecordedAt?.toISOString()  ?? null,
    secondWeightRecordedAt: ticket.secondWeightRecordedAt?.toISOString() ?? null,
    internalRef:     ticket.internalRef,
    purchaseOrderId: ticket.purchaseOrderId?.toString() ?? null,
    purchaseOrderRef:ticket.purchaseOrderRef,
    invoiceId:       ticket.invoiceId?.toString()  ?? null,
    invoiceRef:      ticket.invoiceRef,
    invoiceItemFulfilled: ticket.invoiceItemFulfilled ?? false,
    billId:          ticket.billId?.toString()     ?? null,
    billRef:         ticket.billRef,
    transferRef:     ticket.transferRef,
    linkedTicketId:  ticket.linkedTicketId?.toString() ?? null,
    transferCleared: ticket.transferCleared ?? false,
    warnings:        ticket.warnings ?? [],
    notes:           ticket.notes,
    voidReason:      ticket.voidReason  ?? null,
    voidedAt:        ticket.voidedAt?.toISOString()    ?? null,
    completedAt:     ticket.completedAt?.toISOString() ?? null,
    createdAt:       ticket.createdAt.toISOString(),
  });
}

export async function DELETE(request, { params }) {
  const ctx = await apiKeyAuth(request, { requireScope: "inventory:write" });
  if (!ctx.ok) return ctx.response;

  await dbConnect();

  const ticket = await WeighbridgeTicket.findOne({
    _id: params.id,
    companyId: ctx.companyId,
  });

  if (!ticket) return errorResponse("NOT_FOUND", "Ticket not found", 404);
  if (ticket.status === "completed") {
    return errorResponse(
      "BUSINESS_RULE",
      "Completed tickets cannot be voided — reverse the stock movement manually",
      409
    );
  }
  if (ticket.status === "voided") {
    return errorResponse("BUSINESS_RULE", "Ticket is already voided", 409);
  }

  let body = {};
  try { body = await request.json(); } catch { /* void reason optional */ }

  ticket.status = "voided";
  ticket.voidedAt = new Date();
  ticket.voidReason = body.reason || "Voided via API";
  await ticket.save();

  return okResponse({ voided: true, ticketNumber: ticket.ticketNumber });
}
