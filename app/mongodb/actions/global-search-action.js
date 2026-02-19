"use server";

import dbConnect from "@/app/config/dbConnect";
import Product from "@/app/models/product";
import Invoice from "@/app/models/invoice";
import Quote from "@/app/models/quote";
import Bill from "@/app/models/bill";
import Party from "@/app/models/parties";
import EmployeeClaim from "@/app/models/employeesClaims";
import { StockRequest } from "@/app/models/requests";
import Project from "@/app/models/project";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import { sanitizeSearchTerm } from "@/lib/utils/sanitize";

const LIMIT = 4;

export async function globalSearch(searchTerm) {
  if (!searchTerm || searchTerm.trim().length < 2) {
    return {
      products: [],
      invoices: [],
      quotes: [],
      bills: [],
      customers: [],
      suppliers: [],
      claims: [],
      stockRequests: [],
      projects: [],
    };
  }

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const safe = sanitizeSearchTerm(searchTerm);
  const regex = { $regex: safe, $options: "i" };

  const [products, invoices, quotes, bills, customers, suppliers, claims, stockRequests, projects] =
    await Promise.all([
      // Products: name + SKU
      Product.find(
        withTenantScope(
          { $or: [{ name: regex }, { SKU: regex }] },
          companyId,
          isSuperAdmin
        )
      )
        .select("name SKU inventory.quantityOnHand pricing.sellingPrice")
        .limit(LIMIT)
        .lean(),

      // Invoices: invoiceNumber + customer.name
      Invoice.find(
        withTenantScope(
          {
            $or: [{ invoiceNumber: regex }, { "customer.name": regex }],
          },
          companyId,
          isSuperAdmin
        )
      )
        .select("invoiceNumber customer.name total status invoiceDate")
        .sort({ createdAt: -1 })
        .limit(LIMIT)
        .lean(),

      // Quotes: quoteNumber + customer.name
      Quote.find(
        withTenantScope(
          {
            $or: [{ quoteNumber: regex }, { "customer.name": regex }],
          },
          companyId,
          isSuperAdmin
        )
      )
        .select("quoteNumber customer.name total status quoteDate")
        .sort({ createdAt: -1 })
        .limit(LIMIT)
        .lean(),

      // Bills: billNumber + supplier.name
      Bill.find(
        withTenantScope(
          {
            $or: [{ billNumber: regex }, { "supplier.name": regex }],
          },
          companyId,
          isSuperAdmin
        )
      )
        .select("billNumber supplier.name amounts.total status billDate")
        .sort({ createdAt: -1 })
        .limit(LIMIT)
        .lean(),

      // Customers
      Party.find(
        withTenantScope(
          {
            type: { $in: ["customer", "both"] },
            isActive: true,
            $or: [{ name: regex }, { displayName: regex }, { email: regex }],
          },
          companyId,
          isSuperAdmin
        )
      )
        .select("name displayName email phone")
        .limit(LIMIT)
        .lean(),

      // Suppliers
      Party.find(
        withTenantScope(
          {
            type: { $in: ["supplier", "both"] },
            isActive: true,
            $or: [{ name: regex }, { displayName: regex }, { email: regex }],
          },
          companyId,
          isSuperAdmin
        )
      )
        .select("name displayName email phone")
        .limit(LIMIT)
        .lean(),

      // Claims: claimNumber + employee.name
      EmployeeClaim.find(
        withTenantScope(
          {
            $or: [
              { claimNumber: regex },
              { "employee.name": regex },
            ],
          },
          companyId,
          isSuperAdmin
        )
      )
        .select("claimNumber employee.name claimType totalAmount status")
        .sort({ createdAt: -1 })
        .limit(LIMIT)
        .lean(),

      // Stock Requests: requestNumber + requester.name
      StockRequest.find(
        withTenantScope(
          {
            $or: [
              { requestNumber: regex },
              { "requester.name": regex },
            ],
          },
          companyId,
          isSuperAdmin
        )
      )
        .select("requestNumber requester.name requester.department status priority totalValue")
        .sort({ createdAt: -1 })
        .limit(LIMIT)
        .lean(),

      // Projects: projectNumber + name + client.name
      Project.find(
        withTenantScope(
          {
            $or: [
              { projectNumber: regex },
              { name: regex },
              { "client.name": regex },
            ],
          },
          companyId,
          isSuperAdmin
        )
      )
        .select("projectNumber name client.name status budget.amount")
        .sort({ createdAt: -1 })
        .limit(LIMIT)
        .lean(),
    ]);

  return JSON.parse(
    JSON.stringify({ products, invoices, quotes, bills, customers, suppliers, claims, stockRequests, projects })
  );
}
