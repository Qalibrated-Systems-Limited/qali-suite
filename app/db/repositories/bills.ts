import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { bills, billLines, parties, accounts, products } from "../schema";
import { createJournalEntry, reverseJournalEntry } from "./journal";
import { receiveStock } from "./products";
import { recordMovement } from "./stockMovements";
import { recordBillTaxes } from "./taxTransactions";
import { isUuid, likeContains, likePrefix } from "./sqlHelpers";

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
  /** 0029: who raised it, as they were named then. No users table to join to. */
  createdByName?: string | null;
  createdByRole?: string | null;
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
    sql`SELECT next_entry_number(
      ${input.companyId}::uuid,
      document_prefix(${input.companyId}::uuid, 'bill')
    ) AS bill_number`,
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
      createdByName: input.createdByName ?? null,
      createdByRole: input.createdByRole ?? null,
    })
    .returning();

  await insertBillLines(tx, input.companyId, bill.id, input.lines);

  const [withTotals] = await tx.select().from(bills).where(eq(bills.id, bill.id));
  return withTotals;
}

/**
 * Resolves each line's account snapshot and writes the lines.
 *
 * Shared by create and update so the two cannot drift on what a bill line is
 * allowed to charge, or on which account details get frozen onto it.
 */
async function insertBillLines(
  tx: Tx,
  companyId: string,
  billId: string,
  lines: BillLineInput[],
) {
  let n = 0;
  for (const line of lines) {
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
      companyId,
      billId,
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
}

/**
 * Edits a draft or rejected bill.
 *
 * Editable exactly while nobody downstream has acted on it. A rejected bill
 * returns to draft, and its rejection is cleared: it is being re-submitted,
 * and leaving "rejected by Ada on the 3rd" attached to a bill that is now a
 * draft again describes a state the bill is no longer in.
 *
 * THE SUPPLIER CANNOT CHANGE. Migration 0016 makes supplier_id and its
 * snapshots immutable, on the reasoning that they record what the bill said
 * when it was raised. The reference lets a draft be re-pointed at a different
 * supplier; here that is refused in terms rather than left to surface as a
 * trigger exception, and a bill raised against the wrong supplier is deleted
 * and re-entered — which is a two-click operation on a draft.
 *
 * Lines are deleted and re-inserted rather than updated, which is also what
 * makes the line-level snapshot trigger a non-issue: new rows, no UPDATE.
 * Totals are the trigger's output, so nothing here computes one.
 */
export async function updateBill(
  tx: Tx,
  billId: string,
  input: Omit<CreateBillInput, "companyId" | "createdById" | "createdByName" | "createdByRole">,
) {
  const [bill] = await tx.select().from(bills).where(eq(bills.id, billId));
  if (!bill) throw new Error("Bill not found");
  if (bill.status !== "draft" && bill.status !== "rejected") {
    throw new Error(`Cannot edit a bill in ${bill.status} status`);
  }
  if (input.lines.length === 0) {
    throw new Error("A bill must have at least one line");
  }
  if (input.supplierId && input.supplierId !== bill.supplierId) {
    throw new Error(
      `The supplier on bill ${bill.billNumber} cannot be changed: it records who the bill was raised against. Delete this draft and enter a new one.`,
    );
  }

  await tx.delete(billLines).where(eq(billLines.billId, billId));
  await insertBillLines(tx, bill.companyId, billId, input.lines);

  const [updated] = await tx
    .update(bills)
    .set({
      supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
      billDate: input.billDate,
      dueDate: input.dueDate,
      whtApplicable: input.whtApplicable ?? false,
      whtRate: input.whtRate ?? "0",
      title: input.title ?? null,
      reference: input.reference ?? null,
      description: input.description ?? null,
      internalNotes: input.internalNotes ?? null,
      projectId: input.projectId ?? null,
      projectNumberAtBill: input.projectNumber ?? null,
      projectNameAtBill: input.projectName ?? null,
      costCodeId: input.costCodeId ?? null,
      costCodeAtBill: input.costCode ?? null,
      costCodeNameAtBill: input.costCodeName ?? null,
      status: "draft",
      rejectedAt: null,
      rejectedById: null,
      rejectedByName: null,
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(bills.id, billId))
    .returning();

  return updated;
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
    apAccountId: string;
    openingEquityAccountId: string;
    createdById?: string | null;
  },
) {
  const [supplier] = await tx
    .select({ name: parties.name, taxPin: parties.taxPin })
    .from(parties)
    .where(eq(parties.id, input.supplierId));
  if (!supplier) throw new Error("Supplier not found");

  const [{ bill_number }] = (await tx.execute(
    sql`SELECT next_entry_number(
      ${input.companyId}::uuid,
      document_prefix(${input.companyId}::uuid, 'bill') || '-OB'
    ) AS bill_number`,
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
      status: "approved",
      createdById: input.createdById ?? null,
    })
    .returning();

  /**
   * Dr Opening Balance Equity / Cr Accounts Payable.
   *
   * NEW (0061). This function created the row and returned it, and nothing
   * anywhere posted the entry — so an opening payable made through it seeded
   * no ledger at all and never appeared on a trial balance. It had no callers,
   * which is the only reason that never surfaced.
   */
  const entry = await createJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: input.billDate,
    entryType: "opening_balance",
    description: `Opening balance — ${supplier.name}`,
    reference: bill_number,
    partyType: "supplier",
    partyId: input.supplierId,
    sourceType: "bill",
    sourceId: bill.id,
    lines: [
      {
        accountId: input.openingEquityAccountId,
        debit: input.amount,
        description: "Opening balance — to be reclassified to equity",
      },
      {
        accountId: input.apAccountId,
        credit: input.amount,
        description: `Opening payable — ${supplier.name}`,
      },
    ],
    createdById: input.createdById ?? null,
    postImmediately: true,
  });

  return { bill, entry };
}

