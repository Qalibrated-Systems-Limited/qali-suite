import dbConnect from "../../config/dbConnect";
import PurchaseOrder from "../../models/purchaseOrder";
import Party from "../../models/parties";
import Product from "../../models/product";
import Account from "../../models/account";
import GoodsReceipt from "../../models/goodsReceipt";
import { serializeBsonType } from "@/lib/utils";
import {
  getTenantContext,
  withTenantScope,
  buildTenantMatch,
} from "@/lib/utils/tenant-utils";

// ============================================
// FETCH ACTIVE SUPPLIERS
// ============================================
export const fetchActiveSuppliers = async () => {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const suppliers = await Party.find(
    withTenantScope(
      {
        type: { $in: ["supplier", "both"] },
        isActive: true,
      },
      companyId,
      isSuperAdmin
    )
  )
    .sort({ name: 1 })
    .lean();

  // Format address helper
  const formatAddress = (address) => {
    if (!address) return "";
    const parts = [
      address.line1,
      address.line2,
      address.city,
      address.postalCode,
      address.country,
    ].filter(Boolean);
    return parts.join(", ");
  };

  return suppliers.map((supplier) => ({
    _id: supplier._id.toString(),
    name: supplier.displayName || supplier.name,
    email: supplier.email || "",
    phone: supplier.phone || "",
    address: formatAddress(supplier.address),
    taxPin: supplier.taxPin || "",
    // WHT settings
    whtApplicable: supplier.whtApplicable || false,
    whtRate: supplier.whtRate || 0,
    // Payment terms
    paymentTerms: supplier.paymentTerms || 30,
  }));
};

// ============================================
// FETCH ALL PRODUCTS (For PO - all products, not just in stock)
// ============================================
export const fetchAllProducts = async () => {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const products = await Product.find(
    withTenantScope({ status: "active" }, companyId, isSuperAdmin)
  )
    .sort({ name: 1 })
    .lean();

  return products.map((product) => ({
    _id: product._id.toString(),
    name: product.name,
    SKU: product.SKU,
    unit: product.unit,
    category: product.category,
    // Costing & pricing
    costPrice: product.costing?.costPrice ?? 0,
    lastPurchaseCost: product.costing?.lastPurchaseCost ?? 0,
    sellingPrice: product.pricing?.sellingPrice ?? 0,
    // Current inventory (for reference)
    quantityOnHand: product.inventory?.quantityOnHand ?? 0,
    reorderLevel: product.inventory?.reorderLevel ?? 0,
  }));
};

// ============================================
// FETCH EXPENSE/ASSET ACCOUNTS (For PO lines)
// ============================================
export const fetchPurchaseAccounts = async () => {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find(
    withTenantScope(
      {
        accountType: { $in: ["expense", "asset"] },
        isActive: true,
        canPost: { $ne: false }, // Exclude header accounts
      },
      companyId,
      isSuperAdmin
    )
  )
    .sort({ accountCode: 1 })
    .lean();

  return accounts.map((account) => ({
    _id: account._id.toString(),
    code: account.accountCode,
    name: account.accountName,
    type: account.accountType,
    subType: account.subType,
    // Surfaced so the PO form can auto-pick "Inventory" when a product
    // is selected on a line (systemAccount === "inventory").
    systemAccount: account.systemAccount || null,
    fullName: `${account.accountCode} - ${account.accountName}`,
  }));
};

// ============================================
// SEARCH PURCHASE ORDERS
// ============================================
export const searchPurchaseOrders = async (
  query = "",
  page = 1,
  filters = {}
) => {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  const ITEMS_PER_PAGE = 10;
  const skip = (page - 1) * ITEMS_PER_PAGE;

  // Build query conditions - start with tenant filter
  const conditions = [tenantMatch];

  // Text search
  if (query) {
    conditions.push({
      $or: [
        { poNumber: { $regex: query, $options: "i" } },
        { "supplier.name": { $regex: query, $options: "i" } },
        { "supplier.taxPin": { $regex: query, $options: "i" } },
        { notes: { $regex: query, $options: "i" } },
      ],
    });
  }

  // Status filter
  if (filters.status && filters.status !== "all") {
    conditions.push({ status: filters.status });
  }

  // Supplier filter
  if (filters.supplierId) {
    conditions.push({ "supplier.partyId": filters.supplierId });
  }

  // Date range filter
  if (filters.startDate) {
    conditions.push({ poDate: { $gte: new Date(filters.startDate) } });
  }
  if (filters.endDate) {
    conditions.push({ poDate: { $lte: new Date(filters.endDate) } });
  }

  const matchQuery = { $and: conditions };

  const purchaseOrders = await PurchaseOrder.find(matchQuery)
    .sort({ poDate: -1, createdAt: -1 })
    .skip(skip)
    .limit(ITEMS_PER_PAGE)
    .lean();

  return purchaseOrders.map((po) => serializeBsonType(po));
};

