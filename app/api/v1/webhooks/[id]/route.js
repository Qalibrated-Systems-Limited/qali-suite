import { withApiKeyTenant } from "@/app/db/apiTenant";
import { deactivateWebhookSubscription } from "@/app/db/repositories/integrations";
import { okResponse, errorResponse } from "@/lib/integrations/utils/envelope";

// ============================================
// DELETE /api/v1/webhooks/:id  — remove subscription
// Requires scope: webhooks:manage
//
// POSTGRES since 0102.
// ============================================

export async function DELETE(request, { params }) {
  /**
   * `params` is a Promise in Next 15. The Mongo version read `params.id`
   * synchronously, which is `undefined` — so the query became
   * `{ _id: undefined, companyId }` and Mongoose matched the FIRST
   * subscription for the tenant. Deleting webhook A could deactivate webhook
   * B. Awaiting it is the fix; the 404 below is what an unknown id gets now.
   */
  const { id } = await params;
  if (!id) return errorResponse("VALIDATION_ERROR", "id is required", 400);

  return withApiKeyTenant(
    request,
    { requireScope: "webhooks:manage" },
    async (tx) => {
      // No companyId predicate: RLS scopes this to the key's tenant, so an id
      // belonging to another company is simply not found.
      const found = await deactivateWebhookSubscription(tx, id);
      if (!found) {
        return errorResponse("NOT_FOUND", "Webhook subscription not found", 404);
      }
      return okResponse({ deleted: true, id });
    },
  );
}
