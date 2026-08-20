import { withApiKeyTenant } from "@/app/db/apiTenant";
import * as invoices from "@/app/db/repositories/invoices";
import {
  invoiceDataSchema,
  toRepositoryInput,
} from "@/app/db/validation/invoices";
import {
  listResponse,
  createdResponse,
  errorResponse,
} from "@/lib/integrations/utils/envelope";

// ============================================
// GET  /api/v1/invoices  — list invoices      (scope: invoices:read)
// POST /api/v1/invoices  — create an invoice  (scope: invoices:write)
//
// THE REFERENCE FOR BUILDING ON POSTGRES. The shape to copy is:
//
//   withApiKeyTenant(request, { requireScope }, async (tx, ctx) => { … })
//
// which authenticates the key, resolves its tenant to a Postgres uuid, and
// opens a transaction with app.company_id and app.user_id set. Inside the
// callback every query is scoped by row-level security; there is no companyId
// filter to remember and none to forget.
//
// Call REPOSITORIES from here, not the server actions in app/db/actions —
// those are `"use server"` functions taking (prevState, FormData) and reading
// a NextAuth session, which an API key does not have. The repositories are
// where the invariants live, so nothing is lost by going straight to them.
// ============================================

export async function GET(request) {
  return withApiKeyTenant(
    request,
    { requireScope: "invoices:read" },
    async (tx) => {
      const url = new URL(request.url);
      const status = url.searchParams.get("status");
      if (status && !["draft", "completed", "cancelled"].includes(status)) {
        return errorResponse(
          "VALIDATION_ERROR",
          "status must be draft, completed or cancelled",
          400,
        );
      }

      // The repository caps limit at 200 itself; parsing here only keeps a
      // non-numeric ?limit from becoming NaN and silently meaning "default".
      const rawLimit = url.searchParams.get("limit");
      const limit = rawLimit ? Number(rawLimit) : undefined;
      if (rawLimit && !Number.isFinite(limit)) {
        return errorResponse("VALIDATION_ERROR", "limit must be a number", 400);
      }

      const offset = Number(url.searchParams.get("offset")) || 0;
      const rows = await invoices.listInvoices(tx, {
        limit,
        offset,
        status: status ?? undefined,
      });

      // listResponse, not okResponse: this endpoint pages, and a bare array
      // gives a caller no way to know whether it has seen everything.
      return listResponse(rows, {
        limit: limit ?? 50,
        offset,
        returned: rows.length,
      });
    },
  );
}

export async function POST(request) {
  return withApiKeyTenant(
    request,
    { requireScope: "invoices:write" },
    async (tx, ctx) => {
      let body;
      try {
        body = await request.json();
      } catch {
        return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
      }

      // The SAME schema the dashboard form validates against. An endpoint that
      // re-stated these rules would be a second answer to "what is a valid
      // invoice", and the two would part company the first time one is fixed.
      const parsed = invoiceDataSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Invoice payload failed validation",
          400,
          { fieldErrors: parsed.error.flatten().fieldErrors },
        );
      }

      const invoice = await invoices.createInvoice(tx, {
        companyId: ctx.companyId,
        ...toRepositoryInput(parsed.data),
        // Who to hold to this row. The user who created the key, not the key —
        // see app/db/apiTenant.ts on why an "apikey:<id>" actor would fail the
        // foreign key 0036 says is coming.
        createdById: ctx.actorId,
        createdByName: ctx.actorName ?? ctx.keyName,
        createdByRole: "api",
      });

      return createdResponse({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        status: invoice.status,
      });
    },
  );
}
