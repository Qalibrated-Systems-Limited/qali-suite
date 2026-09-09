import { and, desc, eq, sql } from "drizzle-orm";
import { isUuid, likeContains, likePrefix, toDate } from "./sqlHelpers";
import { createJournalEntry } from "./journal";
import type { Tx } from "../client";
import {
  stockRequests,
  stockRequestItems,
  stockRequestFulfilments,
  stockRequestItemInvoices,
  stockRequestApprovals,
  itemCheckouts,
  weighbridgeTickets,
  parties,
  products,
} from "../schema";
import { issueStock } from "./products";
import { recordMovement } from "./stockMovements";

/**
 * Fulfilment — stock requests, item checkouts and weighbridge tickets.
 *
 * §9.6 step 5. What is NOT in this file is the point of it: there is no
 * `recalculateFulfillment()`. The five values that method maintained —
 * `totalFulfilled`, `remainingToFulfil`, `fulfilmentStatus`, the request's
 * `status` and its `totalValue` — are a generated column and four triggers
 * (migration 0022), so no caller can forget to run them.
 *
 * Nor is there an over-fulfilment check. `addFulfillment()` raises when the
 * running total would exceed the approved quantity, which protects callers that
 * use `addFulfillment()`; here it is a deferred constraint trigger.
 */

export type StockRequestType =
  | "sale"
  | "demo"
  | "installation"
  | "internal"
  | "repair"
  | "employee_borrow";

export interface StockRequestItemInput {
  productId: string;
  requestedQuantity: string;
  unitPrice?: string;
  unit?: string;
  purpose?:
    | "sale"
    | "technician_test"
    | "customer_demo"
    | "internal_use"
    | "installation"
    | "repair"
    | "other";
  purposeDetails?: string | null;
  requiresReturn?: boolean;
  expectedReturnDate?: string | null;
  notes?: string | null;
}

export interface CreateStockRequestInput {
  companyId: string;
  requestType: StockRequestType;
  requesterName: string;
  requesterDepartment:
    | "Technical"
    | "Sales"
    | "Service"
    | "Installation"
    | "Admin"
    | "Finance"
    | "Other";
  items: StockRequestItemInput[];
  /** Required unless the request is `internal` or `employee_borrow`. */
  customerId?: string | null;
  requesterId?: string | null;
  requesterEmail?: string | null;
  requesterPhone?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  requiredByDate?: string | null;
  notes?: string | null;
  /**
   * A Mongo ObjectId — projects are not ported. The column has existed since
   * 0020 and `mapRequest` already reads it back out; nothing ever wrote it.
   */
  projectId?: string | null;
  costCodeId?: string | null;
  createdById?: string | null;
}

const INTERNAL_TYPES = new Set(["internal", "employee_borrow"]);

/**
 * Creates a pending stock request.
 *
 * Each item records what the product was called and how much was on hand when
 * the request was raised. The stock level in particular is a snapshot of the
 * decision's basis: "we approved 10 against 12 on hand" stays true even after
 * the shelf empties, and migration 0022 refuses to let it be rewritten.
 */
