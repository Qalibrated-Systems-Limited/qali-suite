import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { bills, billLines, parties, accounts, products } from "../schema";
import { createJournalEntry, reverseJournalEntry } from "./journal";
import { receiveStock } from "./products";
import { recordMovement } from "./stockMovements";
import { recordBillTaxes } from "./taxTransactions";

/**
 * Bills — accounts payable, and the posting they drive.
 *
 * Money is passed and returned as strings throughout: numeric(19,4) maps to
 * string in Drizzle precisely so values never round-trip through float64.
 *
 * What is NOT in this file, compared to app/models/bill.js:
 *
 * - No amount arithmetic. subtotal/vat/wht are maintained from the lines by a
 *   trigger and total/net_payable/balance are generated columns, so the header
 *   cannot disagree with the lines it was computed from — however the rows are
 *   written. bill.js does this in a pre-save hook that only fires on
 *   document.save().
 * - No balance check before posting. bill.js:992 compares debits and credits
 *   with a 0.01 tolerance and posts anyway if it passes; the database has
 *   refused unbalanced entries exactly since migration 0001.
 * - No overpay guard. bill.js:1302 allows `amount > balance + 0.01`;
 *   CHECK (balance >= 0) refuses it to the cent.
 */

/**
 * Tests a money string for zero without going through Number().
 *
 * numeric(19,4) always renders with four decimals, so `=== "0.0000"` would
 * work today — but the whole point of keeping money as strings is that no
 * value silently acquires a float representation on the way to a comparison,
 * and a pattern says that out loud where an equality check does not.
 */
const isZero = (v: string | null) => v === null || /^-?0(\.0*)?$/.test(v);

export interface BillLineInput {
  description: string;
  accountId: string;
  quantity: string;
  unitPrice: string;
  unit?: string;
  vatRate?: string;
  /** Set only for stocked items — decides whether the line moves inventory. */
  productId?: string | null;
  /** Goods already admitted at the weighbridge; the line clears GR/IR. */
  weighbridgeTicketId?: string | null;
  purchaseOrderId?: string | null;
  purchaseOrderLineNumber?: number | null;
  assetId?: string | null;
  assetNumber?: string | null;
  assetName?: string | null;
}

export interface CreateBillInput {
  companyId: string;
  supplierId: string;
  billDate: string;
  dueDate: string;
  supplierInvoiceNumber?: string | null;
  whtApplicable?: boolean;
  whtRate?: string;
  title?: string | null;
  reference?: string | null;
  description?: string | null;
  internalNotes?: string | null;
  currency?: string;
  purchaseOrderId?: string | null;
  purchaseOrderNumber?: string | null;
  projectId?: string | null;
  projectNumber?: string | null;
  projectName?: string | null;
  costCodeId?: string | null;
  costCode?: string | null;
  costCodeName?: string | null;
  lines: BillLineInput[];
  createdById?: string | null;
}

/**
 * Creates a draft bill with its lines.
 *
 * The supplier and account details are resolved once, here, and never
 * refreshed: §9.4 keeps them as snapshots of what the bill said when it was
 * raised, and migration 0016 refuses to let them be updated afterwards.
 *
 * The header is re-read at the end because its amounts are the trigger's
 * output, not this function's.
 */
