# Invoice Accounting Flow - Visual Diagrams

## Complete Invoice Creation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER CREATES INVOICE                          │
│  - Selects customer                                             │
│  - Adds products/services                                       │
│  - Sets quantities, prices                                      │
│  - Adds discount, VAT                                           │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│         createInvoice() - invoice-actions.js:488                │
│  1. Validate user permissions                                   │
│  2. Parse form data                                             │
│  3. Validate customer exists                                    │
│  4. Validate stock availability for products                    │
│  5. Generate invoice number                                     │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              Invoice.create() - invoice.js:21                   │
│  Status: "draft"                                                │
│  Items: [products + services with itemType]                     │
│  Subtotal, Tax, Total calculated                                │
│  Customer info embedded                                         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│         invoice.complete(user) - invoice.js:643                 │
│  ⚡ THIS IS WHERE THE MAGIC HAPPENS                             │
│  1. Validate invoice                                            │
│  2. Calculate COGS for products                                 │
│  3. Create revenue journal entry                                │
│  4. Create COGS journal entry (if products)                     │
│  5. Create stock movements                                      │
│  6. Update invoice status to "completed"                        │
│  7. Set accounting.accountingComplete = true                    │
└────────────────────┬────────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌──────────────────┐    ┌────────────────────────────┐
│  REVENUE ENTRY   │    │  COGS ENTRY + STOCK        │
│  JE-SALE-####    │    │  JE-COGS-####              │
│                  │    │                            │
│  DR: AR          │    │  DR: COGS                  │
│  CR: Revenue     │    │  CR: Inventory             │
│  CR: VAT         │    │                            │
│                  │    │  + Stock Movements         │
│  Status: posted  │    │    - Product A: OUT        │
└──────────────────┘    │    - Product B: OUT        │
                        │    Status: posted           │
                        └────────────────────────────┘
```

## Journal Entry Creation Detail

```
┌─────────────────────────────────────────────────────────────────┐
│  invoice.createRevenueJournalEntry(user) - invoice.js:698      │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │ Get System Accounts   │
         │ - accounts_receivable │
         │ - sales_revenue       │
         │ - vat_output          │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ Build Journal Lines   │
         │ Line 1: DR AR         │
         │ Line 2: CR Revenue    │
         │ Line 3: CR VAT        │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ Validate Balance      │
         │ Debits = Credits?     │
         │ ✅ Yes → Continue     │
         │ ❌ No → Throw Error   │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ Generate Entry Number │
         │ JE-SALE-####          │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ JournalEntry.create() │
         │ Status: "draft"       │
         │ Party: customer info  │
         │ Related: invoiceId    │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ journalEntry.post()   │
         │ - Validate all        │
         │ - Status: "posted"    │
         │ - Update balances     │
         └───────────────────────┘
```

## COGS & Stock Movement Detail

```
┌─────────────────────────────────────────────────────────────────┐
│  invoice.createCOGSJournalEntry(user) - invoice.js:808         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │ Get System Accounts   │
         │ - cogs                │
         │ - inventory           │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ For Each Product Item │
         └───────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │ 1. Get Product from DB     │
    │ 2. Calculate COGS          │
    │    = qty × product.cost    │
    │ 3. Check stock available   │
    └────────┬───────────────────┘
             │
             ▼
    ┌────────────────────────────┐
    │ 4. Decrease Inventory      │
    │    product.decreaseInv()   │
    │    Stock: 100 → 95         │
    └────────┬───────────────────┘
             │
             ▼
    ┌────────────────────────────┐
    │ 5. Create Stock Movement   │
    │    - Movement Number       │
    │    - Type: sale            │
    │    - Direction: out        │
    │    - Quantity: 5           │
    │    - Unit Cost: 1000       │
    │    - Total Cost: 5000      │
    │    - Unit Price: 1500      │
    │    - Total Value: 7500     │
    │    - Previous: 100         │
    │    - New Stock: 95         │
    └────────┬───────────────────┘
             │
             ▼
    ┌────────────────────────────┐
    │ 6. Update Product Totals   │
    │    lifetimeTotals:         │
    │    - totalQuantitySold     │
    │    - totalRevenue          │
    │    - totalCOGS             │
    │    - totalGrossProfit      │
    └────────────────────────────┘
                 │
                 │ (Repeat for all products)
                 │
                 ▼
         ┌───────────────────────┐
         │ Create COGS JE        │
         │ DR: COGS   [TOTAL]    │
         │ CR: Inv    [TOTAL]    │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ journalEntry.post()   │
         │ Status: "posted"      │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ Link JE to Movements  │
         │ movement.accounting   │
         │   .journalEntryId     │
         │   .accountingPosted   │
         └───────────────────────┘
```

## Account Balance Updates

```
After Invoice Posted:

┌─────────────────────────────────────────────────────────────────┐
│                     BALANCE SHEET                                │
├─────────────────────────────────────────────────────────────────┤
│ ASSETS                                                           │
│                                                                  │
│  Accounts Receivable (1200)           Before      After         │
│  DR: Invoice Total                    10,000  →   32,620   ↑    │
│                                                                  │
│  Inventory (1500)                                                │
│  CR: COGS                              50,000  →   41,300   ↓    │
│                                                                  │
│                                       ──────     ────────        │
│  Total Assets                          60,000     73,920        │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ LIABILITIES                                                      │
│                                                                  │
│  VAT Output (2300)                                               │
│  CR: Tax Collected                     2,000   →   5,120    ↑    │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ EQUITY                                                           │
│                                                                  │
│  Retained Earnings                    58,000  →   68,800   ↑    │
│  (Increased by Net Income)                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    INCOME STATEMENT                              │
├─────────────────────────────────────────────────────────────────┤
│ REVENUE                                                          │
│                                                                  │
│  Sales Revenue (4000)                                            │
│  CR: Subtotal                          15,000  →   34,500   ↑    │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ EXPENSES                                                         │
│                                                                  │
│  Cost of Goods Sold (5000)                                       │
│  DR: Product Costs                      6,000  →   14,700   ↑    │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                       ──────     ────────        │
│  GROSS PROFIT                           9,000     19,800        │
│  Gross Margin %                         60.0%      57.4%        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Error Handling & Rollback