export async function createStockRequest(
  tx: Tx,
  input: CreateStockRequestInput,
) {
  if (input.items.length === 0) {
    throw new Error("A stock request must have at least one item");
  }

  let customer: { name: string; email: string | null; phone: string | null; taxPin: string | null } | null = null;
  if (input.customerId) {
    const [row] = await tx
      .select({
        name: parties.name,
        email: parties.email,
        phone: parties.phone,
        taxPin: parties.taxPin,
      })
      .from(parties)
      .where(eq(parties.id, input.customerId));
    if (!row) throw new Error("Customer not found");
    customer = row;
  } else if (!INTERNAL_TYPES.has(input.requestType)) {
    // The database enforces this too; failing here gives a better message than
    // a check_violation would.
    throw new Error(
      `A ${input.requestType} request is customer-facing and needs a customer`,
    );
  }

  const [{ request_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'REQ') AS request_number`,
  )) as unknown as Array<{ request_number: string }>;

  const [request] = await tx
    .insert(stockRequests)
    .values({
      companyId: input.companyId,
      requestNumber: request_number,
      requestType: input.requestType,
      priority: input.priority ?? "normal",
      customerId: input.customerId ?? null,
      customerNameAtRequest: customer?.name ?? null,
      customerEmailAtRequest: customer?.email ?? null,
      customerPhoneAtRequest: customer?.phone ?? null,
      customerTaxPinAtRequest: customer?.taxPin ?? null,
      requesterId: input.requesterId ?? null,
      requesterNameAtRequest: input.requesterName,
      requesterDepartment: input.requesterDepartment,
      requesterEmail: input.requesterEmail ?? null,
      requesterPhone: input.requesterPhone ?? null,
      requiredByDate: input.requiredByDate ?? null,
      notes: input.notes ?? null,
      projectId: input.projectId ?? null,
      costCodeId: input.costCodeId ?? null,
      createdById: input.createdById ?? null,
    })
    .returning();

  let n = 0;
  for (const item of input.items) {
    n++;
    const [product] = await tx
      .select({
        name: products.name,
        sku: products.sku,
        onHand: products.quantityOnHand,
        price: products.sellingPrice,
      })
      .from(products)
      .where(eq(products.id, item.productId));
    if (!product) throw new Error(`Product not found: ${item.productId}`);

    await tx.insert(stockRequestItems).values({
      companyId: input.companyId,
      requestId: request.id,
      lineNumber: n,
      productId: item.productId,
      productNameAtRequest: product.name,
      skuAtRequest: product.sku,
      stockAtRequest: product.onHand,
      requestedQuantity: item.requestedQuantity,
      unitPrice: item.unitPrice ?? product.price,
      unit: item.unit ?? "pcs",
      purpose: item.purpose ?? null,
      purposeDetails: item.purposeDetails ?? null,
      requiresReturn: item.requiresReturn ?? false,
      expectedReturnDate: item.expectedReturnDate ?? null,
      notes: item.notes ?? null,
    });
  }

  const [withTotals] = await tx
    .select()
    .from(stockRequests)
    .where(eq(stockRequests.id, request.id));
  return withTotals;
}

export async function getStockRequest(tx: Tx, requestId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(requestId)) return null;
  const [request] = await tx
    .select()
    .from(stockRequests)
    .where(eq(stockRequests.id, requestId));
  if (!request) return null;

  const items = await tx
    .select()
    .from(stockRequestItems)
    .where(eq(stockRequestItems.requestId, requestId))
    .orderBy(stockRequestItems.lineNumber);

  return { ...request, items };
}

/**
 * Approves a request, setting the approved quantity per item.
 *
 * Approving less than was asked for is normal; approving more is refused by a
 * CHECK, since the approval answers the request rather than replacing it.
 */
export async function approveStockRequest(
  tx: Tx,
  requestId: string,
  approvals: Array<{
    itemId: string;
    approvedQuantity: string;
    notes?: string | null;
  }>,
  opts: {
    approvedById: string;
    approverName: string;
    comments?: string | null;
    /**
     * Conditions attached to the approval. `approval_conditions` has existed
     * since 0020 and `mapRequest` reads it back out to display; nothing ever
     * wrote it, so it rendered NULL from the day it shipped.
     */
    conditions?: string | null;
  },
) {
  const [request] = await tx
    .select()
    .from(stockRequests)
    .where(
      and(eq(stockRequests.id, requestId), eq(stockRequests.status, "pending")),
    );
  if (!request) throw new Error("Request not found, or not pending");

  for (const a of approvals) {
    await tx
      .update(stockRequestItems)
      .set({
        approvedQuantity: a.approvedQuantity,
        // The approve dialog posts `notes_<itemId>` per line and nothing read
        // them. Only overwrite when the approver actually typed something —
        // an approval should not blank the requester's own note.
        ...(a.notes != null ? { notes: a.notes } : {}),
      })
      .where(eq(stockRequestItems.id, a.itemId));
  }

  const [updated] = await tx
    .update(stockRequests)
    .set({
      status: "approved",
      approvedById: opts.approvedById,
      approvedByNameAtApproval: opts.approverName,
      approvedAt: new Date(),
      approvalComments: opts.comments ?? null,
      approvalConditions: opts.conditions ?? null,
      updatedAt: new Date(),
    })
    .where(eq(stockRequests.id, requestId))
    .returning();

  await tx.insert(stockRequestApprovals).values({
    companyId: request.companyId,
    requestId,
    approverId: opts.approvedById,
    approverNameAtAction: opts.approverName,
    action: "approved",
    comments: opts.comments ?? null,
  });

  return updated;
}

export async function rejectStockRequest(
  tx: Tx,
  requestId: string,
  opts: { rejectedById: string; approverName: string; reason: string },
) {
  const [request] = await tx
    .select()
    .from(stockRequests)
    .where(
      and(eq(stockRequests.id, requestId), eq(stockRequests.status, "pending")),
    );
  if (!request) throw new Error("Request not found, or not pending");

  const [updated] = await tx
    .update(stockRequests)
    .set({
      status: "rejected",
      rejectedById: opts.rejectedById,
      rejectedAt: new Date(),
      rejectionReason: opts.reason || "No reason provided",
      updatedAt: new Date(),
    })
    .where(eq(stockRequests.id, requestId))
    .returning();

  await tx.insert(stockRequestApprovals).values({
    companyId: request.companyId,
    requestId,
    approverId: opts.rejectedById,
    approverNameAtAction: opts.approverName,
    action: "rejected",
    comments: opts.reason,
  });

  return updated;
}

/**
 * Records an issue against a request item.
 *
 * Nothing here totals anything or promotes any status — the triggers do, from
 * the row this inserts. Over-fulfilment fails at COMMIT.
 */
export async function recordFulfilment(
  tx: Tx,
  input: {
    companyId: string;
    itemId: string;
    quantity: string;
    fulfilledById?: string | null;
    fulfilledByName?: string | null;
    serialNumbers?: string[];
    movementId?: string | null;
    checkoutId?: string | null;
    notes?: string | null;
  },
) {
  const [fulfilment] = await tx
    .insert(stockRequestFulfilments)
    .values({
      companyId: input.companyId,
      itemId: input.itemId,
      quantity: input.quantity,
      serialNumbers: input.serialNumbers ?? null,
      fulfilledById: input.fulfilledById ?? null,
      fulfilledByNameAtFulfilment: input.fulfilledByName ?? null,
      movementId: input.movementId ?? null,
      checkoutId: input.checkoutId ?? null,
      notes: input.notes ?? null,
    })
    .returning();

  return fulfilment;
}

/** Records that part of a request item has been invoiced. */
export async function recordItemInvoiced(
  tx: Tx,
  input: {
    companyId: string;
    itemId: string;
    invoiceId: string;
    invoiceNumber: string;
    quantity: string;
  },
) {
  const [row] = await tx
    .insert(stockRequestItemInvoices)
    .values({
      companyId: input.companyId,
      itemId: input.itemId,
      invoiceId: input.invoiceId,
      invoiceNumberAtInvoicing: input.invoiceNumber,
      quantity: input.quantity,
    })
    .returning();
  return row;
}

export async function listStockRequests(
  tx: Tx,
  opts: {
    status?:
      | "pending"
      | "approved"
      | "partially_fulfilled"
      | "fulfilled"
      | "invoiced"
      | "rejected"
      | "cancelled";
    requestType?: StockRequestType;
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const filters = [
    opts.status ? eq(stockRequests.status, opts.status) : undefined,
    opts.requestType
      ? eq(stockRequests.requestType, opts.requestType)
      : undefined,
  ].filter(Boolean);

  return tx
    .select({
      id: stockRequests.id,
      requestNumber: stockRequests.requestNumber,
      requestType: stockRequests.requestType,
      status: stockRequests.status,
      priority: stockRequests.priority,
      customerName: stockRequests.customerNameAtRequest,
      requesterName: stockRequests.requesterNameAtRequest,
      totalValue: stockRequests.totalValue,
      requiredByDate: stockRequests.requiredByDate,
      requestedAt: stockRequests.requestedAt,
    })
    .from(stockRequests)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(stockRequests.requestedAt))
    .limit(limit)
    .offset(opts.offset ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Item checkouts
// ─────────────────────────────────────────────────────────────────────────────

export async function createCheckout(
  tx: Tx,
  input: {
    companyId: string;
    productId: string;
    quantity: string;
    checkedOutToName: string;
    checkedOutByName: string;
    purpose: string;
    expectedReturnDate: string;
    checkedOutToId?: string | null;
    checkedOutById?: string | null;
    requestId?: string | null;
    requestNumber?: string | null;
    requestType?: StockRequestType | null;
    serialNo?: string | null;
    notes?: string | null;
  },
) {
  const [product] = await tx
    .select({ name: products.name, sku: products.sku, category: products.category })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!product) throw new Error("Product not found");

  const [{ checkout_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'CHK') AS checkout_number`,
  )) as unknown as Array<{ checkout_number: string }>;

  const [checkout] = await tx
    .insert(itemCheckouts)
    .values({
      companyId: input.companyId,
      checkoutNumber: checkout_number,
      productId: input.productId,
      productNameAtCheckout: product.name,
      skuAtCheckout: product.sku,
      categoryAtCheckout: product.category,
      quantity: input.quantity,
      serialNo: input.serialNo ?? null,
      checkedOutToId: input.checkedOutToId ?? null,
      checkedOutToNameAtCheckout: input.checkedOutToName,
      checkedOutById: input.checkedOutById ?? null,
      checkedOutByNameAtCheckout: input.checkedOutByName,
      purpose: input.purpose,
      expectedReturnDate: input.expectedReturnDate,
      requestId: input.requestId ?? null,
      requestNumberAtCheckout: input.requestNumber ?? null,
      requestType: input.requestType ?? null,
      checkoutNotes: input.notes ?? null,
    })
    .returning();

  return checkout;
}

/**
 * Records a return against a checkout.
 *
 * `quantity_sold + quantity_returned + quantity_expensed <= quantity` is a
 * CHECK, so a checkout cannot dispose of more than went out however the three
 * are combined — the partial-conversion case Mongo tracks in three independent
 * counters with nothing reconciling them.
 */