export async function createBill(tx: Tx, input: CreateBillInput) {
  if (input.lines.length === 0) {
    throw new Error("A bill must have at least one line");
  }

  const [supplier] = await tx
    .select({
      name: parties.name,
      taxPin: parties.taxPin,
      email: parties.email,
      phone: parties.phone,
    })
    .from(parties)
    .where(eq(parties.id, input.supplierId));
  if (!supplier) throw new Error("Supplier not found");

  const [{ bill_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'BILL') AS bill_number`,
  )) as unknown as Array<{ bill_number: string }>;

  const [bill] = await tx
    .insert(bills)
    .values({
      companyId: input.companyId,
      billNumber: bill_number,
      supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
      billDate: input.billDate,
      dueDate: input.dueDate,
      supplierId: input.supplierId,
      supplierNameAtBill: supplier.name,
      supplierTaxPinAtBill: supplier.taxPin,
      supplierEmailAtBill: supplier.email,
      supplierPhoneAtBill: supplier.phone,
      whtApplicable: input.whtApplicable ?? false,
      whtRate: input.whtRate ?? "0",
      currency: input.currency ?? "KES",
      title: input.title ?? null,
      reference: input.reference ?? null,
      description: input.description ?? null,
      internalNotes: input.internalNotes ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      purchaseOrderNumberAtBill: input.purchaseOrderNumber ?? null,
      projectId: input.projectId ?? null,
      projectNumberAtBill: input.projectNumber ?? null,
      projectNameAtBill: input.projectName ?? null,
      costCodeId: input.costCodeId ?? null,
      costCodeAtBill: input.costCode ?? null,
      costCodeNameAtBill: input.costCodeName ?? null,
      createdById: input.createdById ?? null,
    })
    .returning();

  let n = 0;
  for (const line of input.lines) {
    n++;

    const [account] = await tx
      .select({
        code: accounts.accountCode,
        name: accounts.accountName,
        type: accounts.accountType,
      })
      .from(accounts)
      .where(eq(accounts.id, line.accountId));
    if (!account) throw new Error(`Account not found: ${line.accountId}`);

    // A bill line charges an expense or an asset. Anything else means the
    // caller picked a revenue, liability or equity account for a purchase.
    if (account.type !== "expense" && account.type !== "asset") {
      throw new Error(
        `Bill line ${n} charges ${account.code} (${account.type}); a bill line must charge an expense or asset account`,
      );
    }

    await tx.insert(billLines).values({
      companyId: input.companyId,
      billId: bill.id,
      lineNumber: n,
      description: line.description,
      productId: line.productId ?? null,
      accountId: line.accountId,
      accountCodeAtBill: account.code,
      accountNameAtBill: account.name,
      accountType: account.type,
      quantity: line.quantity,
      unit: line.unit ?? "pcs",
      unitPrice: line.unitPrice,
      vatRate: line.vatRate ?? "0",
      weighbridgeTicketId: line.weighbridgeTicketId ?? null,
      purchaseOrderId: line.purchaseOrderId ?? null,
      purchaseOrderLineNumber: line.purchaseOrderLineNumber ?? null,
      assetId: line.assetId ?? null,
      assetNumberAtBill: line.assetNumber ?? null,
      assetNameAtBill: line.assetName ?? null,
    });
  }

  const [withTotals] = await tx.select().from(bills).where(eq(bills.id, bill.id));
  return withTotals;
}

/**
 * An opening-balance bill: a pre-cutover payable carried in during onboarding.
 *
 * Carries no lines and posts only Dr Opening Balance Equity / Cr AP, so the AP
 * subledger is seeded without booking an expense into the new period. The
 * totals trigger skips these — their gross amount is set here.
 */
export async function createOpeningBalanceBill(
  tx: Tx,
  input: {
    companyId: string;
    supplierId: string;
    billDate: string;
    dueDate: string;
    amount: string;
    supplierInvoiceNumber?: string | null;
    createdById?: string | null;
  },
) {
  const [supplier] = await tx
    .select({ name: parties.name, taxPin: parties.taxPin })
    .from(parties)
    .where(eq(parties.id, input.supplierId));
  if (!supplier) throw new Error("Supplier not found");

  const [{ bill_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'BILL-OB') AS bill_number`,
  )) as unknown as Array<{ bill_number: string }>;

  const [bill] = await tx
    .insert(bills)
    .values({
      companyId: input.companyId,
      billNumber: bill_number,
      supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
      billDate: input.billDate,
      dueDate: input.dueDate,
      supplierId: input.supplierId,
      supplierNameAtBill: supplier.name,
      supplierTaxPinAtBill: supplier.taxPin,
      isOpeningBalance: true,
      subtotal: input.amount,
      createdById: input.createdById ?? null,
    })
    .returning();

  return bill;
}

export async function getBill(tx: Tx, billId: string) {
  const [bill] = await tx.select().from(bills).where(eq(bills.id, billId));
  if (!bill) return null;

  const lines = await tx
    .select({
      id: billLines.id,
      lineNumber: billLines.lineNumber,
      description: billLines.description,
      productId: billLines.productId,
      sku: products.sku,
      accountId: billLines.accountId,
      // The snapshots, not a join — this is what the line was charged to.
      accountCode: billLines.accountCodeAtBill,
      accountName: billLines.accountNameAtBill,
      accountType: billLines.accountType,
      quantity: billLines.quantity,
      unit: billLines.unit,
      unitPrice: billLines.unitPrice,
      amount: billLines.amount,
      vatRate: billLines.vatRate,
      vatAmount: billLines.vatAmount,
      lineTotal: billLines.lineTotal,
      weighbridgeTicketId: billLines.weighbridgeTicketId,
      capitalizedAssetId: billLines.capitalizedAssetId,
    })
    .from(billLines)
    .leftJoin(products, eq(products.id, billLines.productId))
    .where(eq(billLines.billId, billId))
    .orderBy(billLines.lineNumber);

  return { ...bill, lines };
}

