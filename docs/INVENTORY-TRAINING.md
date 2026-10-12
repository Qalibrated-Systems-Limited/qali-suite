# How Inventory Works

*Training reference for storekeepers, procurement and finance. Written against
the behaviour as of migration 0121 — where a screen or an account name is
mentioned, it is the one the system actually uses.*

---

## 1. The one rule everything else follows

**Stock has two numbers, and they move together: a quantity and a value.**

Every time the quantity on a shelf changes, the system writes two things — a
**stock movement** (what moved, when, how much, at what cost) and, where the
change is a real economic event, a **journal entry** (what it was worth and
where that value came from).

A quantity that moves without a value is the single most damaging thing that
can happen to an inventory system. It means the shelf and the balance sheet
disagree, and every cost-of-sales figure after it is wrong. Most of the rules
in this document exist to stop that.

This is why the system will sometimes refuse to do something that looks
harmless — admitting stock with no cost, for example. It is not being awkward.
It is refusing to create a number nobody can explain.

---

## 2. How stock comes in

There are five ways, and **which one you use is an accounting statement**, not
a matter of convenience. They post to different accounts and they mean
different things.

| Route | Use it when | What it credits |
|---|---|---|
| **Goods Receipt (GRN)** | A supplier delivered goods you ordered | GR/IR Clearing |
| **Opening stock** | Stock existed before you started using this system | Opening Balance Equity |
| **Stock adjustment (increase)** | A count found more than the system expected | Inventory Adjustments (expense) |
| **Customer return** | A customer sent goods back | Against the credit note |
| **NCR disposition** | Quarantined goods were released | Against the original receipt |

The first three are the ones people get wrong, and the mistake is almost always
the same: **using an adjustment or opening stock for something that was
actually bought.**

If a supplier delivered it, it is a goods receipt. Not an adjustment — an
adjustment credits an expense account and hides a purchase. Not opening stock —
that credits equity and claims the goods predate the system. Both leave you
with no supplier record, no invoice to match, and nothing to dispute when the
bill arrives wrong.

### Stock going out

Issues to jobs, sales, damage, transfers and write-offs. These follow the same
principle: the value leaves at the product's current weighted-average cost, and
the movement records what it was.

---

## 3. Buying: the three-document flow

This is the core of the module. Three documents describe one purchase, and each
answers a different question.

```
   PURCHASE ORDER          GOODS RECEIPT             SUPPLIER BILL
   what we ordered    →    what actually arrived  →  what we were charged
```

Matching all three is called **three-way match**, and it is the control that
catches short deliveries, over-billing and price changes. It is **on by
default** (migration 0121).

### What happens at each step

**1. Purchase order** — nothing posts. An order is a promise, not a
transaction.

**2. Goods receipt** — the storekeeper records what arrived.

- The goods go **on hand and on hold at the same time**, so the available
  quantity does not move. Nothing can be issued or sold against them yet.
- Still nothing posts to the ledger. Goods that might be rejected have not
  been bought.

**3. Acceptance** — Sales and Finance both sign. The SOP requires both, and the
system enforces it: one signature is not enough.

On the second signature:

```
DR  Inventory          ← the goods are now yours, and issuable
CR  GR/IR Clearing     ← and you owe someone for them
```

Anything rejected leaves again at this point and never enters inventory. A
discrepancy automatically raises an **NCR** (nonconformance report) so it is
visible without anyone opening the GRN.

**4. Supplier bill** — approved by Finance.

```
DR  GR/IR Clearing     ← clearing what the receipt raised
CR  Accounts Payable   ← the supplier is now owed
```

The bill **does not touch inventory**. The goods were admitted by the receipt.

### If the bill arrives first

The same two entries, in the other order. The bill posts to GR/IR and waits,
and the receipt clears it. Either sequence nets GR/IR to zero once both
documents exist. That is the whole purpose of the account.

---

## 4. GR/IR, in plain language

GR/IR stands for **Goods Receipt / Invoice Receipt**. It is a holding account
for the gap between the delivery and the invoice, and it is normal for it to
have a balance.

Read it on **Purchase Reconciliation** (under both Purchases and Accounting —
same screen, because it is one question asked by two departments). You never
need to read a journal entry to understand it.

| Balance | What it means | Is it a problem? |
|---|---|---|
| **Positive** | Goods received, supplier hasn't invoiced yet | Usually not — until it gets old |
| **Negative** | Invoiced for goods not recorded as received | Investigate |
| **Zero** | Matched | No |

The screen never shows you a sign. It says *"KES 20,000 received, not
invoiced"* or *"KES 20,000 invoiced, not received"*.

**Age is the signal, not the sign.** A position three days old is procurement
working normally. The same figure at ninety days is a control failure — either
an invoice nobody chased, a receipt nobody posted, or a delivery that never
happened. That is why the screen groups by age.

### When "invoiced, not received" appears

Work down this list:

1. The invoice genuinely arrived before the goods.
2. The delivery happened but the GRN was never posted.
3. The GRN quantity is understated — a short delivery nobody flagged.
4. The supplier billed more than they sent.
5. The price on the invoice differs from the order.
6. The wrong PO, GRN or bill were matched to each other.

The exception list shows **ordered / received / invoiced** side by side for
exactly this reason. A difference of 20,000 tells you nothing; *ordered
100,000, received 100,000, invoiced 80,000* tells you which document to open.

### The "Unexplained" figure

