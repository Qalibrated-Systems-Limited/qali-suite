import { apiKeyAuth } from "@/lib/integrations/middleware/apiKeyAuth";
import { okResponse } from "@/lib/integrations/utils/envelope";

// ============================================
// GET /api/v1/auth/token-info
// Lets an external system verify their API key
// and inspect what it is allowed to do.
// Useful as a connectivity smoke test.
// ============================================

export async function GET(request) {
  const ctx = await apiKeyAuth(request);
  if (!ctx.ok) return ctx.response;

  return okResponse({
    valid: true,
    keyName: ctx.keyName,
    connectorType: ctx.connectorType,
    scopes: ctx.scopes,
    environment: ctx.environment,
    rateLimit: {
      requestsPerMinute: ctx.key.rateLimit?.requestsPerMinute ?? 60,
      remaining: ctx.rateLimit.remaining,
    },
  });
}
