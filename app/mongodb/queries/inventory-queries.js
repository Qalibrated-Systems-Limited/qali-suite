"use server";

import dbConnect from "@/app/config/dbConnect";
import Product from "@/app/models/product";
import Category from "@/app/models/category";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import { serializeBsonType } from "@/lib/utils";

/**
 * Get Stock Valuation Report
 * Shows inventory value by product and category
 */
export async function getStockValuationReport({ groupBy = "category" } = {}) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  // Get all active products with stock
  const products = await Product.find(
    withTenantScope({ isActive: true }, companyId, isSuperAdmin),
  )
    .select(
      "name SKU category inventory.quantityOnHand costing.costPrice pricing.sellingPrice unit",
    )
    .populate("category", "name")
    .lean();

  // Calculate inventory value for each product
  const productsWithValue = products.map((p) => {
    const qty = p.inventory?.quantityOnHand || 0;
    const costPrice = p.costing?.costPrice || 0;
    const sellingPrice = p.pricing?.sellingPrice || 0;
    const inventoryValue = qty * costPrice;
    const retailValue = qty * sellingPrice;

    return {
      _id: p._id,
      name: p.name,
      SKU: p.SKU,
      category: p.category?.name || "Uncategorized",
      categoryId: p.category?._id?.toString() || null,
      unit: p.unit,
      quantity: qty,
      costPrice,
      sellingPrice,
      inventoryValue,
      retailValue,
      potentialProfit: retailValue - inventoryValue,
    };
  });

  // Filter out zero stock items for the summary (but keep for detail)
  const itemsWithStock = productsWithValue.filter((p) => p.quantity > 0);

  // Group by category
  const byCategory = {};
  for (const product of productsWithValue) {
    const cat = product.category;
    if (!byCategory[cat]) {
      byCategory[cat] = {
        category: cat,
        items: [],
        totalQuantity: 0,
        totalInventoryValue: 0,
        totalRetailValue: 0,
      };
    }
    byCategory[cat].items.push(product);
    byCategory[cat].totalQuantity += product.quantity;
    byCategory[cat].totalInventoryValue += product.inventoryValue;
    byCategory[cat].totalRetailValue += product.retailValue;
  }

  // Convert to array and sort by value
  const categories = Object.values(byCategory).sort(
    (a, b) => b.totalInventoryValue - a.totalInventoryValue,
  );

  // Calculate summary
  const summary = {
    totalProducts: products.length,
    productsWithStock: itemsWithStock.length,
    productsOutOfStock: products.length - itemsWithStock.length,
    totalQuantity: productsWithValue.reduce((sum, p) => sum + p.quantity, 0),
    totalInventoryValue: productsWithValue.reduce(
      (sum, p) => sum + p.inventoryValue,
      0,
    ),
    totalRetailValue: productsWithValue.reduce(
      (sum, p) => sum + p.retailValue,
      0,
    ),
    totalPotentialProfit: productsWithValue.reduce(
      (sum, p) => sum + p.potentialProfit,
      0,
    ),
    categoryCount: categories.length,
  };

  summary.averageMargin =
    summary.totalInventoryValue > 0
      ? (summary.totalPotentialProfit / summary.totalInventoryValue) * 100
      : 0;

  return serializeBsonType({
    reportName: "Stock Valuation Report",
    generatedAt: new Date(),
    products: productsWithValue,
    categories,
    summary,
  });
}

/**
 * Get Low Stock Report
 * Products at or below reorder level
 */
export async function getLowStockReport() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const products = await Product.find(
    withTenantScope(
      {
        isActive: true,
        $expr: {
          $lte: [
            { $ifNull: ["$inventory.quantityOnHand", 0] },
            { $ifNull: ["$inventory.reorderLevel", 0] },
          ],
        },
      },
      companyId,
      isSuperAdmin,
    ),
  )
    .select(
      "name SKU category inventory.quantityOnHand inventory.reorderLevel costing.costPrice unit",
    )
    .populate("category", "name")
    .sort({ "inventory.quantityOnHand": 1 })
    .lean();

  return {
    reportName: "Low Stock Report",
    generatedAt: new Date(),
    products: products.map((p) => ({
      ...p,
      category: p.category?.name || "Uncategorized",
      quantityOnHand: p.inventory?.quantityOnHand || 0,
      reorderLevel: p.inventory?.reorderLevel || 0,
      shortfall: (p.inventory?.reorderLevel || 0) - (p.inventory?.quantityOnHand || 0),
    })),
    summary: {
      totalItems: products.length,
      totalShortfall: products.reduce(
        (sum, p) =>
          sum + Math.max(0, (p.inventory?.reorderLevel || 0) - (p.inventory?.quantityOnHand || 0)),
        0,
      ),
    },
  };
}