export async function returnCheckout(
  tx: Tx,
  checkoutId: string,
  input: {
    quantity: string;
    condition?:
      | "excellent"
      | "good"
      | "fair"
      | "poor"
      | "damaged"
      | "lost";
    returnedById?: string | null;
    returnedByName?: string | null;
    returnMovementId?: string | null;
    notes?: string | null;
    returnDate?: string;
    /**
     * The value coming back, and the two accounts it moves between. All three
     * required to post; omit them and the return records no entry.
     *
     * The cost is passed IN rather than read here: `item_checkouts` carries no
     * unit cost, and the Mongo path takes it from the stock movement. The
     * repository must not decide what stock is worth.
     */
    totalCost?: string | null;
    inventoryAccountId?: string | null;
    technicianStockAccountId?: string | null;
  },
) {
  const [updated] = await tx
    .update(itemCheckouts)
    .set({
      quantityReturned: sql`${itemCheckouts.quantityReturned} + ${input.quantity}::numeric(19,4)`,
      actualReturnDate: input.returnDate ?? sql`CURRENT_DATE`,
      returnedById: input.returnedById ?? null,
      returnedByNameAtReturn: input.returnedByName ?? null,
      returnCondition: input.condition ?? null,
      returnNotes: input.notes ?? null,
      returnMovementId: input.returnMovementId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(itemCheckouts.id, checkoutId))
    .returning();

  if (!updated) throw new Error("Checkout not found");

  // Fully accounted for — nothing is still out.
  const [{ settled }] = (await tx.execute(sql`
    SELECT (quantity_sold + quantity_returned + quantity_expensed = quantity) AS settled
      FROM item_checkouts WHERE id = ${checkoutId}
  `)) as unknown as Array<{ settled: boolean }>;

  /**
   * DR Inventory / CR Technician Stock — the value coming back off the person
   * who had it.
   *
   * NEW. This function moved the quantities and closed the row and posted
   * NOTHING, so returned stock came back into the warehouse while its value
   * stayed sitting on the technician-stock account for ever. The Mongo path
   * posts it (checkout-action.js:587); the Postgres half never did, and nobody
   * noticed because nothing called this function.
   *
   * Skipped when the accounts are not configured, or when the checkout carries
   * no unit cost — a return worth nothing needs no entry, and refusing the
   * return over a missing account would strand the stock.
   */
  let entry = null;
  if (
    Number(input.totalCost ?? 0) > 0 &&
    input.inventoryAccountId &&
    input.technicianStockAccountId
  ) {
    const value = Number(input.totalCost).toFixed(4);
    entry = await createJournalEntry(tx, {
      companyId: updated.companyId,
      entryDate: input.returnDate ?? new Date().toISOString().slice(0, 10),
      entryType: "inventory_adjustment",
      description: `Return to stock — ${updated.checkoutNumber}`,
      reference: updated.checkoutNumber,
      // Both or neither — `journal_entries_source_pair`. A return recorded
      // without a stock movement has nothing to point at, and naming the type
      // with a null id fails the check. The same pair trap as party_type /
      // party_id on the expense postings.
      sourceType: input.returnMovementId ? "stock_movement" : null,
      sourceId: input.returnMovementId ?? null,
      lines: [
        {
          accountId: input.inventoryAccountId,
          debit: value,
          description: `Returned — ${updated.productNameAtCheckout ?? "item"}`,
        },
        {
          accountId: input.technicianStockAccountId,
          credit: value,
          description: `From technician — ${updated.checkedOutToNameAtCheckout}`,
        },
      ],
      createdById: input.returnedById ?? null,
      postImmediately: true,
    });
  }

  if (settled) {
    const [closed] = await tx
      .update(itemCheckouts)
      .set({ status: "returned", updatedAt: new Date() })
      .where(eq(itemCheckouts.id, checkoutId))
      .returning();
    return { checkout: closed, entry };
  }

  return { checkout: updated, entry };
}

/**
 * Flags a checkout for return because the sale that justified issuing the stock
 * did not complete.
 */
export async function requireReturn(
  tx: Tx,
  checkoutId: string,
  input: {
    reason: "invoice_expired" | "invoice_cancelled" | "sale_failed" | "other";
    requiredById?: string | null;
    failedInvoiceId?: string | null;
    failedInvoiceNumber?: string | null;
    returnDeadline?: string | null;
  },
) {
  const [updated] = await tx
    .update(itemCheckouts)
    .set({
      returnRequired: true,
      returnRequiredReason: input.reason,
      returnRequiredAt: new Date(),
      returnRequiredById: input.requiredById ?? null,
      failedInvoiceId: input.failedInvoiceId ?? null,
      failedInvoiceNumber: input.failedInvoiceNumber ?? null,
      returnDeadline: input.returnDeadline ?? null,
      updatedAt: new Date(),
    })
    .where(eq(itemCheckouts.id, checkoutId))
    .returning();

  if (!updated) throw new Error("Checkout not found");
  return updated;
}

/** What is still out, and how overdue. */
export async function getOutstandingCheckouts(
  tx: Tx,
  limit = 100,
  productId?: string,
) {
  return tx.execute(sql`
    SELECT checkout_id, checkout_number, product_name_at_checkout,
           checked_out_to_name_at_checkout, quantity, quantity_outstanding,
           expected_return_date, days_overdue, return_required, return_deadline, status
      FROM outstanding_checkouts
     WHERE ${productId ? sql`product_id = ${productId}::uuid` : sql`TRUE`}
     ORDER BY days_overdue DESC, expected_return_date
     LIMIT ${Math.min(limit, 500)}
  `);
}

/**
 * Requests still waiting on ONE product — what the product page shows under
 * "pending requests", and the reason a quantity is spoken for.
 *
 * Joined through the items, because a request names several products and only
 * the line for this one is relevant to its page.
 */
export async function listPendingRequestsForProduct(
  tx: Tx,
  productId: string,
  limit = 20,
) {
  return tx.execute(sql`
    SELECT r.id, r.request_number, r.status, r.priority,
           r.required_by_date, r.requested_by_name,
           i.quantity_requested, i.quantity_fulfilled
      FROM stock_request_items i
      JOIN stock_requests r ON r.id = i.request_id
     WHERE i.product_id = ${productId}::uuid
       AND r.status IN ('pending', 'approved', 'partially_fulfilled')
     ORDER BY r.required_by_date NULLS LAST, r.created_at DESC
     LIMIT ${Math.min(limit, 100)}
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Weighbridge tickets
// ─────────────────────────────────────────────────────────────────────────────

export type WbTransactionType =
  | "purchase"
  | "sale"
  | "sale_standalone"
  | "transfer_out"
  | "transfer_in"
  | "return_to_supplier"
  | "customer_return";

const INBOUND_TYPES = new Set(["purchase", "transfer_in", "customer_return"]);

/**
 * Opens a ticket, before either weighing.
 *
 * `direction` is derived from `transaction_type` rather than accepted from the
 * caller. The model requires both and constrains neither against the other, so
 * a purchase could be recorded as outbound — and direction is what the stock
 * side reads. A CHECK enforces the pairing; this makes it impossible to get
 * wrong in the first place.
 */
export async function openWeighbridgeTicket(
  tx: Tx,
  input: {
    companyId: string;
    transactionType: WbTransactionType;
    externalRef?: string | null;
    productId?: string | null;
    partyId?: string | null;
    partyName?: string | null;
    vehicleReg?: string | null;
    driverName?: string | null;
    invoiceId?: string | null;
    invoiceRef?: string | null;
    transferRef?: string | null;
    ticketDate?: string | null;
    /**
     * What the gate called the product when it does not match the catalogue.
     * Snapshotted so the completed ticket can say WHICH code was unknown —
     * without it the warning has nothing to name.
     */
    productCodeAtTicket?: string | null;
  },
) {
  let productName: string | null = null;
  let productCode: string | null = input.productCodeAtTicket ?? null;
  if (input.productId) {
    const [product] = await tx
      .select({ name: products.name, sku: products.sku })
      .from(products)
      .where(eq(products.id, input.productId));
    if (!product) throw new Error("Product not found");
    productName = product.name;
    productCode = product.sku;
  }

  const [{ ticket_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'WB') AS ticket_number`,
  )) as unknown as Array<{ ticket_number: string }>;

  const [ticket] = await tx
    .insert(weighbridgeTickets)
    .values({
      companyId: input.companyId,
      ticketNumber: ticket_number,
      externalRef: input.externalRef ?? null,
      transactionType: input.transactionType,
      direction: INBOUND_TYPES.has(input.transactionType) ? "inbound" : "outbound",
      productId: input.productId ?? null,
      productNameAtTicket: productName,
      productCodeAtTicket: productCode,
      partyId: input.partyId ?? null,
      partyNameAtTicket: input.partyName ?? null,
      vehicleReg: input.vehicleReg ?? null,
      driverName: input.driverName ?? null,
      invoiceId: input.invoiceId ?? null,
      invoiceRef: input.invoiceRef ?? null,
      transferRef: input.transferRef ?? null,
      ticketDate: input.ticketDate ?? null,
    })
    .returning();

  return ticket;
}

/**
 * Records a weighing. The first sets the ticket to `first_recorded`; the second
 * completes it.
 *
 * `net_weight` is not passed and cannot be: it is a generated column,
 * `abs(first - second)`, which is what the model documents and then stores as
 * an independent number. A recorded weighing is also immutable — both rules are
 * in migration 0022.
 */
export async function recordWeighing(
  tx: Tx,
  ticketId: string,
  weight: string,
  keyId?: string | null,
) {
  const [ticket] = await tx
    .select()
    .from(weighbridgeTickets)
    .where(eq(weighbridgeTickets.id, ticketId));
  if (!ticket) throw new Error("Weighbridge ticket not found");
  if (ticket.status === "voided") {
    throw new Error(`Ticket ${ticket.ticketNumber} is voided`);
  }

  const isFirst = ticket.firstWeight === null;
  if (!isFirst && ticket.secondWeight !== null) {
    throw new Error(
      `Ticket ${ticket.ticketNumber} already has both weighings`,
    );
  }

  const [updated] = await tx
    .update(weighbridgeTickets)
    .set(
      isFirst
        ? {
            firstWeight: weight,
            firstWeightRecordedAt: new Date(),
            firstWeightKeyId: keyId ?? null,
            status: "first_recorded",
            updatedAt: new Date(),
          }
        : {
            secondWeight: weight,
            secondWeightRecordedAt: new Date(),
            secondWeightKeyId: keyId ?? null,
            status: "completed",
            updatedAt: new Date(),
          },
    )
    .where(eq(weighbridgeTickets.id, ticketId))
    .returning();

  return updated;
}

