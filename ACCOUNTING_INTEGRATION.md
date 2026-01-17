# Invoice Accounting Integration Guide

## Overview

Your invoice system now **automatically generates journal entries** when invoices are created or completed, following proper double-entry bookkeeping principles.

## How It Works

### 1. Invoice Creation Flow

When an invoice is created via `createInvoice()`:

```javascript
// 1. Create invoice (draft status)
const invoice = await Invoice.create({ ... });

// 2. Complete invoice (generates journal entries + stock movements)
await invoice.complete(user);
```

### 2. Automatic Journal Entry Generation

The `.complete()` method ([invoice.js:643-693](invoice.js#L643-L693)) automatically creates **TWO journal entries**:

#### A. Revenue Journal Entry

**Accounts affected:**
- **DEBIT**: Accounts Receivable (Asset) - `total` amount
- **CREDIT**: Sales Revenue (Income) - `subtotal` amount
- **CREDIT**: VAT Output (Liability) - `taxAmount` (if applicable)

**Example:**
```
Invoice: KES 11,600 (Subtotal: 10,000 + VAT: 1,600)

DR  Accounts Receivable    11,600
    CR  Sales Revenue              10,000
    CR  VAT Output                  1,600
```

#### B. COGS Journal Entry (for products only)

**Accounts affected:**
- **DEBIT**: Cost of Goods Sold (Expense) - total COGS
- **CREDIT**: Inventory (Asset) - total COGS

**Example:**
```
COGS: KES 6,000 (from product cost prices)

DR  Cost of Goods Sold     6,000
    CR  Inventory                  6,000
```

### 3. Stock Movement Integration

For each product item, the system:
1. Creates a stock movement record ([invoice.js:858-902](invoice.js#L858-L902))
2. Updates product inventory quantities
3. Links the movement to the invoice
4. Captures costing data (unit cost, total cost, COGS)

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ CREATE INVOICE (invoice-actions.js:488-647)            │
└───────────────────┬─────────────────────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ Invoice.create()      │
        │ Status: "draft"       │
        └───────┬───────────────┘
                │
                ▼
        ┌───────────────────────────────────────────┐
        │ invoice.complete(user)                    │
        │ - Validates invoice                       │
        │ - Calls createRevenueJournalEntry()       │
        │ - Calls createCOGSJournalEntry()          │
        │ - Updates status to "completed"           │
        └───────┬───────────────────────────────────┘
                │
        ┌───────┴────────┐
        │                │
        ▼                ▼
┌──────────────┐  ┌─────────────────────┐
│ REVENUE JE   │  │ COGS JE + STOCK     │
│              │  │ MOVEMENTS           │
│ DR: AR       │  │                     │
│ CR: Revenue  │  │ DR: COGS            │
│ CR: VAT      │  │ CR: Inventory       │
│              │  │                     │
│ Status:      │  │ + StockMovement     │
│ "posted"     │  │   records           │
└──────────────┘  └─────────────────────┘
```

## Required System Accounts

Your chart of accounts **MUST** have these system accounts configured:

| System Account Key    | Account Type | Purpose                    |
|----------------------|--------------|----------------------------|
| `accounts_receivable`| Asset        | Customer invoices (DR)     |
| `sales_revenue`      | Revenue      | Sales income (CR)          |
| `vat_output`         | Liability    | VAT collected (CR)         |
| `cogs`               | Expense      | Cost of goods sold (DR)    |
| `inventory`          | Asset        | Stock value (CR on sale)   |

**Setup these accounts in your Account model with:**
```javascript
{
  accountCode: "1200",
  accountName: "Accounts Receivable",
  accountType: "asset",
  systemAccount: "accounts_receivable", // ← Key field
  canPost: true,
  isActive: true
}
```

## Transaction Atomicity & Error Handling

The `.complete()` method includes **rollback protection**:

```javascript
try {
  // 1. Create revenue JE
  revenueJE = await invoice.createRevenueJournalEntry(user);

  // 2. Create COGS JE + stock movements (if products)
  if (invoice.hasProducts) {
    const result = await invoice.createCOGSJournalEntry(user);
    cogsJE = result.journalEntry;
    stockMovements = result.stockMovements;
  }

  // 3. Update status
  invoice.status = "completed";
  await invoice.save();

} catch (error) {
  // ROLLBACK: Reverse journal entries, restore inventory
  await invoice.rollbackCompletion(user, {
    revenueJE,
    cogsJE,
    stockMovements
  });
  throw error;
}
```

If **ANY** step fails:
- All journal entries are reversed/deleted
- Inventory quantities are restored
- Invoice remains in "draft" status

## Journal Entry Validation

Before posting, each journal entry is validated ([JournalEntry.js:322-328](JournalEntry.js#L322-L328)):

1. **Balance Check**: `totalDebits === totalCredits` (within 0.01 tolerance)
2. **Line Validation**: Each line has EITHER debit OR credit (not both, not zero)
3. **Account Validation**: All accounts exist, are active, and `canPost: true`
4. **Fiscal Period Check**: Period is not closed/locked

## Account Balance Updates

After a journal entry is posted:
- Account balances are recalculated asynchronously ([JournalEntry.js:431-441](JournalEntry.js#L431-L441))
- Uses `account.calculateActualBalance()` ([account.js:208-239](account.js#L208-L239))
- Updates `cachedBalance` and `balanceUpdatedAt` fields

## How to Verify Accounting Integrity

### 1. Check Journal Entries for an Invoice

```javascript
const invoice = await Invoice.findById(invoiceId);

// Revenue journal entry
const revenueJE = await JournalEntry.findById(
  invoice.accounting.revenueJournalEntryId
);

// COGS journal entry
const cogsJE = await JournalEntry.findById(
  invoice.accounting.cogsJournalEntryId
);
```

### 2. Verify Debits = Credits

```javascript
console.log("Total Debits:", revenueJE.totalDebits);
console.log("Total Credits:", revenueJE.totalCredits);
console.log("Balanced?", revenueJE.isBalanced); // Should be true
```

### 3. Check Stock Movements

```javascript
const movements = await StockMovement.find({
  "relatedDocuments.invoiceId": invoiceId
});

console.log("Stock movements:", movements.length);
console.log("Total COGS:", movements.reduce((sum, m) =>
  sum + m.costing.totalCost, 0
));
```

## Invoice Status Workflow

```
draft → sent → completed → paid
  ↓       ↓        ↓         ↓
  ✗       ✗        ✓         ✓    ← Journal entries created
  ✗       ✗        ✓         ✓    ← Stock movements created
  ✗       ✗        ✓         ✓    ← Accounting complete
```

**Important**: Journal entries are ONLY created when status changes to `"completed"` (via `.complete()` method).

## Cancellation & Reversals

To cancel an invoice ([invoice.js:1126-1174](invoice.js#L1126-L1174)):

```javascript
await invoice.cancel(user, "Reason for cancellation");
```

This will:
1. Reverse the revenue journal entry
2. Reverse the COGS journal entry
3. Restore inventory (create IN stock movements)
4. Mark invoice as "cancelled"

**Note**: Cannot cancel paid invoices or invoices with payment history.

## Common Issues & Solutions

### Issue: "AR or Sales Revenue accounts not configured"

**Solution**: Create system accounts in your chart of accounts:
```javascript
await Account.create({
  accountCode: "1200",
  accountName: "Accounts Receivable",
  accountType: "asset",
  systemAccount: "accounts_receivable",
  canPost: true
});

await Account.create({
  accountCode: "4000",
  accountName: "Sales Revenue",
  accountType: "revenue",
  systemAccount: "sales_revenue",
  canPost: true
});
```

### Issue: "Insufficient stock for {product}"

**Solution**: Check product inventory before creating invoice. The system validates stock availability.

### Issue: "Journal entry is not balanced"

**Solution**: This indicates a calculation error. Check:
- Invoice subtotal calculation
- Tax calculation
- Discount calculation
- All amounts are positive numbers

## Reports & Analytics

### Aging Report (AR)

```javascript
const arAging = await JournalEntry.getARAgingReport();
// Returns customer balances by age: current, 0-30, 31-60, 61-90, 90+ days
```

### COGS Report

```javascript
const cogs = await StockMovement.getCOGSForPeriod(startDate, endDate);
console.log("Total COGS:", cogs.totalCOGS);
console.log("Gross Profit:", cogs.grossProfit);
console.log("Gross Margin:", cogs.grossMargin);
```

### Inventory Valuation

```javascript
const valuation = await StockMovement.getInventoryValuation(asOfDate);
console.log("Total Inventory Value:", valuation.totalValue);
console.log("Products:", valuation.products);
```

## Best Practices

1. **Always use `.complete()`** - Don't manually update invoice status to "completed"
2. **Validate system accounts exist** - Check on app startup
3. **Monitor journal entry balance** - All entries should have `isBalanced: true`
4. **Use transactions** - When updating invoices, use MongoDB sessions
5. **Audit trail** - All journal entries include `createdBy` and `postedBy`
6. **Don't skip validations** - Let the model methods handle validation
7. **Test rollback scenarios** - Ensure error handling works correctly

## Testing Checklist

- [ ] Create invoice with products → Verify 2 journal entries created
- [ ] Create invoice with services → Verify 1 journal entry created (revenue only)
- [ ] Create invoice with mixed items → Verify both journal entries
- [ ] Check AR balance increases by invoice total
- [ ] Check Revenue account increases by subtotal
- [ ] Check VAT account increases by tax amount
- [ ] Check COGS account increases by product costs
- [ ] Check Inventory account decreases by product costs
- [ ] Verify stock movements created and linked
- [ ] Test invoice cancellation → Journal entries reversed
- [ ] Test payment recording → AR balance decreases
- [ ] Test aging report → Invoices appear in correct buckets

## Schema References

- **Invoice Model**: [invoice.js](invoice.js)
- **JournalEntry Model**: [JournalEntry.js](JournalEntry.js)
- **Account Model**: [account.js](account.js)
- **StockMovement Model**: [stockmovement.js](stockmovement.js)
- **Product Model**: [product.js](product.js)

## Support

If you encounter issues:
1. Check system accounts are configured
2. Verify invoice data is valid
3. Check console logs for error messages
4. Review journal entry validation errors
5. Ensure products have cost prices set
