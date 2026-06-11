import "server-only";
import mongoose from "mongoose";

import Invoice from "@/app/models/invoice";
import Product from "@/app/models/product";
import User from "@/app/models/user";
import { sendInternalNotificationEmail } from "@/lib/email";
import {
  FINANCE_WRITE_ROLES,
  INVENTORY_WRITE_ROLES,
} from "@/lib/utils/role-gates";

// ============================================
// DAILY ALERT DIGESTS (run from /api/cron/notify-alerts)
// ============================================
// Cross-tenant by design — this runs with no session, so scoping is
// explicit per company. One digest email per tenant per topic per run:
//  - overdue invoices  → finance roles
//  - low stock         → inventory roles
// Digest (not per-document) on purpose: a tenant with 40 overdue invoices
// should get ONE email with a summary, not 40.

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const MAX_RECIPIENTS = 25;
const MAX_LINES = 10; // top N lines listed in the email body

const KES = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

async function recipientsFor(companyId, roles) {
  const users = await User.find({
    companyId,
    role: { $in: roles },
    status: "Active",
  })
    .select("email")
    .limit(MAX_RECIPIENTS)
    .lean();
  return users.map((u) => u.email).filter(Boolean);
}

/**
 * Overdue invoices, grouped per tenant. Uses the
 * (companyId, paymentStatus, dueDate) index per group.
 */
export async function sendOverdueInvoiceDigests() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // One aggregation across tenants: count + total + top lines per company.
  const groups = await Invoice.aggregate([
    {
      $match: {
        status: { $in: ["sent", "completed"] },
        paymentStatus: { $in: ["unpaid", "partial", "overdue"] },
        dueDate: { $lt: today },
        amountDue: { $gt: 0 },
      },
    },
    { $sort: { dueDate: 1 } },
    {
      $group: {
        _id: "$companyId",
        count: { $sum: 1 },
        total: { $sum: "$amountDue" },
        top: {
          $push: {
            invoiceNumber: "$invoiceNumber",
            customer: "$customer.name",
            amountDue: "$amountDue",
            dueDate: "$dueDate",
          },
        },
      },
    },
    { $project: { count: 1, total: 1, top: { $slice: ["$top", MAX_LINES] } } },
  ]);

  let sent = 0;
  for (const g of groups) {
    const to = await recipientsFor(g._id, FINANCE_WRITE_ROLES);
    if (to.length === 0) continue;

    const rows = g.top.map((inv) => [
      `${inv.invoiceNumber} — ${inv.customer || "Customer"}`,
      KES(inv.amountDue),
    ]);
    if (g.count > g.top.length) {
      rows.push([`…and ${g.count - g.top.length} more`, ""]);
    }

    const res = await sendInternalNotificationEmail({
      to,
      subject: `${g.count} overdue invoice${g.count === 1 ? "" : "s"} — ${KES(g.total)} outstanding`,
      label: "Overdue invoices",
      heading: `${KES(g.total)} is past due across ${g.count} invoice${g.count === 1 ? "" : "s"}`,
      rows,
      ctaUrl: `${APP_URL}/dashboard/invoices?paymentStatus=overdue`,
      ctaLabel: "Review overdue invoices",
    });
    if (res.ok) sent += 1;
  }
  return { companies: groups.length, digestsSent: sent };
}

/**
 * Low-stock products, grouped per tenant. Matches the low-stock compound
 * index (companyId, status, reorderLevel, quantityOnHand).
 */
export async function sendLowStockDigests() {
  const groups = await Product.aggregate([
    {
      $match: {
        status: "active",
        "inventory.reorderLevel": { $gt: 0 },
        $expr: {
          $lte: ["$inventory.quantityOnHand", "$inventory.reorderLevel"],
        },
      },
    },
    { $sort: { "inventory.quantityOnHand": 1 } },
    {
      $group: {
        _id: "$companyId",
        count: { $sum: 1 },
        top: {
          $push: {
            sku: "$SKU",
            name: "$name",
            qty: "$inventory.quantityOnHand",
            reorder: "$inventory.reorderLevel",
          },
        },
      },
    },
    { $project: { count: 1, top: { $slice: ["$top", MAX_LINES] } } },
  ]);

  let sent = 0;
  for (const g of groups) {
    const to = await recipientsFor(g._id, INVENTORY_WRITE_ROLES);
    if (to.length === 0) continue;

    const rows = g.top.map((p) => [
      `${p.sku} — ${p.name}`,
      `${p.qty} on hand (reorder at ${p.reorder})`,
    ]);
    if (g.count > g.top.length) {
      rows.push([`…and ${g.count - g.top.length} more`, ""]);
    }

    const res = await sendInternalNotificationEmail({
      to,
      subject: `${g.count} product${g.count === 1 ? "" : "s"} at or below reorder level`,
      label: "Low stock",
      heading: `${g.count} product${g.count === 1 ? "" : "s"} need${g.count === 1 ? "s" : ""} reordering`,
      rows,
      ctaUrl: `${APP_URL}/dashboard/stocks?filter=low-stock`,
      ctaLabel: "Review stock levels",
    });
    if (res.ok) sent += 1;
  }
  return { companies: groups.length, digestsSent: sent };
}
