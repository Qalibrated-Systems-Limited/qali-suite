# Invoice System Documentation

## Overview

This document describes the invoice lifecycle, data flow, and best practices for the inventory/ERP system.

---

## Invoice Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│  INVOICE STATUS FLOW                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   CREATE          COMPLETE           PAYMENT                │
│     │                │                  │                   │
│     ▼                ▼                  ▼                   │
│  ┌──────┐       ┌───────────┐     ┌──────────┐             │
│  │draft │ ───► │ completed │ ───►│  paid    │ (paymentStatus)
│  └──────┘       └───────────┘     └──────────┘             │
│     │                │                                      │
│     │                ▼                                      │
│     │          ┌───────────┐                               │
│     └────────► │ cancelled │                               │
│                └───────────┘                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Principle: Separate Status Fields

| Field | Purpose | Values |
|-------|---------|--------|
| `status` | Document workflow state | `draft`, `sent`, `completed`, `cancelled` |
| `paymentStatus` | Financial tracking | `unpaid`, `partial`, `paid` |

**Important**: `status` never becomes "paid". Payment state is tracked by `paymentStatus`.

---

## Current Implementation

### 1. Invoice Creation Flow

**Form**: `app/dashboard/invoices/components/CreateInvoiceForm.jsx`
**Action**: `app/mongodb/invoice-actions.js` → `createInvoice()`
**Model**: `app/models/invoice.js`

```javascript
// Current flow (simplified):
1. Form collects: customer, items, dates, discount, VAT
2. Server action creates invoice with status: "draft"
3. Immediately calls invoice.complete()
4. complete() creates:
   - Revenue Journal Entry (Debit AR, Credit Sales + VAT)
   - COGS Journal Entry (if products)
   - Stock Movements (deducts inventory)
5. Status becomes "completed"
```

### 2. Payment Flow

**Only completed invoices can receive payments.**

```javascript
// Enforced in:
// - invoice-actions.js:800-808 (createInvoicePayment)
// - invoice.js:1146-1150 (recordPayment method)
// - InvoiceDetailActions.jsx:39 (UI check)
// - Invoicetable.jsx:249-250 (UI check)

const canPay = invoice.paymentStatus !== "paid" && invoice.status === "completed";
```

### 3. Cancel Flow

**Uses model's cancel() method which handles:**
- Revenue journal entry reversal
- COGS journal entry reversal
- Stock restoration via `product.increaseInventory()`
- Stock movement status → "reversed"
- Lifetime totals adjustment

```javascript
// invoice-actions.js:953-956
await invoice.cancel(
  { name: user.name, id: user.id },
  reason || `Cancelled by ${user.name}`
);
```

---

## Validation Rules

### Invoice Can Be Edited When:
- `paymentStatus !== "paid"` (not fully paid)
- `status !== "cancelled"`

### Invoice Can Receive Payment When:
- `status === "completed"` (not draft/cancelled)
- `paymentStatus !== "paid"` (not already fully paid)
- `amount <= amountDue + 0.01` (within balance)

### Invoice Can Be Cancelled When:
- `paymentStatus !== "paid"`
- `status !== "cancelled"`
- `paymentHistory.length === 0` (no payments recorded)

---

## Journal Entries Created

### On Invoice Completion:

**1. Revenue Entry:**
```
Debit:  Accounts Receivable    [total]
Credit: Sales Revenue          [subtotal - discount]
Credit: VAT Output             [taxAmount]
```

**2. COGS Entry (if products):**
```
Debit:  Cost of Goods Sold     [totalCOGS]
Credit: Inventory              [totalCOGS]
```

### On Payment Receipt:
```
Debit:  Cash/Bank/M-Pesa       [amount]
Credit: Accounts Receivable    [amount]
```

---

## Amount Calculations

```javascript
// In invoice model validateAmounts():
subtotal = sum of item.amount
totalDiscount = (subtotal * discountPercentage) / 100  // OR sum of item discounts
taxAmount = sum of item.taxAmount
total = subtotal - totalDiscount + taxAmount
amountDue = total - amountPaid
```

---

## File Reference

| File | Purpose |
|------|---------|
| `app/models/invoice.js` | Mongoose schema, methods (complete, cancel, recordPayment) |
| `app/mongodb/invoice-actions.js` | Server actions (createInvoice, updateInvoice, createInvoicePayment, cancelInvoice) |
| `app/dashboard/invoices/components/CreateInvoiceForm.jsx` | Invoice creation form |
| `app/dashboard/invoices/components/InvoicePaymentDialog.jsx` | Payment recording dialog |
| `app/dashboard/invoices/components/InvoiceDetailActions.jsx` | Action buttons (pay, cancel) |
| `app/dashboard/invoices/components/Invoicetable.jsx` | Invoice list with actions |
| `app/mongodb/queries/invoice-queries.js` | Query functions (search, stats) |

---

## Known Design Decisions

### 1. Auto-Complete on Create
Currently, invoices are created as "draft" then immediately completed. This is a POS-style approach suitable for immediate sales.

**For full draft workflow (future enhancement):**
- Separate "Save Draft" and "Post Invoice" buttons
- Stock reservation on draft (not deduction)
- Convert reservation to deduction on complete

### 2. No Overpayment
Payments exceeding `amountDue` are rejected:
```javascript
if (amount > invoice.amountDue + 0.01) {
  return { error: "Payment exceeds balance" };
}
```

### 3. Cancel vs Delete
Invoices are never deleted - they are cancelled. This preserves audit trail and allows journal entry reversal.

---

## Common Issues & Fixes

### Issue: "Receive Payment" button on draft invoices
**Fix**: UI checks `status === "completed"` (not just `!== "cancelled"`)

### Issue: `status === "paid"` checks failing
**Fix**: Changed to `paymentStatus === "paid"`. Status never becomes "paid".

### Issue: Manual stock restoration on cancel
**Fix**: Use `invoice.cancel()` method which uses `product.increaseInventory()` properly.

---

## Status Checks Quick Reference

```javascript
// Can edit invoice?
canEdit = paymentStatus !== "paid" && status !== "cancelled"

// Can receive payment?
canPay = paymentStatus !== "paid" && status === "completed"

// Can cancel invoice?
canCancel = paymentStatus !== "paid" && status !== "cancelled" && paymentHistory.length === 0

// Is overdue?
isOverdue = paymentStatus !== "paid" && status === "completed" && new Date() > dueDate
```

---

## Recommended Future Enhancements

1. **Draft Workflow**: Allow saving drafts before posting
2. **Stock Reservation**: Reserve stock on draft, deduct on complete
3. **Credit Notes**: For partial refunds/returns
4. **Recurring Invoices**: Auto-generate periodic invoices
5. **Email Integration**: Send invoices directly to customers

---

*Last Updated: January 2026*
*Related: See also `docs/BILL_SYSTEM.md` for vendor bills (AP)*
