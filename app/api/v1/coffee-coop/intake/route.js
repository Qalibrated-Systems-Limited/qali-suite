import { sql } from "drizzle-orm";
import { withApiKeyTenant } from "@/app/db/apiTenant";
import { CoffeeCoopConnector } from "@/lib/integrations/connectors/coffee-coop";
import { apiKeyAuth } from "@/lib/integrations/middleware/apiKeyAuth";
import {
  okResponse,
  createdResponse,
  errorResponse,
  listResponse,
} from "@/lib/integrations/utils/envelope";

// ============================================
// POST /api/v1/coffee-coop/intake
//   Record a farmer coffee delivery.
//   Called by intake station software at
//   the collection centre.
//
// GET /api/v1/coffee-coop/intake
//   List intake entries (filterable).
//
// Required scope: inventory:write (POST)
//                 inventory:read  (GET)
//
// ── PAYLOAD (POST) ───────────────────────────
// {
//   "event":          "collection.intake_created",
//   "externalRef":    "IC-2026-001",    // station's unique ID — idempotency key
//   "farmerCode":     "M-0042",         // member number (REQUIRED)
//   "farmerName":     "Jane Wanjiku",
//   "farmerPhone":    "0712345678",
//
//   "coffeeType":     "parchment",      // cherry | parchment | mbuni  (REQUIRED)
//   "grade":          "AA",             // AA | AB | C | PB | E | TT | UG | ungraded (REQUIRED)
//
//   "grossWeight":    52.4,             // kg as weighed  (REQUIRED)
//   "deductionWeight": 2.4,             // tare / moisture deduction (default: 0)
//   "moisture":       12,               // % moisture content (informational)
//
//   "unitPrice":      85,               // KES per kg net — optional, resolved from season priceSchedule
//
//   "productCode":    "COFFEE-AA",      // matches product SKU — enables stock movement
//   "seasonRef":      "2024/25 Long Rains", // season name or _id — falls back to active season
//   "paymentMethod":  "member_account", // cash | member_account | mpesa | bank_transfer
//
//   "notes":          "Good quality, uniform beans"
// }
//
// ── GL ENTRIES ──────────────────────────────
//   DR Inventory        (coffee stock increases)
//   CR Farmer Payable   (liability to the farmer)
//
//   When farmer is paid (separate payment tx):
//   DR Farmer Payable
//   CR Cash | Bank | Mpesa
// ============================================

export async function POST(request) {
  const ctx = await apiKeyAuth(request, { requireScope: "inventory:write" });
  if (!ctx.ok) return ctx.response;

  if (ctx.connectorType !== "coffee_coop") {
    return errorResponse(
      "FORBIDDEN_SCOPE",
      `This key is issued to a "${ctx.connectorType}" connector, not coffee_coop`,
      403
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (!body.event) {
    return errorResponse(
      "VALIDATION_ERROR",
      'event is required: "collection.intake_created"',
      400
    );
  }

  // No dbConnect: the connector opens its own tenant-scoped Postgres
  // transaction, and since 0102 BaseConnector's integration log does too.
  //
  // `ctx.companyId` is a Postgres uuid now, not the Mongo id the key used to
  // carry — which the connector was passing straight to `withTenant()`, where
  // the policies cast it with `::uuid` and a 24-character ObjectId does not.
  const connector = new CoffeeCoopConnector(ctx.companyId, ctx.keyId);

  // Use externalRef as idempotency key when provided
  const externalRef = body.externalRef?.toString().trim() || null;

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
    async (tx, ctx) => {
      const { searchParams } = new URL(request.url);
      const seasonId = searchParams.get("seasonId");
      const farmerCode = searchParams.get("farmerCode");
      const grade = searchParams.get("grade");
      const paymentStatus = searchParams.get("paymentStatus");
      const status = searchParams.get("status");
      const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
      const offset = parseInt(searchParams.get("offset") || "0");

      // POSTGRES since 0058 — no companyId filter, and none is needed. RLS
      // scopes this to the key's tenant; the Mongo version wrote the filter by
      // hand on every branch.
      const rows = await tx.execute(sql`
        SELECT e.*,
               e.gross_weight::float8 AS gross_w, e.deduction_weight::float8 AS ded_w,
               e.net_weight::float8 AS net_w, e.unit_price::float8 AS unit_p,
               e.total_amount::float8 AS total_a, e.amount_paid::float8 AS paid_a,
               COUNT(*) OVER ()::int AS full_count
          FROM farmer_intake_entries e
         WHERE TRUE
           ${seasonId ? sql`AND e.season_id = ${seasonId}::uuid` : sql``}
           ${farmerCode ? sql`AND e.farmer_code = ${farmerCode}` : sql``}
           ${grade ? sql`AND e.grade = ${grade}` : sql``}
           ${paymentStatus ? sql`AND e.payment_status = ${paymentStatus}::farmer_payment_status` : sql``}
           ${status ? sql`AND e.status = ${status}::farmer_intake_status` : sql``}
         ORDER BY e.created_at DESC
         LIMIT ${limit} OFFSET ${offset}
      `);

      const total = rows.length ? Number(rows[0].full_count) : 0;
      return listResponse(rows.map(serializeEntry), { total, limit, offset });
    },
  );
}

function serializeEntry(e) {
  return {
    id: String(e.id),
    entryNumber: e.entry_number,
    externalRef: e.external_ref,
    seasonId: e.season_id,
    seasonName: e.season_name_at_intake,
    farmerCode: e.farmer_code,
    farmerName: e.farmer_name,
    farmerPhone: e.farmer_phone,
    coffeeType: e.coffee_type,
    grade: e.grade,
    grossWeight: e.gross_w,
    moisture: Number(e.moisture),
    deductionWeight: e.ded_w,
    netWeight: e.net_w,
    unitPrice: e.unit_p,
    currency: e.currency,
    totalAmount: e.total_a,
    paymentMethod: e.payment_method,
    paymentStatus: e.payment_status,
    amountPaid: e.paid_a,
    paymentRef: e.payment_ref,
    status: e.status,
    journalEntryId: e.journal_entry_id,
    stockMovementId: e.stock_movement_id,
    warnings: e.warnings ?? [],
    createdAt: e.created_at,
  };
}

