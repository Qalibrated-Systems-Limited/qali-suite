# Accounting Integration Testing Guide

## Overview
This guide provides step-by-step instructions for testing the automatic journal entry generation when creating invoices.

---

## Prerequisites

### 1. Required System Accounts
Verify these system accounts exist in your database:

```javascript
// Run this query in MongoDB to check:
db.accounts.find({ systemAccount: { $exists: true } }).pretty()
```

**Required System Accounts:**
- `accounts_receivable` - Asset account (e.g., "1200 - Accounts Receivable")
- `sales_revenue` - Revenue account (e.g., "4000 - Sales Revenue")
- `vat_output` - Liability account (e.g., "2200 - VAT Payable")
- `cost_of_goods_sold` - Expense account (e.g., "5000 - Cost of Goods Sold")
- `inventory` - Asset account (e.g., "1300 - Inventory")

### 2. Test Data Setup
You'll need:
- **At least one customer** (Party with type="customer")
- **At least one product** with stock available
- **User with Admin or Accountant role**

---

## Test Scenarios

### Test 1: Simple Product Invoice

**Objective:** Create invoice with one product, verify journal entries and stock movements

**Steps:**

1. **Create Invoice:**
   - Navigate to: `/dashboard/invoices/new`
   - Select a customer
   - Add 1 product (e.g., 5 units @ KES 1,000 each = KES 5,000)
   - VAT: 16% (KES 800)
   - Total: KES 5,800
   - Click "Create Invoice"

2. **Verify Invoice Creation:**
   ```javascript
   // MongoDB query:
   db.invoices.findOne({ invoiceNumber: "INV-XXXX" })
   ```

   **Expected:**
   - Status: `completed`
   - `accounting.accountingComplete`: `true`
   - `accounting.revenueJournalEntryId`: exists
   - `accounting.cogsJournalEntryId`: exists

3. **Verify Revenue Journal Entry:**
   ```javascript
   db.journalentries.findOne({
     referenceType: "Invoice",
     referenceNumber: "INV-XXXX",
     entryType: "sales"
   })
   ```

   **Expected Journal Entry:**
   ```
   Date: Invoice Date
   Description: "Sales Invoice INV-XXXX - [Customer Name]"
   Status: posted

   Lines:
   ┌────────────────────────┬────────┬─────────┐
   │ Account                │ Debit  │ Credit  │
   ├────────────────────────┼────────┼─────────┤
   │ Accounts Receivable    │ 5,800  │    0    │
   │ Sales Revenue          │    0   │ 5,000   │
   │ VAT Output             │    0   │   800   │
   ├────────────────────────┼────────┼─────────┤
   │ TOTALS                 │ 5,800  │ 5,800   │
   └────────────────────────┴────────┴─────────┘
   ```

4. **Verify COGS Journal Entry:**
   ```javascript
   db.journalentries.findOne({
     referenceType: "Invoice",
     referenceNumber: "INV-XXXX",
     entryType: "cogs"
   })
   ```

   **Expected (assuming product cost = KES 600/unit):**
   ```
   Date: Invoice Date
   Description: "COGS for Invoice INV-XXXX"
   Status: posted

   Lines:
   ┌────────────────────────┬────────┬─────────┐
   │ Account                │ Debit  │ Credit  │
   ├────────────────────────┼────────┼─────────┤
   │ Cost of Goods Sold     │ 3,000  │    0    │
   │ Inventory              │    0   │ 3,000   │
   ├────────────────────────┼────────┼─────────┤
   │ TOTALS                 │ 3,000  │ 3,000   │
   └────────────────────────┴────────┴─────────┘
   ```

5. **Verify Stock Movements:**
   ```javascript
   db.stockmovements.find({
     invoiceId: ObjectId("invoice-id-here")
   })
   ```

   **Expected:**
   - 1 movement with type: `sale`
   - Quantity: -5 (negative = decrease)
   - `costing.unitCost`: Product's cost price
   - `costing.totalCost`: 3,000
   - `accounting.journalEntryId`: Points to COGS journal entry
   - `accounting.accountingPosted`: true

6. **Verify Product Stock Updated:**
   ```javascript
   db.products.findOne({ _id: ObjectId("product-id") })
   ```

   **Expected:**
   - `stock` field decreased by 5

---

### Test 2: Mixed Invoice (Products + Services)

**Objective:** Verify correct handling of both product and service items

**Steps:**

1. **Create Invoice:**
   - Customer: Any customer
   - Add Product: 3 units @ KES 2,000 = KES 6,000
   - Add Service: Consulting, 2 hours @ KES 1,500 = KES 3,000
   - Subtotal: KES 9,000
   - VAT 16%: KES 1,440
   - Total: KES 10,440

2. **Verify Revenue Journal Entry:**
   ```
   ┌────────────────────────┬────────┬─────────┐
   │ Account                │ Debit  │ Credit  │
   ├────────────────────────┼────────┼─────────┤
   │ Accounts Receivable    │10,440  │    0    │
   │ Sales Revenue          │    0   │ 9,000   │
   │ VAT Output             │    0   │ 1,440   │
   └────────────────────────┴────────┴─────────┘
   ```

