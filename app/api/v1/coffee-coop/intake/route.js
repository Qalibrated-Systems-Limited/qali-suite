import dbConnect from "@/app/config/dbConnect";
import FarmerIntakeEntry from "@/app/models/farmerIntakeEntry";
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

  await dbConnect();

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
  const ctx = await apiKeyAuth(request, { requireScope: "inventory:read" });
  if (!ctx.ok) return ctx.response;

  await dbConnect();

  const { searchParams } = new URL(request.url);
  const seasonId      = searchParams.get("seasonId");
  const farmerCode    = searchParams.get("farmerCode");
  const grade         = searchParams.get("grade");
  const paymentStatus = searchParams.get("paymentStatus");
  const status        = searchParams.get("status");
  const limit  = Math.min(parseInt(searchParams.get("limit")  || "50"), 200);
  const offset =          parseInt(searchParams.get("offset") || "0");

  const query = { companyId: ctx.companyId };
  if (seasonId)      query.seasonId      = seasonId;
  if (farmerCode)    query.farmerCode    = farmerCode;
  if (grade)         query.grade         = grade;
  if (paymentStatus) query.paymentStatus = paymentStatus;
  if (status)        query.status        = status;

  const [entries, total] = await Promise.all([
    FarmerIntakeEntry.find(query)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    FarmerIntakeEntry.countDocuments(query),
  ]);

  return listResponse(entries.map(serializeEntry), { total, limit, offset });
}

function serializeEntry(e) {
  return {
    id:                 e._id.toString(),
    entryNumber:        e.entryNumber,
    externalRef:        e.externalRef,
    seasonId:           e.seasonId?.toString(),
    seasonName:         e.seasonName,
    farmerCode:         e.farmerCode,
    farmerName:         e.farmerName,
    farmerPhone:        e.farmerPhone,
    coffeeType:         e.coffeeType,
    grade:              e.grade,
    grossWeight:        e.grossWeight,
    moisture:           e.moisture,
    deductionWeight:    e.deductionWeight,
    netWeight:          e.netWeight,
    unitPrice:          e.unitPrice,
    currency:           e.currency,
    totalAmount:        e.totalAmount,
    paymentMethod:      e.paymentMethod,
    paymentStatus:      e.paymentStatus,
    amountPaid:         e.amountPaid,
    paymentRef:         e.paymentRef,
    paidAt:             e.paidAt?.toISOString() ?? null,
    productId:          e.productId?.toString() ?? null,
    productName:        e.productSnapshot?.name ?? null,
    journalEntryNumber: e.journalEntryNumber,
    status:             e.status,
    warnings:           e.warnings ?? [],
    notes:              e.notes,
    receivedAt:         e.receivedAt?.toISOString() ?? null,
    createdAt:          e.createdAt.toISOString(),
  };
}
