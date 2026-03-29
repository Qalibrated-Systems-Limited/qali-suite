import dbConnect from "@/app/config/dbConnect";
import WebhookSubscription from "@/app/models/webhookSubscription";
import { apiKeyAuth } from "@/lib/integrations/middleware/apiKeyAuth";
import { okResponse, errorResponse } from "@/lib/integrations/utils/envelope";

// ============================================
// DELETE /api/v1/webhooks/:id  — remove subscription
// POST   /api/v1/webhooks/:id/ping — test delivery
// Requires scope: webhooks:manage
// ============================================

export async function DELETE(request, { params }) {
  const ctx = await apiKeyAuth(request, { requireScope: "webhooks:manage" });
  if (!ctx.ok) return ctx.response;

  await dbConnect();

  const sub = await WebhookSubscription.findOne({
    _id: params.id,
    companyId: ctx.companyId,
  });

  if (!sub) return errorResponse("NOT_FOUND", "Webhook subscription not found", 404);

  sub.isActive = false;
  await sub.save();

  return okResponse({ deleted: true, id: params.id });
}