3. **Verify COGS Journal Entry:**
   - Should ONLY include cost for the product (3 units)
   - Services have NO cost of goods sold
   - If product cost = KES 1,200/unit:
   ```
   ┌────────────────────────┬────────┬─────────┐
   │ Account                │ Debit  │ Credit  │
   ├────────────────────────┼────────┼─────────┤
   │ Cost of Goods Sold     │ 3,600  │    0    │
   │ Inventory              │    0   │ 3,600   │
   └────────────────────────┴────────┴─────────┘
   ```

4. **Verify Stock Movements:**
   - Should have 1 movement (for product only)
   - Services should NOT create stock movements

---

### Test 3: Service-Only Invoice

**Objective:** Verify invoices with only services don't create COGS entries

**Steps:**

1. **Create Invoice:**
   - Customer: Any customer
   - Add Service: Training, 1 day @ KES 5,000
   - VAT 16%: KES 800
   - Total: KES 5,800

2. **Verify Revenue Journal Entry:**
   - Should exist and be posted

3. **Verify NO COGS Journal Entry:**
   ```javascript
   const cogsEntry = await db.journalentries.findOne({
     referenceType: "Invoice",
     referenceNumber: "INV-XXXX",
     entryType: "cogs"
   });

   // Should be null
   console.log(cogsEntry); // null
   ```

4. **Verify NO Stock Movements:**
   ```javascript
   const movements = await db.stockmovements.find({
     invoiceId: ObjectId("invoice-id")
   }).toArray();

   // Should be empty array
   console.log(movements); // []
   ```

---

### Test 4: Invoice Rollback on Error

**Objective:** Verify transaction rollback if journal entry creation fails

**Steps:**

1. **Setup - Temporarily Break System:**
   - Option A: Remove a system account (e.g., delete `sales_revenue` account)
   - Option B: Set an account to inactive

2. **Attempt Invoice Creation:**
   - Try to create a normal invoice
   - Should fail with error message

3. **Verify Rollback:**
   ```javascript
   // Invoice should NOT exist
   db.invoices.findOne({ invoiceNumber: "INV-XXXX" })
   // => null

   // Journal entries should NOT exist
   db.journalentries.find({ referenceNumber: "INV-XXXX" }).toArray()
   // => []

   // Stock should NOT be decreased
   db.products.findOne({ _id: ObjectId("product-id") })
   // => stock unchanged
   ```

4. **Restore System:**
   - Re-create or reactivate the system account
   - Retry invoice creation
   - Should now succeed

---

### Test 5: Account Balance Updates

**Objective:** Verify account balances are updated correctly

**Steps:**

1. **Check Initial Balances:**
   ```javascript
   const arAccount = await db.accounts.findOne({
     systemAccount: "accounts_receivable"
   });
   const initialBalance = arAccount.cachedBalance;
   ```

2. **Create Invoice:**
   - Total: KES 10,000

3. **Wait for Balance Update:**
   - Balance updates happen asynchronously
   - Wait 2-3 seconds

4. **Verify Balance Increased:**
   ```javascript
   const updatedAccount = await db.accounts.findOne({
     systemAccount: "accounts_receivable"
   });

   // Should increase by invoice total
   console.log(updatedAccount.cachedBalance);
   // => initialBalance + 10000
   ```

5. **Verify balanceUpdatedAt:**
   ```javascript
   console.log(updatedAccount.balanceUpdatedAt);
   // => Recent timestamp
   ```

---

## Validation Queries

### Query 1: Check All Posted Journal Entries
```javascript
db.journalentries.find({
  status: "posted",
  referenceType: "Invoice"
}).sort({ entryDate: -1 }).limit(10)
```

### Query 2: Check Unbalanced Journal Entries (Should be 0)
```javascript
db.journalentries.aggregate([
  { $match: { status: "posted" } },
  {
    $addFields: {
      totalDebits: { $sum: "$lines.debit" },
      totalCredits: { $sum: "$lines.credit" }
    }
  },
  {
    $match: {
      $expr: { $ne: ["$totalDebits", "$totalCredits"] }
    }
  }
])
```

### Query 3: Verify Stock Movements Linked to Journal Entries
```javascript
db.stockmovements.aggregate([
  {
    $lookup: {
      from: "journalentries",
      localField: "accounting.journalEntryId",
      foreignField: "_id",
      as: "journalEntry"
    }
  },
  {
    $match: {
      "accounting.accountingPosted": true,
      journalEntry: { $size: 0 } // No matching journal entry
    }
  }
])
// Should return empty array
```

