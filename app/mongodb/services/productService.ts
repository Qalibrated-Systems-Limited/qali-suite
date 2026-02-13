"use server";

import Product from "@/app/models/product";
import dbConnect from "@/app/config/dbConnect";
import { withTenantScope } from "@/lib/utils/tenant-utils";
import type { ClientSession, Types } from "mongoose";

// ============================================
// TYPES
// ============================================

export interface ProductInventory {
  quantityOnHand: number;
  quantityAvailable: number;
  quantityCommitted: number;
  reorderLevel?: number;
  reorderQuantity?: number;
  minimumStock?: number;
  maximumStock?: number;
}

export interface ProductCosting {
  costPrice: number;
  lastPurchaseCost?: number;
  lastPurchaseDate?: Date;
  costingMethod?: "average" | "fifo" | "lifo" | "specific" | "weighted_average";
  standardCost?: number;
}

export interface ProductPricing {
  sellingPrice: number;
  wholesalePrice?: number;
  minimumPrice?: number;
  marginPercentage?: number;
  markupPercentage?: number;
  lastPriceUpdate?: Date;
}

export interface ProductTaxInfo {
  taxable: boolean;
  taxRate: number;
}

// Mongoose document type (what we get from queries)
export interface IProduct {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  name: string;
  SKU: string;
  unit: string;
  category?: string;
  description?: string;
  inventory?: ProductInventory;
  costing?: ProductCosting;
  pricing?: ProductPricing;
  taxInfo?: ProductTaxInfo;
  status?: "active" | "inactive" | "discontinued";
  isActive?: boolean;
  // Instance methods
  decreaseInventory: (quantity: number) => Promise<number>;
  increaseInventory: (quantity: number, cost: number, reason?: string) => Promise<IProduct>;
  commitInventory: (quantity: number) => Promise<IProduct>;
  releaseInventory: (quantity: number) => Promise<IProduct>;
  recordSale: (quantity: number, sellingPrice: number) => Promise<{
    revenue: number;
    cogs: number;
    grossProfit: number;
  }>;
  calculateMargins: () => { margin: number; markup: number };
  updateAverageCost: (newQuantity: number, newCost: number) => number;
}

// Serialized product for client (invoices/forms)
export interface SerializedProduct {
  _id: string;
  name: string;
  SKU: string;
  unit: string;
  category?: string;
  inventory: {
    quantityOnHand: number;
    quantityAvailable: number;
    quantityCommitted: number;
  };
  costing: {
    costPrice: number;
  };
  pricing: {
    sellingPrice: number;
    wholesalePrice: number;
    minimumPrice: number;
  };
  taxInfo: {
    taxable: boolean;
    taxRate: number;
  };
}

// Serialized product for stock operations
export interface StockProduct {
  _id: string;
  name: string;
  SKU: string;
  unit: string;
  quantityOnHand: number;
  quantityAvailable: number;
  quantityCommitted: number;
  costPrice: number;
  sellingPrice: number;
}

// Update operations type
export interface InventoryUpdateOperation {
  $inc: {
    "inventory.quantityOnHand"?: number;
    "inventory.quantityAvailable"?: number;
    "inventory.quantityCommitted"?: number;
  };
}

// ============================================
// PRODUCT SERVICE CLASS
// ============================================

export class ProductService {
  /**
   * Get product by ID
   */
  static async getById(
    productId: string,
    session?: ClientSession | null
  ): Promise<IProduct | null> {
    await dbConnect();
    const query = Product.findById(productId);
    if (session) query.session(session);
    return query as Promise<IProduct | null>;
  }

  /**
   * Get product with tenant scoping
   */
  static async getByIdWithTenant(
    productId: string,
    companyId: string,
    isSuperAdmin: boolean,
    session?: ClientSession | null
  ): Promise<IProduct | null> {
    await dbConnect();
    const query = Product.findOne(
      withTenantScope({ _id: productId }, companyId, isSuperAdmin)
    );
    if (session) query.session(session);
    return query as Promise<IProduct | null>;
  }

  // ============================================
  // INVENTORY GETTERS
  // ============================================

  /**
   * Get available quantity (on-hand minus committed)
   */
  static getAvailable(product: IProduct | null): number {
    return product?.inventory?.quantityAvailable ?? 0;
  }

  /**
   * Get on-hand quantity
   */
  static getOnHand(product: IProduct | null): number {
    return product?.inventory?.quantityOnHand ?? 0;
  }

  /**
   * Get committed quantity
   */
  static getCommitted(product: IProduct | null): number {
    return product?.inventory?.quantityCommitted ?? 0;
  }

  // ============================================
  // PRICING GETTERS
  // ============================================

  /**
   * Get selling price
   */
  static getSellingPrice(product: IProduct | null): number {
    return product?.pricing?.sellingPrice ?? 0;
  }

  /**
   * Get cost price
   */
  static getCostPrice(product: IProduct | null): number {
    return product?.costing?.costPrice ?? 0;
  }

  // ============================================
  // VALIDATION
  // ============================================

  /**
   * Check if product has sufficient stock
   */
  static hasSufficientStock(product: IProduct | null, quantity: number): boolean {
    return this.getAvailable(product) >= quantity;
  }

  /**
   * Validate stock availability - throws if insufficient
   */
  static validateStock(product: IProduct, quantity: number): void {
    const available = this.getAvailable(product);
    if (quantity > available) {
      throw new Error(
        `Insufficient stock for ${product.name}. Available: ${available}, Requested: ${quantity}`
      );
    }
  }

  // ============================================
  // ATOMIC INVENTORY OPERATIONS
  // ============================================

