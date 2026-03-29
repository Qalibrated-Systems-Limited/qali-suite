import crypto from "crypto";
import dbConnect from "@/app/config/dbConnect";
import WebhookSubscription from "@/app/models/webhookSubscription";
import { apiKeyAuth } from "@/lib/integrations/middleware/apiKeyAuth";
import { okResponse, createdResponse, errorResponse } from "@/lib/integrations/utils/envelope";
import { Errors } from "@/lib/integrations/utils/errors";

// ============================================
// GET  /api/v1/webhooks  — list subscriptions
// POST /api/v1/webhooks  — register new subscription
// Requires scope: webhooks:manage
// ============================================

export async function GET(request) {
  const ctx = await apiKeyAuth(request, { requireScope: "webhooks:manage" });
  if (!ctx.ok) return ctx.response;

  await dbConnect();

  const subs = await WebhookSubscription.find({
    companyId: ctx.companyId,
    isActive: true,
  })
    .sort({ createdAt: -1 })
    .lean();

  return okResponse(
    subs.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      url: s.url,
      events: s.events,
      connectorType: s.connectorType,
      suspended: s.suspended,
      failureCount: s.failureCount,
      createdAt: s.createdAt.toISOString(),
    }))
  );
}

export async function POST(request) {
  const ctx = await apiKeyAuth(request, { requireScope: "webhooks:manage" });
  if (!ctx.ok) return ctx.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const { name, url, events = ["*"], connectorType = null, notes = "" } = body;

  if (!name?.trim()) return errorResponse("VALIDATION_ERROR", "name is required", 400);
  if (!url?.trim()) return errorResponse("VALIDATION_ERROR", "url is required", 400);
  if (!url.startsWith("https://") && !url.startsWith("http://localhost")) {
    return errorResponse("VALIDATION_ERROR", "url must use HTTPS", 400);
  }
  if (!Array.isArray(events) || events.length === 0) {
    return errorResponse("VALIDATION_ERROR", "events must be a non-empty array", 400);
  }

  await dbConnect();

  const secret = crypto.randomBytes(32).toString("hex");

  const sub = await WebhookSubscription.create({
    companyId: ctx.companyId,
    name: name.trim(),
    url: url.trim(),
    events,
    secret,
    connectorType: connectorType || null,
    notes: notes.trim(),
    createdBy: { id: ctx.keyId, name: ctx.keyName },
  });

  return createdResponse({
    id: sub._id.toString(),
    name: sub.name,
    url: sub.url,
    events: sub.events,
    // Secret returned once at creation — same as API key pattern
    secret,
    createdAt: sub.createdAt.toISOString(),
  });
}