// ============================================
// FETCH PURCHASE ORDER PAGES (For pagination)
// ============================================
export const fetchPurchaseOrderPages = async (query = "", filters = {}) => {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  const ITEMS_PER_PAGE = 10;

  // Build query conditions - start with tenant filter
  const conditions = [tenantMatch];

  if (query) {
    conditions.push({
      $or: [
        { poNumber: { $regex: query, $options: "i" } },
        { "supplier.name": { $regex: query, $options: "i" } },
        { "supplier.taxPin": { $regex: query, $options: "i" } },
        { notes: { $regex: query, $options: "i" } },
      ],
    });
  }

  if (filters.status && filters.status !== "all") {
    conditions.push({ status: filters.status });
  }

  if (filters.supplierId) {
    conditions.push({ "supplier.partyId": filters.supplierId });
  }

  if (filters.startDate) {
    conditions.push({ poDate: { $gte: new Date(filters.startDate) } });
  }
  if (filters.endDate) {
    conditions.push({ poDate: { $lte: new Date(filters.endDate) } });
  }

  const matchQuery = { $and: conditions };

  const count = await PurchaseOrder.countDocuments(matchQuery);
  return Math.ceil(count / ITEMS_PER_PAGE);
};

// ============================================
// GET PURCHASE ORDER BY ID
// ============================================
export const getPurchaseOrderById = async (id) => {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const po = await PurchaseOrder.findOne(
    withTenantScope({ _id: id }, companyId, isSuperAdmin)
  ).lean();

  if (!po) return null;

  return serializeBsonType(po);
};

// ============================================
// GET PURCHASE ORDER STATS
// ============================================
export const getPurchaseOrderStats = async (filters = {}) => {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  // Build base query - start with tenant filter
  const conditions = [tenantMatch];

  if (filters.startDate) {
    conditions.push({ poDate: { $gte: new Date(filters.startDate) } });
  }
  if (filters.endDate) {
    conditions.push({ poDate: { $lte: new Date(filters.endDate) } });
  }

  const baseMatch = { $and: conditions };

  const stats = await PurchaseOrder.aggregate([
    { $match: baseMatch },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalValue: { $sum: "$amounts.total" },
      },
    },
  ]);

  // Transform to object
  const result = {
    total: 0,
    totalValue: 0,
    draft: 0,
    draftValue: 0,
    sent: 0,
    sentValue: 0,
    confirmed: 0,
    confirmedValue: 0,
    partial: 0,
    partialValue: 0,
    received: 0,
    receivedValue: 0,
    cancelled: 0,
    cancelledValue: 0,
    expired: 0,
    expiredValue: 0,
  };

  for (const stat of stats) {
    result.total += stat.count;
    result.totalValue += stat.totalValue || 0;
    result[stat._id] = stat.count;
    result[`${stat._id}Value`] = stat.totalValue || 0;
  }

  // Calculate open (draft + sent + confirmed + partial)
  result.open = result.draft + result.sent + result.confirmed + result.partial;
  result.openValue =
    result.draftValue +
    result.sentValue +
    result.confirmedValue +
    result.partialValue;

  return result;
};

