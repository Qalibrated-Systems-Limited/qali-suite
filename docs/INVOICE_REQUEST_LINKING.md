# Invoice-Request Linking Implementation

## Overview
Invoices can now handle both **direct sales** (from Inventory) and **technician sales** (from fulfilled requests), with smart COGS accounting.

---

## Key Changes

### 1. Invoice Schema - Added `relatedRequest` to Items
**File:** `app/models/invoice.js`

```javascript
items: [{
  // ... existing fields
  relatedRequest: {
    requestId: ObjectId,      // Link to StockRequest
    requestNumber: String,
    technicianId: String,
    technicianName: String
  }
}]
```

### 2. StockRequest Schema - Added Invoicing Tracking
**File:** `app/models/requests.js`

```javascript
items: [{
  // ... existing fields
  invoicedQuantity: Number,   // Track how much has been invoiced
  invoices: [{
    invoiceId: ObjectId,
    invoiceNumber: String,
    quantity: Number,
    invoicedAt: Date
  }]
}]

status: "invoiced"  // New status when fully invoiced
```

### 3. Smart COGS Logic
**File:** `app/models/invoice.js` → `createCOGSJournalEntry()`

**Before:**
```
DR: COGS
CR: Inventory (always)
```

**After (Smart Routing):**
```
DR: COGS

// Split credits based on item source:
CR: Inventory (for items WITHOUT relatedRequest)
CR: Technician Stock (for items WITH relatedRequest)
```

**Example Journal Entry:**
```
Invoice with 2 items:
- Item A: Direct sale, COGS = KES 1,000
- Item B: From request REQ-001, COGS = KES 500

Journal Entry:
DR: COGS               1,500
CR: Inventory          1,000  (Item A)
CR: Technician Stock     500  (Item B)
```

---

## Complete Flow

### Scenario 1: Direct Sale (No Request)
```
1. Customer walks in
2. Create invoice (no relatedRequest)
3. COGS: DR COGS, CR Inventory
4. Stock movement created
5. Inventory decreased
```

### Scenario 2: Technician Sale (Linked to Request)
```
1. Technician requests items → REQ-001
2. Store Manager fulfills → creates JE (DR Tech Stock, CR Inventory)
3. Later: Create invoice with relatedRequest = REQ-001
4. COGS: DR COGS, CR Technician Stock
5. NO stock movement (already created during fulfillment)
6. Request marked as "invoiced"
```

---

## Helper Function

**File:** `app/mongodb/queries/invoice-queries.js`

```javascript
getFulfilledRequestsForCustomer(customerId)
```

Returns requests with items that have been fulfilled but not fully invoiced.

---

## Next Steps (UI)

1. Modify invoice creation form
2. When customer selected → fetch fulfilled requests
3. Show optional: "Link to Request?"
4. Auto-populate items with `relatedRequest` data

---

## System Accounts Required

- `inventory` - Asset (for direct sales)
- `technician_stock` - Asset (for request-based sales)
- `cogs` - Expense (cost of goods sold)

---

**Date:** 2026-01-10
**Status:** Backend Complete ✅ | UI Pending
