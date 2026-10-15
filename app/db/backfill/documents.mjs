/**
 * Backfill steps for the documents that sit on top of the ledger: invoices,
 * bills, payments and allocations, tax transactions, expenses, and HR.
 *
 * Runs inside a company's transaction, after the journal entries (step 7 in
 * backfill.mjs), because every document here links to the entry it posted.
 *
 * DOCUMENTS ARE LINKED, NEVER RE-POSTED. Each Mongo document already has its
 * journal entry, and step 7 copied it. Posting again from the document would
 * double the ledger, so a document is inserted with a pointer to its migrated
 * entry, and that entry is tagged with the document as its source.
 *
 * DERIVED FIGURES ARE LEFT TO THE DATABASE. Bill totals come from the lines
 * (bill_lines_recalc_totals), and the amount paid on an invoice or bill from
 * the allocations (payment_allocations_maintain_*). Where the database's
 * figure differs from what Mongo stored, the row is kept and the difference is
 * written to _migration_rejects with a `variance:` reason, so the cutover gate
 * sees it and somebody explains it.
 *
 * KNOWN SOURCE DEFECTS ARE CORRECTED, NOT COPIED. A tax record whose document
 * was cancelled is not carried (the MongoDB app never removed them), and a
 * draft expense keeps no journal entry (the MongoDB app could leave one behind
 * when posting failed). Both are recorded.
 */

const PAYMENT_TERMS_DAYS = /(\d+)/;