/** Links the two legs of a transfer. Validated by trigger. */
export async function linkTransferLegs(
  tx: Tx,
  inboundTicketId: string,
  outboundTicketId: string,
) {
  await tx
    .update(weighbridgeTickets)
    .set({ linkedTicketId: outboundTicketId, transferCleared: true, updatedAt: new Date() })
    .where(eq(weighbridgeTickets.id, inboundTicketId));

  const [updated] = await tx
    .update(weighbridgeTickets)
    .set({ linkedTicketId: inboundTicketId, transferCleared: true, updatedAt: new Date() })
    .where(eq(weighbridgeTickets.id, outboundTicketId))
    .returning();

  return updated;
}

export async function voidWeighbridgeTicket(
  tx: Tx,
  ticketId: string,
  voidedById: string,
  reason: string,
) {
  const [updated] = await tx
    .update(weighbridgeTickets)
    .set({
      status: "voided",
      voidedAt: new Date(),
      voidedById,
      voidReason: reason || "No reason provided",
      updatedAt: new Date(),
    })
    .where(eq(weighbridgeTickets.id, ticketId))
    .returning();

  if (!updated) throw new Error("Weighbridge ticket not found");
  return updated;
}

export async function listWeighbridgeTickets(
  tx: Tx,
  opts: {
    status?: "pending" | "first_recorded" | "completed" | "voided";
    transactionType?: WbTransactionType;
    limit?: number;
  } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const filters = [
    opts.status ? eq(weighbridgeTickets.status, opts.status) : undefined,
    opts.transactionType
      ? eq(weighbridgeTickets.transactionType, opts.transactionType)
      : undefined,
  ].filter(Boolean);

  return tx
    .select()
    .from(weighbridgeTickets)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(weighbridgeTickets.createdAt))
    .limit(limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock request reads, shaped for the pages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-request fulfilment totals, computed in SQL.
 *
 * The list page derives these in JavaScript today:
 *
 *     request.items.reduce((sum, i) => sum + (i.approvedQuantity || i.requestedQuantity), 0)
 *
 * Quantities are numeric(19,4), which cross this boundary as STRINGS, so that
 * reduce concatenates rather than adds — `0 + "5.0000"` is `"05.0000"`, and
 * the next line appends to it. The same shape has already bitten the bills
 * stats card and the invoice totals. Summing in numeric(19,4) removes the
 * class of bug rather than the instance, and the page reads a number it does
 * not have to compute.
 *
 * It also reads `item.remainingToFulfill`, which does not exist: the column is
 * `remaining_to_fulfil`, one L, and the missing field made the "remaining"
 * figure NaN. Both spellings are returned below so neither is a trap.
 */
const REQUEST_TOTALS = sql`
  SELECT i.request_id,
         count(*)::int                                      AS item_count,
         COALESCE(SUM(COALESCE(i.approved_quantity, i.requested_quantity)), 0) AS target,
         COALESCE(SUM(i.total_fulfilled), 0)                AS fulfilled,
         COALESCE(SUM(i.remaining_to_fulfil), 0)            AS remaining
    FROM stock_request_items i
   GROUP BY i.request_id
`;

export async function searchStockRequests(
  tx: Tx,
  opts: {
    query?: string;
    status?: string;
    requestType?: string;
    priority?: string;
    requesterId?: string;
    page?: number;
    perPage?: number;
  } = {},
) {
  const perPage = Math.min(opts.perPage ?? 10, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const offset = (page - 1) * perPage;
  const q = (opts.query ?? "").trim();

  const where = [];
  if (q) {
    where.push(sql`(
      r.request_number ILIKE ${likePrefix(q)}
      OR r.requester_name_at_request ILIKE ${likeContains(q)}
      OR r.customer_name_at_request ILIKE ${likeContains(q)}
    )`);
  }
  if (opts.status) where.push(sql`r.status = ${opts.status}::stock_request_status`);
  if (opts.requestType) {
    where.push(sql`r.request_type = ${opts.requestType}::stock_request_type`);
  }
  if (opts.priority) where.push(sql`r.priority = ${opts.priority}::request_priority`);
  if (opts.requesterId) where.push(sql`r.requester_id = ${opts.requesterId}`);

  const clause = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

  const rows = (await tx.execute(sql`
    SELECT r.id, r.request_number, r.request_type::text AS request_type,
           r.status::text AS status, r.priority::text AS priority,
           r.customer_name_at_request, r.requester_name_at_request,
           r.requester_id, r.requester_department::text AS requester_department,
           r.total_value::text AS total_value,
           r.required_by_date::text AS required_by_date,
           r.requested_at, r.created_at, r.notes,
           -- When the request was DECIDED, for activity feeds. Additive: no
           -- existing caller reads it, and the Mongo shape's updatedAt was the
           -- wrong answer anyway — any later edit re-dated the decision.
           -- (No backticks in here: one ends the sql template literal.)
           COALESCE(r.approved_at, r.rejected_at) AS decided_at,
           COALESCE(t.item_count, 0) AS item_count,
           COALESCE(t.target, 0)::text     AS total_requested,
           COALESCE(t.fulfilled, 0)::text  AS total_fulfilled,
           COALESCE(t.remaining, 0)::text  AS total_remaining,
           CASE
             WHEN r.status = 'pending' OR COALESCE(t.target, 0) = 0 THEN 0
             ELSE ROUND(COALESCE(t.fulfilled, 0) * 100 / t.target)
           END::int AS progress,
           count(*) OVER() AS total_count
      FROM stock_requests r
      LEFT JOIN (${REQUEST_TOTALS}) t ON t.request_id = r.id
      ${clause}
     ORDER BY r.requested_at DESC, r.request_number DESC
     LIMIT ${perPage} OFFSET ${offset}
  `)) as unknown as Array<Record<string, string | number>>;

  const total = rows.length ? Number(rows[0].total_count) : 0;

  return {
    requests: rows.map((r) => ({
      _id: r.id,
      id: r.id,
      requestNumber: r.request_number,
      requestType: r.request_type,
      status: r.status,
      priority: r.priority,
      totalValue: r.total_value,
      requiredByDate: r.required_by_date,
      requestedAt: r.requested_at,
      decidedAt: r.decided_at,
      createdAt: r.created_at,
      notes: r.notes,
      customer: { name: r.customer_name_at_request },
      requester: {
        id: r.requester_id,
        name: r.requester_name_at_request,
        department: r.requester_department,
      },
      itemCount: Number(r.item_count),
      /** Summed in SQL — see the note above REQUEST_TOTALS. */
      totalRequested: r.total_requested,
      totalFulfilled: r.total_fulfilled,
      totalRemaining: r.total_remaining,
      progress: Number(r.progress),
    })),
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    page,
  };
}

/** The figures the requests list cards read. */
/**
 * What was decided TODAY — the two movement tiles on the operations tab.
 *
 * Not in `getStockRequestStats`, which counts standing state. These count
 * transitions, and they key on `approved_at` / `rejected_at` rather than
 * `updated_at`: the Mongo query used `updatedAt >= todayStart`, so ANY edit to
 * an old request — a note, a fulfilment, a priority change — re-dated it into
 * today's "approved" tile. The column that records the decision is the one
 * that answers when the decision was made.
 *
 * `CURRENT_DATE` in the database's timezone, not a JS `todayStart` computed on
 * the server, so the boundary is one thing rather than two that can disagree.
 */
export async function getStockRequestDecisionsToday(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE approved_at >= CURRENT_DATE)::int AS "approvedToday",
      count(*) FILTER (WHERE rejected_at >= CURRENT_DATE)::int AS "rejectedToday"
    FROM stock_requests
  `)) as unknown as Array<{ approvedToday: number; rejectedToday: number }>;

  return row ?? { approvedToday: 0, rejectedToday: 0 };
}

export async function getStockRequestStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT count(*)::int                                          AS total,
           count(*) FILTER (WHERE status = 'pending')::int         AS pending,
           count(*) FILTER (WHERE status = 'approved')::int        AS approved,
           count(*) FILTER (WHERE status IN ('fulfilled', 'invoiced'))::int
                                                                   AS fulfilled,
           count(*) FILTER (WHERE priority = 'urgent'
                              AND status IN ('pending', 'approved',
                                             'partially_fulfilled'))::int
                                                                   AS urgent,
           -- Overdue is DERIVED from the date, and compared against
           -- CURRENT_DATE rather than now(): a request required TODAY has not
           -- run out of time yet. §9B.2 records why no status stores this.
           count(*) FILTER (WHERE required_by_date IS NOT NULL
                              AND required_by_date < CURRENT_DATE
                              AND status IN ('pending', 'approved',
                                             'partially_fulfilled'))::int
                                                                   AS overdue
      FROM stock_requests
  `)) as unknown as Array<Record<string, number>>;

  return {
    total: Number(row.total),
    pending: Number(row.pending),
    approved: Number(row.approved),
    fulfilled: Number(row.fulfilled),
    urgentCount: Number(row.urgent),
    overdueCount: Number(row.overdue),
  };
}