export async function submitBill(tx: Tx, billId: string, submittedById: string) {
  const [updated] = await tx
    .update(bills)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      submittedById,
      updatedAt: new Date(),
    })
    .where(and(eq(bills.id, billId), eq(bills.status, "draft")))
    .returning();

  if (!updated) throw new Error("Bill not found, or not in draft status");
  return updated;
}

export async function rejectBill(
  tx: Tx,
  billId: string,
  rejectedById: string,
  reason: string,
) {
  const [updated] = await tx
    .update(bills)
    .set({
      status: "rejected",
      rejectedAt: new Date(),
      rejectedById,
      rejectionReason: reason || "No reason provided",
      updatedAt: new Date(),
    })
    .where(and(eq(bills.id, billId), eq(bills.status, "submitted")))
    .returning();

  if (!updated) throw new Error("Bill not found, or not in submitted status");
  return updated;
}

export interface ApproveBillAccounts {
  /** Accounts Payable — credited with the net payable. */
  apAccountId: string;
  /** VAT Input — debited when the bill carries VAT. */
  vatInputAccountId?: string | null;
  /** WHT Payable — credited with tax withheld from the supplier. */
  whtPayableAccountId?: string | null;
  /** Inventory — debited when a stocked line admits goods directly. */
  inventoryAccountId?: string | null;
  /** GR/IR clearing — used under three-way match, and by weighbridge lines. */
  grniAccountId?: string | null;
}

/**
 * Approves a bill: posts the purchase entry, and admits stock for any line
 * that actually receives goods.
 *
 * The posting, per line:
 *
 *   stocked line, goods already weighed in   DR GR/IR      (clears the receipt)
 *   stocked line, three-way match on         DR GR/IR      (goods admitted at GRN)
 *   stocked line, direct purchase            DR Inventory  (+ stock movement)
 *   anything else                            DR the line's own account
 *
 * then DR VAT Input, CR WHT Payable, CR Accounts Payable.
 *
 * Two differences from bill.js:764 worth naming:
 *
 * 1. The stock movements are in this transaction. bill.js wraps each one in a
 *    try/catch that logs and continues (bill.js:1092), so a bill could post its
 *    purchase entry while the goods it admitted were never recorded — leaving
 *    inventory and the ledger disagreeing with no trace of why.
 *
 * 2. Nothing checks that the entry balances before posting. That is not an
 *    omission: bill.js:992 does check, with a 0.01 tolerance, and then posts
 *    regardless of what the tolerance let through. Migration 0001's constraint
 *    is exact and cannot be bypassed by this or any other writer.
 */