export async function getBill(tx: Tx, billId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(billId)) return null;
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

/**
 * `submittedByName`, and its siblings on the other transitions, are the 0029
 * snapshots: there is no users table in Postgres to join an id to, so the name
 * is recorded as it was at the moment the person acted.
 */
export async function submitBill(
  tx: Tx,
  billId: string,
  submittedById: string,
  submittedByName?: string | null,
) {
  const [updated] = await tx
    .update(bills)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      submittedById,
      submittedByName: submittedByName ?? null,
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
  rejectedByName?: string | null,
) {
  const [updated] = await tx
    .update(bills)
    .set({
      status: "rejected",
      rejectedAt: new Date(),
      rejectedById,
      rejectedByName: rejectedByName ?? null,
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
    approvedByName?: string | null;
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
    // The project dimension — 0080. A bill carries both, and the cost code is
    // the one a budget is actually checked against.
    projectId: bill.projectId ?? null,
    costCodeId: bill.costCodeId ?? null,
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
      approvedByName: opts.approvedByName ?? null,
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
  cancelledByName?: string | null,
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
      cancelledByName: cancelledByName ?? null,
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

/**
 * The bills list page, in one round trip.
 *
 * Predicates are COMPOSED rather than made conditional inside the SQL. The
 * obvious shape — `WHERE ($1 = '' OR b.status::text = $1)` — is wrong twice
 * over: one cached plan then has to serve every combination of filters, so no
 * index can be used for a predicate that might not apply, and casting the
 * COLUMN converts every row before comparing. Casting the PARAMETER instead
 * lets `bills_company_date_status_idx` serve both the ordering and a status
 * filter. Same reasoning as searchInvoices, and the same measured difference.
 *
 * Ordered by bill_date, not created_at as the Mongo query is. The column the
 * page shows as "Date" is the bill date, and ordering by insertion order puts
 * a backdated bill at the top of a list sorted, visibly, by something else.
 *
 * `count(*) OVER()` returns the page and its total together; the Mongo path
 * issues a separate countDocuments over the same filters.
 *
 * Search is prefix-anchored on bill_number and supplier_invoice_number so the
 * (company_id, bill_number) index serves it. Supplier name matches anywhere,
 * which is a scan of parties — if that becomes hot the fix is a trigram index
 * on parties.name, not a rewrite of this query.
 */
export async function searchBills(
  tx: Tx,
  opts: {
    query?: string;
    page?: number;
    perPage?: number;
    status?: string;
    paymentStatus?: string;
    supplierId?: string;
  } = {},
) {
  const perPage = Math.min(opts.perPage ?? 10, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const offset = (page - 1) * perPage;
  const q = (opts.query ?? "").trim();

  const where = [];
  if (q) {
    where.push(
      sql`(b.bill_number ILIKE ${likePrefix(q)}
           OR b.supplier_invoice_number ILIKE ${likePrefix(q)}
           OR p.name ILIKE ${likeContains(q)})`,
    );
  }
  if (opts.status) where.push(sql`b.status = ${opts.status}::bill_status`);
  if (opts.paymentStatus) {
    where.push(sql`b.payment_status = ${opts.paymentStatus}::payment_status`);
  }
  if (opts.supplierId) where.push(sql`b.supplier_id = ${opts.supplierId}::uuid`);

  const clause = where.length
    ? sql`WHERE ${sql.join(where, sql` AND `)}`
    : sql``;

  const rows = (await tx.execute(sql`
    SELECT b.id,
           b.bill_number,
           b.supplier_invoice_number,
           b.bill_date::text    AS bill_date,
           b.due_date::text     AS due_date,
           b.total::text        AS total,
           b.net_payable::text  AS net_payable,
           b.amount_paid::text  AS amount_paid,
           b.balance::text      AS balance,
           b.status::text         AS status,
           b.payment_status::text AS payment_status,
           b.supplier_name_at_bill,
           count(*) OVER() AS total_count
      FROM bills b
      JOIN parties p ON p.id = b.supplier_id
      ${clause}
     ORDER BY b.bill_date DESC, b.bill_number DESC
     LIMIT ${perPage} OFFSET ${offset}
  `)) as unknown as Array<Record<string, string>>;

  const total = rows.length ? Number(rows[0].total_count) : 0;

  return {
    // Shaped for the existing table markup — `amounts.total`, `supplier.name`
    // and `_id` — so changing the data source does not rewrite the UI. The
    // supplier name is the SNAPSHOT taken at the bill, not the party's current
    // name: a rename must not relabel what was already billed (§9.4).
    bills: rows.map((r) => ({
      _id: r.id,
      id: r.id,
      billNumber: r.bill_number,
      supplierInvoiceNumber: r.supplier_invoice_number,
      billDate: r.bill_date,
      dueDate: r.due_date,
      status: r.status,
      paymentStatus: r.payment_status,
      supplier: { name: r.supplier_name_at_bill },
      amounts: {
        total: r.total,
        netPayable: r.net_payable,
        amountPaid: r.amount_paid,
        balance: r.balance,
      },
    })),
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    page,
  };
}

/**
 * The four figures the list page's cards read, in one pass.
 *
 * Mongo runs a five-branch $facet for this. Every branch is a filtered
 * aggregate over the same rows, which is what FILTER expresses directly.
 *
 * `overdue` is DERIVED from due_date, not read from a stored status — §9B.2
 * records why an `overdue` payment status was not carried across: a stored
 * copy of a function of today's date is wrong for some rows at any moment.
 *
 * It compares against CURRENT_DATE, not now(). The Mongo facet tests
 * `dueDate: { $lt: new Date() }` against a field holding a date at midnight,
 * so a bill due TODAY reads as overdue for all but the first instant of the
 * day. Overdue means the day has passed, not the hour.
 *
 * The unpaid/partial figures sum `balance`, which is a GENERATED column
 * (net_payable - amount_paid) rather than a maintained one, so they cannot
 * report a balance the bill's own numbers do not support.
 */
export async function getBillStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT count(*) FILTER (WHERE status = 'submitted')::int       AS pending_count,
           COALESCE(SUM(total) FILTER (WHERE status = 'submitted'), 0)::text
                                                                   AS pending_total,

           count(*) FILTER (
             WHERE status = 'approved' AND payment_status = 'unpaid'
           )::int                                                  AS unpaid_count,
           COALESCE(SUM(balance) FILTER (
             WHERE status = 'approved' AND payment_status = 'unpaid'
           ), 0)::text                                             AS unpaid_balance,

           count(*) FILTER (
             WHERE status = 'approved' AND payment_status = 'partial'
           )::int                                                  AS partial_count,
           COALESCE(SUM(balance) FILTER (
             WHERE status = 'approved' AND payment_status = 'partial'
           ), 0)::text                                             AS partial_balance,

           count(*) FILTER (
             WHERE status = 'approved' AND payment_status IN ('unpaid', 'partial')
           )::int                                                  AS outstanding_count,
           COALESCE(SUM(balance) FILTER (
             WHERE status = 'approved' AND payment_status IN ('unpaid', 'partial')
           ), 0)::text                                             AS outstanding_balance,

           count(*) FILTER (
             WHERE status = 'approved' AND payment_status IN ('unpaid', 'partial')
               AND due_date IS NOT NULL AND due_date < CURRENT_DATE
           )::int                                                  AS overdue_count,
           COALESCE(SUM(balance) FILTER (
             WHERE status = 'approved' AND payment_status IN ('unpaid', 'partial')
               AND due_date IS NOT NULL AND due_date < CURRENT_DATE
           ), 0)::text                                             AS overdue_total,

           count(*) FILTER (WHERE bill_date >= date_trunc('month', CURRENT_DATE))::int
                                                                   AS month_count,
           COALESCE(SUM(total) FILTER (
             WHERE bill_date >= date_trunc('month', CURRENT_DATE)
           ), 0)::text                                             AS month_total
      FROM bills
  `)) as unknown as Array<Record<string, string>>;

  // Named as the existing cards read them, so the component keeps its markup.
  return {
    pendingApproval: {
      count: Number(row.pending_count),
      total: row.pending_total,
    },
    byPaymentStatus: {
      unpaid: { count: Number(row.unpaid_count), balance: row.unpaid_balance },
      partial: { count: Number(row.partial_count), balance: row.partial_balance },
    },
    /**
     * unpaid + partial, summed in SQL.
     *
     * The card wants one figure and the Mongo-era markup produced it by adding
     * the two in JavaScript. That was float arithmetic on money then; with
     * money as strings it would be string CONCATENATION now — "100.0000" +
     * "50.0000" giving "100.000050.0000" on the page. Money is added in
     * numeric(19,4) or not at all.
     */
    outstanding: {
      count: Number(row.outstanding_count),
      balance: row.outstanding_balance,
    },
    overdue: { count: Number(row.overdue_count), total: row.overdue_total },
    thisMonth: { count: Number(row.month_count), total: row.month_total },
  };
}

/**
 * Deletes a draft bill.
 *
 * Only a draft: anything submitted has been seen by an approver, and anything
 * approved has posted. Those are cancelled, which reverses the entry and the
 * stock, rather than erased. bill_lines cascade (0016).
 *
 * The capitalisation guard is carried across from bill-actions.js:1305. Fixed
 * assets are not ported, so capitalized_asset_id can only hold a value that
 * arrived with the backfill — but deleting the bill that a fixed asset was
 * raised from would orphan the asset either way, so the check moves with the
 * behaviour rather than being dropped as unreachable.
 */
export async function deleteDraftBill(tx: Tx, billId: string) {
  const [bill] = await tx.select().from(bills).where(eq(bills.id, billId));
  if (!bill) throw new Error("Bill not found");
  if (bill.status !== "draft") {
    throw new Error(
      `Only draft bills can be deleted. Bill ${bill.billNumber} is ${bill.status} — cancel it instead.`,
    );
  }

  const [capitalised] = await tx
    .select({ id: billLines.id })
    .from(billLines)
    .where(
      and(
        eq(billLines.billId, billId),
        sql`${billLines.capitalizedAssetId} IS NOT NULL`,
      ),
    );
  if (capitalised) {
    throw new Error(
      "Cannot delete: a line on this bill has been capitalised into a fixed asset. Dispose or write off the asset first.",
    );
  }

  await tx.delete(bills).where(eq(bills.id, billId));
  return { billNumber: bill.billNumber };
}

/**
 * A bill as the detail page renders it.
 *
 * Shaped to the page rather than to the schema — `amounts.total`,
 * `supplier.name`, `line.account.code`, `accounting.journalEntryId` — so the
 * markup did not have to change with the data source.
 *
 * Three queries rather than one join: joining lines to a header repeats every
 * header column per line, and the page needs the header, the lines and the
 * payments as separate shapes anyway.
 *
 * THE PAYMENTS COME FROM THE ALLOCATIONS. Mongo keeps an embedded payments[]
 * array on the bill AND a Payment document with allocations, updated by
 * different code paths — the §8.2 defect, closed in 0016. There is one record
 * of the event here and the bill's amount_paid is derived from it, so a
 * payment history and a balance cannot disagree.
 */
export async function getBillDetail(tx: Tx, billId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(billId)) return null;
  const [b] = (await tx.execute(sql`
    SELECT b.id,
           b.bill_number,
           b.supplier_id,
           b.supplier_invoice_number,
           b.bill_date::text AS bill_date,
           b.due_date::text  AS due_date,
           b.status::text         AS status,
           b.payment_status::text AS payment_status,
           b.subtotal::text     AS subtotal,
           b.vat_amount::text   AS vat_amount,
           b.wht_amount::text   AS wht_amount,
           b.total::text        AS total,
           b.net_payable::text  AS net_payable,
           b.amount_paid::text  AS amount_paid,
           b.balance::text      AS balance,
           b.currency,
           b.wht_applicable,
           b.wht_rate::text     AS wht_rate,
           b.title, b.reference, b.description, b.internal_notes,
           b.created_at, b.created_by_name, b.created_by_role,
           b.submitted_at, b.submitted_by_name,
           b.approved_at, b.approved_by_name,
           b.rejected_at, b.rejected_by_name, b.rejection_reason,
           b.cancelled_at, b.cancelled_by_name, b.cancellation_reason,
           b.journal_entry_id, b.inventory_moved, b.used_grni,
           p.name    AS supplier_name,
           p.email   AS supplier_email,
           p.phone   AS supplier_phone,
           p.tax_pin AS supplier_tax_pin,
           concat_ws(', ',
             NULLIF(p.address_line1, ''), NULLIF(p.address_line2, ''),
             NULLIF(p.city, ''), NULLIF(p.country, '')
           ) AS supplier_address
      FROM bills b
      JOIN parties p ON p.id = b.supplier_id
     WHERE b.id = ${billId}
  `)) as unknown as Array<Record<string, string | null>>;

  // Null, not forbidden: RLS filtered another tenant's bill out before the
  // query saw it, so the page 404s. Invisible rather than leaked (§2.2).
  if (!b) return null;

  const lines = (await tx.execute(sql`
    SELECT l.id,
           l.line_number,
           l.description,
           l.quantity::text    AS quantity,
           l.unit,
           l.unit_price::text  AS unit_price,
           l.amount::text      AS amount,
           l.vat_rate::text    AS vat_rate,
           l.vat_amount::text  AS vat_amount,
           l.line_total::text  AS line_total,
           l.account_type::text AS account_type,
           -- The snapshots, not a join: what the line was CHARGED to, which a
           -- later rename of the account must not rewrite.
           l.account_code_at_bill AS account_code,
           l.account_name_at_bill AS account_name,
           l.product_id,
           l.capitalized_asset_id,
           l.weighbridge_ticket_id,
           pr.name AS product_name,
           pr.sku  AS product_sku
      FROM bill_lines l
      LEFT JOIN products pr ON pr.id = l.product_id
     WHERE l.bill_id = ${billId}
     ORDER BY l.line_number
  `)) as unknown as Array<Record<string, string | null>>;

  // Polymorphic by design (0011): an allocation settles an invoice or a bill,
  // so it is matched on document_type AND document_id. Matching document_id
  // alone would be a cross-document read waiting on a uuid collision, and
  // payment_allocations_document_idx is keyed on the pair.
  const payments = (await tx.execute(sql`
    SELECT a.id,
           a.amount_allocated::text AS amount,
           pay.payment_number,
           pay.payment_date::text   AS payment_date,
           pay.payment_method::text AS payment_method,
           pay.reference
      FROM payment_allocations a
      JOIN payments pay ON pay.id = a.payment_id
     WHERE a.document_type = 'bill' AND a.document_id = ${billId}
     ORDER BY pay.payment_date, pay.payment_number
  `)) as unknown as Array<Record<string, string | null>>;

  return {
    _id: b.id,
    id: b.id,
    billNumber: b.bill_number,
    supplierInvoiceNumber: b.supplier_invoice_number,
    billDate: b.bill_date,
    dueDate: b.due_date,
    status: b.status,
    paymentStatus: b.payment_status,
    currency: b.currency,
    title: b.title,
    reference: b.reference,
    description: b.description,
    internalNotes: b.internal_notes,

    /**
     * Named as the detail page reads them, and that naming is the fix for a
     * live bug rather than a convenience.
     *
     * bill-queries.js:88-89 projects `amounts.vatTotal` and
     * `amounts.whtAmount`. The model stores `amounts.vat` and `amounts.wht`
     * (bill.js:298, 312; written as such at bill-actions.js:578, 580), so both
     * projections resolve to undefined, fall through `|| 0`, and the page's
     * `vatTotal > 0` and `whtAmount > 0` guards are never true. The VAT and
     * withholding rows on the totals card have never rendered.
     *
     * `paid` and `balance` are the bill's own columns — balance is GENERATED
     * as net_payable - amount_paid — so the card cannot show a balance the
     * bill's own numbers do not support.
     */
    amounts: {
      subtotal: b.subtotal,
      vatTotal: b.vat_amount,
      whtAmount: b.wht_amount,
      total: b.total,
      netPayable: b.net_payable,
      paid: b.amount_paid,
      balance: b.balance,
    },
    whtApplicable: b.wht_applicable,
    whtRate: b.wht_rate,

    createdAt: b.created_at,
    createdBy: { name: b.created_by_name, role: b.created_by_role },
    submittedAt: b.submitted_at,
    submittedBy: b.submitted_by_name ? { name: b.submitted_by_name } : null,
    approvedAt: b.approved_at,
    approvedBy: b.approved_by_name ? { name: b.approved_by_name } : null,
    rejectedAt: b.rejected_at,
    rejectedBy: b.rejected_by_name ? { name: b.rejected_by_name } : null,
    rejectionReason: b.rejection_reason,
    cancelledAt: b.cancelled_at,
    cancelledBy: b.cancelled_by_name ? { name: b.cancelled_by_name } : null,
    cancellationReason: b.cancellation_reason,

    accounting: {
      journalEntryId: b.journal_entry_id,
      inventoryMoved: b.inventory_moved,
      usedGRNI: b.used_grni,
    },

    /**
     * `canEdit` was a Mongoose virtual. It is a function of the status and
     * nothing else, so it is computed where the status is read rather than
     * left for each caller to restate — the mistake §8.4 records against
     * stored derived values, in its smaller form.
     */
    canEdit: b.status === "draft" || b.status === "rejected",

    supplier: {
      id: b.supplier_id,
      partyId: b.supplier_id,
      name: b.supplier_name,
      email: b.supplier_email,
      phone: b.supplier_phone,
      taxPin: b.supplier_tax_pin,
      address: b.supplier_address || null,
    },

    lines: lines.map((l) => ({
      _id: l.id,
      lineNumber: l.line_number,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unit_price,
      amount: l.amount,
      lineTotal: l.line_total,
      vat: { rate: l.vat_rate, amount: l.vat_amount },
      account: {
        code: l.account_code,
        name: l.account_name,
        type: l.account_type,
      },
      product: l.product_id
        ? { id: l.product_id, name: l.product_name, sku: l.product_sku }
        : null,
      capitalizedAssetId: l.capitalized_asset_id,
      weighbridgeTicketId: l.weighbridge_ticket_id,
    })),

    payments: payments.map((p) => ({
      _id: p.id,
      paymentNumber: p.payment_number,
      date: p.payment_date,
      method: p.payment_method,
      reference: p.reference,
      amount: p.amount,
    })),
  };
}

/**
 * Approved bills whose goods have not been admitted yet.
 *
 * These are the three-way-match bills: the purchase posted to GR/IR clearing
 * (`used_grni`) and inventory has not moved (`inventory_moved = false`), so the
 * receipt is still outstanding. The pair of columns is what approveBill writes
 * to record which route the bill took, and reading them is what keeps "awaiting
 * receipt" a fact about the bill rather than a status somebody has to maintain.
 */
export async function listBillsAwaitingGRN(tx: Tx, limit = 100) {
  const rows = (await tx.execute(sql`
    SELECT b.id, b.bill_number, b.bill_date::text AS bill_date,
           b.supplier_id, b.supplier_name_at_bill, b.total::text AS total
      FROM bills b
     WHERE b.status = 'approved'
       AND b.used_grni = true
       AND b.inventory_moved = false
     ORDER BY b.bill_date DESC, b.bill_number DESC
     LIMIT ${Math.min(limit, 500)}
  `)) as unknown as Array<Record<string, string>>;

  return rows.map((r) => ({
    _id: r.id,
    billNumber: r.bill_number,
    billDate: r.bill_date,
    supplier: { id: r.supplier_id, partyId: r.supplier_id, name: r.supplier_name_at_bill },
    amounts: { total: r.total },
  }));
}