/** One request, shaped for the detail page. */
export async function getStockRequestDetail(tx: Tx, requestId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(requestId)) return null;
  const [r] = (await tx.execute(sql`
    SELECT r.*,
           r.request_type::text  AS request_type_text,
           r.status::text        AS status_text,
           r.priority::text      AS priority_text,
           r.requester_department::text AS requester_department_text,
           r.required_by_date::text AS required_by_date_text
      FROM stock_requests r
     WHERE r.id = ${requestId}
  `)) as unknown as Array<Record<string, unknown>>;

  if (!r) return null;

  const items = (await tx.execute(sql`
    SELECT i.id, i.line_number, i.product_id,
           i.product_name_at_request, i.sku_at_request,
           i.stock_at_request::text     AS stock_at_request,
           i.requested_quantity::text   AS requested_quantity,
           i.approved_quantity::text    AS approved_quantity,
           i.unit_price::text           AS unit_price,
           i.unit, i.purpose::text AS purpose, i.purpose_details, i.notes,
           i.requires_return,
           i.expected_return_date::text AS expected_return_date,
           i.total_fulfilled::text      AS total_fulfilled,
           i.remaining_to_fulfil::text  AS remaining_to_fulfil,
           i.fulfilment_status::text    AS fulfilment_status,
           i.invoiced_quantity::text    AS invoiced_quantity
      FROM stock_request_items i
     WHERE i.request_id = ${requestId}
     ORDER BY i.line_number
  `)) as unknown as Array<Record<string, unknown>>;

  const approvals = (await tx.execute(sql`
    SELECT approver_name_at_action, action, comments, acted_at
      FROM stock_request_approvals
     WHERE request_id = ${requestId}
     ORDER BY acted_at
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    _id: r.id,
    id: r.id,
    requestNumber: r.request_number,
    requestType: r.request_type_text,
    status: r.status_text,
    priority: r.priority_text,
    totalValue: String(r.total_value ?? "0"),
    requiredByDate: r.required_by_date_text,
    requestedAt: r.requested_at,
    createdAt: r.created_at,
    notes: r.notes,

    customer: {
      id: r.customer_id,
      name: r.customer_name_at_request,
      email: r.customer_email_at_request,
      phone: r.customer_phone_at_request,
      address: r.customer_address_at_request,
      taxPin: r.customer_tax_pin_at_request,
    },
    // Snapshots: there is no users table to join an id to (§10).
    requester: {
      id: r.requester_id,
      name: r.requester_name_at_request,
      department: r.requester_department_text,
      email: r.requester_email,
      phone: r.requester_phone,
    },
    approver: r.approved_by_name_at_approval
      ? {
          name: r.approved_by_name_at_approval,
          approvedAt: r.approved_at,
          comments: r.approval_comments,
          conditions: r.approval_conditions,
        }
      : null,
    rejectedBy: r.rejected_by_id ? { id: r.rejected_by_id } : null,
    rejectedAt: r.rejected_at,
    rejectionReason: r.rejection_reason,
    cancelledAt: r.cancelled_at,
    cancellationReason: r.cancellation_reason,

    project: r.project_number_at_request
      ? { projectNumber: r.project_number_at_request, name: r.project_name_at_request }
      : null,
    costCode: r.cost_code_at_request ? { code: r.cost_code_at_request } : null,
    /** `storekeeper` has no counterpart here; the detail page guards on it. */
    storekeeper: null,

    draftInvoice: r.draft_invoice_number_at_creation
      ? {
          invoiceId: r.draft_invoice_id,
          invoiceNumber: r.draft_invoice_number_at_creation,
          createdAt: r.draft_invoice_created_at,
        }
      : null,

    items: items.map((i) => ({
      _id: i.id,
      id: i.id,
      lineNumber: i.line_number,
      productId: i.product_id,
      productName: i.product_name_at_request,
      SKU: i.sku_at_request,
      currentStock: i.stock_at_request,
      requestedQuantity: i.requested_quantity,
      approvedQuantity: i.approved_quantity,
      unitPrice: i.unit_price,
      unit: i.unit,
      purpose: i.purpose,
      purposeDetails: i.purpose_details,
      requiresReturn: i.requires_return,
      expectedReturnDate: i.expected_return_date,
      notes: i.notes,
      totalFulfilled: i.total_fulfilled,
      // Both spellings: the column is `remaining_to_fulfil` and the UI reads
      // `remainingToFulfill`, which silently produced NaN.
      remainingToFulfil: i.remaining_to_fulfil,
      remainingToFulfill: i.remaining_to_fulfil,
      fulfillmentStatus: i.fulfilment_status,
      fulfilmentStatus: i.fulfilment_status,
      invoicedQuantity: i.invoiced_quantity,
    })),

    approvalHistory: approvals.map((a) => ({
      approverName: a.approver_name_at_action,
      action: a.action,
      comments: a.comments,
      timestamp: a.acted_at,
    })),
  };
}

/**
 * Cancels a request.
 *
 * Only before anything has been issued against it. Once stock has moved the
 * question is a return, not a cancellation, and the two are different events
 * with different consequences for inventory.
 */
export async function cancelStockRequest(
  tx: Tx,
  requestId: string,
  cancelledById: string,
  reason: string,
) {
  const [request] = await tx
    .select()
    .from(stockRequests)
    .where(eq(stockRequests.id, requestId));
  if (!request) throw new Error("Stock request not found");

  if (["fulfilled", "invoiced", "cancelled"].includes(request.status)) {
    throw new Error(`Cannot cancel a request that is already ${request.status}`);
  }

  const [{ issued }] = (await tx.execute(sql`
    SELECT COALESCE(SUM(total_fulfilled), 0)::text AS issued
      FROM stock_request_items WHERE request_id = ${requestId}
  `)) as unknown as Array<{ issued: string }>;

  if (!/^-?0(\.0*)?$/.test(issued)) {
    throw new Error(
      `Cannot cancel ${request.requestNumber}: ${issued} has already been issued against it. Return the stock instead.`,
    );
  }

  const [updated] = await tx
    .update(stockRequests)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancellationReason: reason || "No reason provided",
      updatedAt: new Date(),
    })
    .where(eq(stockRequests.id, requestId))
    .returning();

  return updated;
}

/**
 * Issues stock against an approved request.
 *
 * One transaction per call, doing per item, in this order:
 *
 *   1. record the movement   — provenance, BEFORE the level moves
 *   2. issue the stock       — on hand down, commitment released
 *   3. create a checkout     — only where the goods must come back
 *   4. record the fulfilment — linking the movement and the checkout
 *
 * THE ORDER OF 1 AND 2 IS THE POINT. recordMovement reads the product's
 * CURRENT level as previous_stock and derives new_stock from it, so issuing
 * first makes every provenance record understate both levels by the quantity
 * issued — a sale of 10 from 100 written down as "90 → 80". §9.7 records the
 * same defect found at four other call sites; this is the fifth, and it is
 * stated here rather than left to be rediscovered.
 *
 * A CHECKOUT IS RAISED ONLY WHERE THE STOCK IS COMING BACK. `internal` is
 * consumed and `sale` is sold; demo, repair, installation and employee_borrow
 * are out on loan and are what the outstanding-checkouts queue is for.
 *
 * NO DRAFT INVOICE. requests-actions.js:1491 raises one at fulfilment for
 * `sale` requests. That is a separate decision with its own posting
 * consequences, and stock_requests.draft_invoice_id is a pass-2 back-reference
 * for the same reason — raising it belongs with the invoicing slice, not
 * inside the stock issue.
 */
const RETURNABLE_TYPES = new Set([
  "demo",
  "repair",
  "installation",
  "employee_borrow",
]);

export async function fulfilStockRequest(
  tx: Tx,
  requestId: string,
  issues: Array<{ itemId: string; quantity: string; serialNumbers?: string[] }>,
  opts: {
    fulfilledById: string;
    fulfilledByName: string;
    expectedReturnDate?: string | null;
    notes?: string | null;
    /**
     * The two accounts a project's consumed stock moves between — 0085.
     * Required only when the request names a project AND the stock is
     * consumed; the action resolves them and throws if the chart lacks them.
     */
    projectMaterialsAccountId?: string | null;
    inventoryAccountId?: string | null;
  },
) {
  const [request] = await tx
    .select()
    .from(stockRequests)
    .where(eq(stockRequests.id, requestId));
  if (!request) throw new Error("Stock request not found");
  if (!["approved", "partially_fulfilled"].includes(request.status)) {
    throw new Error(
      `Cannot issue against a request that is ${request.status}. It must be approved first.`,
    );
  }

  const items = await tx
    .select()
    .from(stockRequestItems)
    .where(eq(stockRequestItems.requestId, requestId));
  const byId = new Map(items.map((i) => [i.id, i]));

  const results = [];
  let consumedCost = 0;

  for (const issue of issues) {
    if (/^-?0(\.0*)?$/.test(issue.quantity)) continue;

    const item = byId.get(issue.itemId);
    if (!item) throw new Error(`Item ${issue.itemId} is not on this request`);

    // 1. Provenance first — see the note above.
    const movement = await recordMovement(tx, {
      companyId: request.companyId,
      productId: item.productId,
      movementType: "issue",
      direction: "out",
      quantity: issue.quantity,
      sourceReference: request.requestNumber,
      performedById: opts.fulfilledById,
      performedByName: opts.fulfilledByName,
    });

    // 2. Then the level moves.
    await issueStock(tx, item.productId, issue.quantity);

    // 3. Out on loan, or gone for good.
    let checkout = null;
    if (RETURNABLE_TYPES.has(request.requestType)) {
      checkout = await createCheckout(tx, {
        companyId: request.companyId,
        productId: item.productId,
        quantity: issue.quantity,
        checkedOutToId: null,
        checkedOutToName: request.requesterNameAtRequest,
        checkedOutById: opts.fulfilledById,
        checkedOutByName: opts.fulfilledByName,
        purpose: request.requestType,
        expectedReturnDate:
          opts.expectedReturnDate ??
          item.expectedReturnDate ??
          request.requiredByDate ??
          new Date().toISOString().slice(0, 10),
        requestId: request.id,
        requestNumber: request.requestNumber,
        requestType: request.requestType,
        notes: opts.notes ?? null,
      });
    }

    // 4. The fulfilment row, which is what the triggers read. Over-issuing is
    //    refused by the deferred constraint in 0022, not by a check here.
    const fulfilment = await recordFulfilment(tx, {
      companyId: request.companyId,
      itemId: item.id,
      quantity: issue.quantity,
      fulfilledById: opts.fulfilledById,
      fulfilledByName: opts.fulfilledByName,
      serialNumbers: issue.serialNumbers,
      movementId: movement.id,
      checkoutId: checkout?.id ?? null,
      notes: opts.notes ?? null,
    });

    results.push({ item, movement, checkout, fulfilment });

    /**
     * Only CONSUMED stock is a cost. A returnable issue — demo, repair,
     * installation, employee_borrow — is still the company's asset sitting
     * somewhere else, and `createCheckout` above is what tracks it; expensing
     * it here would write off inventory that is coming back.
     */
    if (!RETURNABLE_TYPES.has(request.requestType)) {
      consumedCost += Number(movement.totalCost ?? 0);
    }
  }

  if (!results.length) {
    throw new Error("Nothing to issue — every quantity was zero");
  }

  /**
   * MATERIAL ISSUED TO A JOB REACHES THE LEDGER — 0085.
   *
   * This posted nothing at all before: `recordMovement` and `issueStock` insert
   * rows and neither creates a journal entry, while a bill for an inventory
   * purchase DEBITS Inventory. So material bought for a job and issued to it was
   * relieved from stock in QUANTITY and never in the LEDGER — Inventory
   * overstated by every item ever issued to a project, and a construction job's
   * largest cost line invisible to the accounts.
   *
   * SAP issues goods to a WBS element against a consumption account and Odoo's
   * stock moves hit the valuation accounts in real time. There is no reading of
   * standard practice where this stays unposted.
   *
   * ONE ENTRY PER FULFILMENT, not per line — a goods issue is one document, and
   * a line-by-line posting is how a ledger acquires thousands of rows a month
   * with no clean way to reverse a correction.
   *
   * At the movement's own cost, which is the cost the stock actually left at.
   */
  let entry = null;
  if (request.projectId && consumedCost > 0) {
    if (!opts.projectMaterialsAccountId || !opts.inventoryAccountId) {
      throw new Error(
        "Project Materials (5410) or Inventory is not configured in the chart of accounts, so stock issued to a project cannot be costed.",
      );
    }
    const amount = consumedCost.toFixed(4);
    entry = await createJournalEntry(tx, {
      companyId: request.companyId,
      entryDate: new Date().toISOString().slice(0, 10),
      entryType: "inventory_adjustment",
      description: `Materials issued to project — ${request.requestNumber}`,
      reference: request.requestNumber,
      sourceType: "stock_request",
      sourceId: request.id,
      projectId: request.projectId,
      costCodeId: request.costCodeId ?? null,
      createdById: opts.fulfilledById ?? null,
      postImmediately: true,
      lines: [
        {
          accountId: opts.projectMaterialsAccountId,
          debit: amount,
          description: `Issued against ${request.requestNumber}`,
        },
        {
          accountId: opts.inventoryAccountId,
          credit: amount,
          description: "Out of stock",
        },
      ],
    });
  }

  // Re-read: status and the item totals are the triggers' output, not this
  // function's, so the caller gets what the database decided rather than what
  // this code assumed.
  const [updated] = await tx
    .select()
    .from(stockRequests)
    .where(eq(stockRequests.id, requestId));

  return { request: updated, issued: results.length, journalEntryId: entry?.id ?? null };
}

/**
 * A weighbridge ticket by the gate's own reference.
 *
 * That reference is the idempotency key for a trip: first weight opens the
 * ticket under it, second weight finds it again. Unique per company where
 * present (0022) — Mongo indexes it WITHOUT uniqueness, which is what lets a
 * retried gate call open a second ticket for one truck.
 */
export async function getWeighbridgeTicketByExternalRef(
  tx: Tx,
  externalRef: string,
) {
  const [ticket] = await tx
    .select()
    .from(weighbridgeTickets)
    .where(eq(weighbridgeTickets.externalRef, externalRef));
  return ticket ?? null;
}

/**
 * What the connector knows once the truck has left: which document the trip
 * produced, which invoice it turned out to belong to, and anything worth
 * telling a person about.
 *
 * The weights are NOT here. A recorded weighing is immutable and `net_weight`
 * is generated — both in 0022 — so completion records consequences, never
 * figures.
 */
export async function completeWeighbridgeTicket(
  tx: Tx,
  ticketId: string,
  patch: {
    internalRef?: string | null;
    internalId?: string | null;
    invoiceId?: string | null;
    invoiceRef?: string | null;
    partyName?: string | null;
    billId?: string | null;
    billRef?: string | null;
    warnings?: string[];
    completedAt?: Date;
  },
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.internalRef !== undefined) set.internalRef = patch.internalRef;
  if (patch.internalId !== undefined) set.internalId = patch.internalId;
  if (patch.invoiceId !== undefined) set.invoiceId = patch.invoiceId;
  if (patch.invoiceRef !== undefined) set.invoiceRef = patch.invoiceRef;
  if (patch.partyName !== undefined) set.partyNameAtTicket = patch.partyName;
  if (patch.billId !== undefined) set.billId = patch.billId;
  if (patch.billRef !== undefined) set.billRef = patch.billRef;
  if (patch.warnings !== undefined) set.warnings = patch.warnings;
  set.completedAt = patch.completedAt ?? new Date();

  const [updated] = await tx
    .update(weighbridgeTickets)
    .set(set)
    .where(eq(weighbridgeTickets.id, ticketId))
    .returning();
  return updated;
}

/**
 * Converts checked-out stock into an expense: DR Expense / CR Technician Stock.
 *
 * The technician did not bring it back and is not being billed for it — it was
 * consumed. The value has to leave technician stock and land somewhere, and
 * that somewhere is an expense account the person choosing picks.
 *
 * NEW in the Postgres half. The columns have been on `item_checkouts` since
 * the fulfilment port — `expensed`, `expensed_at`, `expense_account_id`,
 * `expense_journal_entry_id`, `quantity_expensed`, `expense_total_cost` — and
 * nothing ever wrote any of them.
 *
 * The `quantity_sold + quantity_returned + quantity_expensed <= quantity`
 * CHECK is what stops a checkout disposing of more than went out, however the
 * three are combined. Mongo tracks the same three counters with nothing
 * reconciling them.
 */
export async function expenseCheckout(
  tx: Tx,
  checkoutId: string,
  input: {
    quantity: string;
    totalCost: string;
    expenseAccountId: string;
    expenseAccountCode: string;
    expenseAccountName: string;
    technicianStockAccountId: string;
    reason: string;
    expensedById?: string | null;
  },
) {
  const [checkout] = await tx
    .select()
    .from(itemCheckouts)
    .where(eq(itemCheckouts.id, checkoutId));
  if (!checkout) throw new Error("Checkout not found");
  if (checkout.status === "returned") {
    throw new Error("That checkout has already been fully returned.");
  }
  if (!input.reason?.trim()) {
    throw new Error("Say what the stock was used for.");
  }

  const entry = await createJournalEntry(tx, {
    companyId: checkout.companyId,
    entryDate: new Date().toISOString().slice(0, 10),
    entryType: "expense",
    description: `Internal use expense — ${checkout.productNameAtCheckout ?? "item"}`,
    reference: checkout.checkoutNumber,
    lines: [
      {
        accountId: input.expenseAccountId,
        debit: input.totalCost,
        description: `${checkout.productNameAtCheckout ?? "item"} — ${input.reason.trim()}`,
      },
      {
        accountId: input.technicianStockAccountId,
        credit: input.totalCost,
        description: `From technician stock — ${checkout.checkoutNumber}`,
      },
    ],
    createdById: input.expensedById ?? null,
    postImmediately: true,
  });

  const [updated] = await tx
    .update(itemCheckouts)
    .set({
      quantityExpensed: sql`${itemCheckouts.quantityExpensed} + ${input.quantity}::numeric(19,4)`,
      expenseTotalCost: sql`${itemCheckouts.expenseTotalCost} + ${input.totalCost}::numeric(19,4)`,
      expensed: true,
      expensedAt: new Date(),
      expensedById: input.expensedById ?? null,
      expenseAccountId: input.expenseAccountId,
      // §9.4 — what the account was called when the cost was booked to it.
      expenseAccountCodeAtExpense: input.expenseAccountCode,
      expenseAccountNameAtExpense: input.expenseAccountName,
      expenseJournalEntryId: entry.id,
      expenseReason: input.reason.trim(),
      updatedAt: new Date(),
    })
    .where(eq(itemCheckouts.id, checkoutId))
    .returning();

  // Fully accounted for, whichever way the quantity was disposed of.
  const [{ settled }] = (await tx.execute(sql`
    SELECT (quantity_sold + quantity_returned + quantity_expensed = quantity) AS settled
      FROM item_checkouts WHERE id = ${checkoutId}
  `)) as unknown as Array<{ settled: boolean }>;

  if (settled) {
    const [closed] = await tx
      .update(itemCheckouts)
      .set({ status: "expensed", updatedAt: new Date() })
      .where(eq(itemCheckouts.id, checkoutId))
      .returning();
    return { checkout: closed, entry };
  }

  return { checkout: updated, entry };
}

/** Flags a checkout for someone else's attention. Posts nothing. */
export async function escalateCheckout(
  tx: Tx,
  checkoutId: string,
  input: {
    escalatedToId: string;
    escalatedToName: string;
    reason?: string | null;
  },
) {
  const [updated] = await tx
    .update(itemCheckouts)
    .set({
      isEscalated: true,
      escalatedToId: input.escalatedToId,
      escalatedToNameAtEscalation: input.escalatedToName,
      escalatedAt: new Date(),
      escalationReason: input.reason?.trim() || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(itemCheckouts.id, checkoutId),
        eq(itemCheckouts.status, "checked_out"),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error("Only a checkout that is still out can be escalated.");
  }
  return updated;
}

/**
 * Marks a checkout lost, damaged or overdue.
 *
 * NOT a route to `returned` or `expensed`: those move value and must go
 * through the function that posts the entry. The status set here changes what
 * the screen says, not what the ledger holds — which is why the list is
 * narrower than the enum.
 */
export async function setCheckoutStatus(
  tx: Tx,
  checkoutId: string,
  status: "overdue" | "lost" | "damaged",
  input: { damageDetails?: string | null } = {},
) {
  const [updated] = await tx
    .update(itemCheckouts)
    .set({
      status,
      damageDetails: input.damageDetails ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(itemCheckouts.id, checkoutId),
        sql`${itemCheckouts.status} IN ('checked_out', 'overdue', 'lost', 'damaged')`,
      ),
    )
    .returning();

  if (!updated) {
    throw new Error(
      "That checkout has been returned or expensed — its status is settled.",
    );
  }
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The checkout list's row shape — the DOCUMENT shape the screens read.
 *
 * `checkedOutTo` and `productSnapshot` are nested because the tables render
 * `checkout.checkedOutTo?.name` and `checkout.productSnapshot?.SKU`. The
 * derived day counts are computed in SQL: `daysOverdue` off the expected
 * return date, and `isOverdue` from it, so a list of two hundred rows does not
 * recompute dates in JavaScript and cannot disagree with the filter that
 * selected them.
 */
function checkoutRow(r: Record<string, unknown>) {
  return {
    _id: String(r.id),
    id: String(r.id),
    checkoutNumber: r.checkout_number as string,
    checkoutDate: toDate(r.checked_out_at)!,
    expectedReturnDate: r.expected_return_date as string,
    quantity: Number(r.quantity),
    purpose: r.purpose as string,
    purposeDetails: (r.purpose_details as string) ?? null,
    checkoutNotes: (r.purpose_details as string) ?? null,
    status: r.status as string,
    damageDetails: (r.damage_details as string) ?? null,

    productSnapshot: {
      name: (r.product_name_at_checkout as string) ?? "",
      SKU: (r.sku_at_checkout as string) ?? "",
      category: (r.category_at_checkout as string) ?? "",
    },
    productId: r.product_id as string,

    checkedOutTo: {
      id: (r.checked_out_to_id as string) ?? null,
      name: (r.checked_out_to_name_at_checkout as string) ?? "",
      department: (r.checked_out_to_department as string) ?? null,
      email: (r.checked_out_to_email as string) ?? null,
      phone: (r.checked_out_to_phone as string) ?? null,
    },
    checkedOutBy: {
      id: (r.checked_out_by_id as string) ?? null,
      name: (r.checked_out_by_name_at_checkout as string) ?? "",
    },

    isEscalated: Boolean(r.is_escalated),
    escalatedTo: r.is_escalated
      ? {
          id: (r.escalated_to_id as string) ?? null,
          name: (r.escalated_to_name_at_escalation as string) ?? "",
          escalatedAt: toDate(r.escalated_at),
          reason: (r.escalation_reason as string) ?? null,
        }
      : null,

    quantityReturned: Number(r.quantity_returned),
    quantityExpensed: Number(r.quantity_expensed),
    quantitySold: Number(r.quantity_sold),

    daysHeld: Number(r.days_held ?? 0),
    daysOverdue: Number(r.days_overdue ?? 0),
    daysUntilDue: Number(r.days_until_due ?? 0),
    isOverdue: Boolean(r.is_overdue),
  };
}

const CHECKOUT_DERIVED = sql`
  GREATEST(0, (CURRENT_DATE - c.checked_out_at::date))                  AS days_held,
  GREATEST(0, (CURRENT_DATE - c.expected_return_date))                  AS days_overdue,
  GREATEST(0, (c.expected_return_date - CURRENT_DATE))                  AS days_until_due,
  (c.status = 'checked_out' AND c.expected_return_date < CURRENT_DATE)  AS is_overdue
`;

export async function searchCheckouts(
  tx: Tx,
  opts: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  const limit = Math.min(opts.limit ?? 10, 100);
  const offset = (Math.max(1, opts.page ?? 1) - 1) * limit;
  const term = opts.search?.trim() ? likeContains(opts.search.trim()) : null;

  const where = sql`WHERE TRUE
    ${
      opts.status && opts.status !== "all"
        ? sql`AND c.status = ${opts.status}::checkout_status`
        : sql``
    }
    ${
      term
        ? sql`AND (c.checkout_number ILIKE ${term}
                OR c.product_name_at_checkout ILIKE ${term}
                OR c.sku_at_checkout ILIKE ${term}
                OR c.checked_out_to_name_at_checkout ILIKE ${term})`
        : sql``
    }`;

  const rows = (await tx.execute(sql`
    SELECT c.*, ${CHECKOUT_DERIVED}
      FROM item_checkouts c
      ${where}
     ORDER BY c.checked_out_at DESC
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;

  const [{ count }] = (await tx.execute(sql`
    SELECT count(*)::int AS count FROM item_checkouts c ${where}
  `)) as unknown as Array<{ count: number }>;

  return {
    checkouts: rows.map(checkoutRow),
    total: count,
    pages: Math.max(1, Math.ceil(count / limit)),
  };
}

export async function getCheckoutById(tx: Tx, checkoutId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(checkoutId)) return null;
  const rows = (await tx.execute(sql`
    SELECT c.*, ${CHECKOUT_DERIVED}
      FROM item_checkouts c
     WHERE c.id = ${checkoutId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  return rows[0] ? checkoutRow(rows[0]) : null;
}

/**
 * The list page's stat tiles.
 *
 * `overdue` is derived from the date rather than read from the status: a
 * checkout goes overdue by the calendar passing, and nothing runs at midnight
 * to relabel it. The Mongo version counts `status: "overdue"`, so the tile
 * showed only those a store manager had manually marked.
 */
/**
 * What ONE person still holds — the two numbers on their own alerts strip.
 *
 * `overdue` IS NOT A STATUS HERE, and that is the only real difference from
 * the Mongo query this replaces. That collection carried an `overdue` value
 * that nothing ever set (see `setCheckoutStatusPg`), so its
 * `status: { $in: ["checked_out", "overdue"] }` was the first term and a value
 * that could not occur. Overdue is derived from the date, which is the only
 * way the number can be right the morning after it becomes true.
 *
 * The two counts deliberately OVERLAP: an overdue item is still checked out,
 * and the strip renders "3 out, 1 overdue" rather than two disjoint buckets.
 */
export async function countMyCheckouts(tx: Tx, userId: string) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'checked_out')::int AS "checkedOut",
      count(*) FILTER (WHERE status = 'checked_out'
                         AND expected_return_date < CURRENT_DATE)::int AS overdue
    FROM item_checkouts
    WHERE checked_out_to_id = ${userId}
  `)) as unknown as Array<{ checkedOut: number; overdue: number }>;

  return row ?? { checkedOut: 0, overdue: 0 };
}

