# Journal Entry Examples

## Invoice Sale - Products + Services + VAT

### Scenario
- **Invoice**: INV-100124-001
- **Customer**: ABC Company
- **Date**: 2024-01-10
- **Products**:
  - 5x Widget A @ KES 2,000 = KES 10,000 (Cost: KES 1,200 each)
  - 3x Widget B @ KES 1,500 = KES 4,500 (Cost: KES 900 each)
- **Services**:
  - Installation @ KES 5,000
- **Subtotal**: KES 19,500
- **VAT (16%)**: KES 3,120
- **Total**: KES 22,620

### Journal Entry 1: Revenue (Accounts Receivable)

**Entry Number**: JE-SALE-0001
**Entry Date**: 2024-01-10
**Entry Type**: sale
**Description**: Sale - Invoice INV-100124-001

| Account Code | Account Name           | Debit    | Credit   |
|--------------|------------------------|----------|----------|
| 1200         | Accounts Receivable    | 22,620   | —        |
| 4000         | Sales Revenue          | —        | 19,500   |
| 2300         | VAT Output             | —        | 3,120    |
| **TOTALS**   |                        | **22,620** | **22,620** |

**Status**: posted
**Related Documents**: invoiceId, invoiceNumber
**Party**: customer, ABC Company

---

### Journal Entry 2: COGS (Cost of Goods Sold)

**Entry Number**: JE-COGS-0001
**Entry Date**: 2024-01-10
**Entry Type**: sale
**Description**: COGS - Invoice INV-100124-001

| Account Code | Account Name           | Debit  | Credit |
|--------------|------------------------|--------|--------|
| 5000         | Cost of Goods Sold     | 8,700  | —      |
| 1500         | Inventory              | —      | 8,700  |
| **TOTALS**   |                        | **8,700** | **8,700** |

**Calculation**:
- Widget A: 5 × KES 1,200 = KES 6,000
- Widget B: 3 × KES 900 = KES 2,700
- **Total COGS**: KES 8,700

**Status**: posted
**Related Documents**: invoiceId, invoiceNumber

---

### Stock Movements Created

**Movement 1**: SM-000001
- Product: Widget A
- Type: sale, Direction: out
- Quantity: 5
- Previous Stock: 100 → New Stock: 95
- Unit Cost: KES 1,200, Total Cost: KES 6,000
- Unit Price: KES 2,000, Total Value: KES 10,000

**Movement 2**: SM-000002
- Product: Widget B
- Type: sale, Direction: out
- Quantity: 3
- Previous Stock: 50 → New Stock: 47
- Unit Cost: KES 900, Total Cost: KES 2,700
- Unit Price: KES 1,500, Total Value: KES 4,500

---

### Financial Impact

**Balance Sheet Changes**:
```
ASSETS:
  Accounts Receivable:  +22,620 ↑
  Inventory:            -8,700  ↓
  Net Asset Change:     +13,920

LIABILITIES:
  VAT Output:           +3,120  ↑

EQUITY:
  (Increased via Revenue - COGS = Net Income)
  Net Income:           +10,800 (19,500 - 8,700)
```

**Income Statement**:
```
REVENUE:
  Sales Revenue:        +19,500

EXPENSES:
  Cost of Goods Sold:   +8,700

GROSS PROFIT:          +10,800 (55.4% margin)
```

---

## Invoice Cancellation

### Scenario
Invoice INV-100124-001 needs to be cancelled.

### Reversal Entry 1: Revenue Reversal

**Entry Number**: JE-REV-0001
**Entry Date**: 2024-01-15
**Entry Type**: adjustment
**Description**: Reversal of JE-SALE-0001: Invoice cancelled

| Account Code | Account Name           | Debit  | Credit   |
|--------------|------------------------|--------|----------|
| 4000         | Sales Revenue          | 19,500 | —        |
| 2300         | VAT Output             | 3,120  | —        |
| 1200         | Accounts Receivable    | —      | 22,620   |
| **TOTALS**   |                        | **22,620** | **22,620** |

**Original Entry**: JE-SALE-0001 (marked as "reversed")

---

### Reversal Entry 2: COGS Reversal

**Entry Number**: JE-REV-0002
**Entry Date**: 2024-01-15
**Entry Type**: adjustment
**Description**: Reversal of JE-COGS-0001: Invoice cancelled

| Account Code | Account Name           | Debit | Credit |
|--------------|------------------------|-------|--------|
| 1500         | Inventory              | 8,700 | —      |
| 5000         | Cost of Goods Sold     | —     | 8,700  |
| **TOTALS**   |                        | **8,700** | **8,700** |

---

### Stock Movement Reversals

**Movement 3**: SM-000003 (Reversal of SM-000001)
- Product: Widget A
- Type: adjustment, Direction: **in**
- Quantity: 5
- Previous Stock: 95 → New Stock: 100
- Reason: "Invoice cancelled - INV-100124-001"

