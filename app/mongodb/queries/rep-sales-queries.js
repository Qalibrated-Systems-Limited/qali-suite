import "server-only";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  buildTenantMatch,
} from "@/lib/utils/tenant-utils";
import Invoice from "@/app/models/invoice";

// ============================================
// SALES BY REP — billed-basis attribution report
// ============================================
// Groups sent/completed invoices by salesPerson.employeeId for a month
// (or all time). Invoices with no salesPerson land in an explicit
// "Unattributed" bucket — silent drops would make the report lie.
// Matches the (companyId, salesPerson.employeeId, status, invoiceDate)
// index.

export const cSalesByRep = cache(async (year = null, month = null) => {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const match = {
      ...buildTenantMatch(companyId, isSuperAdmin),
      status: { $in: ["sent", "completed"] },
    };
    if (year && month) {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);
      match.invoiceDate = { $gte: start, $lt: end };
    }

    const rows = await Invoice.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$salesPerson.employeeId",
          name: { $last: "$salesPerson.name" },
          invoices: { $sum: 1 },
          revenue: { $sum: "$total" },
          collected: { $sum: "$amountPaid" },
          outstanding: { $sum: "$amountDue" },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 100 },
    ]);

    return rows.map((r) => ({
      employeeId: r._id ? r._id.toString() : null,
      name: r._id ? r.name || "Unknown rep" : "Unattributed",
      invoices: r.invoices,
      revenue: r.revenue || 0,
      collected: r.collected || 0,
      outstanding: r.outstanding || 0,
    }));
  } catch (error) {
    console.error("cSalesByRep error:", error);
    return [];
  }
});

/**
 * Invoices for ONE rep (the filtered drill-down), capped + projected.
 */
export const cRepInvoices = cache(async (employeeId, year = null, month = null) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(employeeId)) return [];
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const match = {
      ...buildTenantMatch(companyId, isSuperAdmin),
      "salesPerson.employeeId": new mongoose.Types.ObjectId(employeeId),
      status: { $in: ["sent", "completed"] },
    };
    if (year && month) {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);
      match.invoiceDate = { $gte: start, $lt: end };
    }

    const rows = await Invoice.find(match)
      .select("invoiceNumber customer.name invoiceDate total amountPaid amountDue paymentStatus")
      .sort({ invoiceDate: -1 })
      .limit(100)
      .lean();

    return rows.map((r) => ({
      _id: r._id.toString(),
      invoiceNumber: r.invoiceNumber,
      customer: r.customer?.name || "",
      invoiceDate: r.invoiceDate?.toISOString?.() ?? null,
      total: r.total || 0,
      amountPaid: r.amountPaid || 0,
      amountDue: r.amountDue || 0,
      paymentStatus: r.paymentStatus,
    }));
  } catch (error) {
    console.error("cRepInvoices error:", error);
    return [];
  }
});
