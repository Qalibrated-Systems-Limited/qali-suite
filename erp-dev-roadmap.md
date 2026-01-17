# ═══════════════════════════════════════════════════════════════════════════════
#                    ERP DEVELOPMENT ROADMAP
#                    Complete Feature Status & Action Plan
# ═══════════════════════════════════════════════════════════════════════════════
#  Generated: January 2025
#  System: Multi-tenant ERP (Stock, Accounting, HR)
# ═══════════════════════════════════════════════════════════════════════════════


## TABLE OF CONTENTS

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Current Feature Status](#2-current-feature-status)
3. [Schema Inventory](#3-schema-inventory)
4. [Transaction Flows](#4-transaction-flows)
5. [Missing Features](#5-missing-features)
6. [Development Phases](#6-development-phases)
7. [PDF Templates Required](#7-pdf-templates-required)
8. [Utility Functions Reference](#8-utility-functions-reference)


---

## 1. SYSTEM ARCHITECTURE OVERVIEW

### Tech Stack
| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Database | MongoDB + Mongoose |
| Auth | NextAuth.js |
| Styling | Tailwind CSS + OKLCH Colors |
| Charts | Recharts |
| PDF | @react-pdf/renderer (planned) |
| Language | JavaScript (for speed) |

### Design System
| Element | Value |
|---------|-------|
| Primary Color | Yellow (#eab308) |
| Font | Geist Sans / Geist Mono |
| Theme | Light/Dark with OKLCH |
| Style | GitHub/Vercel inspired |
| Mobile | Cards view, icon-only buttons |
| Desktop | Table view, labeled buttons |

### Role Hierarchy
```
Admin
  └── Manager
        └── Accountant
        └── Store Manager
              └── Employee
```


---

## 2. CURRENT FEATURE STATUS

### Complete Features ✅

| Feature | Schema | Actions | UI | Queries | Notes |
|---------|--------|---------|-----|---------|-------|
| Products | 100% | 95% | 90% | 90% | Enhanced with costing/inventory |
| Stock Movements | 100% | 90% | 85% | 80% | Immutable + accounting |
| Item Checkouts | 100% | 95% | 90% | 90% | Loan tracking |
| Stock Requests | 100% | 95% | 85% | 80% | Multi-fulfillment |
| Stock Adjustments | 100% | 100% | 80% | 70% | Auto journal entries |
| Employee Claims | 95% | 80% | 75% | 70% | Advance + Reimbursement |
| Journal Entries | 100% | 90% | 70% | 80% | Double-entry |
| Chart of Accounts | 100% | 90% | 80% | 80% | Kenya standard |
| Parties | 100% | 80% | 60% | 60% | Customer/Supplier/Employee |
| Fiscal Periods | 100% | 80% | 40% | 50% | Month close/lock |
| Tax Transactions | 100% | 60% | 20% | 40% | VAT + WHT tracking |

### Incomplete Features 🔨

| Feature | Schema | Actions | UI | PDF | Priority |
|---------|--------|---------|-----|-----|----------|
| **Bills** | 95% | 20% | 0% | ❌ | 🔴 HIGH |
| **Expenses** | 90% | 15% | 0% | ❌ | 🔴 HIGH |
| **Purchase Orders** | 0% | 0% | 0% | ❌ | 🔴 HIGH |
| **Invoices** | 90% | 80% | 70% | ❌ | 🟡 MEDIUM |
| **Credit Notes** | 0% | 0% | 0% | ❌ | 🟡 MEDIUM |
| **Quotes** | 0% | 0% | 0% | ❌ | 🟡 MEDIUM |
| **Delivery Notes** | 80% | 70% | 60% | ❌ | 🟢 LOW |
| **Payments** | 70% | 50% | 30% | ❌ | 🟡 MEDIUM |

### Dashboard Status

| Dashboard | Layout | KPIs | Charts | Lists | Alerts |
|-----------|--------|------|--------|-------|--------|
| Admin | 70% | 80% | 70% | 60% | 50% |
| Accountant | 30% | 40% | 30% | 20% | 20% |
| Store Manager | 60% | 70% | 60% | 50% | 40% |
| Employee | 70% | 80% | 50% | 70% | 60% |
| Executive | 0% | 0% | 0% | 0% | 0% |


---

## 3. SCHEMA INVENTORY

### Existing Schemas (Location: `/app/models/`)

| Schema | File | Status | JE Integration |
|--------|------|--------|----------------|
| Product | `product.js` | ✅ Complete | Via Bill/Invoice |
| StockMovement | `stockmovement.js` | ✅ Complete | ✅ Yes |
| StockRequest | `requests.js` | ✅ Complete | Via fulfillment |
| ItemCheckout | `checkouts.js` | ✅ Complete | Via return |
| InventoryAdjustment | `inventoryAdjustment.js` | ✅ Complete | ✅ Auto |
| Invoice | `invoice.js` | 🔨 90% | ✅ Revenue + COGS |
| Bill | `bill.js` | 🔨 95% | ✅ AP + Inventory |
| Expense | `expense.js` | 🔨 90% | ✅ Yes |
| EmployeeClaim | `employeeClaim.js` | 🔨 95% | ✅ Yes |
| JournalEntry | `JournalEntry.js` | ✅ Complete | N/A (is JE) |
| Account | `account.js` | ✅ Complete | N/A |
| Party | `party.js` | ✅ Complete | Via JE party field |
| FiscalPeriod | `fiscalPeriod.js` | ✅ Complete | Should validate |
| TaxTransaction | `taxTransaction.js` | ✅ Complete | Links to JE |
| DeliveryNote | `dnote.js` | 🔨 80% | ❌ No |
| Counter | `counter.js` | ✅ Complete | N/A |
| User | `user.js` | ✅ Complete | N/A |

### Missing Schemas (To Create)

| Schema | Purpose | Priority |
|--------|---------|----------|
| **PurchaseOrder** | Order before Bill | 🔴 HIGH |
| **Quote** | Proposal before Invoice | 🟡 MEDIUM |
| **CreditNote** | Returns against Invoice | 🟡 MEDIUM |
| **Payment** | Payment records | 🟡 MEDIUM |
| **DebitNote** | Returns against Bill | 🟢 LOW |


---

## 4. TRANSACTION FLOWS

### Purchase Flow (Supplier → Us)
```
┌─────────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Purchase Order  │ ──► │    Bill     │ ──► │   Payment   │ ──► │  Completed  │
│    (Draft)      │     │  (Approved) │     │   (Made)    │     │             │
└─────────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Journal Entry:      │
                    │ DR: Inventory/Expense│
                    │ DR: VAT Input       │
                    │ CR: WHT Payable     │
                    │ CR: Accounts Payable│
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Stock Movement      │
                    │ (if products)       │
                    │ Type: "purchase"    │
                    │ Direction: "in"     │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Tax Transactions    │
                    │ - VAT Input         │
                    │ - WHT (if applicable)│
                    └─────────────────────┘
```

### Sales Flow (Us → Customer)
```
┌─────────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│     Quote       │ ──► │   Invoice   │ ──► │   Payment   │ ──► │  Completed  │
│    (Draft)      │     │ (Completed) │     │ (Received)  │     │             │
└─────────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Revenue JE:         │
                    │ DR: Accounts Recv.  │
                    │ CR: Sales Revenue   │
                    │ CR: VAT Output      │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ COGS JE (products): │
                    │ DR: Cost of Sales   │
                    │ CR: Inventory       │
                    │   OR Tech Stock     │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Stock Movement      │
                    │ Type: "sale"        │
                    │ Direction: "out"    │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Tax Transaction     │
                    │ - VAT Output        │
                    └─────────────────────┘
```

### Technician Stock Flow (Internal Issue → Client Sale)
```
┌─────────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Stock Request   │ ──► │  Fulfillment │ ──► │  Checkout   │ ──► │   Invoice   │
│ (Tech requests) │     │ (Issued)     │     │ (Tech has)  │     │ (Sold)      │
└─────────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                               │                                        │
                               ▼                                        ▼
                    ┌─────────────────────┐              ┌─────────────────────┐
                    │ JE: Issue to Tech   │              │ COGS JE:            │
                    │ DR: Technician Stock│              │ DR: Cost of Sales   │
                    │ CR: Inventory       │              │ CR: Technician Stock│
                    └─────────────────────┘              └─────────────────────┘
                               │                                        │
                               ▼                                        ▼
                    ┌─────────────────────┐              ┌─────────────────────┐
                    │ Stock Movement      │              │ Links back to:      │
                    │ Type: "issue"       │              │ - StockRequest      │
                    │ Direction: "out"    │              │ - ItemCheckout      │
                    │ From: Inventory     │              │ Auto-closes checkout│
                    └─────────────────────┘              └─────────────────────┘
```

### Expense Flow
```
┌─────────────────┐     ┌─────────────┐     ┌─────────────┐
│    Expense      │ ──► │   Approved  │ ──► │    Paid     │
│    (Draft)      │     │             │     │             │
└─────────────────┘     └─────────────┘     └─────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Journal Entry:      │
                    │ DR: Expense Account │
                    │ DR: VAT Input (opt) │
                    │ CR: Cash/Bank/AP    │
                    └─────────────────────┘
```

### Employee Claims Flow

#### A) Advance Request Flow
```
┌─────────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Advance Request │ ──► │   Approved  │ ──► │    Paid     │ ──► │   Settle    │
│  (Employee)     │     │  (Manager)  │     │ (Accountant)│     │ (Employee)  │
└─────────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                   │                    │
                                                   ▼                    ▼
                                        ┌─────────────────┐   ┌─────────────────┐
                                        │ JE: Pay Advance │   │ Creates new     │
                                        │ DR: Emp Advances│   │ "advance_return"│
                                        │ CR: Cash/Bank   │   │ claim with      │
                                        └─────────────────┘   │ expense items   │
                                                              └─────────────────┘
                                                                       │
                                                                       ▼
                                                              ┌─────────────────┐
                                                              │ Close Settlement│
                                                              │  (Accountant)   │
                                                              └─────────────────┘
```

#### B) Advance Settlement Scenarios

**Scenario 1: Employee spent LESS than advance (owes company)**
```
Example: Advance 10,000 | Spent 7,000 | Balance +3,000

Journal Entry:
  DR: Travel Expense           7,000
  CR: Employee Advances        7,000  (reduce advance by spent)

Remaining Employee Advances balance: 3,000 (employee still owes)

When employee returns cash:
  DR: Cash                     3,000
  CR: Employee Advances        3,000  (clear remaining)
```

**Scenario 2: Employee spent MORE than advance (company owes employee)**
```
Example: Advance 10,000 | Spent 12,000 | Balance -2,000

Journal Entry:
  DR: Travel Expense          12,000
  CR: Employee Advances       10,000  (clear full advance)
  CR: Employee Payables        2,000  (we owe them)

Then pay the extra:
  DR: Employee Payables        2,000
  CR: Cash                     2,000
```

**Scenario 3: Employee spent EXACTLY the advance**
```
Example: Advance 10,000 | Spent 10,000 | Balance 0

Journal Entry:
  DR: Travel Expense          10,000
  CR: Employee Advances       10,000  (fully cleared)
```

#### C) Reimbursement Flow (No Advance)
```
┌─────────────────┐     ┌─────────────┐     ┌─────────────┐
│  Reimbursement  │ ──► │   Approved  │ ──► │    Paid     │
│   (Employee)    │     │  (Manager)  │     │ (Accountant)│
└─────────────────┘     └─────────────┘     └─────────────┘
                                                   │
                                                   ▼
                                        ┌─────────────────────┐
                                        │ JE #1: Expense      │
                                        │ DR: Expense Accounts│
                                        │ CR: Employee Payable│
                                        └─────────────────────┘
                                                   │
                                                   ▼
                                        ┌─────────────────────┐
                                        │ JE #2: Payment      │
                                        │ DR: Employee Payable│
                                        │ CR: Cash/Bank       │
                                        └─────────────────────┘
```

#### D) Stock Request by Employee
```
┌─────────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Stock Request   │ ──► │   Approved  │ ──► │  Fulfilled  │ ──► │   Invoice   │
│  (Technician)   │     │  (Manager)  │     │(Store Mgr)  │     │ (if sold)   │
└─────────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
        │                                          │                    │
        │                                          ▼                    ▼
        │                               ┌─────────────────┐   ┌─────────────────┐
        │                               │ JE: Issue       │   │ COGS JE:        │
        │                               │ DR: Tech Stock  │   │ DR: COGS        │
        │                               │ CR: Inventory   │   │ CR: Tech Stock  │
        │                               └─────────────────┘   └─────────────────┘
        │                                          │
        │                                          ▼
        │                               ┌─────────────────┐
        │                               │ ItemCheckout    │
        │                               │ (if returnable) │
        │                               └─────────────────┘
        │                                          │
        ▼                                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Request Types:                                                   │
│ • sale         → Delivery Note, links to Invoice                │
│ • technician_test → Checkout, must return                       │
│ • customer_demo   → Checkout, must return                       │
│ • installation    → Checkout OR direct to Invoice               │
│ • internal_use    → Checkout, must return                       │
└─────────────────────────────────────────────────────────────────┘
```

### Stock Adjustment Flow
```
┌─────────────────┐     ┌─────────────┐
│   Adjustment    │ ──► │   Approved  │
│    (Draft)      │     │             │
└─────────────────┘     └─────────────┘
         │
         ▼
┌─────────────────────┐
│ For each line:      │
│ - Update Product qty│
│ - Create StockMove  │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ Journal Entry:      │
│ Net Increase:       │
│   DR: Inventory     │
│   CR: Adj Account   │
│ Net Decrease:       │
│   DR: Adj Account   │
│   CR: Inventory     │
└─────────────────────┘
```


---

## 5. MISSING FEATURES

### 5.1 Invoice Enhancements Needed

```javascript
// Add to Invoice schema:

// 1. Sales Person
salesPerson: {
  partyId: { type: Schema.Types.ObjectId, ref: "Party" },
  employeeId: { type: Schema.Types.ObjectId, ref: "User" },
  name: String,
  employeeNumber: String,
  commission: {
    rate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
  }
},

// 2. Quote Reference
quoteRef: {
  quoteId: { type: Schema.Types.ObjectId, ref: "Quote" },
  quoteNumber: String,
},

// 3. Linked Stock Requests (already exists in items.relatedRequest)
// Just need UI to show/select this
```

### 5.2 Quote Schema (To Create)

```javascript
// /app/models/quote.js

const quoteSchema = new Schema({
  quoteNumber: { type: String, required: true, unique: true },
  quoteDate: { type: Date, required: true },
  validUntil: { type: Date, required: true },
  
  // Customer
  customer: {
    id: String,
    name: String,
    email: String,
    phone: String,
    address: String,
    taxPin: String,
  },
  
  // Sales Person
  salesPerson: {
    partyId: Schema.Types.ObjectId,
    name: String,
    employeeNumber: String,
  },
  
  // Items (same structure as Invoice)
  items: [{
    itemType: { type: String, enum: ["product", "service"] },
    productId: Schema.Types.ObjectId,
    productSKU: String,
    productName: String,
    description: String,
    unit: String,
    quantity: Number,
    unitPrice: Number,
    amount: Number,
    taxRate: { type: Number, default: 16 },
    taxAmount: Number,
    discountPercentage: Number,
    discountAmount: Number,
  }],
  
  // Amounts
  subtotal: Number,
  totalDiscount: Number,
  taxAmount: Number,
  total: Number,
  currency: { type: String, default: "KES" },
  
  // Status
  status: {
    type: String,
    enum: ["draft", "sent", "accepted", "rejected", "expired", "converted"],
    default: "draft",
  },
  
  // Conversion
  convertedToInvoice: {
    invoiceId: Schema.Types.ObjectId,
    invoiceNumber: String,
    convertedAt: Date,
    convertedBy: { name: String, id: String },
  },
  
  // Notes
  notes: String,
  termsAndConditions: String,
  
  // Audit
  createdBy: { name: String, id: String },
  lastModifiedBy: { name: String, id: String },
}, { timestamps: true });

// Methods:
// - convertToInvoice(user) → Creates Invoice from Quote
// - send(user) → Marks as sent
// - accept(user) → Marks as accepted
// - reject(user, reason) → Marks as rejected
```

### 5.3 Purchase Order Schema (To Create)

```javascript
// /app/models/purchaseOrder.js

const purchaseOrderSchema = new Schema({
  poNumber: { type: String, required: true, unique: true },
  poDate: { type: Date, required: true },
  expectedDeliveryDate: Date,
  
  // Supplier
  supplier: {
    id: String,
    name: String,
    email: String,
    phone: String,
    address: String,
    taxPin: String,
  },
  
  // Items
  items: [{
    productId: Schema.Types.ObjectId,
    productSKU: String,
    productName: String,
    description: String,
    unit: String,
    quantity: Number,
    unitPrice: Number,
    amount: Number,
    taxRate: Number,
    taxAmount: Number,
    receivedQuantity: { type: Number, default: 0 },
  }],
  
  // Amounts
  subtotal: Number,
  taxAmount: Number,
  total: Number,
  currency: { type: String, default: "KES" },
  
  // Status
  status: {
    type: String,
    enum: ["draft", "sent", "confirmed", "partial", "received", "cancelled"],
    default: "draft",
  },
  
  // Receiving
  receivings: [{
    billId: Schema.Types.ObjectId,
    billNumber: String,
    receivedAt: Date,
    receivedBy: { name: String, id: String },
    items: [{
      productId: Schema.Types.ObjectId,
      quantity: Number,
    }],
  }],
  
  // Conversion to Bill
  convertedToBill: {
    billId: Schema.Types.ObjectId,
    billNumber: String,
    convertedAt: Date,
  },
  
  // Notes
  notes: String,
  deliveryAddress: String,
  
  // Audit
  createdBy: { name: String, id: String },
}, { timestamps: true });

// Methods:
// - send(user) → Send to supplier
// - confirm(user) → Supplier confirmed
// - receivePartial(items, user) → Partial receiving
// - convertToBill(user) → Creates Bill from PO
```

### 5.4 Credit Note Schema (To Create)

```javascript
// /app/models/creditNote.js

const creditNoteSchema = new Schema({
  creditNoteNumber: { type: String, required: true, unique: true },
  creditNoteDate: { type: Date, required: true },
  
  // Link to original Invoice
  originalInvoice: {
    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", required: true },
    invoiceNumber: String,
    invoiceDate: Date,
    invoiceTotal: Number,
  },
  
  // Customer (copied from Invoice)
  customer: {
    id: String,
    name: String,
    email: String,
    taxPin: String,
  },
  
  // Reason
  reason: {
    type: String,
    enum: ["return", "pricing_error", "damaged", "service_issue", "other"],
    required: true,
  },
  reasonDetails: String,
  
  // Items being credited
  items: [{
    originalItemIndex: Number, // Reference to invoice item
    productId: Schema.Types.ObjectId,
    productSKU: String,
    productName: String,
    description: String,
    quantity: Number, // Quantity being returned/credited
    unitPrice: Number,
    amount: Number,
    taxRate: Number,
    taxAmount: Number,
    
    // For returns - track stock
    returnToInventory: { type: Boolean, default: true },
    stockMovementId: Schema.Types.ObjectId,
  }],
  
  // Amounts
  subtotal: Number,
  taxAmount: Number,
  total: Number,
  
  // Accounting
  journalEntryId: Schema.Types.ObjectId,
  
  // Status
  status: {
    type: String,
    enum: ["draft", "approved", "applied", "cancelled"],
    default: "draft",
  },
  
  approvedAt: Date,
  approvedBy: { name: String, id: String },
  
  // How credit was applied
  application: {
    method: {
      type: String,
      enum: ["refund", "apply_to_invoice", "store_credit"],
    },
    appliedToInvoiceId: Schema.Types.ObjectId,
    refundPaymentId: Schema.Types.ObjectId,
    appliedAt: Date,
    appliedBy: { name: String, id: String },
  },
  
  // Audit
  createdBy: { name: String, id: String },
}, { timestamps: true });

// Methods:
// - approve(user) → Approve, create JE, create stock movements
// - applyToInvoice(invoiceId, user) → Apply credit to another invoice
// - issueRefund(paymentMethod, user) → Create refund payment
```

### 5.5 Payment Schema Enhancement

```javascript
// /app/models/payment.js

const paymentSchema = new Schema({
  paymentNumber: { type: String, required: true, unique: true },
  paymentDate: { type: Date, required: true },
  
  // Payment Type
  paymentType: {
    type: String,
    enum: ["received", "made"], // received = from customer, made = to supplier
    required: true,
  },
  
  // Party
  party: {
    type: { type: String, enum: ["customer", "supplier", "employee"] },
    id: String,
    name: String,
  },
  
  // Payment Method
  paymentMethod: {
    type: String,
    enum: ["cash", "mpesa", "bank_transfer", "cheque", "card"],
    required: true,
  },
  
  // Payment Details
  amount: { type: Number, required: true },
  currency: { type: String, default: "KES" },
  
  // Bank/Mpesa details
  bankDetails: {
    bankName: String,
    accountNumber: String,
    chequeNumber: String,
    transactionReference: String,
  },
  
  mpesaDetails: {
    transactionCode: String,
    phoneNumber: String,
  },
  
  // Allocations (which invoices/bills this pays)
  allocations: [{
    documentType: { type: String, enum: ["invoice", "bill", "credit_note"] },
    documentId: Schema.Types.ObjectId,
    documentNumber: String,
    amount: Number,
    whtAmount: { type: Number, default: 0 }, // WHT deducted
  }],
  
  // WHT (for payments made to suppliers)
  whtDeducted: { type: Number, default: 0 },
  netAmount: Number, // amount - whtDeducted
  
  // Account
  accountId: Schema.Types.ObjectId,
  accountCode: String,
  accountName: String,
  
  // Journal Entry
  journalEntryId: Schema.Types.ObjectId,
  
  // Status
  status: {
    type: String,
    enum: ["draft", "confirmed", "reconciled", "cancelled"],
    default: "draft",
  },
  
  // Reconciliation
  reconciliation: {
    reconciled: { type: Boolean, default: false },
    reconciledAt: Date,
    reconciledBy: { name: String, id: String },
    bankStatementRef: String,
  },
  
  // Audit
  createdBy: { name: String, id: String },
}, { timestamps: true });
```


---

## 6. DEVELOPMENT PHASES

### Phase 1: Core Transaction Completion (Week 1-2)
**Goal:** Complete all transaction schemas and actions

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Fix `addStock`/`updateStock` actions | 🔴 HIGH | 2h | None |
| Bill server actions | 🔴 HIGH | 4h | None |
| Bill UI (list, create, detail) | 🔴 HIGH | 6h | Bill actions |
| Expense server actions | 🔴 HIGH | 3h | None |
| Expense UI (list, create, detail) | 🔴 HIGH | 5h | Expense actions |
| Add Fiscal Period validation to JE.post() | 🔴 HIGH | 1h | None |
| Payment schema + actions | 🟡 MED | 4h | Bill/Invoice |

### Phase 2: Purchase Flow (Week 2-3)
**Goal:** Complete purchase cycle

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| PurchaseOrder schema | 🔴 HIGH | 3h | None |
| PurchaseOrder actions | 🔴 HIGH | 4h | Schema |
| PurchaseOrder UI | 🔴 HIGH | 6h | Actions |
| PO → Bill conversion | 🟡 MED | 3h | Both schemas |
| Bill payment flow | 🟡 MED | 4h | Payment schema |

### Phase 3: Sales Flow Enhancement (Week 3-4)
**Goal:** Complete sales cycle with quotes

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Quote schema | 🟡 MED | 3h | None |
| Quote actions | 🟡 MED | 4h | Schema |
| Quote UI | 🟡 MED | 6h | Actions |
| Quote → Invoice conversion | 🟡 MED | 3h | Both schemas |
| Add salesPerson to Invoice | 🟡 MED | 2h | Party schema |
| Invoice ↔ StockRequest UI link | 🟡 MED | 3h | Existing schemas |
| CreditNote schema + actions | 🟡 MED | 5h | Invoice |
| CreditNote UI | 🟡 MED | 5h | Actions |

### Phase 4: PDF Generation (Week 4-5)
**Goal:** Professional PDF documents

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Setup @react-pdf/renderer | 🟡 MED | 2h | None |
| Base PDF template/components | 🟡 MED | 4h | Setup |
| Quote PDF | 🟡 MED | 4h | Quote schema |
| Invoice PDF | 🟡 MED | 4h | Invoice schema |
| Credit Note PDF | 🟡 MED | 3h | CreditNote schema |
| Purchase Order PDF | 🟡 MED | 4h | PO schema |
| Delivery Note PDF | 🟢 LOW | 3h | DeliveryNote schema |
| Bill/Payment Voucher PDF | 🟢 LOW | 3h | Bill schema |

### Phase 5: Dashboard & Reports (Week 5-6)
**Goal:** Complete all dashboards

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Executive Dashboard | 🟡 MED | 6h | All transactions |
| Accountant Dashboard complete | 🟡 MED | 5h | JE queries |
| AR Aging Report | 🟡 MED | 3h | Invoice data |
| AP Aging Report | 🟡 MED | 3h | Bill data |
| VAT Report | 🟡 MED | 3h | TaxTransaction |
| WHT Report | 🟡 MED | 3h | TaxTransaction |
| Inventory Valuation Report | 🟢 LOW | 3h | Product/Movement |
| Sales Report by Person | 🟢 LOW | 3h | Invoice + salesPerson |


---

## 7. PDF TEMPLATES REQUIRED

### Template List

| Document | Fields | Logo | Footer | Status |
|----------|--------|------|--------|--------|
| Quote | Customer, Items, Totals, Terms | ✅ | Terms & Conditions | ❌ |
| Invoice | Customer, Items, Totals, Payment Info | ✅ | Bank Details | ❌ |
| Credit Note | Customer, Original Invoice, Items | ✅ | Reason | ❌ |
| Purchase Order | Supplier, Items, Delivery Info | ✅ | Terms | ❌ |
| Delivery Note | Customer, Items, Signatures | ✅ | Receiver Sign | ❌ |
| Payment Voucher | Payee, Amount, Approvals | ✅ | Signatures | ❌ |
| Receipt | Customer, Amount, Payment Method | ✅ | Thank you | ❌ |

### PDF Component Structure

```
/app/components/pdf/
├── templates/
│   ├── QuotePDF.jsx
│   ├── InvoicePDF.jsx
│   ├── CreditNotePDF.jsx
│   ├── PurchaseOrderPDF.jsx
│   ├── DeliveryNotePDF.jsx
│   └── PaymentVoucherPDF.jsx
├── components/
│   ├── PDFHeader.jsx         # Company logo, address
│   ├── PDFFooter.jsx         # Page numbers, terms
│   ├── PDFTable.jsx          # Line items table
│   ├── PDFTotals.jsx         # Subtotal, tax, total
│   ├── PDFPartyInfo.jsx      # Customer/Supplier block
│   └── PDFSignatures.jsx     # Signature lines
└── styles/
    └── pdfStyles.js          # Shared styles
```


---

## 8. UTILITY FUNCTIONS REFERENCE

### Entry Number Generators

| Function | Location | Format | Used By |
|----------|----------|--------|---------|
| `generateUniqueEntryNumber(prefix)` | `/app/lib/utils/generateEntryNumber.js` | `JE-{PREFIX}-0001` | All JE creators |
| `generateMovementNumber()` | StockMovement static | `MOV-DDMMYY-0001` | Stock movements |
| `generateAdjustmentNumber()` | InventoryAdjustment static | `ADJ-YYYY-0001` | Adjustments |
| `generateRequestNumber()` | Request actions | `REQ-DDMMYY-001` | Stock requests |
| `generateCheckoutNumber()` | Request actions | `CHECK-DDMMYY-001` | Checkouts |

### Journal Entry Prefixes

| Prefix | Used For | Example |
|--------|----------|---------|
| `SALE` | Invoice revenue | `JE-SALE-0001` |
| `COGS` | Invoice COGS | `JE-COGS-0001` |
| `BILL` | Bill approval | `JE-BILL-0001` |
| `EXP` | Expense | `JE-EXP-0001` |
| `PAY` | Payment made | `JE-PAY-0001` |
| `REC` | Payment received | `JE-REC-0001` |
| `ADV` | Employee advance | `JE-ADV-0001` |
| `ADJ` | Adjustment | `JE-ADJ-0001` |
| `REV` | Reversal | `JE-REV-0001` |
| `CLOSE` | Period closing | `JE-CLOSE-2025-01` |

### Formatting Functions

| Function | Location | Example |
|----------|----------|---------|
| `formatCurrency(amount, compact?)` | `/app/lib/utils.ts` | `KES 1,500,000.00` or `KES 1.5M` |
| `formatRelativeTime(date)` | `/app/lib/utils.ts` | `5m ago`, `2h ago` |
| `toTitle(string)` | `/app/lib/utils.ts` | `HELLO WORLD` → `Hello World` |


---

## 10. KNOWN BUGS & FIXES

### 10.1 BUG: `closeSettlement` Journal Entry Logic (CRITICAL)

**Location:** `/app/lib/actions/claims/actions.js` → `closeSettlement()`

**Problem:** When employee owes company (balance > 0), the code incorrectly debits Employee Payables instead of keeping the balance in Employee Advances.

**Current (Wrong) Code:**
```javascript
if (balance > 0) {
  // ❌ WRONG - Employee Payables is for when WE OWE THEM
  journalLines.push({
    accountId: employeePayablesAccount._id,
    debit: balance,
    credit: 0,
    description: `Amount to be returned by ${settlement.employee.name}`,
  });
}
```

**Fixed Code:**
```javascript
// ============================================
// FIXED: closeSettlement Journal Entry Logic
// ============================================

// Calculate balance
const advanceAmount = settlement.returnDetails.advanceAmount;
const totalSpent = settlement.returnDetails.totalSpent;
const balance = advanceAmount - totalSpent;

// DEBIT: All expense accounts
for (const [category, amount] of Object.entries(expensesByCategory)) {
  const account = expenseAccounts[category];
  journalLines.push({
    accountId: account._id,
    accountCode: account.accountCode,
    accountName: account.accountName,
    accountType: account.accountType,
    debit: amount,
    credit: 0,
    description: `${category} expenses`,
  });
}

// CREDIT: Employee Advances - always credit by totalSpent (what was actually used)
journalLines.push({
  accountId: employeeAdvancesAccount._id,
  accountCode: employeeAdvancesAccount.accountCode,
  accountName: employeeAdvancesAccount.accountName,
  accountType: employeeAdvancesAccount.accountType,
  debit: 0,
  credit: totalSpent, // ✅ Only clear what was spent
  description: `Clear advance for expenses`,
});

// Handle remaining balance
if (balance > 0) {
  // Employee owes company - advance balance remains in Employee Advances
  // Don't create any entry - the remaining balance stays as asset
  // Employee must return cash separately
  
  // Optional: Create a receivable entry if you want explicit tracking
  // But typically the remaining Employee Advances balance IS the receivable
  
} else if (balance < 0) {
  // Company owes employee - need to record payable
  journalLines.push({
    accountId: employeePayablesAccount._id,
    accountCode: employeePayablesAccount.accountCode,
    accountName: employeePayablesAccount.accountName,
    accountType: employeePayablesAccount.accountType,
    debit: 0,
    credit: Math.abs(balance), // ✅ Credit = we owe them
    description: `Additional reimbursement owed to ${settlement.employee.name}`,
  });
}

// Verify journal entry balances
const totalDebits = journalLines.reduce((sum, l) => sum + (l.debit || 0), 0);
const totalCredits = journalLines.reduce((sum, l) => sum + (l.credit || 0), 0);

if (Math.abs(totalDebits - totalCredits) > 0.01) {
  throw new Error(
    `Journal entry not balanced! Debits: ${totalDebits}, Credits: ${totalCredits}`
  );
}
```

**Test Cases:**

| Advance | Spent | Balance | DR Expenses | CR Emp Advances | CR Emp Payables | Balanced? |
|---------|-------|---------|-------------|-----------------|-----------------|-----------|
| 10,000 | 7,000 | +3,000 | 7,000 | 7,000 | 0 | ✅ 7k = 7k |
| 10,000 | 12,000 | -2,000 | 12,000 | 10,000 | 2,000 | ✅ 12k = 12k |
| 10,000 | 10,000 | 0 | 10,000 | 10,000 | 0 | ✅ 10k = 10k |


### 10.2 BUG: `payAdvance` uses wrong system account name

**Location:** `/app/lib/actions/claims/actions.js` → `payAdvance()`

**Problem:** Looking for `employee_advance` (singular) but schema uses `employee_advances` (plural)

**Fix:**
```javascript
// Change this:
const employeeAdvancesAccount = await Account.findOne({
  systemAccount: "employee_advance",  // ❌ Wrong
}).session(session);

// To this:
const employeeAdvancesAccount = await Account.findOne({
  systemAccount: "employee_advances",  // ✅ Correct (plural)
}).session(session);
```


### 10.3 MISSING: Cash Return from Employee

**Issue:** When employee owes company (balance > 0), there's no action to record the cash return.

**Solution:** Add new action `recordAdvanceReturn`:

```javascript
// ============================================
// RECORD CASH RETURN FROM EMPLOYEE
// ============================================
export async function recordAdvanceReturn(settlementId, prevState, formData) {
  // ... auth checks ...
  
  const settlement = await EmployeeClaim.findById(settlementId);
  const balance = settlement.returnDetails.balance;
  
  if (balance <= 0) {
    throw new Error("No amount to return");
  }
  
  const paymentMethod = formData.get("paymentMethod");
  const amountReturned = parseFloat(formData.get("amount"));
  
  // Get accounts
  const paymentAccount = await getPaymentAccount(paymentMethod);
  const employeeAdvancesAccount = await Account.findOne({
    systemAccount: "employee_advances",
  });
  
  // Journal Entry: Employee returns cash
  // DR: Cash/Bank
  // CR: Employee Advances
  const journalEntry = await JournalEntry.create([{
    entryNumber: await generateUniqueEntryNumber("RET"),
    entryDate: new Date(),
    entryType: "advance_return",
    description: `Advance return - ${settlement.claimNumber}`,
    lines: [
      {
        accountId: paymentAccount._id,
        accountCode: paymentAccount.accountCode,
        accountName: paymentAccount.accountName,
        accountType: paymentAccount.accountType,
        debit: amountReturned,
        credit: 0,
        description: `Cash returned by ${settlement.employee.name}`,
      },
      {
        accountId: employeeAdvancesAccount._id,
        accountCode: employeeAdvancesAccount.accountCode,
        accountName: employeeAdvancesAccount.accountName,
        accountType: employeeAdvancesAccount.accountType,
        debit: 0,
        credit: amountReturned,
        description: `Clear remaining advance`,
      },
    ],
    // ... rest of JE fields
  }]);
  
  await journalEntry[0].post(user);
  
  // Update settlement status to fully closed
  settlement.returnDetails.amountReturned = amountReturned;
  settlement.status = "closed";
  await settlement.save();
}
```


### 10.4 MISSING: Pay Extra to Employee

**Issue:** When company owes employee (balance < 0), there's no action to pay the extra amount.

**Solution:** Add new action `paySettlementBalance`:

```javascript
// ============================================
// PAY EXTRA AMOUNT TO EMPLOYEE
// ============================================
export async function paySettlementBalance(settlementId, prevState, formData) {
  // ... auth checks ...
  
  const settlement = await EmployeeClaim.findById(settlementId);
  const balance = settlement.returnDetails.balance;
  
  if (balance >= 0) {
    throw new Error("No amount owed to employee");
  }
  
  const amountToPay = Math.abs(balance);
  const paymentMethod = formData.get("paymentMethod");
  
  // Get accounts
  const paymentAccount = await getPaymentAccount(paymentMethod);
  const employeePayablesAccount = await Account.findOne({
    systemAccount: "employee_payables",
  });
  
  // Journal Entry: Pay extra to employee
  // DR: Employee Payables
  // CR: Cash/Bank
  const journalEntry = await JournalEntry.create([{
    entryNumber: await generateUniqueEntryNumber("PAY"),
    entryDate: new Date(),
    entryType: "payment_made",
    description: `Settlement payment - ${settlement.claimNumber}`,
    lines: [
      {
        accountId: employeePayablesAccount._id,
        debit: amountToPay,
        credit: 0,
        description: `Clear payable to ${settlement.employee.name}`,
      },
      {
        accountId: paymentAccount._id,
        debit: 0,
        credit: amountToPay,
        description: `Payment via ${paymentMethod}`,
      },
    ],
    // ... rest of JE fields
  }]);
  
  await journalEntry[0].post(user);
  
  settlement.settlementPaymentId = journalEntry[0]._id;
  settlement.status = "closed";
  await settlement.save();
}
```


---

## 11. SYSTEM ACCOUNTS REQUIRED

### Account Setup Checklist

| System Account | Account Type | Required By |
|----------------|--------------|-------------|
| `accounts_receivable` | Asset | Invoice, Payment |
| `accounts_payable` | Liability | Bill, Payment |
| `inventory` | Asset | Bill, Invoice, Adjustment |
| `technician_stock` | Asset | Request fulfillment |
| `cogs` | Expense | Invoice COGS |
| `sales_revenue` | Revenue | Invoice |
| `vat_input` | Asset | Bill, Expense |
| `vat_output` | Liability | Invoice |
| `wht_payable` | Liability | Bill |
| `employee_advances` | Asset | Employee Claims |
| `employee_payables` | Liability | Employee Claims |
| `retained_earnings` | Equity | Period closing |
| `inventory_adjustment` | Expense | Stock Adjustment |
| `cash` | Asset | Payments |
| `bank` | Asset | Payments |
| `mpesa` | Asset | Payments |


---

---

## 12. QUICK REFERENCE - WHAT CREATES WHAT

| Action | Creates JE? | Creates Movement? | Creates Tax Txn? | Updates Product? |
|--------|-------------|-------------------|------------------|------------------|
| addStock (new) | ❌ | ✅ initial | ❌ | ✅ create |
| updateStock | ❌ | ❌ | ❌ | ✅ update |
| StockAdjustment.approve() | ✅ auto | ✅ auto | ❌ | ✅ qty |
| Bill.approve() | ✅ auto | ✅ if products | ✅ VAT+WHT | ✅ qty+cost |
| Bill.recordPayment() | ✅ auto | ❌ | ❌ | ❌ |
| Invoice.complete() | ✅ Revenue+COGS | ✅ sale | ✅ VAT | ✅ qty |
| Invoice.recordPayment() | ✅ auto | ❌ | ❌ | ❌ |
| Expense.approve() | ✅ auto | ❌ | ✅ if VAT | ❌ |
| fulfillRequest() | ✅ auto | ✅ issue | ❌ | ✅ qty |
| returnItemCheckout() | ✅ auto | ✅ return | ❌ | ✅ qty |
| EmployeeClaim.approve() | ✅ auto | ❌ | ❌ | ❌ |


---

# ═══════════════════════════════════════════════════════════════════════════════
#                              END OF DOCUMENT
# ═══════════════════════════════════════════════════════════════════════════════