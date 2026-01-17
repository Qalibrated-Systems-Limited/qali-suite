# Invoice Accounting - Quick Reference Card

## 🎯 What Happens When Invoice is Created?

```
Invoice Created (Draft)
        ↓
invoice.complete(user)
        ↓
    ┌───┴───┐
    ↓       ↓
Revenue JE  COGS JE
    ↓       ↓
  Posted   Posted + Stock Movements
```

## 📊 Journal Entries Created

### Revenue Entry
```
DR  Accounts Receivable    [TOTAL]
    CR  Sales Revenue            [SUBTOTAL]
    CR  VAT Output               [TAX]
```

### COGS Entry (Products Only)
```
DR  Cost of Goods Sold     [COST]
    CR  Inventory                [COST]
```

## 🔑 Required System Accounts

| Key | Name | Type | Side |
|-----|------|------|------|
| `accounts_receivable` | AR | Asset | DR |
| `sales_revenue` | Revenue | Revenue | CR |
| `vat_output` | VAT | Liability | CR |
| `cogs` | COGS | Expense | DR |
| `inventory` | Inventory | Asset | DR/CR |

## ✅ Validation Rules

- Debits = Credits (±0.01 tolerance)
- Each line: debit XOR credit (not both)
- All accounts: `canPost: true`
- Stock available ≥ quantity needed

## 🧪 Quick Tests

```javascript
// 1. Check system accounts
const ar = await Account.findOne({ systemAccount: 'accounts_receivable' });
console.log(ar ? '✅' : '❌ Missing AR account');

// 2. Verify journal entry
const je = await JournalEntry.findById(jeId);
console.log('Balanced:', je.isBalanced); // Should be true

// 3. Check invoice accounting
const invoice = await Invoice.findById(invoiceId);
console.log('Accounting Complete:', invoice.accounting?.accountingComplete);
console.log('Revenue JE:', invoice.accounting?.revenueJournalEntryId);
console.log('COGS JE:', invoice.accounting?.cogsJournalEntryId);

// 4. Verify stock movements
const movements = await StockMovement.find({
  'relatedDocuments.invoiceId': invoiceId
});
console.log('Movements:', movements.length);
```

## 🔄 Invoice Lifecycle

| Status | JE Created? | Stock Deducted? | Can Edit? |
|--------|-------------|-----------------|-----------|
| draft | ❌ | ❌ | ✅ |
| sent | ❌ | ❌ | ✅ |
| completed | ✅ | ✅ | ❌ |
| paid | ✅ | ✅ | ❌ |
| cancelled | Reversed | Restored | ❌ |

## 🚨 Error Messages

| Error | Meaning | Fix |
|-------|---------|-----|
| "AR or Sales Revenue accounts not configured" | System accounts missing | Create accounts with `systemAccount` field |
| "Journal entry is not balanced" | Debits ≠ Credits | Check calculations |
| "Insufficient stock" | Not enough inventory | Increase stock or reduce quantity |
| "Cannot post to header account" | Account has `canPost: false` | Update account settings |

## 📁 Key Files

- **Invoice Model**: `app/models/invoice.js`
- **JournalEntry Model**: `app/models/JournalEntry.js`
- **Create Action**: `app/mongodb/invoice-actions.js`
- **Stock Movement**: `app/models/stockmovement.js`

## 🔧 Common Operations

### Create Invoice
```javascript
// Automatically creates journal entries
await createInvoice(formData);
```

### Cancel Invoice
```javascript
const invoice = await Invoice.findById(id);
await invoice.cancel(user, "Reason");
// Reverses journal entries, restores stock
```

### Record Payment
```javascript
const invoice = await Invoice.findById(id);
await invoice.recordPayment(paymentId, amount);
// Updates AR, payment status
```

## 📈 Reports

```javascript
// AR Aging
const aging = await JournalEntry.getARAgingReport();

// COGS for Period
const cogs = await StockMovement.getCOGSForPeriod(start, end);

// Inventory Valuation
const value = await StockMovement.getInventoryValuation(date);

// Customer Statement
const stmt = await JournalEntry.getStatementOfAccount({
  partyType: 'customer',
  partyId: customerId,
  startDate,
  endDate
});
```

## 💡 Best Practices

✅ Always use `invoice.complete()` to create accounting entries
✅ Verify system accounts exist on app startup
✅ Monitor unbalanced journal entries daily
✅ Use `.cancel()` method, not manual updates
✅ Check `accounting.accountingComplete` before modifying invoices
✅ Let the model methods handle validation
✅ Review aging reports weekly

## 🔍 Monitoring Queries

```javascript
// Unbalanced entries
await JournalEntry.find({
  $expr: { $ne: ['$totalDebits', '$totalCredits'] }
});

// Incomplete accounting
await Invoice.find({
  status: 'completed',
  'accounting.accountingComplete': false
});

// Pending stock movements
await StockMovement.getNeedingAccounting();
```

## 📞 Quick Help

1. **Check error logs**: Console shows detailed errors
2. **Verify accounts**: Ensure all 5 system accounts exist
3. **Test with simple invoice**: 1 product, no discount
4. **Review journal entries**: Check they're balanced
5. **Check stock movements**: Verify quantities match

---

**Tip**: Keep this handy during development and testing!