The screen reconciles itself against the ledger and shows any difference. It is
not decoration. Goods receipts raised directly against a bill, or with no
source document at all, post to GR/IR but have no order line to appear under.
If that number is not zero, something is in the account that the positions
cannot account for.

---

## 5. What things cost

**Cost is calculated, never typed.**

The system uses **weighted average** — and only weighted average. Every time
stock is received at a price, the product's cost is recalculated across
everything on the shelf:

```
new cost = (existing qty × existing cost + received qty × received price)
           ÷ (existing qty + received qty)
```

There is no field to edit a product's cost, and this is deliberate. Typing over
a cost would revalue everything in the warehouse with no entry to explain the
change — the balance sheet would move and nothing would say why.

**Selling price is different.** It is a decision, not a calculation, and it is
set on the pricing dialog. A price below cost, below the product's own floor,
or under the company's minimum margin raises an approval and **leaves the
price unchanged** until someone signs it.

Cost and price are set by different people on purpose: whoever measures the
margin should not also set the number it is measured from.

---

## 6. Opening stock vs. restocking

The distinction people get wrong most often, and the most expensive.

**Opening stock** means *this existed before we started keeping books in this
system*. It is a go-live activity. It credits **Opening Balance Equity**,
because nothing was bought — you are recording what was already there.

**Restocking** means *we bought more*. It credits **Accounts Payable**, through
a goods receipt and a bill, because there is a supplier who is owed money.

Using opening stock for a mid-year purchase overstates equity permanently,
leaves no supplier record, produces no GR/IR position, and gives you nothing
to match the invoice against when it arrives.

> **Rule of thumb:** if there is a supplier who expects to be paid, it is a
> goods receipt. If there is no supplier because the stock predates the system,
> it is opening stock. There is no third case.

A new product created today starts at **quantity zero with no valuation**, and
that is a complete and correct record. An empty shelf is not a problem to be
fixed — it is the honest state until something arrives.

---

## 7. Counts and adjustments

A stock adjustment says *the system's figure was wrong*. It is for counts,
damage, expiry, theft and corrections — never for receiving.

**Raising one and approving one are different jobs.** A storekeeper counts the
shelf; someone who carries the loss signs it off. Approving is not a status
change — it moves the stock and writes the journal entry.

### When a count finds stock the company has never valued

If a count finds more of a product that has **no cost on record**, the
adjustment does not become a draft awaiting a signature. It goes to
**Awaiting valuation**, and finance or procurement enters what the goods were
worth before it can be approved.

This exists because admitting stock at no value raises the quantity on the
shelf while the balance sheet stays still, and leaves units with nothing to
charge to cost of sales when they eventually sell.

The person supplying the cost **cannot change the count**. The counted figure
is a statement about what is physically there, made by the person who was
standing in front of it. Valuation says what it was worth. Two different
statements, two different people.

If the product already has a weighted-average cost, none of this applies — the
count is valued at that cost and takes the ordinary approval route.

---

## 8. Who can do what

| Task | Roles |
|---|---|
| Record a goods receipt | Storekeeper, Store Manager, Admin |
| Accept a receipt (Sales side) | Sales Manager, Admin |
| Accept a receipt (Finance side) | Finance Manager, CFO, Admin |
| Raise a stock adjustment | Storekeeper, Store Manager, Manager, Accountant, Admin |
| Approve a stock adjustment | Store Manager, Manager, CFO, Finance Manager, Admin |
| Value unvalued stock | CFO, Finance Manager, Procurement Officer, Admin |
| Create a product | Store Manager, Manager, CFO, Finance Manager, Admin |
| Set a cost price | CFO, Finance Manager, Procurement Officer, Admin |
| Set a selling price | Sales Manager, CFO, Finance Manager, Admin |
| Approve a supplier bill | Finance Manager, CFO, Admin |
| Read GR/IR reconciliation | Procurement and Finance both |

SuperAdmin passes every check.

Two splits are load-bearing and worth understanding rather than memorising:

- **Receiving is not accepting.** The person who takes the delivery does not
  decide it is acceptable.
- **Counting is not valuing.** A Store Manager may approve a count and may not
  decide what the goods were worth.

---

## 9. Quick reference — what do I use?

| Situation | Use |
|---|---|
| Supplier delivered against an order | Goods Receipt |
| Supplier delivered with no order | Goods Receipt (unscheduled) |
| Loading stock at go-live | Opening stock |
| Count found more than expected | Stock adjustment — increase |
| Count found less than expected | Stock adjustment — decrease |
| Goods broken or expired | Stock adjustment — damage / expiry |
| Customer sent goods back | Credit note |
| Goods arrived damaged | Reject on the GRN — never adjust afterwards |
| Invoice disagrees with the delivery | Leave it; the GR/IR exception list is where it belongs |

---

## 10. Things that will refuse, and why

| You'll see | Because | Do this |
|---|---|---|
| "Opening stock needs a cost price" | Stock with no value misstates the balance sheet | Set a cost, or save with zero stock and receive it properly |
| "This adjustment admits stock with no cost" | Same reason, found by a count | Finance or procurement values it first |
| "Sales has not signed this receipt yet" | Both signatures are required | Get the other signature |
| "Three-way match is enabled but no GR/IR clearing account" | The chart of accounts is incomplete | Finance maps a GR/IR account |
| "You do not set cost prices" | Cost is a finance decision | Save with zero stock; ask someone with cost rights |

None of these are bugs. Each is the system refusing to write a number it cannot
justify — which is the whole job.