export async function getCheckoutStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'checked_out')::int AS active,
      count(*) FILTER (WHERE status = 'checked_out'
                         AND expected_return_date < CURRENT_DATE)::int AS overdue,
      -- Due within three days, matching the Mongo window. Not yet overdue:
      -- the two tiles must not count the same checkout twice.
      count(*) FILTER (WHERE status = 'checked_out'
                         AND expected_return_date >= CURRENT_DATE
                         AND expected_return_date <= CURRENT_DATE + 3)::int AS due_soon,
      count(*) FILTER (WHERE status = 'returned')::int   AS returned,
      count(*) FILTER (WHERE status = 'expensed')::int   AS expensed,
      count(*) FILTER (WHERE is_escalated)::int          AS escalated,
      count(*)::int                                      AS total
    FROM item_checkouts
  `)) as unknown as Array<Record<string, number>>;
  // `due_soon` → `dueSoon`: the stat tiles read camelCase.
  return { ...row, dueSoon: row.due_soon };
}

/**
 * One ticket by id, for the void path.
 *
 * `listWeighbridgeTickets` cannot serve this: it caps at 200 and orders by
 * date, so a ticket older than the cap is invisible to it — and "the ticket
 * you asked to void does not exist" is the wrong answer to give about a ticket
 * that does. RLS is what confines it to the tenant; there is no company
 * predicate here for the same reason there is none in the rest of this file.
 */
export async function getWeighbridgeTicketById(tx: Tx, ticketId: string) {
  if (!isUuid(ticketId)) return null;
  const [ticket] = await tx
    .select()
    .from(weighbridgeTickets)
    .where(eq(weighbridgeTickets.id, ticketId));
  return ticket ?? null;
}

/**
 * The integrations dashboard's weighbridge tiles.
 *
 * Counted in SQL rather than by grouping and reducing in JavaScript, which is
 * what the Mongo aggregation did. `net_weight` is numeric(19,4) and crosses
 * this boundary as a STRING, so `stats.reduce((a, s) => a + s.totalNet, 0)`
 * concatenates — the same failure documented at REQUEST_TOTALS above, and the
 * reason `total_net_kg` is summed and cast here.
 *
 * `pending` folds `first_recorded` in with `pending`: both mean a truck that
 * has been weighed once and is still on site, which is the thing the tile is
 * telling someone about.
 */
export async function getWeighbridgeStats(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT
      count(*)::int                                                  AS total,
      count(*) FILTER (WHERE status = 'completed')::int              AS completed,
      count(*) FILTER (WHERE status IN ('pending', 'first_recorded'))::int
                                                                     AS pending,
      count(*) FILTER (WHERE status = 'voided')::int                 AS voided,
      COALESCE(SUM(net_weight) FILTER (WHERE status = 'completed'), 0)::float8
                                                                     AS total_net_kg
    FROM weighbridge_tickets
  `)) as unknown as Array<Record<string, number>>;
  const r = rows[0] ?? {};
  return {
    total: Number(r.total ?? 0),
    completed: Number(r.completed ?? 0),
    pending: Number(r.pending ?? 0),
    voided: Number(r.voided ?? 0),
    totalNetKg: Number(r.total_net_kg ?? 0),
  };
}