/**
 * Get Stock Summary by Category
 */
export async function getStockByCategory() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const result = await Product.aggregate([
    {
      $match: withTenantScope({ isActive: true }, companyId, isSuperAdmin),
    },
    {
      $lookup: {
        from: "categories",
        localField: "category",
        foreignField: "_id",
        as: "categoryInfo",
      },
    },
    {
      $unwind: {
        path: "$categoryInfo",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $group: {
        _id: "$categoryInfo._id",
        categoryName: {
          $first: { $ifNull: ["$categoryInfo.name", "Uncategorized"] },
        },
        productCount: { $sum: 1 },
        totalQuantity: { $sum: { $ifNull: ["$inventory.quantityOnHand", 0] } },
        totalValue: {
          $sum: {
            $multiply: [
              { $ifNull: ["$inventory.quantityOnHand", 0] },
              { $ifNull: ["$costing.costPrice", 0] },
            ],
          },
        },
      },
    },
    { $sort: { totalValue: -1 } },
  ]);

  return result;
}

/**
 * Get Out of Stock Products
 */
export async function getOutOfStockProducts() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const products = await Product.find(
    withTenantScope(
      { isActive: true, "inventory.quantityOnHand": { $lte: 0 } },
      companyId,
      isSuperAdmin,
    ),
  )
    .select("name SKU category inventory.quantityOnHand costing.costPrice unit createdAt")
    .populate("category", "name")
    .sort({ name: 1 })
    .lean();

  return {
    reportName: "Out of Stock Products",
    generatedAt: new Date(),
    products: products.map((p) => ({
      ...p,
      category: p.category?.name || "Uncategorized",
    })),
    summary: {
      totalItems: products.length,
    },
  };
}

/**
 * Get Stock Valuation Stats (optimized for stats cards)
 */
export async function getStockValuationStats() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const [result] = await Product.aggregate([
    {
      $match: withTenantScope({ isActive: true }, companyId, isSuperAdmin),
    },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        productsWithStock: {
          $sum: {
            $cond: [{ $gt: [{ $ifNull: ["$inventory.quantityOnHand", 0] }, 0] }, 1, 0],
          },
        },
        totalQuantity: { $sum: { $ifNull: ["$inventory.quantityOnHand", 0] } },
        totalInventoryValue: {
          $sum: {
            $multiply: [
              { $ifNull: ["$inventory.quantityOnHand", 0] },
              { $ifNull: ["$costing.costPrice", 0] },
            ],
          },
        },
        totalRetailValue: {
          $sum: {
            $multiply: [
              { $ifNull: ["$inventory.quantityOnHand", 0] },
              { $ifNull: ["$pricing.sellingPrice", 0] },
            ],
          },
        },
        categories: { $addToSet: "$category" },
      },
    },
    {
      $project: {
        _id: 0,
        totalProducts: 1,
        productsWithStock: 1,
        productsOutOfStock: { $subtract: ["$totalProducts", "$productsWithStock"] },
        totalQuantity: 1,
        totalInventoryValue: 1,
        totalRetailValue: 1,
        totalPotentialProfit: { $subtract: ["$totalRetailValue", "$totalInventoryValue"] },
        categoryCount: { $size: "$categories" },
      },
    },
  ]);

  return result || {
    totalProducts: 0,
    productsWithStock: 0,
    productsOutOfStock: 0,
    totalQuantity: 0,
    totalInventoryValue: 0,
    totalRetailValue: 0,
    totalPotentialProfit: 0,
    categoryCount: 0,
  };
}
