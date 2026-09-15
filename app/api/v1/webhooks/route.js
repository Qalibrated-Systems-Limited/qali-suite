import crypto from "crypto";
import { withApiKeyTenant } from "@/app/db/apiTenant";
import {
  listWebhookSubscriptions,
  createWebhookSubscription,
} from "@/app/db/repositories/integrations";
import {
  okResponse,
  createdResponse,
  errorResponse,
} from "@/lib/integrations/utils/envelope";

// ============================================
// GET  /api/v1/webhooks  — list subscriptions
// POST /api/v1/webhooks  — register new subscription
// Requires scope: webhooks:manage
//
// POSTGRES since 0102. No companyId filter on either handler and none is
// needed: withApiKeyTenant scopes the transaction to the key's tenant and RLS
// does the rest. The Mongo version wrote the filter by hand on every query,
// which is the class of mistake this removes rather than the instance.
// ============================================

export async function GET(request) {
  return withApiKeyTenant(
    request,
    { requireScope: "webhooks:manage" },
    async (tx) => {
      const subs = await listWebhookSubscriptions(tx);
      return okResponse(
        subs.map((s) => ({
          id: s.id,
          name: s.name,
          url: s.url,
          events: s.events,
          connectorType: s.connectorType,
          suspended: s.suspended,
          failureCount: s.failureCount,
          createdAt: s.createdAt,
        })),
      );
    },
  );
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const { name, url, events = ["*"], connectorType = null, notes = "" } = body;

  if (!name?.trim())
    return errorResponse("VALIDATION_ERROR", "name is required", 400);
  if (!url?.trim())
    return errorResponse("VALIDATION_ERROR", "url is required", 400);
  if (!url.startsWith("https://") && !url.startsWith("http://localhost")) {
    return errorResponse("VALIDATION_ERROR", "url must use HTTPS", 400);
  }
  if (!Array.isArray(events) || events.length === 0) {
    return errorResponse(
      "VALIDATION_ERROR",
      "events must be a non-empty array",
      400,
    );
  }

  return withApiKeyTenant(
    request,
    { requireScope: "webhooks:manage" },
    async (tx, ctx) => {
      const secret = crypto.randomBytes(32).toString("hex");

      const created = await createWebhookSubscription(tx, ctx.companyId, {
        name: name.trim(),
        url: url.trim(),
        events,
        secret,
        connectorType: connectorType || null,
        notes: (notes || "").trim(),
        /**
         * The PERSON the key acts on behalf of, not the key.
         *
         * Mongo recorded `{ id: ctx.keyId, name: ctx.keyName }` here, which
         * puts an integration key's id in a column that 0036 will make a
         * foreign key to `users` — so every subscription registered through
         * the API would have failed that migration. Null when the key predates
         * `createdBy` being recorded; a missing actor is better than an
         * invented one.
         */
        createdById: ctx.actorId,
        createdByName: ctx.actorName,
      });

      const subs = await listWebhookSubscriptions(tx);
      const sub = subs.find((s) => s.id === created.id);

      return createdResponse({
        id: created.id,
        name: sub?.name ?? name.trim(),
        url: sub?.url ?? url.trim(),
        events: sub?.events ?? events,
        // Secret returned once at creation — same as the API key pattern.
        secret,
        createdAt: sub?.createdAt ?? null,
      });
    },
  );
}
