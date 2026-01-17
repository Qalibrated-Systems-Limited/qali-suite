import { ItemCheckout } from "@/app/models/checkouts";
import Product from "@/app/models/product";
import { StockRequest } from "@/app/models/requests";
import { StockMovement } from "@/app/models/stockmovement";

const { default: dbConnect } = require("@/app/config/dbConnect");

dbConnect();

export async function getProduct(id) {
  try {
    const product = await Product.findById(id).lean();
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
    const movements = await StockMovement.find({ productId })
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
    const requests = await StockRequest.find({
      "items.productId": productId,
      status: { $in: ["pending", "approved", "partial"] },
    })
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
    const checkouts = await ItemCheckout.find({
      productId,
      status: { $in: ["checked_out", "overdue"] },
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    return JSON.parse(JSON.stringify(checkouts));
  } catch (error) {
    console.error("Error fetching checkouts:", error);
    return [];
  }
}