  /**
   * Decrease inventory atomically (for transactions)
   * Validates stock availability before decreasing
   */
  static async decreaseInventory(
    productId: string,
    quantity: number,
    session?: ClientSession | null
  ): Promise<IProduct> {
    await dbConnect();

    if (quantity <= 0) {
      throw new Error("Quantity must be greater than zero");
    }

    // First check availability
    const product = await this.getById(productId, session);
    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }

    const available = this.getAvailable(product);
    if (quantity > available) {
      throw new Error(
        `Insufficient inventory for ${product.name}. Available: ${available}, Requested: ${quantity}`
      );
    }

    // Perform atomic update
    const options = session ? { session, new: true } : { new: true };
    const updated = await Product.findByIdAndUpdate(
      productId,
      this.getDecreaseUpdate(quantity),
      options
    );

    return updated as IProduct;
  }

  /**
   * Increase inventory atomically (for transactions)
   */
  static async increaseInventory(
    productId: string,
    quantity: number,
    session?: ClientSession | null
  ): Promise<IProduct> {
    await dbConnect();

    if (quantity <= 0) {
      throw new Error("Quantity must be greater than zero");
    }

    const options = session ? { session, new: true } : { new: true };
    const updated = await Product.findByIdAndUpdate(
      productId,
      this.getIncreaseUpdate(quantity),
      options
    );

    if (!updated) {
      throw new Error(`Product not found: ${productId}`);
    }

    return updated as IProduct;
  }

  /**
   * Get atomic update object for decreasing inventory
   * Use with findByIdAndUpdate
   */
  static getDecreaseUpdate(quantity: number): InventoryUpdateOperation {
    return {
      $inc: {
        "inventory.quantityOnHand": -quantity,
        "inventory.quantityAvailable": -quantity,
      },
    };
  }

  /**
   * Get atomic update object for increasing inventory
   * Use with findByIdAndUpdate
   */
  static getIncreaseUpdate(quantity: number): InventoryUpdateOperation {
    return {
      $inc: {
        "inventory.quantityOnHand": quantity,
        "inventory.quantityAvailable": quantity,
      },
    };
  }

  /**
   * Get atomic update object for committing inventory
   */
  static getCommitUpdate(quantity: number): InventoryUpdateOperation {
    return {
      $inc: {
        "inventory.quantityCommitted": quantity,
        "inventory.quantityAvailable": -quantity,
      },
    };
  }

  /**
   * Get atomic update object for releasing committed inventory
   */
  static getReleaseUpdate(quantity: number): InventoryUpdateOperation {
    return {
      $inc: {
        "inventory.quantityCommitted": -quantity,
        "inventory.quantityAvailable": quantity,
      },
    };
  }

  // ============================================
  // INSTANCE-BASED OPERATIONS (use product model methods)
  // ============================================

  /**
   * Commit inventory (allocate to pending order)
   */
  static async commitInventory(
    productId: string,
    quantity: number,
    session?: ClientSession | null
  ): Promise<IProduct> {
    const product = await this.getById(productId, session);
    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }
    return product.commitInventory(quantity);
  }

  /**
   * Release committed inventory (cancel order)
   */
  static async releaseInventory(
    productId: string,
    quantity: number,
    session?: ClientSession | null
  ): Promise<IProduct> {
    const product = await this.getById(productId, session);
    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }
    return product.releaseInventory(quantity);
  }

  /**
   * Record a sale (decrease inventory + update totals)
   */
  static async recordSale(
    productId: string,
    quantity: number,
    sellingPrice: number,
    session?: ClientSession | null
  ): Promise<{ revenue: number; cogs: number; grossProfit: number }> {
    const product = await this.getById(productId, session);
    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }
    return product.recordSale(quantity, sellingPrice);
  }

  // ============================================
  // SERIALIZATION
  // ============================================

  /**
   * Serialize product for client-side use (invoices/forms)
   */
  static serializeForInvoice(product: IProduct): SerializedProduct {
    return {
      _id: product._id.toString(),
      name: product.name,
      SKU: product.SKU,
      unit: product.unit,
      category: product.category,
      inventory: {
        quantityOnHand: product.inventory?.quantityOnHand ?? 0,
        quantityAvailable: product.inventory?.quantityAvailable ?? 0,
        quantityCommitted: product.inventory?.quantityCommitted ?? 0,
      },
      costing: {
        costPrice: product.costing?.costPrice ?? 0,
      },
      pricing: {
        sellingPrice: product.pricing?.sellingPrice ?? 0,
        wholesalePrice: product.pricing?.wholesalePrice ?? 0,
        minimumPrice: product.pricing?.minimumPrice ?? 0,
      },
      taxInfo: {
        taxable: product.taxInfo?.taxable ?? true,
        taxRate: product.taxInfo?.taxRate ?? 16,
      },
    };
  }

  /**
   * Serialize product for checkout/stock operations
   */
  static serializeForStock(product: IProduct): StockProduct {
    return {
      _id: product._id.toString(),
      name: product.name,
      SKU: product.SKU,
      unit: product.unit,
      quantityOnHand: product.inventory?.quantityOnHand ?? 0,
      quantityAvailable: product.inventory?.quantityAvailable ?? 0,
      quantityCommitted: product.inventory?.quantityCommitted ?? 0,
      costPrice: product.costing?.costPrice ?? 0,
      sellingPrice: product.pricing?.sellingPrice ?? 0,
    };
  }

  /**
   * Bulk get products with inventory data
   */
  static async getProductsWithInventory(
    productIds: string[],
    session?: ClientSession | null
  ): Promise<StockProduct[]> {
    await dbConnect();

    const query = Product.find({ _id: { $in: productIds } }).select(
      "name SKU unit inventory costing pricing"
    );

    if (session) query.session(session);

    const products = (await query) as IProduct[];
    return products.map((p) => this.serializeForStock(p));
  }
}

// Export default for convenience
export default ProductService;