export async function approveBill(
  tx: Tx,
  billId: string,
  opts: ApproveBillAccounts & {
    approvedById: string;
    /** Three-way match: goods are admitted on GRN acceptance, not here. */
    requireGRN?: boolean;
  },
) {
  const [bill] = await tx
    .select()
    .from(bills)
    .where(and(eq(bills.id, billId), eq(bills.status, "submitted")));

  if (!bill) throw new Error("Bill not found, or not in submitted status");

  const lines = await tx
    .select()
    .from(billLines)
    .where(eq(billLines.billId, billId))
    .orderBy(billLines.lineNumber);

  const requireGRN = opts.requireGRN ?? false;

  // A stocked line that has not already been weighed in is one that strict
  // three-way match would defer — and that needs somewhere to defer it to.
  const hasInventoryLine = lines.some(
    (l) => l.productId && l.accountType === "asset" && !l.weighbridgeTicketId,
  );
  if (requireGRN && hasInventoryLine && !opts.grniAccountId) {
    throw new Error(
      "Three-way match is enabled but no GR/IR clearing account was supplied. " +
        "Configure it before approving inventory bills rather than falling back " +
        "to direct-inventory posting, which would defeat the control.",
    );
  }
  if (!isZero(bill.vatAmount) && !opts.vatInputAccountId) {
    throw new Error("Bill carries VAT but no VAT Input account was supplied");
  }
  if (!isZero(bill.whtAmount) && !opts.whtPayableAccountId) {
    throw new Error("Bill withholds tax but no WHT Payable account was supplied");
  }

  const jeLines: Array<{
    accountId: string;
    debit?: string;
    credit?: string;
    description?: string | null;
  }> = [];
  const toReceive: Array<{
    productId: string;
    quantity: string;
    unitCost: string;
    lineId: string;
    description: string;
  }> = [];

  for (const line of lines) {
    const isInventoryPurchase = Boolean(line.productId) && line.accountType === "asset";

    if (isInventoryPurchase && line.weighbridgeTicketId && opts.grniAccountId) {
      // The weighbridge already posted DR Inventory / CR GR/IR when the goods
      // crossed the scale. This bill clears that liability; the stock is
      // already on hand, so no movement is queued here.
      jeLines.push({
        accountId: opts.grniAccountId,
        debit: line.amount!,
        description: `GR/IR clearing — ${line.description}`,
      });
    } else if (isInventoryPurchase && requireGRN && opts.grniAccountId) {
      // Strict three-way match: the goods are admitted when the GRN is
      // accepted, and the Inventory debit goes with them.
      jeLines.push({
        accountId: opts.grniAccountId,
        debit: line.amount!,
        description: `GR/IR clearing — ${line.description} (pending GRN)`,
      });
    } else if (isInventoryPurchase && opts.inventoryAccountId) {
      jeLines.push({
        accountId: opts.inventoryAccountId,
        debit: line.amount!,
        description: `Purchase: ${line.description} (${line.quantity} ${line.unit})`,
      });
      toReceive.push({
        productId: line.productId!,
        quantity: line.quantity,
        unitCost: line.unitPrice,
        lineId: line.id,
        description: line.description,
      });
    } else {
      jeLines.push({
        accountId: line.accountId,
        debit: line.amount!,
        description: line.description,
      });
    }
  }

  if (!isZero(bill.vatAmount)) {
    jeLines.push({
      accountId: opts.vatInputAccountId!,
      debit: bill.vatAmount,
      description: `VAT Input — ${bill.supplierNameAtBill}`,
    });
  }

  if (!isZero(bill.whtAmount)) {
    jeLines.push({
      accountId: opts.whtPayableAccountId!,
      credit: bill.whtAmount,
      description: `WHT ${bill.whtRate}% — ${bill.supplierNameAtBill}`,
    });
  }

  jeLines.push({
    accountId: opts.apAccountId,
    credit: bill.netPayable!,
    description: `Payable to ${bill.supplierNameAtBill}`,
  });

  const entry = await createJournalEntry(tx, {
    companyId: bill.companyId,
    entryDate: bill.billDate,
    entryType: "purchase",
    description: `Bill ${bill.billNumber} — ${bill.supplierNameAtBill}`,
    reference: bill.billNumber,
    partyType: "supplier",
    partyId: bill.supplierId,
    dueDate: bill.dueDate,
    sourceType: "bill",
    sourceId: bill.id,
    createdById: opts.approvedById,
    postImmediately: true,
    lines: jeLines,
  });

  // Admit the goods, in this transaction, linked to the entry that paid for
  // them. Nothing here is best-effort.
  for (const receipt of toReceive) {
    // recordMovement reads the product's current level as `previous_stock` and
    // derives `new_stock` from it, so it goes BEFORE the level changes.
    await recordMovement(tx, {
      companyId: bill.companyId,
      productId: receipt.productId,
      movementType: "purchase",
      direction: "in",
      quantity: receipt.quantity,
      unitCost: receipt.unitCost,
      sourceReference: bill.billNumber,
      performedById: opts.approvedById,
    });
    await receiveStock(
      tx,
      receipt.productId,
      receipt.quantity,
      receipt.unitCost,
      bill.billDate,
    );
  }

  const [updated] = await tx
    .update(bills)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedById: opts.approvedById,
      journalEntryId: entry.id,
      // What the bill itself moved, so cancellation knows what to give back.
      inventoryMoved: !requireGRN || !hasInventoryLine,
      usedGrni: requireGRN && hasInventoryLine,
      updatedAt: new Date(),
    })
    .where(eq(bills.id, billId))
    .returning();

  // VAT Input and WHT records, raised after the header update so they carry the
  // journal entry id.
  //
  // bill.js:1106-1114 wraps this in a try/catch that logs and continues —
  // "tax transactions can be created manually" — so an approved bill could
  // leave no record of the VAT it claimed or the tax it withheld, with nothing
  // but a console line to say so. A statutory record is not best-effort: it
  // fails the approval or it exists.
  const taxes = await recordBillTaxes(tx, {
    companyId: bill.companyId,
    billId: bill.id,
    vatInputAccountId: opts.vatInputAccountId,
    whtPayableAccountId: opts.whtPayableAccountId,
    createdById: opts.approvedById,
  });

  return { bill: updated, entry, taxes };
}