export async function backfillDocuments(ctx) {
  const { db, tx, oldCompanyId, companyUuid, stats, h } = ctx;
  const { mapId, reject, toScaled, toMoney, toDate } = h;

  for (const k of [
    "invoices", "invoiceLines", "bills", "billLines", "payments", "allocations",
    "taxTransactions", "expenses", "departments", "employees", "employmentEvents",
    "leaveTypes", "leaveEntitlements", "attendance", "pettyCashReturns",
    "reversalLinks", "variances",
  ]) {
    stats[k] ??= 0;
  }

  const find = (collection) =>
    db.collection(collection).find({ companyId: oldCompanyId }).toArray().catch(() => []);

  // ── lookups ────────────────────────────────────────────────────────────────
  // An id that maps in _migration_id_map is not proof the row exists: the
  // source row may have been quarantined. Every foreign key goes through one
  // of these, so a reference to a rejected row is caught here with a reason
  // rather than by the database as an opaque violation.
  const exists = async (table, collection, oldId) => {
    if (!oldId) return null;
    const id = await mapId(tx, collection, oldId);
    const [row] = await tx`SELECT 1 AS ok FROM ${tx(table)} WHERE id = ${id}`;
    return row ? id : null;
  };
  const party = (oldId) => exists("parties", "parties", oldId);
  const account = (oldId) => exists("accounts", "accounts", oldId);
  const entry = (oldId) => exists("journal_entries", "journalEntries", oldId);
  const product = (oldId) => exists("products", "products", oldId);

  // Actor columns on some tables are foreign keys to users. A Mongo actor id
  // can name a user who was never migrated (another company's, or deleted),
  // and an audit field is not worth losing the document over.
  const userIds = new Set(
    (await tx`SELECT id FROM users`).map((r) => r.id),
  );
  const actor = (id) => (id && userIds.has(String(id)) ? String(id) : null);

  const ts = (d) => (d ? new Date(d) : null);
  const money = (v) => toMoney(toScaled(v));

  async function variance(collection, oldId, reason, detail) {
    stats.variances++;
    await tx`
      DELETE FROM _migration_rejects
       WHERE collection = ${collection} AND old_object_id = ${String(oldId)}
         AND reason = ${"variance:" + reason}
    `;
    await tx`
      INSERT INTO _migration_rejects (collection, old_object_id, reason, detail)
      VALUES (${collection}, ${String(oldId)}, ${"variance:" + reason}, ${tx.json(detail ?? {})})
    `;
  }

  async function tagSource(entryId, type, id) {
    if (!entryId) return;
    await tx`
      UPDATE journal_entries SET source_type = ${type}, source_id = ${id}
       WHERE id = ${entryId} AND source_type IS NULL
    `;
  }

  // ── journal entries, pass 2: reversal links ────────────────────────────────
  // Step 7 inserts every entry before any can be linked. A reversed original
  // arrives as POSTED with reversed_at set (see a_reversal_nets_to_zero), so
  // it and its reversal both count and net to zero, which the MongoDB reports
  // never did.
  const linked = await db
    .collection("journalentries")
    .find({ companyId: oldCompanyId, $or: [{ reversalEntryId: { $ne: null } }, { originalEntryId: { $ne: null } }] })
    .toArray()
    .catch(() => []);
  for (const e of linked) {
    const id = await entry(e._id);
    if (!id) continue;
    const reversal = e.reversalEntryId ? await entry(e.reversalEntryId) : null;
    const original = e.originalEntryId ? await entry(e.originalEntryId) : null;
    await tx`
      UPDATE journal_entries
         SET reversal_entry_id = COALESCE(${reversal}, reversal_entry_id),
             original_entry_id = COALESCE(${original}, original_entry_id)
       WHERE id = ${id}
    `;
    stats.reversalLinks++;
  }

  // ── invoices + lines ───────────────────────────────────────────────────────
  for (const inv of await find("invoices")) {
    const id = await mapId(tx, "invoices", inv._id);
    const customerId = await party(inv.customer?.id);
    if (!customerId) {
      await reject(tx, stats, "invoices", inv._id, "customer_not_migrated", {
        invoiceNumber: inv.invoiceNumber,
        customer: inv.customer?.name ?? null,
      });
      continue;
    }

    const items = Array.isArray(inv.items) ? inv.items : [];
    const bad = items.find((it) => !(Number(it.quantity) > 0));
    if (bad) {
      await reject(tx, stats, "invoices", inv._id, "line_quantity_not_positive", {
        invoiceNumber: inv.invoiceNumber,
        quantity: bad.quantity ?? null,
      });
      continue;
    }

    const revenueEntryId = await entry(inv.accounting?.revenueJournalEntryId);
    const cogsEntryId = await entry(inv.accounting?.cogsJournalEntryId);
    const terms = PAYMENT_TERMS_DAYS.exec(String(inv.paymentTerms ?? ""));

    try {
      await tx.savepoint(async (sp) => {
        await sp`
          INSERT INTO invoices (
            id, company_id, invoice_number, invoice_date, due_date, customer_id,
            title, notes, subtotal, discount_percentage, discount_total,
            tax_amount, total, currency, payment_terms_days, is_opening_balance,
            status, completed_at, completed_by_id, revenue_entry_id, cogs_entry_id,
            created_by_id, created_by_name, created_at, updated_at
          ) VALUES (
            ${id}, ${companyUuid}, ${inv.invoiceNumber}, ${toDate(inv.invoiceDate)},
            ${toDate(inv.dueDate)}, ${customerId},
            ${inv.title || null}, ${inv.notes || null},
            ${money(inv.subtotal)}, ${String(inv.discountPercentage ?? 0)},
            ${money(inv.totalDiscount)}, ${money(inv.taxAmount)}, ${money(inv.total)},
            ${inv.currency ?? "KES"}, ${terms ? Number(terms[1]) : 30},
            ${inv.isOpeningBalance ?? false},
            ${inv.status ?? "draft"}, ${ts(inv.completedAt)},
            ${inv.completedBy?.id ?? null}, ${revenueEntryId}, ${cogsEntryId},
            ${inv.createdBy?.id ?? null}, ${inv.createdBy?.name ?? null},
            ${ts(inv.createdAt) ?? new Date()}, ${ts(inv.updatedAt) ?? new Date()}
          )
          ON CONFLICT (id) DO NOTHING
        `;

        let n = 0;
        for (const it of items) {
          n++;
          const isProduct = it.itemType === "product" || (!it.itemType && it.product?.id);
          const productId = isProduct ? await product(it.product?.id ?? it.productId) : null;
          if (isProduct && !productId) {
            throw new Error(`line ${n}: product not migrated`);
          }
          const ticketId = it.weighbridgeTicketId
            ? await exists("weighbridge_tickets", "weighbridgeTickets", it.weighbridgeTicketId)
            : null;
          // qty * price - discount + tax, as resolveInvoiceLines computes it,
          // in exact integer units so the total carries no float error.
          const lineTotal =
            Math.round(Number(it.quantity) * toScaled(it.unitPrice)) -
            toScaled(it.discountAmount) +
            toScaled(it.taxAmount);

          await sp`
            INSERT INTO invoice_lines (
              id, company_id, invoice_id, item_type, service_category, product_id,
              line_number, description, unit, quantity, unit_price, unit_cost,
              discount_amount, tax_amount, line_total,
              fulfilment_source, weighbridge_ticket_id
            ) VALUES (
              ${await mapId(sp, "invoiceLines", it._id ?? `${String(inv._id)}#${n}`)},
              ${companyUuid}, ${id}, ${isProduct ? "product" : "service"},
              ${isProduct ? null : (it.serviceCategory ?? "other")}, ${productId},
              ${n}, ${it.description ?? null}, ${it.unit || "pcs"},
              ${String(it.quantity)}, ${money(it.unitPrice)},
              ${money(it.costing?.unitCost)}, ${money(it.discountAmount)},
              ${money(it.taxAmount)}, ${toMoney(lineTotal)},
              ${ticketId ? "weighbridge" : "inventory"}, ${ticketId}
            )
            ON CONFLICT (invoice_id, line_number) DO NOTHING
          `;
        }
        await tagSource(revenueEntryId, "invoice", id);
        await tagSource(cogsEntryId, "invoice", id);
      });
      stats.invoices++;
      stats.invoiceLines += items.length;
    } catch (err) {
      await reject(tx, stats, "invoices", inv._id, "rejected_by_target", {
        invoiceNumber: inv.invoiceNumber,
        error: err.message,
      });
    }
  }

  // ── bills + lines ──────────────────────────────────────────────────────────
  const migratedBills = new Map(); // old id -> { id, status }
  for (const b of await find("bills")) {
    const id = await mapId(tx, "bills", b._id);
    const supplierId = await party(b.supplier?.partyId);
    const lines = Array.isArray(b.lines) ? b.lines : [];

    const refuse = (reason, detail) =>
      reject(tx, stats, "bills", b._id, reason, { billNumber: b.billNumber, ...detail });

    if (!supplierId) { await refuse("supplier_not_migrated", { supplier: b.supplier?.name ?? null }); continue; }
    // bills_have_lines is a DEFERRED constraint: a bill with none would only
    // fail at the company's commit, taking every other row with it.
    if (!lines.length) { await refuse("bill_has_no_lines", {}); continue; }
    if (b.dueDate && b.billDate && toDate(b.dueDate) < toDate(b.billDate)) {
      await refuse("due_before_bill_date", { billDate: toDate(b.billDate), dueDate: toDate(b.dueDate) });
      continue;
    }

    const journalEntryId = await entry(b.accounting?.journalEntryId);

    try {
      await tx.savepoint(async (sp) => {
        await sp`
          INSERT INTO bills (
            id, company_id, bill_number, supplier_invoice_number, bill_date, due_date,
            supplier_id, supplier_name_at_bill, supplier_tax_pin_at_bill,
            supplier_email_at_bill, supplier_phone_at_bill, supplier_address_at_bill,
            wht_applicable, wht_rate, currency, status, is_opening_balance,
            title, reference, description, internal_notes,
            submitted_at, submitted_by_id, submitted_by_name,
            approved_at, approved_by_id, approved_by_name,
            rejected_at, rejected_by_id, rejected_by_name, rejection_reason,
            cancelled_at, cancelled_by_id, cancelled_by_name, cancellation_reason,
            journal_entry_id, inventory_moved, used_grni,
            created_by_id, created_by_name, created_at, updated_at
          ) VALUES (
            ${id}, ${companyUuid}, ${b.billNumber}, ${b.supplierInvoiceNumber || null},
            ${toDate(b.billDate)}, ${toDate(b.dueDate ?? b.billDate)},
            ${supplierId}, ${b.supplier?.name ?? "Unknown supplier"}, ${b.supplier?.taxPin || null},
            ${b.supplier?.email || null}, ${b.supplier?.phone || null}, ${b.supplier?.address || null},
            ${b.whtApplicable ?? false}, ${String(b.whtRate ?? 0)}, ${b.currency ?? "KES"},
            ${b.status ?? "draft"}, ${b.isOpeningBalance ?? false},
            ${b.title || null}, ${b.reference || null}, ${b.description || null}, ${b.internalNotes || null},
            ${ts(b.submittedAt)}, ${b.submittedBy?.id ?? null}, ${b.submittedBy?.name ?? null},
            ${ts(b.approvedAt)}, ${b.approvedBy?.id ?? null}, ${b.approvedBy?.name ?? null},
            ${ts(b.rejectedAt)}, ${b.rejectedBy?.id ?? null}, ${b.rejectedBy?.name ?? null}, ${b.rejectionReason || null},
            ${ts(b.cancelledAt)}, ${b.cancelledBy?.id ?? null}, ${b.cancelledBy?.name ?? null}, ${b.cancellationReason || null},
            ${journalEntryId}, ${b.accounting?.inventoryMoved ?? true}, ${b.accounting?.usedGRNI ?? false},
            ${b.createdBy?.id ?? null}, ${b.createdBy?.name ?? null},
            ${ts(b.createdAt) ?? new Date()}, ${ts(b.updatedAt) ?? new Date()}
          )
          ON CONFLICT (id) DO NOTHING
        `;

        let n = 0;
        for (const l of lines) {
          n++;
          const accountId = await account(l.account?.id);
          if (!accountId) throw new Error(`line ${n}: account not migrated`);
          if (!(Number(l.quantity) > 0)) throw new Error(`line ${n}: quantity not positive`);
          await sp`
            INSERT INTO bill_lines (
              id, company_id, bill_id, line_number, description, product_id,
              account_id, account_code_at_bill, account_name_at_bill, account_type,
              quantity, unit, unit_price, vat_rate, weighbridge_ticket_id
            ) VALUES (
              ${await mapId(sp, "billLines", l._id ?? `${String(b._id)}#${n}`)},
              ${companyUuid}, ${id}, ${n}, ${l.description || "—"},
              ${l.product?.id ? await product(l.product.id) : null},
              ${accountId}, ${l.account?.code ?? ""}, ${l.account?.name ?? ""},
              ${l.account?.type === "asset" ? "asset" : "expense"},
              ${String(l.quantity)}, ${l.unit || "pcs"}, ${money(l.unitPrice)},
              ${String(l.vat?.rate ?? 0)},
              ${l.weighbridgeRef?.ticketId
                ? await exists("weighbridge_tickets", "weighbridgeTickets", l.weighbridgeRef.ticketId)
                : null}
            )
            ON CONFLICT (bill_id, line_number) DO NOTHING
          `;
        }
        await tagSource(journalEntryId, "bill", id);

        // The database recomputes the totals from the lines. Mongo rounded
        // VAT per line; a cent of difference is a real disagreement between
        // the bill and the entry that posted it, so it is surfaced.
        const [pg] = await sp`SELECT subtotal::text, vat_amount::text, wht_amount::text FROM bills WHERE id = ${id}`;
        const want = {
          subtotal: money(b.amounts?.subtotal),
          vat_amount: money(b.amounts?.vat),
          wht_amount: money(b.amounts?.wht),
        };
        if (pg.subtotal !== want.subtotal || pg.vat_amount !== want.vat_amount || pg.wht_amount !== want.wht_amount) {
          await variance("bills", b._id, "totals_recomputed", { billNumber: b.billNumber, mongo: want, postgres: pg });
        }
      });
      migratedBills.set(String(b._id), { id, status: b.status });
      stats.bills++;
      stats.billLines += lines.length;
    } catch (err) {
      await refuse("rejected_by_target", { error: err.message });
    }
  }

  // ── payments + allocations ─────────────────────────────────────────────────
  for (const p of await find("payments")) {
    const id = await mapId(tx, "payments", p._id);
    const partyId = await party(p.party?.partyId ?? p.party?.id);
    const accountId = await account(p.account?.id);
    const refuse = (reason, detail) =>
      reject(tx, stats, "payments", p._id, reason, { paymentNumber: p.paymentNumber, ...detail });

    if (!partyId) { await refuse("party_not_migrated", { party: p.party?.name ?? null }); continue; }
    if (!accountId) { await refuse("account_not_migrated", { account: p.account?.code ?? null }); continue; }
    if (!(Number(p.amount) > 0)) { await refuse("amount_not_positive", { amount: p.amount }); continue; }

    const allocations = (p.allocations ?? []).filter((a) => Number(a.amountAllocated) > 0);
    const journalEntryId = await entry(p.journalEntryId);

    try {
      await tx.savepoint(async (sp) => {
        await sp`
          INSERT INTO payments (
            id, company_id, payment_number, payment_type, payment_date, payment_method,
            amount, currency, party_id, party_name_at_payment, account_id,
            account_code_at_payment, account_name_at_payment, reference, description,
            notes, status, confirmed_at, confirmed_by_id, cancelled_at, cancelled_by_id,
            cancellation_reason, journal_entry_id, created_by_id, created_at, updated_at
          ) VALUES (
            ${id}, ${companyUuid}, ${p.paymentNumber}, ${p.paymentType},
            ${toDate(p.paymentDate)}, ${p.paymentMethod}, ${money(p.amount)},
            ${p.currency ?? "KES"}, ${partyId}, ${p.party?.name ?? "Unknown"},
            ${accountId}, ${p.account?.code ?? ""}, ${p.account?.name ?? ""},
            ${p.reference || null}, ${p.description || null}, ${p.notes || null},
            ${p.status ?? "draft"}, ${ts(p.confirmedAt)}, ${p.confirmedBy?.id ?? null},
            ${ts(p.cancelledAt)}, ${p.cancelledBy?.id ?? null}, ${p.cancellationReason || null},
            ${journalEntryId}, ${p.createdBy?.id ?? null},
            ${ts(p.createdAt) ?? new Date()}, ${ts(p.updatedAt) ?? new Date()}
          )
          ON CONFLICT (id) DO NOTHING
        `;

        let n = 0;
        for (const a of allocations) {
          n++;
          const table = a.documentType === "invoice" ? "invoices" : "bills";
          const docId = await exists(table, table, a.documentId);
          if (!docId) throw new Error(`allocation to ${a.documentType} ${a.documentNumber} whose document was not migrated`);
          await sp`
            INSERT INTO payment_allocations (
              id, company_id, payment_id, document_type, document_id,
              document_number_at_allocation, original_amount, balance_before, amount_allocated
            ) VALUES (
              ${await mapId(sp, "paymentAllocations", a._id ?? `${String(p._id)}#${n}`)},
              ${companyUuid}, ${id}, ${a.documentType}, ${docId}, ${a.documentNumber ?? ""},
              ${money(Math.max(0, Number(a.originalAmount) || 0))},
              ${money(Math.max(0, Number(a.balanceBefore) || 0))},
              ${money(a.amountAllocated)}
            )
            ON CONFLICT (id) DO NOTHING
          `;
        }
        await tagSource(journalEntryId, "payment", id);
      });
      stats.payments++;
      stats.allocations += allocations.length;
    } catch (err) {
      await refuse("rejected_by_target", { error: err.message });
    }
  }

  // ── tax transactions ───────────────────────────────────────────────────────
  for (const t of await find("taxtransactions")) {
    const refuse = (reason, detail) =>
      reject(tx, stats, "taxtransactions", t._id, reason, {
        transactionNumber: t.transactionNumber,
        taxType: t.taxType,
        taxAmount: t.taxAmount,
        ...detail,
      });

    const src = t.sourceDocument ?? {};
    let sourceType = null;
    let sourceId = null;
    if (src.type === "bill") {
      const bill = migratedBills.get(String(src.id));
      if (bill?.status === "cancelled") {
        // The MongoDB app left these behind when a bill was cancelled, which
        // overstated input VAT. Not carried; recorded so the variance against
        // the MongoDB VAT report is explained.
        await refuse("tax_on_cancelled_document", { billNumber: src.number ?? null });
        continue;
      }
      sourceType = "bill";
      sourceId = bill?.id ?? null;
    } else if (src.type === "invoice") {
      sourceType = "invoice";
      sourceId = await exists("invoices", "invoices", src.id);
    } else if (src.type === "journal_entry" || src.type === "expense") {
      sourceType = "journal_entry";
      sourceId = await entry(src.journalEntryId ?? src.id);
    }
    if (!sourceId) { await refuse("source_document_not_migrated", { source: src.type ?? null, number: src.number ?? null }); continue; }

    const partyId = await party(t.party?.id);
    if (!partyId) { await refuse("party_not_migrated", { party: t.party?.name ?? null }); continue; }
    const accountId = await account(t.accountId);
    if (!accountId) { await refuse("account_not_migrated", { account: t.accountCode ?? null }); continue; }

    const kra = t.kraTracking ?? {};
    try {
      await tx.savepoint(async (sp) => {
        await sp`
          INSERT INTO tax_transactions (
            id, company_id, transaction_number, transaction_date, tax_type, tax_code,
            tax_rate, base_amount, tax_amount, total_amount, currency,
            party_id, party_type, party_name_at_transaction, party_tax_pin_at_transaction,
            party_email_at_transaction, party_phone_at_transaction,
            source_document_type, source_document_id, source_document_number, source_document_date,
            filing_period, filed, remitted, certificate_issued, reconciled,
            journal_entry_id, account_id, account_code_at_transaction, account_name_at_transaction,
            description, created_by_id, created_at, updated_at
          ) VALUES (
            ${await mapId(sp, "taxTransactions", t._id)}, ${companyUuid},
            ${t.transactionNumber}, ${toDate(t.transactionDate)}, ${t.taxType},
            ${t.taxCode ?? `VAT-${t.taxRate ?? 0}`}, ${String(t.taxRate ?? 0)},
            ${money(t.baseAmount)}, ${money(t.taxAmount)}, ${money(t.totalAmount)},
            ${t.currency ?? "KES"},
            ${partyId}, ${t.party?.type ?? "other"}, ${t.party?.name ?? "Unknown"},
            ${t.party?.taxPin || null}, ${t.party?.email || null}, ${t.party?.phone || null},
            ${sourceType}, ${sourceId}, ${src.number ?? null}, ${toDate(src.date)},
            ${kra.filingPeriod ?? toDate(t.transactionDate)?.slice(0, 7)},
            ${kra.filed ?? false}, ${kra.remitted ?? false},
            ${kra.certificateIssued ?? false}, ${t.reconciliation?.reconciled ?? false},
            ${await entry(t.journalEntryId)}, ${accountId},
            ${t.accountCode ?? ""}, ${t.accountName ?? ""},
            ${t.description || null}, ${t.createdBy?.id ?? null},
            ${ts(t.createdAt) ?? new Date()}, ${ts(t.updatedAt) ?? new Date()}
          )
          ON CONFLICT (id) DO NOTHING
        `;
      });
      stats.taxTransactions++;
    } catch (err) {
      await refuse("rejected_by_target", { error: err.message });
    }
  }

  // ── expenses ───────────────────────────────────────────────────────────────
  for (const e of await find("expenses")) {
    const id = await mapId(tx, "expenses", e._id);
    const refuse = (reason, detail) =>
      reject(tx, stats, "expenses", e._id, reason, { expenseNumber: e.expenseNumber, ...detail });

    const accountId = await account(e.accountId);
    if (!accountId) { await refuse("account_not_migrated", { account: e.accountCode ?? null }); continue; }
    if (!(Number(e.amount) > 0)) { await refuse("amount_not_positive", { amount: e.amount }); continue; }

    const isDraft = (e.status ?? "draft") === "draft";
    // Mongo stores "unpaid" as a payment method; Postgres stores no method,
    // and the three payment columns are set together or not at all.
    const method = e.paymentMethod && e.paymentMethod !== "unpaid" ? e.paymentMethod : null;
    const paidFrom = method ? await account(e.paidFrom) : null;
    const paid = Boolean(method && paidFrom);

    let journalEntryId = isDraft ? null : await entry(e.journalEntryId);
    if (!isDraft && !journalEntryId) {
      await refuse("posted_without_entry", { status: e.status });
      continue;
    }
    if (isDraft && e.journalEntryId) {
      // Posting failed in the MongoDB app after the entry was created, so the
      // entry stayed as a draft beside a draft expense. Neither reached the
      // books; the expense comes across as a draft to be posted again.
      await variance("expenses", e._id, "draft_with_orphan_entry", {
        expenseNumber: e.expenseNumber,
        withholdingTax: e.withholdingTax ?? 0,
      });
    }

    try {
      await tx.savepoint(async (sp) => {
        await sp`
          INSERT INTO expenses (
            id, company_id, expense_number, expense_date, category, account_id,
            account_code_at_expense, account_name_at_expense, amount, tax_amount,
            tax_rate, withholding_tax, currency, payment_method, paid_from_account_id,
            paid_at, payee_party_id, payee_type, payee_name_at_expense,
            payee_phone_at_expense, payee_email_at_expense, payee_tax_pin_at_expense,
            description, reference, supplier_invoice_number, notes, is_reimbursable,
            status, journal_entry_id, clearing_journal_entry_id, posted_at, posted_by_id,
            created_by_id, created_at, updated_at
          ) VALUES (
            ${id}, ${companyUuid}, ${e.expenseNumber}, ${toDate(e.expenseDate)},
            ${e.category ?? "other"}, ${accountId},
            ${e.accountCode ?? ""}, ${e.accountName ?? ""},
            ${money(e.amount)}, ${money(e.taxAmount)}, ${String(e.taxRate ?? 0)},
            ${money(e.withholdingTax)}, ${e.currency ?? "KES"},
            ${paid ? method : null}, ${paid ? paidFrom : null},
            ${paid ? (ts(e.paidAt) ?? ts(e.expenseDate)) : null},
            ${await party(e.vendor?.id)}, ${e.vendor?.partyType ?? "supplier"},
            ${e.vendor?.name || "Unknown payee"}, ${e.vendor?.phone || null},
            ${e.vendor?.email || null}, ${e.vendor?.taxPin || null},
            ${e.description || e.category || "Expense"}, ${e.reference || null},
            ${e.invoiceNumber || null}, ${e.notes || null}, ${e.isReimbursable ?? false},
            ${e.status ?? "draft"}, ${journalEntryId},
            ${paid ? await entry(e.clearingJournalEntryId) : null},
            ${isDraft ? null : ts(e.postedAt)}, ${actor(e.postedBy?.id)},
            ${actor(e.createdBy?.id)},
            ${ts(e.createdAt) ?? new Date()}, ${ts(e.updatedAt) ?? new Date()}
          )
          ON CONFLICT (id) DO NOTHING
        `;
        await tagSource(journalEntryId, "expense", id);
      });
      stats.expenses++;
    } catch (err) {
      await refuse("rejected_by_target", { error: err.message });
    }
    journalEntryId = null;
  }

  await backfillHr(ctx, { exists, party, actor, ts, money, variance });
  await seedCounters(tx, companyUuid);
}

// ─────────────────────────────────────────────────────────────────────────────
// HR
// ─────────────────────────────────────────────────────────────────────────────

async function backfillHr(ctx, util) {
  const { db, tx, oldCompanyId, companyUuid, stats, h } = ctx;
  const { mapId, reject, toDate } = h;
  const { exists, party, actor, ts, money, variance } = util;
  const find = (collection) =>
    db.collection(collection).find({ companyId: oldCompanyId }).toArray().catch(() => []);

  // Departments. Code and name are each unique per company; a department the
  // company already has under that code is reused rather than duplicated.
  for (const d of await find("departments")) {
    const id = await mapId(tx, "departments", d._id);
    try {
      await tx.savepoint(async (sp) => {
        await sp`
          INSERT INTO departments (id, company_id, code, name, description, is_active,
                                   created_by_id, created_by_name, created_at, updated_at)
          VALUES (${id}, ${companyUuid}, ${String(d.code ?? d.name).toUpperCase()}, ${d.name},
                  ${d.description || null}, ${d.isActive ?? true},
                  ${d.createdBy?.id ?? null}, ${d.createdBy?.name ?? null},
                  ${ts(d.createdAt) ?? new Date()}, ${ts(d.updatedAt) ?? new Date()})
          ON CONFLICT (id) DO NOTHING
        `;
      });
      stats.departments++;
    } catch (err) {
      await reject(tx, stats, "departments", d._id, "rejected_by_target", { name: d.name, error: err.message });
    }
  }

  // Leave types. A company may already have the defaults; the code is the
  // key, so an existing type is updated to the source's settings and mapped.
  const leaveTypeByCode = new Map();
  for (const lt of await find("leavetypes")) {
    const code = String(lt.code).toLowerCase();
    const [row] = await tx`
      INSERT INTO leave_types (id, company_id, code, name, default_entitlement, max_carry_over,
                               is_paid, requires_document, applicable_gender, is_active,
                               is_default, sort_order, created_at, updated_at)
      VALUES (${await mapId(tx, "leaveTypes", lt._id)}, ${companyUuid}, ${code}, ${lt.name},
              ${String(lt.defaultEntitlement ?? 0)}, ${String(lt.maxCarryOver ?? 0)},
              ${lt.paidLeave ?? true}, ${lt.requiresDocument ?? false},
              ${lt.applicableGender ?? "all"}, ${lt.isActive ?? true}, ${lt.isDefault ?? false},
              ${lt.sortOrder ?? 0}, ${ts(lt.createdAt) ?? new Date()}, ${ts(lt.updatedAt) ?? new Date()})
      ON CONFLICT (company_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        default_entitlement = EXCLUDED.default_entitlement,
        max_carry_over = EXCLUDED.max_carry_over,
        is_paid = EXCLUDED.is_paid,
        requires_document = EXCLUDED.requires_document,
        applicable_gender = EXCLUDED.applicable_gender,
        is_active = EXCLUDED.is_active,
        updated_at = now()
      RETURNING id
    `;
    leaveTypeByCode.set(code, row.id);
    stats.leaveTypes++;
  }

  // Employees, pass 1. The party is the person and must exist; manager links
  // are pass 2, once every employee row is in.
  const profiles = await find("employeeprofiles");
  for (const pr of profiles) {
    const id = await mapId(tx, "employees", pr._id);
    const pi = pr.personalInfo ?? {};
    const em = pr.employment ?? {};
    const cp = pr.compensation ?? {};
    const al = cp.allowances ?? {};
    const ec = pr.emergencyContact ?? {};
    const refuse = (reason, detail) =>
      reject(tx, stats, "employeeprofiles", pr._id, reason, { employeeNumber: pr.employeeNumber, ...detail });

    const partyId = await party(pr.partyId);
    if (!partyId) { await refuse("party_not_migrated", {}); continue; }
    // 0120: payroll cannot remit PAYE without a PIN, and NSSF, SHA and the
    // bank match on the ID. Refused here with a reason, not by the CHECK.
    if (!String(pi.kraPin ?? "").trim()) { await refuse("missing_kra_pin", {}); continue; }
    if (!String(pi.nationalId ?? "").trim() && !String(pi.passportNumber ?? "").trim()) {
      await refuse("missing_identity_document", {});
      continue;
    }

    try {
      await tx.savepoint(async (sp) => {
        await sp`
          INSERT INTO employees (
            id, company_id, party_id, user_id, employee_number, first_name, last_name,
            date_of_birth, gender, national_id, kra_pin, nssf_number, sha_number,
            passport_number, nationality, department_id, designation, employment_type,
            status, hire_date, confirmation_date, termination_date, termination_reason,
            contract_start, contract_end, contract_type, work_location, job_grade,
            shift_start, shift_end, basic_salary, currency, allowance_housing,
            allowance_transport, allowance_medical, allowance_other, payment_method,
            bank_name, bank_account, bank_branch, mpesa_number,
            emergency_name, emergency_relationship, emergency_phone, emergency_alternate_phone,
            notes, created_by_id, created_by_name, created_at, updated_at
          ) VALUES (
            ${id}, ${companyUuid}, ${partyId}, ${actor(pr.userId)}, ${pr.employeeNumber},
            ${pi.firstName ?? ""}, ${pi.lastName ?? ""}, ${toDate(pi.dateOfBirth)},
            ${pi.gender ?? null}, ${pi.nationalId || null}, ${String(pi.kraPin).toUpperCase()},
            ${pi.nssfNumber || null}, ${pi.shaNumber ?? pi.nhifNumber ?? null},
            ${pi.passportNumber || null}, ${pi.nationality ?? "Kenyan"},
            ${em.departmentId ? await exists("departments", "departments", em.departmentId) : null},
            ${em.designation || null}, ${em.employmentType ?? "full_time"},
            ${em.status ?? "probation"}, ${toDate(em.hireDate ?? pr.createdAt)},
            ${toDate(em.confirmationDate)}, ${toDate(em.terminationDate)}, ${em.terminationReason || null},
            ${toDate(em.contractStart)}, ${toDate(em.contractEnd)}, ${em.contractType || null},
            ${em.workLocation || null}, ${em.jobGrade || null},
            ${em.shiftStart || null}, ${em.shiftEnd || null},
            ${money(cp.basicSalary)}, ${cp.currency ?? "KES"},
            ${money(al.housing)}, ${money(al.transport)}, ${money(al.medical)}, ${money(al.other)},
            ${cp.paymentMethod ?? "bank"}, ${cp.bankName || null}, ${cp.bankAccount || null},
            ${cp.bankBranch || null}, ${cp.mpesaNumber || null},
            ${ec.name || null}, ${ec.relationship || null}, ${ec.phone || null}, ${ec.alternatePhone || null},
            ${pr.notes || null}, ${pr.createdBy?.id ?? null}, ${pr.createdBy?.name ?? null},
            ${ts(pr.createdAt) ?? new Date()}, ${ts(pr.updatedAt) ?? new Date()}
          )
          ON CONFLICT (id) DO NOTHING
        `;

        // Leave balances were embedded on the profile; here they are
        // entitlements per type and year. Days USED are derived from leave
        // requests in Postgres, so a balance whose used days had no request
        // behind it is surfaced rather than silently restored to full.
        for (const lb of pr.leaveBalances ?? []) {
          const leaveTypeId = leaveTypeByCode.get(String(lb.leaveType).toLowerCase());
          if (!leaveTypeId || !lb.year) continue;
          await sp`
            INSERT INTO leave_entitlements (company_id, employee_id, leave_type_id, year,
                                            entitled_days, carry_over_days)
            VALUES (${companyUuid}, ${id}, ${leaveTypeId}, ${lb.year},
                    ${String(lb.entitledDays ?? 0)}, ${String(lb.carryOver ?? 0)})
            ON CONFLICT (company_id, employee_id, leave_type_id, year) DO NOTHING
          `;
          stats.leaveEntitlements++;
          if (Number(lb.usedDays) > 0 || Number(lb.pendingDays) > 0) {
            await variance("employeeprofiles", pr._id, `leave_used_without_requests_${lb.leaveType}_${lb.year}`, {
              employeeNumber: pr.employeeNumber, usedDays: lb.usedDays ?? 0, pendingDays: lb.pendingDays ?? 0,
            });
          }
        }
      });
      stats.employees++;
    } catch (err) {
      await refuse("rejected_by_target", { error: err.message });
    }
  }

  // Employees, pass 2: managers.
  for (const pr of profiles) {
    if (!pr.employment?.managerId) continue;
    const id = await exists("employees", "employees", pr._id);
    const managerId = await exists("employees", "employees", pr.employment.managerId);
    if (!id || !managerId || id === managerId) continue;
    try {
      await tx.savepoint((sp) => sp`UPDATE employees SET manager_id = ${managerId} WHERE id = ${id}`);
    } catch (err) {
      await variance("employeeprofiles", pr._id, "manager_not_linked", { error: err.message });
    }
  }

  for (const ev of await find("employmenthistories")) {
    const employeeId = await exists("employees", "employees", ev.profileId);
    if (!employeeId) {
      await reject(tx, stats, "employmenthistories", ev._id, "employee_not_migrated", { employeeNumber: ev.employeeNumber });
      continue;
    }
    await tx`
      INSERT INTO employment_events (id, company_id, employee_id, event_type, field,
                                     previous_value, new_value, effective_date,
                                     changed_by_id, changed_by_name, created_at)
      VALUES (${await mapId(tx, "employmentEvents", ev._id)}, ${companyUuid}, ${employeeId},
              ${ev.eventType}, ${ev.field || null}, ${ev.previousValue ?? null},
              ${ev.newValue ?? null}, ${toDate(ev.effectiveDate ?? ev.createdAt)},
              ${ev.changedBy?.id ?? null}, ${ev.changedBy?.name ?? null},
              ${ts(ev.createdAt) ?? new Date()})
      ON CONFLICT (id) DO NOTHING
    `;
    stats.employmentEvents++;
  }

  // hours_worked and overtime_hours are GENERATED from check-in and
  // check-out, so they are recomputed rather than carried.
  for (const a of await find("attendance")) {
    const employeeId = await exists("employees", "employees", a.profileId);
    if (!employeeId) {
      await reject(tx, stats, "attendance", a._id, "employee_not_migrated", { employeeNumber: a.employeeNumber });
      continue;
    }
    await tx`
      INSERT INTO attendance (id, company_id, employee_id, work_date, shift, shift_start,
                              standard_hours, check_in, check_out,
                              status, method, ip_address, created_at, updated_at)
      VALUES (${await mapId(tx, "attendance", a._id)}, ${companyUuid}, ${employeeId},
              ${toDate(a.date)}, ${a.shift ?? "morning"}, ${a.shiftStart ?? "08:00"},
              ${String(a.standardHours ?? 8)}, ${ts(a.checkIn)}, ${ts(a.checkOut)},
              ${String(a.status ?? "absent").replace("-", "_")}, ${a.method ?? "web"},
              ${a.ipAddress ?? null}, ${ts(a.createdAt) ?? new Date()}, ${ts(a.updatedAt) ?? new Date()})
      ON CONFLICT (employee_id, work_date) DO NOTHING
    `;
    stats.attendance++;
  }

  // Petty cash returns. Only drafts carry no frozen figures; a submitted or
  // approved return's totals are what was approved, and are carried as such.
  for (const r of await find("pettycashreturns")) {
    const floatId = await exists("accounts", "accounts", r.floatAccountId);
    if (!floatId) {
      await reject(tx, stats, "pettycashreturns", r._id, "float_account_not_migrated", { documentNumber: r.documentNumber });
      continue;
    }
    const frozen = (r.status ?? "draft") !== "draft";
    try {
      await tx.savepoint(async (sp) => {
        await sp`
          INSERT INTO petty_cash_returns (
            id, company_id, document_number, float_account_id, custodian_user_id,
            custodian_name_at_return, period_from, period_to, opening_balance,
            total_debits, total_credits, frozen_at, status, rejection_reason, notes,
            created_at, updated_at
          ) VALUES (
            ${await mapId(sp, "pettyCashReturns", r._id)}, ${companyUuid}, ${r.documentNumber},
            ${floatId}, ${actor(r.custodian?.userId)}, ${r.custodian?.name ?? null},
            ${toDate(r.period?.from)}, ${toDate(r.period?.to)},
            ${frozen ? money(r.openingBalance) : null},
            ${frozen ? money(r.totals?.debits) : null},
            ${frozen ? money(r.totals?.credits) : null},
            ${frozen ? (ts(r.updatedAt) ?? new Date()) : null},
            ${r.status ?? "draft"}, ${r.rejectionReason || null}, ${r.notes || null},
            ${ts(r.createdAt) ?? new Date()}, ${ts(r.updatedAt) ?? new Date()}
          )
          ON CONFLICT (id) DO NOTHING
        `;
      });
      stats.pettyCashReturns++;
    } catch (err) {
      await reject(tx, stats, "pettycashreturns", r._id, "rejected_by_target", {
        documentNumber: r.documentNumber, error: err.message,
      });
    }
  }
}

/**
 * Continue numbering after the migrated documents.
 *
 * Postgres numbers documents PREFIX-00001 from entry_counters. Migrated
 * numbers keep their MongoDB format, so they cannot collide, but a company
 * with 46 invoices should see its next one numbered 47, not 1.
 */
async function seedCounters(tx, companyUuid) {
  const counts = [
    [sqlPrefix(tx, companyUuid, "invoice"), tx`SELECT count(*)::int AS n FROM invoices`],
    [sqlPrefix(tx, companyUuid, "bill"), tx`SELECT count(*)::int AS n FROM bills`],
    ["PMT", tx`SELECT count(*)::int AS n FROM payments WHERE payment_type = 'made'`],
    ["RCP", tx`SELECT count(*)::int AS n FROM payments WHERE payment_type = 'received'`],
    ["EXP", tx`SELECT count(*)::int AS n FROM expenses`],
    ["EMP", tx`SELECT count(*)::int AS n FROM employees`],
  ];
  for (const [prefixQuery, countQuery] of counts) {
    const prefix = typeof prefixQuery === "string" ? prefixQuery : (await prefixQuery)[0].p;
    const [{ n }] = await countQuery;
    if (!n) continue;
    await tx`
      INSERT INTO entry_counters (company_id, prefix, last_value)
      VALUES (${companyUuid}, ${prefix}, ${n})
      ON CONFLICT (company_id, prefix)
      DO UPDATE SET last_value = GREATEST(entry_counters.last_value, EXCLUDED.last_value)
    `;
  }
}

const sqlPrefix = (tx, companyUuid, kind) =>
  tx`SELECT document_prefix(${companyUuid}::uuid, ${kind}) AS p`;
