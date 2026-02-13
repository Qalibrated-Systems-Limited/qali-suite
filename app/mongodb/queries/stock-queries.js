import { ItemCheckout } from "@/app/models/checkouts";
import Product from "@/app/models/product";
import { StockRequest } from "@/app/models/requests";
import { StockMovement } from "@/app/models/stockmovement";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";

const { default: dbConnect } = require("@/app/config/dbConnect");

export async function getProduct(id) {
  await dbConnect();
  try {
    const { companyId, isSuperAdmin } = await getTenantContext();

    const query = withTenantScope({ _id: id }, companyId, isSuperAdmin);
    const product = await Product.findOne(query).lean();
    if (!product) return null;

    // Convert MongoDB document to plain object
    return JSON.parse(JSON.stringify(product));
  } catch (error) {
    console.error("Error fetching product:", error);
    return null;
  }
}

export async function getAProductRecentMovements(productId, limit = 5) {
  try {
    const { companyId, isSuperAdmin } = await getTenantContext();

    const query = withTenantScope({ productId }, companyId, isSuperAdmin);
    const movements = await StockMovement.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return JSON.parse(JSON.stringify(movements));
  } catch (error) {
    console.error("Error fetching movements:", error);
    return [];
  }
}

export async function getAProductPendingRequests(productId) {
  try {
    const { companyId, isSuperAdmin } = await getTenantContext();

    const query = withTenantScope(
      {
        "items.productId": productId,
        status: { $in: ["pending", "approved", "partial"] },
      },
      companyId,
      isSuperAdmin
    );

    const requests = await StockRequest.find(query)
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    return JSON.parse(JSON.stringify(requests));
  } catch (error) {
    console.error("Error fetching requests:", error);
    return [];
  }
}

export async function getAProductActiveCheckouts(productId) {
  try {
    const { companyId, isSuperAdmin } = await getTenantContext();

    const query = withTenantScope(
      {
        productId,
        status: { $in: ["checked_out", "overdue"] },
      },
      companyId,
      isSuperAdmin
    );

    const checkouts = await ItemCheckout.find(query)
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    return JSON.parse(JSON.stringify(checkouts));
  } catch (error) {
    console.error("Error fetching checkouts:", error);
    return [];
  }
}