/**
 * Cancels a bill, undoing everything its approval did.
 *
 * Reverses the purchase entry and takes back any stock the bill admitted —
 * both in the caller's transaction. A bill that deferred its goods to a GRN
 * (`inventory_moved = false`) admitted nothing, so there is nothing to return.
 *
 * A bill with payments against it cannot be cancelled: the payment is a real
 * event, and unwinding it is a separate decision.
 */
export async function cancelBill(
  tx: Tx,
  billId: string,
  cancelledById: string,
  reason: string,
) {
  const [bill] = await tx.select().from(bills).where(eq(bills.id, billId));
  if (!bill) throw new Error("Bill not found");
  if (bill.status === "cancelled") throw new Error("Bill is already cancelled");
  if (!isZero(bill.amountPaid)) {
    throw new Error(
      `Cannot cancel bill ${bill.billNumber}: ${bill.amountPaid} has been paid against it`,
    );
  }

  if (bill.journalEntryId) {
    await reverseJournalEntry(
      tx,
      bill.journalEntryId,
      cancelledById,
      `Bill ${bill.billNumber} cancelled: ${reason || "No reason provided"}`,
    );
  }

  if (bill.inventoryMoved) {
    const received = await tx
      .select()
      .from(billLines)
      .where(eq(billLines.billId, billId));

    for (const line of received) {
      if (!line.productId || line.accountType !== "asset") continue;
      if (line.weighbridgeTicketId) continue; // admitted at the gate, not here

      // Recorded before the level moves, so previous/new describe the real
      // transition. This is also what refuses the cancellation when the goods
      // have already been consumed: the movement's own CHECK rejects a
      // negative resulting level, which is a real conflict for the user to
      // resolve rather than something to paper over by letting stock go
      // negative.
      await recordMovement(tx, {
        companyId: bill.companyId,
        productId: line.productId,
        movementType: "adjustment",
        direction: "out",
        quantity: line.quantity,
        unitCost: line.unitPrice,
        sourceReference: bill.billNumber,
        performedById: cancelledById,
      });

      await tx
        .update(products)
        .set({
          quantityOnHand: sql`${products.quantityOnHand} - ${line.quantity}::numeric(19,4)`,
          updatedAt: new Date(),
        })
        .where(eq(products.id, line.productId));
    }
  }

  const [updated] = await tx
    .update(bills)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledById,
      cancellationReason: reason || "No reason provided",
      updatedAt: new Date(),
    })
    .where(eq(bills.id, billId))
    .returning();

  return updated;
}

export async function listBills(
  tx: Tx,
  opts: {
    limit?: number;
    offset?: number;
    status?: "draft" | "submitted" | "approved" | "rejected" | "cancelled";
    supplierId?: string;
  } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);

  const filters = [
    opts.status ? eq(bills.status, opts.status) : undefined,
    opts.supplierId ? eq(bills.supplierId, opts.supplierId) : undefined,
  ].filter(Boolean);

  return tx
    .select({
      id: bills.id,
      billNumber: bills.billNumber,
      supplierInvoiceNumber: bills.supplierInvoiceNumber,
      billDate: bills.billDate,
      dueDate: bills.dueDate,
      // The snapshot — what the bill said the supplier was called.
      supplierName: bills.supplierNameAtBill,
      total: bills.total,
      netPayable: bills.netPayable,
      amountPaid: bills.amountPaid,
      balance: bills.balance,
      status: bills.status,
      paymentStatus: bills.paymentStatus,
    })
    .from(bills)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(bills.billDate), desc(bills.billNumber))
    .limit(limit)
    .offset(opts.offset ?? 0);
}

/**
 * AP aging from the subledger.
 *
 * reports.ts ages AP off the general ledger's control account; this ages it off
 * the bills themselves. The two should agree, and §6.3 makes reconciling them a
 * precondition of cutover.
 */
export async function getBillAging(tx: Tx, limit = 200) {
  return tx.execute(sql`
    SELECT bill_id, bill_number, supplier_name_at_bill, bill_date, due_date,
           net_payable, amount_paid, balance, days_overdue, aging_bucket
      FROM bill_aging
     ORDER BY days_overdue DESC, due_date
     LIMIT ${Math.min(limit, 500)}
  `);
}
