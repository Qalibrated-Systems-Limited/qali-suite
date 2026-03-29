# Integration Layer — Technical Specification

> **Version:** 1.0
> **Status:** Planning
> **Scope:** External system integration — weighbridges, collection centers, logistics, millers, and any future connector

---

## Table of Contents

1. [Philosophy & Design Principles](#1-philosophy--design-principles)
2. [Architecture Overview](#2-architecture-overview)
3. [Authentication & Security](#3-authentication--security)
4. [API Gateway — Inbound](#4-api-gateway--inbound)
5. [Webhook Engine — Outbound](#5-webhook-engine--outbound)
6. [Connector / Adapter Pattern](#6-connector--adapter-pattern)
7. [Data Models](#7-data-models)
8. [Vertical Connectors](#8-vertical-connectors)
   - 8a. [Weighbridge](#8a-weighbridge-connector)
   - 8b. [Coffee Collection Center](#8b-coffee-collection-center-connector)
   - 8c. [Logistics / Transport](#8c-logistics--transport-connector)
   - 8d. [Miller / Grain Processor](#8d-miller--grain-processor-connector)
9. [Error Handling & Retry](#9-error-handling--retry)
10. [Sync Log & Audit Trail](#10-sync-log--audit-trail)
11. [Rate Limiting & Quotas](#11-rate-limiting--quotas)
12. [API Versioning](#12-api-versioning)
13. [Implementation Phases](#13-implementation-phases)
14. [File Structure](#14-file-structure)

---

## 1. Philosophy & Design Principles

### The Single Event Rule
> *The same real-world event must never be recorded by two people in two systems.*

A truck crossing a weighbridge, a farmer handing in coffee, a bag leaving a warehouse — each is a single physical event. The integration layer ensures it is recorded once, in the originating system, and that record flows automatically into the ERP. Manual re-entry is a failure of integration, not a workflow.

### Core Principles

| Principle | Meaning |
|-----------|---------|
| **External systems own their data** | A weighbridge ticket is owned by the weighbridge. The ERP derives a goods receipt from it — it does not replace it. |
| **The ERP is the system of record for financials** | All monetary consequence (inventory value, liabilities, revenue) lives in the ERP regardless of where the transaction originated. |
| **Connectors enforce business rules** | Raw data from external systems is always validated and mapped through a connector before touching core ERP entities. Never write directly to inventory or accounting from an external payload. |
| **Idempotency everywhere** | Every inbound request must be safe to retry. Duplicate delivery of the same event must not create duplicate records. |
| **Fail loudly, recover gracefully** | Failures are logged, alerted, and retried. They are never silently swallowed. |
| **Tenant isolation is absolute** | An API key belongs to one company. It can never read or write data belonging to another tenant. |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        EXTERNAL SYSTEMS                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  Weighbridge │  │  Collection  │  │  Logistics / Miller / │ │
│  │  Software    │  │  Mobile App  │  │  Any Future System    │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘ │
└─────────┼────────────────┼───────────────────────┼─────────────┘
          │  HTTPS + HMAC  │                        │
          ▼                ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API GATEWAY  /api/v1/                       │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │              MIDDLEWARE STACK                           │  │
│   │  1. API Key Auth → resolve companyId + scopes           │  │
│   │  2. Tenant scope injection                              │  │
│   │  3. Rate limiter                                        │  │
│   │  4. Request logger (SyncLog entry: status=received)     │  │
│   │  5. HMAC signature verification (optional per key)      │  │
│   └─────────────────────┬───────────────────────────────────┘  │
│                         │                                       │
│   ┌─────────────────────▼───────────────────────────────────┐  │
│   │              CONNECTOR REGISTRY                         │  │
│   │  Looks up connectorType from API key                    │  │
│   │  Routes payload to the correct Connector Adapter        │  │
│   └─────────────────────┬───────────────────────────────────┘  │
│                         │                                       │
│   ┌─────────────────────▼───────────────────────────────────┐  │
│   │              CONNECTOR ADAPTERS                         │  │
│   │                                                         │  │
│   │  WeighbridgeConnector  │  CoffeeCoopConnector           │  │
│   │  LogisticsConnector    │  MillerConnector                │  │
│   │  GenericConnector      │  [future...]                    │  │
│   │                                                         │  │
│   │  Each adapter:                                          │  │
│   │  - Validates the payload (Zod schema)                   │  │
│   │  - Maps external fields → internal ERP fields           │  │
│   │  - Enforces business rules                              │  │
│   │  - Calls the appropriate ERP service                    │  │
│   └─────────────────────┬───────────────────────────────────┘  │
│                         │                                       │
└─────────────────────────┼───────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
   │  Inventory  │ │  Accounting │ │     HR      │
   │  Service   │ │   Service   │ │   Service   │
   └─────────────┘ └─────────────┘ └─────────────┘
          │               │               │
          └───────────────┼───────────────┘
                          │
          ┌───────────────▼───────────────┐
          │         WEBHOOK ENGINE        │
          │  Fires events to registered   │
          │  subscriber URLs when ERP     │
          │  state changes                │
          └───────────────────────────────┘
                          │
                          ▼
               External systems receive
               push notifications of
               what the ERP did
```

### The Request Lifecycle

```
External system sends POST /api/v1/weighbridge/tickets
         │
         ├─ Middleware authenticates API key → resolves companyId
         ├─ SyncLog created: { status: "received", externalRef }
         ├─ Connector adapter validates payload (Zod)
         ├─ Adapter maps payload → internal format
         ├─ Idempotency check: has externalRef been processed before?
         │    YES → return cached response, skip processing
         │    NO  → continue
         ├─ ERP service called (e.g. createGoodsReceipt)
         ├─ SyncLog updated: { status: "processed", internalRef }
         ├─ Webhook event fired: "inventory.receipt_created"
         └─ 200 response returned with internalRef
```

---

## 3. Authentication & Security

### API Key Structure

Every external system is issued an API key pair:

```
Key:    qls_live_k_[32 random chars]   ← sent in Authorization header
Secret: qls_live_s_[64 random chars]   ← used for HMAC signing (optional)
```

Keys are stored **hashed** (SHA-256) in the database. The plaintext key is shown only once at creation — just like Stripe, GitHub, and Twilio.

### Request Authentication

```http
POST /api/v1/weighbridge/tickets
Authorization: Bearer qls_live_k_abc123...
Content-Type: application/json
X-Timestamp: 1711584000
X-Signature: sha256=abcdef...   ← optional HMAC of (timestamp + body)
```

The middleware resolves the key to a `companyId` and a `scopes` array:

```js
// Resolved API key context (injected into every request)
{
  companyId: "65f...",
  keyId: "67a...",
  connectorType: "weighbridge",
  scopes: ["inventory:write", "contacts:read"],
  rateLimit: { requestsPerMinute: 60 }
}
```

### Scopes

| Scope | Permits |
|-------|---------|
| `inventory:read` | Read stock levels, products |
| `inventory:write` | Create receipts, dispatches, adjustments |
| `contacts:read` | Read parties / suppliers / customers |
| `contacts:write` | Create or update parties |
| `orders:read` | Read purchase and sales orders |
| `orders:write` | Create orders, update status |
| `invoices:read` | Read invoices |
| `invoices:write` | Create invoices, mark paid |
| `hr:read` | Read employee list (for driver lookup, etc.) |
| `collection:write` | Create farmer intake entries (coffee coop only) |
| `webhooks:manage` | Register / delete webhook subscriptions |

### HMAC Signature (recommended for weighbridge)

For systems at a fixed location (weighbridge PC), HMAC signing is enforced. The external system signs:

```
message = HTTP_METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + SHA256(BODY)
signature = HMAC-SHA256(message, secret)
```

Replay attacks are prevented by rejecting requests where `X-Timestamp` is more than **300 seconds** from server time.

---

## 4. API Gateway — Inbound

### Base URL

```
/api/v1/
```

All routes are tenant-scoped via API key. No companyId in the URL.

### Route Map

```
AUTH
  POST   /api/v1/auth/token-info        → inspect current API key

CONTACTS
  GET    /api/v1/contacts               → list (search, type filter)
  GET    /api/v1/contacts/:id           → single
  POST   /api/v1/contacts               → create
  PATCH  /api/v1/contacts/:id           → update

PRODUCTS
  GET    /api/v1/products               → list (search, category)
  GET    /api/v1/products/:id           → single
  GET    /api/v1/products/:id/stock     → current stock levels

INVENTORY
  POST   /api/v1/inventory/receipts     → create goods receipt
  POST   /api/v1/inventory/dispatches   → create dispatch / delivery note
  POST   /api/v1/inventory/adjustments  → stock adjustment

WEIGHBRIDGE
  POST   /api/v1/weighbridge/tickets    → create / update ticket
  GET    /api/v1/weighbridge/tickets/:ticketNumber → get status
  PATCH  /api/v1/weighbridge/tickets/:ticketNumber → second weigh / complete

COLLECTION
  GET    /api/v1/collection/seasons     → list open seasons
  GET    /api/v1/collection/seasons/:id → season detail + totals
  POST   /api/v1/collection/intake      → create farmer intake entry
  GET    /api/v1/collection/farmer/:memberNumber → farmer's season total
  PATCH  /api/v1/collection/intake/:id  → correct an entry (with reason)

ORDERS
  GET    /api/v1/orders/purchase        → list POs (status filter)
  GET    /api/v1/orders/purchase/:id    → single PO
  GET    /api/v1/orders/sales           → list SOs
  GET    /api/v1/orders/sales/:id       → single SO

INVOICES
  GET    /api/v1/invoices               → list
  GET    /api/v1/invoices/:id           → single
  POST   /api/v1/invoices               → create
  PATCH  /api/v1/invoices/:id/status    → update status

WEBHOOKS
  GET    /api/v1/webhooks               → list subscriptions
  POST   /api/v1/webhooks               → register new subscription
  DELETE /api/v1/webhooks/:id           → remove subscription
  POST   /api/v1/webhooks/:id/ping      → test delivery

SYNC
  GET    /api/v1/sync/logs              → query sync log for this key
  GET    /api/v1/sync/logs/:id          → single log entry
```

### Standard Response Envelope

Every response follows this structure:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-03-28T08:00:00Z",
    "companyId": "65f..."
  }
}
```

Error response:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "netWeight must be a positive number",
    "field": "netWeight",
    "details": [ ... ]
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-03-28T08:00:00Z"
  }
}
```

### Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `AUTH_INVALID_KEY` | 401 | API key not found or revoked |
| `AUTH_INVALID_SIGNATURE` | 401 | HMAC signature mismatch |
| `AUTH_EXPIRED_TIMESTAMP` | 401 | Request timestamp too old |
| `FORBIDDEN_SCOPE` | 403 | Key lacks required scope |
| `TENANT_MISMATCH` | 403 | Attempted cross-tenant access |
| `VALIDATION_ERROR` | 422 | Payload failed schema validation |
| `DUPLICATE_REQUEST` | 409 | externalRef already processed |
| `NOT_FOUND` | 404 | Resource not found |
| `BUSINESS_RULE` | 422 | Violated a business rule (season closed, etc.) |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## 5. Webhook Engine — Outbound

### Event Catalogue

Events are fired whenever an ERP state transition occurs, regardless of whether it was triggered by an API call or by a user in the UI.

```
INVENTORY
  inventory.receipt_created          goods received into stock
  inventory.dispatch_created         goods dispatched from stock
  inventory.adjustment_posted        manual stock adjustment
  inventory.low_stock_alert          product drops below reorder point

WEIGHBRIDGE
  weighbridge.ticket_first_weighed   first weighing recorded
  weighbridge.ticket_completed       both weighings done, net calculated
  weighbridge.ticket_voided          ticket cancelled

COLLECTION
  collection.intake_created          farmer intake entry recorded
  collection.intake_corrected        entry amended (with reason)
  collection.season_closed           season closed, pricing set
  collection.payments_calculated     farmer payment amounts ready
  collection.payment_released        payments approved and disbursed

ORDERS
  order.purchase_created
  order.purchase_approved
  order.sales_created
  order.sales_approved

INVOICES
  invoice.created
  invoice.paid
  invoice.overdue

HR
  hr.employee_created
  hr.payroll_approved
  hr.loan_approved
  hr.loan_disbursed
```

### Webhook Payload Structure

```json
{
  "event": "weighbridge.ticket_completed",
  "id": "evt_abc123",
  "timestamp": "2026-03-28T08:00:00Z",
  "companyId": "65f...",
  "data": {
    "ticketNumber": "WB-000456",
    "direction": "inbound",
    "vehicleReg": "KBZ 123A",
    "netWeight": 4820,
    "productId": "prod_maize_001",
    "supplierId": "party_abc",
    "receiptId": "REC-000789",
    "completedAt": "2026-03-28T07:55:00Z"
  },
  "previousState": null
}
```

### Delivery Mechanism

```
Event fires
    │
    ├─ Look up all active webhook subscriptions for this companyId + event
    │
    ├─ For each subscription:
    │     POST payload to subscriber URL
    │     Header: X-QaliSuite-Event: weighbridge.ticket_completed
    │     Header: X-QaliSuite-Signature: sha256=...
    │     Header: X-QaliSuite-Delivery: evt_abc123
    │     Timeout: 10 seconds
    │
    ├─ 2xx response → mark delivered
    │
    └─ Non-2xx or timeout → schedule retry
          Retry schedule: 1m → 5m → 15m → 1h → 6h → 24h (max 6 attempts)
          After 6 failures → mark as dead, notify account owner
```

### Subscriber Verification

When a webhook is registered, a **challenge ping** is sent. The subscriber must echo back a `challenge` field to prove they control the endpoint:

```json
POST to subscriber URL:
{
  "event": "webhook.ping",
  "challenge": "random_string_abc"
}

Expected response:
{
  "challenge": "random_string_abc"
}
```

---

## 6. Connector / Adapter Pattern

Each integration type has a dedicated connector that lives in `lib/integrations/connectors/`. A connector has three responsibilities:

```
1. VALIDATE     Zod schema — reject bad data at the boundary
2. MAP          Transform external field names/units to internal ERP fields
3. EXECUTE      Call the appropriate ERP service with the mapped data
```

### Connector Interface

```js
// lib/integrations/connectors/base.js

class BaseConnector {
  constructor(companyId, keyId) {
    this.companyId = companyId;
    this.keyId = keyId;
  }

  // Every connector must implement these:
  async validate(payload) { throw new Error("Not implemented"); }
  async map(validatedPayload) { throw new Error("Not implemented"); }
  async execute(mappedPayload) { throw new Error("Not implemented"); }

  // Orchestrates the three steps + idempotency check
  async process(payload, externalRef) {
    // 1. Idempotency
    const existing = await SyncLog.findOne({
      companyId: this.companyId,
      externalRef,
      status: "processed"
    });
    if (existing) return { cached: true, internalRef: existing.internalRef };

    // 2. Validate
    const validated = await this.validate(payload);

    // 3. Map
    const mapped = await this.map(validated);

    // 4. Execute
    const result = await this.execute(mapped);

    // 5. Log
    await SyncLog.create({
      companyId: this.companyId,
      keyId: this.keyId,
      externalRef,
      internalRef: result.internalRef,
      status: "processed",
      direction: "inbound",
      payload,
      result
    });

    return result;
  }
}
```

### Connector Registry

```js
// lib/integrations/connectors/registry.js

import { WeighbridgeConnector }  from "./weighbridge";
import { CoffeeCoopConnector }   from "./coffee-coop";
import { LogisticsConnector }    from "./logistics";
import { MillerConnector }       from "./miller";
import { GenericConnector }      from "./generic";

const REGISTRY = {
  weighbridge:    WeighbridgeConnector,
  coffee_coop:    CoffeeCoopConnector,
  logistics:      LogisticsConnector,
  miller:         MillerConnector,
  generic:        GenericConnector,
};

export function getConnector(connectorType, companyId, keyId) {
  const Connector = REGISTRY[connectorType] ?? GenericConnector;
  return new Connector(companyId, keyId);
}
```

---

## 7. Data Models

### ApiKey

```js
{
  _id,
  companyId,                    // tenant owner
  name,                         // "Weighbridge Gate 1"
  keyHash,                      // SHA-256 of plaintext key
  secretHash,                   // SHA-256 of secret (for HMAC)
  connectorType,                // "weighbridge" | "coffee_coop" | "logistics" | "miller" | "generic"
  scopes: [String],             // ["inventory:write", "contacts:read"]
  rateLimit: {
    requestsPerMinute: Number,  // default 60
    requestsPerDay: Number      // default 5000
  },
  isActive: Boolean,
  lastUsedAt: Date,
  lastUsedIp: String,
  expiresAt: Date,              // null = never
  createdBy,                    // userId
  createdAt,
  notes                         // admin notes about this key
}
```

### WebhookSubscription

```js
{
  _id,
  companyId,
  url,                          // "https://theirapp.co.ke/webhooks/erp"
  events: [String],             // ["invoice.paid", "inventory.receipt_created"]
  secret,                       // for signing outbound payloads
  isActive: Boolean,
  isVerified: Boolean,          // challenge ping passed
  failureCount: Number,         // consecutive failures
  lastDeliveredAt: Date,
  lastFailedAt: Date,
  lastFailureReason: String,
  createdAt,
  createdBy
}
```

### SyncLog

```js
{
  _id,
  companyId,
  keyId,
  direction: "inbound" | "outbound",

  // What happened
  event: String,                // "weighbridge.ticket_completed"
  externalRef: String,          // their ID — used for idempotency
  internalRef: String,          // our ID (receiptId, invoiceId, etc.)

  // The data
  rawPayload: Object,           // exactly what we received
  mappedPayload: Object,        // after connector mapping
  result: Object,               // what the ERP service returned

  // Status
  status: "received" | "processing" | "processed" | "failed" | "skipped",
  error: String,
  attempts: Number,
  lastAttemptAt: Date,

  // Outbound webhook tracking
  webhookSubscriptionId,
  httpStatus: Number,           // response code from subscriber
  responseBody: String,

  processedAt: Date,
  createdAt: Date
}
// Indexes: companyId + status, companyId + externalRef, companyId + internalRef
```

### WeighbridgeTicket

```js
{
  _id,
  companyId,
  ticketNumber,                 // WB-YYYYMMDD-NNNN (auto)
  externalTicketNumber,         // from weighbridge software

  direction: "inbound" | "outbound",
  materialCategory: "raw_material" | "finished_goods" | "packaging" | "waste",

  // Vehicle
  vehicleReg,
  driverName,
  driverPhone,

  // Counterparty
  partyId,                      // supplier (inbound) or customer (outbound)
  partyName,                    // denormalized

  // Product
  productId,
  productName,                  // denormalized
  expectedQuantity,             // from linked PO/SO (kg)

  // Weighing
  grossWeight: Number,          // kg
  grossWeightAt: Date,
  grossWeightOperator: String,

  tareWeight: Number,           // kg
  tareWeightAt: Date,
  tareWeightOperator: String,

  netWeight: Number,            // calculated: gross - tare (kg)
  weightVariance: Number,       // netWeight - expectedQuantity

  // Linked ERP documents
  purchaseOrderId,              // pre-linked PO (inbound)
  salesOrderId,                 // pre-linked SO (outbound)
  receiptId,                    // goods receipt created on completion (inbound)
  deliveryNoteId,               // delivery note created on completion (outbound)

  status: "open" | "first_weighed" | "completed" | "voided",
  voidReason: String,
  notes: String,

  // Sync
  syncSource: "api" | "manual" | "csv_import",
  syncedAt: Date,

  createdAt, updatedAt
}
```

### CoffeeSeason

```js
{
  _id,
  companyId,
  name,                         // "Main Crop 2025/26"
  cropType: "main" | "fly",
  openDate: Date,
  closeDate: Date,

  status: "upcoming" | "open" | "closed" | "payments_calculated" | "paid",

  // Collection points in this season
  collectionCenters: [{
    name: String,
    location: String,
    officer: String,
    officerPhone: String
  }],

  // Grades accepted and pricing (set at close)
  grades: [{
    grade: String,              // "AB" | "C" | "PB" | "TT" | "mbuni"
    coffeeType: String,         // "cherry" | "mbuni"
    pricePerKg: Number,         // set when season closes
    estimatedPrice: Number      // indicative price shown during season
  }],

  // Season-end totals (calculated at close)
  totals: {
    totalFarmers: Number,
    totalIntakeKg: Number,
    totalPaymentKES: Number,
    totalDeductionsKES: Number,
    totalNetPaymentKES: Number
  },

  createdBy, createdAt, updatedAt
}
```

### FarmerIntakeEntry

```js
{
  _id,
  companyId,
  season,                       // ref CoffeeSeason

  // Farmer
  partyId,                      // ref Party/Contact
  memberNumber,                 // cooperative member number
  farmerName,                   // denormalized

  // Collection
  collectionCenter: String,
  collectionDate: Date,
  collectionOfficer: String,
  receiptNumber: String,        // paper receipt number

  // Coffee
  coffeeType: "cherry" | "mbuni",
  grade: String,                // "AB" | "C" | "PB" | "TT" | "mbuni"

  // Weight
  grossWeight: Number,          // kg (with sack)
  sackWeight: Number,           // standard deduction per sack
  numberOfSacks: Number,
  netWeight: Number,            // grossWeight - (numberOfSacks × sackWeight)
  moistureContent: Number,      // % if measured

  // ERP link
  purchaseReceiptId,            // created from this entry

  // Correction history
  corrections: [{
    correctedBy,
    correctedAt: Date,
    reason: String,
    previousNetWeight: Number,
    newNetWeight: Number
  }],

  status: "draft" | "confirmed" | "paid",
  notes: String,

  createdAt, updatedAt
}
// Indexes: companyId + season, companyId + partyId + season, companyId + memberNumber
```

### FarmerSeasonPayment

```js
{
  _id,
  companyId,
  season,                       // ref CoffeeSeason
  partyId,                      // ref Party/Contact (farmer)
  memberNumber,
  farmerName,                   // denormalized

  // Delivery breakdown by grade
  deliveries: [{
    grade: String,
    coffeeType: String,
    totalKg: Number,
    pricePerKg: Number,
    amount: Number
  }],
  grossPayment: Number,

  // Deductions
  deductions: [{
    description: String,        // "Fertilizer advance" | "Loan repayment" | "Levy 1%"
    reference: String,          // loan number, invoice number, etc.
    amount: Number
  }],
  totalDeductions: Number,

  netPayment: Number,           // grossPayment - totalDeductions

  // Settlement
  paymentMethod: "mpesa" | "bank" | "cash" | "sacco",
  accountRef: String,           // M-Pesa number, bank account
  paidAt: Date,

  // Accounting
  apVoucherId,                  // AP voucher in accounting module
  journalEntryId,

  status: "draft" | "approved" | "paid" | "disputed",
  disputeReason: String,

  approvedBy, approvedAt,
  createdAt, updatedAt
}
```

---

## 8. Vertical Connectors

### 8a. Weighbridge Connector

**What it does:** Receives a weighbridge ticket from gate software and, when the ticket is complete (both weighings done), automatically creates a Goods Receipt (inbound) or Delivery Note (outbound) in the ERP.

**Two-phase ticket lifecycle:**

```
Phase 1 — First Weigh
POST /api/v1/weighbridge/tickets
{
  "externalTicketNumber": "WB-00456",
  "direction": "inbound",
  "vehicleReg": "KBZ 123A",
  "driverName": "John Kamau",
  "grossWeight": 19840,
  "grossWeightAt": "2026-03-28T06:00:00Z",
  "productCode": "MAIZE_WHITE",
  "supplierCode": "SUP-012",
  "purchaseOrderNumber": "PO-000345",
  "operator": "Gate1-Operator"
}
→ 201 { ticketNumber: "WB-20260328-0012", status: "first_weighed" }

Phase 2 — Second Weigh (ticket completes)
PATCH /api/v1/weighbridge/tickets/WB-20260328-0012
{
  "tareWeight": 14820,
  "tareWeightAt": "2026-03-28T06:45:00Z",
  "operator": "Gate1-Operator"
}
→ 200 {
    ticketNumber: "WB-20260328-0012",
    netWeight: 5020,
    status: "completed",
    receiptId: "REC-000789",         ← created automatically
    weightVariance: +20              ← vs PO expected qty
  }
```

**Business rules enforced by connector:**
- Tare weight must be less than gross weight
- Net weight must be positive
- If variance > 5% of PO quantity → flag for review, still create receipt but mark `requiresReview: true`
- Voided tickets do not create inventory movements
- A completed ticket cannot be re-completed (idempotent)

**Field mapping:**

| External Field | Internal Field | Transform |
|---------------|----------------|-----------|
| `externalTicketNumber` | `externalTicketId` | none |
| `direction` | `direction` | none |
| `vehicleReg` | `vehicleReg` | uppercase |
| `grossWeight` | `grossWeight` | validate > 0 |
| `tareWeight` | `tareWeight` | validate < grossWeight |
| `grossWeight - tareWeight` | `netWeight` | calculated |
| `productCode` | `productId` | lookup Product by code |
| `supplierCode` | `partyId` | lookup Party by supplierCode |
| `purchaseOrderNumber` | `purchaseOrderId` | lookup PO by number |

---

### 8b. Coffee Collection Center Connector

**What it does:** Receives farmer intake entries from a mobile collection app (online or queued from offline) and creates purchase receipts tracking the coffee against a season.

**Intake entry:**

```
POST /api/v1/collection/intake
{
  "externalRef": "mobile_entry_uuid_xyz",   ← from mobile app (idempotency key)
  "seasonId": "SZN-2025-MAIN",
  "memberNumber": "COOP-001234",
  "coffeeType": "cherry",
  "grade": "AB",
  "grossWeight": 42.5,
  "numberOfSacks": 1,
  "collectionCenter": "Karatina Center A",
  "collectionDate": "2026-03-28",
  "collectionOfficer": "Mary Wangui",
  "receiptNumber": "KAR-A-00892",
  "moistureContent": 68
}
→ 201 {
    entryId: "INT-000892",
    farmerName: "Peter Mwangi",
    netWeight: 41.0,             ← 42.5 - 1.5kg sack
    seasonRunningTotal: 384.5,   ← this farmer's total this season
    receiptId: "REC-001245"
  }
```

**Farmer season summary (for mobile app display):**

```
GET /api/v1/collection/farmer/COOP-001234/season/SZN-2025-MAIN
→ 200 {
    memberNumber: "COOP-001234",
    farmerName: "Peter Mwangi",
    season: "Main Crop 2025/26",
    deliveries: [
      { date: "2026-03-28", grade: "AB", netWeight: 41.0 },
      { date: "2026-03-21", grade: "AB", netWeight: 38.5 },
      ...
    ],
    totals: {
      AB: { kg: 234.5, estimatedPayment: 19932.50 },
      C:  { kg: 45.0,  estimatedPayment: 2700.00  }
    },
    totalKg: 279.5,
    estimatedGrossPayment: 22632.50,
    knownDeductions: 3500.00,
    estimatedNetPayment: 19132.50
  }
```

**Business rules enforced by connector:**
- Season must be `status: "open"` — reject if closed
- `memberNumber` must resolve to a registered farmer Party
- `moistureContent` outside 65–85% for cherry triggers a warning (not a rejection)
- Corrections allowed with reason — creates an audit trail, never deletes original
- Sack weight is taken from season configuration (`sackWeightKg` per coffee type)

---

### 8c. Logistics / Transport Connector

**What it does:** Links a transport management system (TMS) to the ERP, syncing dispatch orders, delivery confirmations, and vehicle/driver activity.

**Key flows:**

```
Outbound dispatch (TMS pushes when truck is dispatched)
POST /api/v1/inventory/dispatches
{
  "externalRef": "TMS-DISPATCH-0045",
  "salesOrderNumber": "SO-000123",
  "vehicleReg": "KCA 456B",
  "driverEmployeeNumber": "EMP-045",
  "items": [
    { "productCode": "FLOUR_SIFTED", "quantity": 2000, "unit": "kg" }
  ],
  "dispatchedAt": "2026-03-28T07:00:00Z",
  "destinationRef": "CUSTOMER-ABC / Mombasa Warehouse"
}
→ 201 { deliveryNoteId: "DN-000678" }

Proof of delivery (TMS pushes when customer signs)
PATCH /api/v1/invoices/:id/status
{
  "status": "delivered",
  "externalRef": "TMS-POD-0045",
  "deliveredAt": "2026-03-28T16:30:00Z",
  "receivedBy": "James Otieno",
  "signatureUrl": "https://..."
}
→ 200 { invoiceId: "INV-000456", status: "delivered" }
```

---

### 8d. Miller / Grain Processor Connector

**What it does:** Links milling software to the ERP for intake, production runs, and yield reconciliation.

**Key flows:**

```
Grain intake (inbound weighbridge feeds this automatically)
→ handled by WeighbridgeConnector → purchase receipt

Milling run (miller software pushes production result)
POST /api/v1/inventory/adjustments
{
  "externalRef": "MILL-RUN-0234",
  "type": "production",
  "inputs": [
    { "productCode": "MAIZE_WHITE", "quantity": 5000, "unit": "kg" }
  ],
  "outputs": [
    { "productCode": "FLOUR_SIFTED",    "quantity": 3200, "unit": "kg" },
    { "productCode": "FLOUR_UNSIFTED",  "quantity": 800,  "unit": "kg" },
    { "productCode": "BRAN_MAIZE",      "quantity": 750,  "unit": "kg" }
  ],
  "waste": 250,
  "runDate": "2026-03-28",
  "millRef": "MILL-A"
}
→ 201 {
    adjustmentId: "ADJ-000567",
    inputConsumed: 5000,
    totalOutput: 4750,
    yieldPercent: 95.0,
    expectedYield: 96.5,
    yieldVariance: -1.5
  }
```

**Yield variance alerting:**
- Expected yield is configured per product (Bill of Materials)
- Variance > 3% fires `inventory.yield_variance_alert` webhook to ops manager

---

## 9. Error Handling & Retry

### Inbound Request Errors

| Scenario | Behaviour |
|----------|-----------|
| Schema validation fails | 422 immediately, no SyncLog created |
| Business rule violation | 422, SyncLog status: "failed" |
| Duplicate externalRef | 409, return original response |
| ERP service throws | 500, SyncLog status: "failed", alert fired |
| Rate limit exceeded | 429, Retry-After header set |

### Outbound Webhook Retry

```
Attempt 1  → immediately on event
Attempt 2  → 1 minute later
Attempt 3  → 5 minutes later
Attempt 4  → 15 minutes later
Attempt 5  → 1 hour later
Attempt 6  → 6 hours later
─────────────────────────────────
After 6 failures: status = "dead"
  → Webhook marked inactive
  → Account admin notified by email
  → Manual re-enable required
```

Successful delivery resets `failureCount` to 0.

### Circuit Breaker (per subscriber URL)

If a subscriber endpoint returns 5xx on 10 consecutive attempts across any events, the subscription is automatically paused for 1 hour. This prevents hammering a subscriber that is down.

---

## 10. Sync Log & Audit Trail

The `SyncLog` collection is the complete paper trail of every exchange — inbound and outbound. It is **append-only** — records are never deleted or modified after creation.

### What can be queried

From the integration dashboard in the ERP admin:

- All requests for a given API key over a time range
- All events delivered to a given webhook URL
- All failed requests (for debugging)
- Lookup by `externalRef` → find the internal ERP record it created
- Lookup by `internalRef` → find the external event that created it (full lineage)

### Retention

| Log type | Retention |
|----------|-----------|
| Inbound processed | 2 years |
| Inbound failed | 2 years |
| Outbound delivered | 1 year |
| Outbound failed | 2 years |

---

## 11. Rate Limiting & Quotas

Rate limits are enforced **per API key** using a sliding window algorithm stored in memory (or Redis if available):

| Tier | Requests/minute | Requests/day | Burst |
|------|----------------|--------------|-------|
| Default | 60 | 5,000 | 100 |
| Weighbridge | 120 | 10,000 | 200 |
| Collection App | 200 | 50,000 | 300 |
| High-volume | 500 | 100,000 | 1000 |

When a key exceeds its limit:
```
HTTP 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1711584060
```

---

## 12. API Versioning

The API is versioned at the URL level: `/api/v1/`, `/api/v2/`, etc.

### Versioning Policy

- A version is supported for a minimum of **24 months** after the next version ships
- Breaking changes (removed fields, changed types, renamed resources) require a new major version
- Additive changes (new optional fields, new endpoints) are made within the current version
- Deprecation notices are sent via webhook event `api.version_deprecated` and email 6 months before sunset
- Each API key can be pinned to a specific version

### What constitutes a breaking change

- Removing a field from a response
- Changing a field's type
- Removing an endpoint
- Changing required/optional status of a request field
- Changing error code values

---

## 13. Implementation Phases

### Phase 1 — Foundation (enables everything else)
- `ApiKey` model, hashing, CRUD (admin UI to create/revoke keys)
- API key middleware (`lib/integrations/middleware/apiKeyAuth.js`)
- `SyncLog` model + append-only writer
- Base connector class with `process()` orchestration
- `GET /api/v1/auth/token-info` (smoke test for key holders)
- Rate limiter middleware
- Standard error/response envelopes

**Deliverable:** Any external system can authenticate and the system logs the attempt.

### Phase 2 — Read-only API
- `GET /api/v1/products` + `stock`
- `GET /api/v1/contacts`
- `GET /api/v1/orders/purchase` + `sales`
- `GET /api/v1/invoices`

**Deliverable:** External systems can read ERP state without writing.

### Phase 3 — Weighbridge Integration
- `WeighbridgeTicket` model
- `WeighbridgeConnector` (validate → map → create goods receipt or delivery note)
- `POST /api/v1/weighbridge/tickets`
- `PATCH /api/v1/weighbridge/tickets/:number`
- Weighbridge dashboard page (`/dashboard/weighbridge`)
- Variance alerting

**Deliverable:** Gate software can push tickets, inventory moves automatically.

### Phase 4 — Webhook Engine
- `WebhookSubscription` model
- Challenge/verify on registration
- Event emitter hooks in existing server actions
- Delivery worker with retry schedule
- Circuit breaker
- `POST/GET/DELETE /api/v1/webhooks`

**Deliverable:** External systems receive push notifications on ERP state changes.

### Phase 5 — Coffee Collection Center
- `CoffeeSeason` model + management UI
- `FarmerIntakeEntry` model + offline-capable entry form
- `FarmerSeasonPayment` model + payment calculation engine
- `CoffeeCoopConnector`
- `POST /api/v1/collection/intake`
- `GET /api/v1/collection/farmer/:memberNumber/season/:seasonId`
- Season close → bulk payment calculation → AP vouchers

**Deliverable:** Collection centers sync daily intake; season close generates farmer payments.

### Phase 6 — Logistics + Miller
- `LogisticsConnector` — dispatch and POD flow
- `MillerConnector` — production run + yield tracking
- Bill of Materials model (input → multiple outputs)
- Yield variance alerting

**Deliverable:** Transport and milling operations feed inventory and accounting automatically.

### Phase 7 — Partner Portal
- Self-service key management for partners
- Integration health dashboard (delivery rates, error rates, latency)
- Webhook log viewer
- Sandbox mode (isolated test environment per key)
- API documentation (auto-generated from schemas)

---

## 14. File Structure

```
lib/
└── integrations/
    ├── middleware/
    │   ├── apiKeyAuth.js         ← resolves key → companyId + scopes
    │   ├── rateLimiter.js        ← sliding window per key
    │   ├── hmacVerify.js         ← optional signature check
    │   └── requestLogger.js      ← writes initial SyncLog entry
    │
    ├── connectors/
    │   ├── base.js               ← BaseConnector class
    │   ├── registry.js           ← connectorType → class map
    │   ├── weighbridge.js        ← WeighbridgeConnector
    │   ├── coffee-coop.js        ← CoffeeCoopConnector
    │   ├── logistics.js          ← LogisticsConnector
    │   ├── miller.js             ← MillerConnector
    │   └── generic.js            ← GenericConnector (passthrough)
    │
    ├── webhooks/
    │   ├── emitter.js            ← fireEvent(event, data, companyId)
    │   ├── delivery.js           ← HTTP delivery with retry
    │   ├── circuitBreaker.js     ← pause failing subscribers
    │   └── events.js             ← event catalogue (constants)
    │
    └── utils/
        ├── idempotency.js        ← check / store externalRef
        ├── signResponse.js       ← HMAC outbound payloads
        └── envelope.js           ← standard response wrapper

app/
└── api/
    └── v1/
        ├── auth/
        │   └── token-info/route.js
        ├── contacts/route.js
        ├── products/
        │   ├── route.js
        │   └── [id]/stock/route.js
        ├── inventory/
        │   ├── receipts/route.js
        │   ├── dispatches/route.js
        │   └── adjustments/route.js
        ├── weighbridge/
        │   └── tickets/
        │       ├── route.js
        │       └── [number]/route.js
        ├── collection/
        │   ├── seasons/route.js
        │   ├── intake/route.js
        │   └── farmer/[memberNumber]/season/[seasonId]/route.js
        ├── orders/
        │   ├── purchase/route.js
        │   └── sales/route.js
        ├── invoices/route.js
        ├── webhooks/route.js
        └── sync/logs/route.js

app/
└── mongodb/
    └── models/ (or app/models/)
        ├── apiKey.js
        ├── webhookSubscription.js
        ├── syncLog.js
        ├── weighbridgeTicket.js
        ├── coffeeSeason.js
        ├── farmerIntakeEntry.js
        └── farmerSeasonPayment.js

app/
└── dashboard/
    ├── integrations/             ← admin UI for API keys + webhooks
    │   ├── page.jsx              ← dashboard: health, recent logs
    │   ├── api-keys/page.jsx     ← create / revoke keys
    │   ├── webhooks/page.jsx     ← manage subscriptions
    │   └── logs/page.jsx         ← sync log viewer
    ├── weighbridge/
    │   ├── page.jsx              ← live ticket queue
    │   └── [id]/page.jsx         ← ticket detail
    └── coffee/
        ├── seasons/
        │   ├── page.jsx          ← seasons list
        │   └── [id]/page.jsx     ← season detail + payments
        └── intake/
            └── new/page.jsx      ← manual entry form
```

---

*This document describes the target architecture. Implementation follows the phases defined in Section 13. Each phase produces working, deployed functionality — there is no big-bang release.*
