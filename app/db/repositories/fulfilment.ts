import { and, desc, eq, sql } from "drizzle-orm";
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
  approvals: Array<{ itemId: string; approvedQuantity: string }>,
  opts: { approvedById: string; approverName: string; comments?: string | null },
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
      .set({ approvedQuantity: a.approvedQuantity })
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

  if (settled) {
    const [closed] = await tx
      .update(itemCheckouts)
      .set({ status: "returned", updatedAt: new Date() })
      .where(eq(itemCheckouts.id, checkoutId))
      .returning();
    return closed;
  }

  return updated;
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
export async function getOutstandingCheckouts(tx: Tx, limit = 100) {
  return tx.execute(sql`
    SELECT checkout_id, checkout_number, product_name_at_checkout,
           checked_out_to_name_at_checkout, quantity, quantity_outstanding,
           expected_return_date, days_overdue, return_required, return_deadline, status
      FROM outstanding_checkouts
     ORDER BY days_overdue DESC, expected_return_date
     LIMIT ${Math.min(limit, 500)}
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
  },
) {
  let productName: string | null = null;
  let productCode: string | null = null;
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