### Query 4: Check Revenue vs COGS Correlation
```javascript
db.invoices.aggregate([
  { $match: { status: "completed" } },
  {
    $lookup: {
      from: "journalentries",
      localField: "accounting.revenueJournalEntryId",
      foreignField: "_id",
      as: "revenueJE"
    }
  },
  {
    $lookup: {
      from: "journalentries",
      localField: "accounting.cogsJournalEntryId",
      foreignField: "_id",
      as: "cogsJE"
    }
  },
  {
    $project: {
      invoiceNumber: 1,
      total: 1,
      hasProducts: 1,
      hasRevenueJE: { $gt: [{ $size: "$revenueJE" }, 0] },
      hasCogsJE: { $gt: [{ $size: "$cogsJE" }, 0] }
    }
  },
  {
    $match: {
      $or: [
        { hasRevenueJE: false }, // Every invoice needs revenue JE
        { hasProducts: true, hasCogsJE: false } // Product invoices need COGS JE
      ]
    }
  }
])
// Should return empty array
```

---

## Common Issues and Solutions

### Issue 1: "System account not found: sales_revenue"

**Cause:** Required system accounts not created

**Solution:**
```javascript
// Check existing system accounts
db.accounts.find({ systemAccount: { $exists: true } })

// Ensure you have all required system accounts set up
```

### Issue 2: Invoice created but no journal entries

**Cause:** `invoice.complete()` not being called

**Solution:**
- Verify [invoice-actions.js:625-628](app/mongodb/invoice-actions.js#L625-L628) calls `invoice.complete()`
- Check console logs for errors

### Issue 3: Stock decreased but no COGS entry

**Cause:** Product's cost price not set or zero

**Solution:**
```javascript
// Check product cost price
db.products.findOne({ SKU: "PROD-001" })

// Update if needed
db.products.updateOne(
  { SKU: "PROD-001" },
  { $set: { costPrice: 500 } }
)
```

### Issue 4: "Journal entry is not balanced!"

**Cause:** Rounding errors or tax calculation issues

**Solution:**
- Check tax calculations in invoice items
- Verify all amounts are properly rounded to 2 decimal places
- Review invoice totals calculation

### Issue 5: Account balances not updating

**Cause:** Async balance update failed

**Solution:**
```javascript
// Manually trigger balance recalculation
const account = await Account.findById(accountId);
await account.calculateActualBalance();
```

---

## Performance Testing

### Load Test: Multiple Invoices
```javascript
// Create 10 invoices in quick succession
for (let i = 0; i < 10; i++) {
  // Create invoice via UI or API
  // Wait 500ms between each
}

// Verify all journal entries created
db.journalentries.find({
  entryDate: { $gte: new Date("2026-01-10") }
}).count()
// Should be 20 (10 revenue + 10 COGS if products)
```

---

## Reporting Verification

### Income Statement Check
```javascript
db.journalentries.aggregate([
  { $match: { status: "posted" } },
  { $unwind: "$lines" },
  {
    $lookup: {
      from: "accounts",
      localField: "lines.accountId",
      foreignField: "_id",
      as: "account"
    }
  },
  { $unwind: "$account" },
  {
    $match: {
      "account.accountType": { $in: ["revenue", "expense"] }
    }
  },
  {
    $group: {
      _id: "$account.accountName",
      accountType: { $first: "$account.accountType" },
      totalDebit: { $sum: "$lines.debit" },
      totalCredit: { $sum: "$lines.credit" }
    }
  },
  {
    $project: {
      accountName: "$_id",
      accountType: 1,
      balance: {
        $cond: {
          if: { $eq: ["$accountType", "revenue"] },
          then: { $subtract: ["$totalCredit", "$totalDebit"] },
          else: { $subtract: ["$totalDebit", "$totalCredit"] }
        }
      }
    }
  },
  { $sort: { accountType: 1, accountName: 1 } }
])
```

### Expected Output:
```javascript
[
  {
    accountName: "Sales Revenue",
    accountType: "revenue",
    balance: 50000  // Total revenue
  },
  {
    accountName: "Cost of Goods Sold",
    accountType: "expense",
    balance: 30000  // Total COGS
  }
]
// Net Income = 50000 - 30000 = 20000
```

---

## Sign-Off Checklist

Before marking accounting integration as complete, verify:

- [ ] All system accounts exist and are active
- [ ] Test invoice creates revenue journal entry
- [ ] Test invoice creates COGS journal entry (for products)
- [ ] All journal entries are balanced (debits = credits)
- [ ] Stock movements created for products
- [ ] Product stock decreased correctly
- [ ] Account balances update (check AR, Revenue, VAT, COGS, Inventory)
- [ ] Service-only invoices work (no COGS/stock movements)
- [ ] Error handling works (rollback on failure)
- [ ] No orphaned journal entries or stock movements
- [ ] Reports show correct financial data

---

## Next Steps

After successful testing:

1. **Monitor Production:** Watch for any accounting discrepancies
2. **Reconciliation:** Regularly reconcile account balances
3. **Audit Trail:** Review journal entry audit fields
4. **Performance:** Monitor database query performance
5. **Backup:** Ensure regular backups of accounting data

---

## Support

If you encounter issues not covered in this guide:

1. Check application logs for errors
2. Review MongoDB queries in this guide
3. Verify system account configuration
4. Check invoice and journal entry models for recent changes