/**
 * The API's ticket list: filtered, paged, and counted in one pass.
 *
 * `COUNT(*) OVER ()` rather than a second `countDocuments` query, which is
 * what the Mongo route ran alongside the find. Two queries against a moving
 * table can disagree — a ticket created between them makes `total` inconsistent
 * with the page — and it doubles the work for a number that is a by-product of
 * the scan the first query already did.
 *
 * `vehicle_reg` matches case-insensitively on a substring, as the Mongo route's
 * `new RegExp(vehicleReg, "i")` did. Note what that means and did not say: an
 * operator searching "KBZ 123A" gets it, but so does a caller passing `.*`,
 * because Mongo compiled the parameter AS A REGULAR EXPRESSION. Here it is a
 * bound parameter to ILIKE with its wildcards escaped, so it is a search
 * string and nothing else.
 */
export async function searchWeighbridgeTicketsForApi(
  tx: Tx,
  opts: {
    status?: string;
    transactionType?: string;
    vehicleReg?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  const rows = (await tx.execute(sql`
    SELECT *, COUNT(*) OVER ()::int AS full_count
      FROM weighbridge_tickets
     WHERE TRUE
       ${opts.status ? sql`AND status = ${opts.status}::wb_status` : sql``}
       ${
         opts.transactionType
           ? sql`AND transaction_type = ${opts.transactionType}::wb_transaction_type`
           : sql``
       }
       ${
         opts.vehicleReg
           ? sql`AND vehicle_reg ILIKE ${likeContains(opts.vehicleReg)}`
           : sql``
       }
     ORDER BY created_at DESC
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Record<string, unknown>[];

  return {
    rows,
    total: rows.length ? Number(rows[0].full_count) : 0,
    limit,
    offset,
  };
}