**Movement 4**: SM-000004 (Reversal of SM-000002)
- Product: Widget B
- Type: adjustment, Direction: **in**
- Quantity: 3
- Previous Stock: 47 → New Stock: 50
- Reason: "Invoice cancelled - INV-100124-001"

---

## Payment Receipt

### Scenario
Customer pays KES 22,620 for Invoice INV-100124-001.

### Journal Entry: Payment Received

**Entry Number**: JE-PAY-0001
**Entry Date**: 2024-01-20
**Entry Type**: payment_received
**Description**: Payment received from ABC Company - Invoice INV-100124-001

| Account Code | Account Name           | Debit  | Credit   |
|--------------|------------------------|--------|----------|
| 1100         | Bank/Cash              | 22,620 | —        |
| 1200         | Accounts Receivable    | —      | 22,620   |
| **TOTALS**   |                        | **22,620** | **22,620** |

**Status**: posted
**Party**: customer, ABC Company
**Related Documents**: invoiceId, paymentId

---

## Partial Payment

### Scenario
Customer pays KES 10,000 towards Invoice INV-100124-001 (Total: KES 22,620).

### Journal Entry: Partial Payment

**Entry Number**: JE-PAY-0002
**Entry Date**: 2024-01-18
**Entry Type**: payment_received
**Description**: Partial payment from ABC Company - Invoice INV-100124-001

| Account Code | Account Name           | Debit  | Credit |
|--------------|------------------------|--------|--------|
| 1100         | Bank/Cash              | 10,000 | —      |
| 1200         | Accounts Receivable    | —      | 10,000 |
| **TOTALS**   |                        | **10,000** | **10,000** |

**Invoice Updated**:
- amountPaid: KES 10,000
- amountDue: KES 12,620
- paymentStatus: "partial"

**Journal Entry Updated**:
- amountPaid: KES 10,000
- amountOutstanding: KES 12,620
- isFullyPaid: false

---

## Account Balances After All Transactions

### Accounts Receivable (1200) - Asset

| Date       | Entry         | Debit  | Credit | Balance |
|------------|---------------|--------|--------|---------|
| 2024-01-10 | JE-SALE-0001  | 22,620 | —      | 22,620  |
| 2024-01-18 | JE-PAY-0002   | —      | 10,000 | 12,620  |

**Current Balance**: KES 12,620 (Debit)

---

### Sales Revenue (4000) - Revenue

| Date       | Entry         | Debit | Credit | Balance |
|------------|---------------|-------|--------|---------|
| 2024-01-10 | JE-SALE-0001  | —     | 19,500 | 19,500  |

**Current Balance**: KES 19,500 (Credit)

---

### VAT Output (2300) - Liability

| Date       | Entry         | Debit | Credit | Balance |
|------------|---------------|-------|--------|---------|
| 2024-01-10 | JE-SALE-0001  | —     | 3,120  | 3,120   |

**Current Balance**: KES 3,120 (Credit)

---

### Inventory (1500) - Asset

| Date       | Entry         | Debit | Credit | Balance |
|------------|---------------|-------|--------|---------|
| (Opening)  | —             | —     | —      | 100,000 |
| 2024-01-10 | JE-COGS-0001  | —     | 8,700  | 91,300  |

**Current Balance**: KES 91,300 (Debit)

---

### Cost of Goods Sold (5000) - Expense

| Date       | Entry         | Debit | Credit | Balance |
|------------|---------------|-------|--------|---------|
| 2024-01-10 | JE-COGS-0001  | 8,700 | —      | 8,700   |

**Current Balance**: KES 8,700 (Debit)

---

## Services-Only Invoice (No COGS)

### Scenario
- **Invoice**: INV-100124-002
- **Customer**: XYZ Ltd
- **Services**:
  - Consulting @ KES 50,000
  - Training @ KES 30,000
- **Subtotal**: KES 80,000
- **VAT (16%)**: KES 12,800
- **Total**: KES 92,800

### Journal Entry: Revenue Only

**Entry Number**: JE-SALE-0002
**Entry Date**: 2024-01-10
**Entry Type**: sale
**Description**: Sale - Invoice INV-100124-002

| Account Code | Account Name           | Debit  | Credit |
|--------------|------------------------|--------|--------|
| 1200         | Accounts Receivable    | 92,800 | —      |
| 4000         | Sales Revenue          | —      | 80,000 |
| 2300         | VAT Output             | —      | 12,800 |
| **TOTALS**   |                        | **92,800** | **92,800** |

**Note**: No COGS journal entry created (services have no inventory cost).

---

## Accounting Equation Verification

After creating Invoice INV-100124-001:

```
ASSETS = LIABILITIES + EQUITY

Before Transaction:
100,000 (Inventory) + 0 (AR) = 0 (VAT) + 100,000 (Equity)
100,000 = 100,000 ✓

After Transaction:
91,300 (Inventory) + 22,620 (AR) = 3,120 (VAT) + 110,800 (Equity*)
113,920 = 113,920 ✓

*Equity increased by Net Income: 19,500 (Revenue) - 8,700 (COGS) = 10,800
```

**The accounting equation remains balanced!** ✓
