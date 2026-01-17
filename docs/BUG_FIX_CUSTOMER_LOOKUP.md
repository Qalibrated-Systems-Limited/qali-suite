# Bug Fix: Customer Lookup in Invoice Creation

## Issue Identified

**File:** [app/mongodb/invoice-actions.js](../app/mongodb/invoice-actions.js)

**Problem:** The `createInvoice()` function was incorrectly using the `Account` model to look up customers instead of the `Party` model.

### Original Code (Line 523):
```javascript
const customer = await Account.findById(data.customerId);
```

### Impact:
- Invoice creation would fail with "Customer not found" error
- Customers are stored in the `Party` collection, not the `Account` collection
- `Account` is for the Chart of Accounts (financial accounts like AR, Revenue, etc.)
- `Party` is for business relationships (customers, suppliers, employees)

---

## Fix Applied

### 1. Added Party Import

**File:** [app/mongodb/invoice-actions.js:8](../app/mongodb/invoice-actions.js#L8)

```javascript
import Party from "../models/parties";
```

### 2. Updated Customer Lookup

**Lines 523-538:**

```javascript
// Get customer (Party)
const customer = await Party.findById(data.customerId);
if (!customer) {
  return {
    message: "Customer not found",
    success: false,
  };
}

// Verify it's a customer
if (customer.type !== "customer" && customer.type !== "both") {
  return {
    message: "Selected party is not a customer",
    success: false,
  };
}
```

**Changes:**
- ✅ Use `Party.findById()` instead of `Account.findById()`
- ✅ Added validation to ensure party is actually a customer
- ✅ Handles parties with type "both" (customer + supplier)

### 3. Fixed Customer Field Mapping

**Lines 603-642:**

The Party model has a structured address object, but Invoice model expects a string. Added address formatting:

```javascript
// Format customer address from Party model
const formatAddress = (address) => {
  if (!address) return "";
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.postalCode,
    address.country,
  ].filter(Boolean);
  return parts.join(", ");
};

// Create invoice using new Invoice model
const invoice = await Invoice.create({
  // ...
  customer: {
    id: customer._id.toString(),
    name: customer.displayName || customer.name,  // ✅ Use displayName if available
    email: customer.email || "",
    phone: customer.phone || "",                   // ✅ Fixed: was phoneNumber
    address: formatAddress(customer.address),      // ✅ Format nested address object
    taxPin: customer.taxPin || "",
  },
  // ...
});
```

**Changes:**
- ✅ Use `customer.displayName || customer.name` (Party model supports displayName)
- ✅ Use `customer.phone` instead of `customer.phoneNumber`
- ✅ Format nested address object into a single string

---

## Data Model Differences

### Account Model (Chart of Accounts)
```javascript
{
  accountCode: "1200",
  accountName: "Accounts Receivable",
  accountType: "asset",
  systemAccount: "accounts_receivable",
  // ... accounting-specific fields
}
```

**Purpose:** Financial accounts for double-entry bookkeeping

### Party Model (Business Relationships)
```javascript
{
  type: "customer",  // or "supplier", "employee", "both"
  name: "Kenya Tea Development Agency",
  displayName: "KTDA",
  email: "info@ktda.co.ke",
  phone: "+254700000000",
  address: {
    line1: "P.O. Box 30213",
    line2: "Nairobi",
    city: "Nairobi",
    postalCode: "00100",
    country: "Kenya"
  },
  taxPin: "A000000000X",
  // ... party-specific fields
}
```

**Purpose:** Customers, suppliers, and employees

---

## Testing

### Before Fix:
```javascript
// Creating invoice would fail
const result = await createInvoice(prevState, formData);
// => { message: "Customer not found", success: false }
```

### After Fix:
```javascript
// Creating invoice now works
const result = await createInvoice(prevState, formData);
// => {
//   message: "Invoice INV-2026-0001 created successfully with journal entries",
//   success: true,
//   invoiceId: "...",
//   invoiceNumber: "INV-2026-0001"
// }
```

### Verification Query:
```javascript
// Find customer in Party collection
const customer = await Party.findOne({
  type: { $in: ["customer", "both"] },
  name: "KTDA"
});

// Use in invoice creation
const formData = new FormData();
formData.append("invoiceData", JSON.stringify({
  customerId: customer._id.toString(),
  // ... other invoice data
}));

const result = await createInvoice(null, formData);
console.log(result.success); // true
```

---

## Additional Findings

### 1. Duplicate File Found
**Location:** [app/models/invoice-actions.jsx](../app/models/invoice-actions.jsx)

This file appears to be an old duplicate that's not being imported anywhere. It contains outdated invoice creation logic and should likely be removed.

**Recommendation:** Delete this file as it's not in use and could cause confusion.

### 2. Legacy API Route
**Location:** [app/api/invoices/[id]/add-item/route.js](../app/api/invoices/[id]/add-item/route.js)

This API route uses the old approach:
- Directly manipulating stock
- Not creating journal entries
- Using deprecated `StockTransaction` model instead of `StockMovement`

**Recommendation:** Consider deprecating this route or updating it to use the new accounting-integrated approach.

---

## Files Modified

1. **[app/mongodb/invoice-actions.js](../app/mongodb/invoice-actions.js)**
   - Line 8: Added `import Party from "../models/parties"`
   - Lines 523-538: Updated customer lookup and validation
   - Lines 603-627: Added address formatting and fixed field mapping

---

## Related Documentation

- [ACCOUNTING_INTEGRATION.md](./ACCOUNTING_INTEGRATION.md) - Complete accounting integration guide
- [ACCOUNTING_TESTING_GUIDE.md](./ACCOUNTING_TESTING_GUIDE.md) - Testing procedures
- [Party Model](../app/models/parties.js) - Customer/Supplier/Employee schema
- [Invoice Model](../app/models/invoice.js) - Invoice schema with accounting methods

---

## Status

✅ **FIXED** - Invoice creation now correctly uses Party model for customer lookup

**Date:** 2026-01-10
**Priority:** High
**Impact:** Critical - Invoice creation was broken without this fix