```
┌─────────────────────────────────────────────────────────────────┐
│                  invoice.complete(user)                         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
              ┌──────────────┐
              │  TRY BLOCK   │
              └──────┬───────┘
                     │
                     ▼
         ┌───────────────────────┐
         │ Create Revenue JE     │
         │ ✅ Success            │
         │ revenueJE = [ID]      │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ Create COGS JE        │
         │ ❌ ERROR!             │
         │ (Insufficient stock)  │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │   CATCH BLOCK         │
         │ rollbackCompletion()  │
         └───────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────────┐
    │ 1. Find Revenue JE by ID       │
    │ 2. Check if posted             │
    │ 3. Create reversal entry       │
    │    - Swap debits/credits       │
    │    - Post reversal             │
    │ 4. Mark original as "reversed" │
    └────────┬───────────────────────┘
             │
             ▼
    ┌────────────────────────────────┐
    │ 5. Delete/reverse COGS JE      │
    │    (if it was created)         │
    └────────┬───────────────────────┘
             │
             ▼
    ┌────────────────────────────────┐
    │ 6. Restore stock for movements │
    │    product.increaseInventory() │
    └────────┬───────────────────────┘
             │
             ▼
    ┌────────────────────────────────┐
    │ 7. Delete stock movements      │
    └────────┬───────────────────────┘
             │
             ▼
    ┌────────────────────────────────┐
    │ 8. Throw error to caller       │
    │ Invoice remains in "draft"     │
    │ Nothing persisted ✅           │
    └────────────────────────────────┘
```

## Payment Recording Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Customer Pays Invoice (Full or Partial)                        │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │ invoice.recordPayment │
         │ (paymentId, amount)   │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ Validate Amount       │
         │ - Amount > 0?         │
         │ - Amount ≤ amountDue? │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ Add to Payment History│
         │ - paymentId           │
         │ - amount              │
         │ - date                │
         │ - method              │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ Update Invoice Amounts│
         │ amountPaid += amount  │
         │ amountDue = total - pd│
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ Update Payment Status │
         │ - amountDue ≤ 0.01    │
         │   → "paid"            │
         │ - amountPaid > 0      │
         │   → "partial"         │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ Update Revenue JE     │
         │ je.amountPaid         │
         │ je.amountOutstanding  │
         │ je.isFullyPaid        │
         └───────┬───────────────┘
                 │
                 ▼
         ┌───────────────────────┐
         │ Save Invoice & JE     │
         │ ✅ Payment Recorded   │
         └───────────────────────┘
```

## Data Relationships

```
┌──────────────┐
│   INVOICE    │
│ invoiceId    │
│ customer     │◄─────┐
│ items[]      │      │
│ total        │      │
│ accounting {  │      │
│   revenueJEId├──┐   │
│   cogsJEId   ├┐ │   │
│ }            ││ │   │
└──────────────┘│ │   │
                │ │   │
       ┌────────┘ │   │
       │          │   │
       ▼          │   │
┌──────────────┐ │   │
│ JOURNAL ENTRY│ │   │
│ (Revenue)    │ │   │
│ JE-SALE-#### │ │   │
│              │ │   │
│ lines: [     │ │   │
│   DR: AR     ├─┼───┘
│   CR: Rev    ├─┼───┐
│   CR: VAT    ├─┼───┼───┐
│ ]            │ │   │   │
│              │ │   │   │
│ party: {     │ │   │   │
│   customerId ├─┘   │   │
│ }            │     │   │
└──────────────┘     │   │
                     │   │
       ┌─────────────┘   │
       │                 │
       ▼                 │
┌──────────────┐         │
│ JOURNAL ENTRY│         │
│ (COGS)       │         │
│ JE-COGS-#### │         │
│              │         │
│ lines: [     │         │
│   DR: COGS   │         │
│   CR: Inv    ├─────┐   │
│ ]            │     │   │
│              │     │   │
│ relatedDocs: │     │   │
│   invoiceId  │     │   │
└──────┬───────┘     │   │
       │             │   │
       ▼             │   │
┌──────────────┐    │   │
│ STOCK        │    │   │
│ MOVEMENTS    │    │   │
│ SM-######    │    │   │
│              │    │   │
│ productId    │    │   │
│ direction:out│    │   │
│ quantity: 5  │    │   │
│              │    │   │
│ costing: {   │    │   │
│   unitCost   │    │   │
│   totalCost  │    │   │
│ }            │    │   │
│              │    │   │
│ accounting: {│    │   │
│   jeId       ├────┘   │
│ }            │        │
│              │        │
│ relatedDocs: │        │
│   invoiceId  │        │
└──────────────┘        │
                        │
       ┌────────────────┘
       │
       ▼
┌──────────────┐
│   ACCOUNTS   │
│              │
│ AR (1200)    │
│ Revenue(4000)│
│ VAT (2300)   │
│ COGS (5000)  │
│ Inv (1500)   │
│              │
│ Each has:    │
│ cachedBalance│
│ balanceUpdt  │
└──────────────┘
```

---

**Visual Guide Version**: 1.0
**Last Updated**: 2024-01-10