// ============================================
// GET OPEN PURCHASE ORDERS (For receiving)
// ============================================
export const getOpenPurchaseOrders = async (supplierId = null) => {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  let query = {
    status: { $in: ["sent", "confirmed", "partial"] },
  };

  if (supplierId) {
    query["supplier.partyId"] = supplierId;
  }

  // Apply tenant scoping
  query = withTenantScope(query, companyId, isSuperAdmin);

  const pos = await PurchaseOrder.find(query)
    .sort({ expectedDeliveryDate: 1, poDate: -1 })
    .lean();

  // In-flight GRNs (draft / pending_acceptance) have already reserved
  // units against these POs but haven't bumped PO.lines.receivedQuantity
  // yet (that only happens on accept). Subtract their qty here so the
  // same units don't appear available twice.
  const poIds = pos.map((p) => p._id);
  const inFlightGRNs = poIds.length
    ? await GoodsReceipt.find(
        withTenantScope(
          {
            "source.type": "purchase_order",
            "source.purchaseOrderId": { $in: poIds },
            status: { $in: ["draft", "pending_acceptance"] },
          },
          companyId,
          isSuperAdmin,
        ),
      ).lean()
    : [];

  // Map: poId → productId → reserved qty
  const reserved = new Map();
  for (const grn of inFlightGRNs) {
    const poKey = grn.source?.purchaseOrderId?.toString();
    if (!poKey) continue;
    if (!reserved.has(poKey)) reserved.set(poKey, new Map());
    const byProduct = reserved.get(poKey);
    for (const line of grn.lines || []) {
      const pid = line.productId?.toString();
      if (!pid) continue;
      const qty = Number(line.receivedQty) || 0;
      byProduct.set(pid, (byProduct.get(pid) || 0) + qty);
    }
  }

  // Filter to only POs with available items
  return pos
    .map((po) => {
      const poReserved = reserved.get(po._id.toString()) || new Map();
      return {
        ...serializeBsonType(po),
        availableLines: po.lines
          .map((line) => {
            const pid = line.product?.id?.toString();
            const inFlight = (pid && poReserved.get(pid)) || 0;
            const available =
              (line.quantity || 0) -
              (line.receivedQuantity || 0) -
              inFlight;
            return {
              lineId: line._id.toString(),
              product: line.product
                ? {
                    id: line.product.id?.toString(),
                    sku: line.product.sku,
                    name: line.product.name,
                  }
                : null,
              description: line.description,
              unit: line.unit,
              unitPrice: line.unitPrice,
              orderedQuantity: line.quantity,
              receivedQuantity: line.receivedQuantity,
              availableQuantity: available,
            };
          })
          .filter((line) => line.availableQuantity > 0),
      };
    })
    .filter((po) => po.availableLines.length > 0);
};

// ============================================
// GET PURCHASE ORDERS BY SUPPLIER
// ============================================
export const getPurchaseOrdersBySupplier = async (
  supplierId,
  status = null
) => {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  let query = { "supplier.partyId": supplierId };
  if (status) {
    query.status = Array.isArray(status) ? { $in: status } : status;
  }

  // Apply tenant scoping
  query = withTenantScope(query, companyId, isSuperAdmin);

  const pos = await PurchaseOrder.find(query).sort({ poDate: -1 }).lean();

  return pos.map((po) => serializeBsonType(po));
};

// ============================================
// GET OVERDUE PURCHASE ORDERS
// ============================================
export const getOverduePurchaseOrders = async () => {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const now = new Date();

  const pos = await PurchaseOrder.find(
    withTenantScope(
      {
        status: { $in: ["sent", "confirmed", "partial"] },
        expectedDeliveryDate: { $lt: now },
      },
      companyId,
      isSuperAdmin
    )
  )
    .sort({ expectedDeliveryDate: 1 })
    .lean();

  return pos.map((po) => serializeBsonType(po));
};

// ============================================
// GET EXPIRING PURCHASE ORDERS
// ============================================
export const getExpiringPurchaseOrders = async (daysAhead = 7) => {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const now = new Date();
  const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const pos = await PurchaseOrder.find(
    withTenantScope(
      {
        status: { $in: ["draft", "sent"] },
        validUntil: { $gte: now, $lte: futureDate },
      },
      companyId,
      isSuperAdmin
    )
  )
    .sort({ validUntil: 1 })
    .lean();

  return pos.map((po) => serializeBsonType(po));
};
