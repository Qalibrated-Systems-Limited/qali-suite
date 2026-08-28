"use server";

import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import * as productsRepo from "../repositories/products";
import * as movementsRepo from "../repositories/stockMovements";
import * as fulfilmentRepo from "../repositories/fulfilment";
import { createJournalEntry } from "../repositories/journal";
import { accounts, categories, products } from "../schema";
import {
  canWriteProducts,
  canSetProductCost,
  canEditPricing,
} from "@/lib/permissions";

/**
 * The product master, on Postgres.
 *
 * WHY THIS FILE DID NOT EXIST. `app/db/repositories/products.ts` was written
 * with the whole commitment-based flow — commitStock, releaseStock, issueStock,
 * receive-to-hold/accept/reject, recostFromAcceptedReceipt — and then nothing
 * was ever pointed at it. The screens went on calling the Mongo action beside
 * it, so products were written to one store while INVOICES read the other:
 * `getInvoiceFormData` lists Postgres products and `createInvoice` throws
 * "Product not found" for anything not there. With 30 products in Mongo and 0
 * in Postgres, the product dropdown on a new invoice was empty and no stock
 * item could be sold at all.
 *
 * WHAT IS DELIBERATELY DIFFERENT FROM THE MONGO VERSION:
 *
 * 1. QUANTITIES ARE NOT WRITABLE FROM A FORM. Every level moves through a
 *    function that records a movement or is guarded by the
 *    `committed + on_hold <= on_hand` CHECK. See updateProduct in the
 *    repository.
 *
 * 2. DELETE DEACTIVATES ONCE A PRODUCT HAS TRADED. Mongo's delete checked
 *    nothing and orphaned the movements and invoice lines that explain last
 *    year's cost of sales.
 *
 * 3. COST IS NOT AN EDITABLE FIELD. Under weighted average it is an OUTPUT of
 *    receiving stock. Typing over it revalues everything on the shelf with no
 *    journal entry to explain it.
 *
 * KEPT, because they are right: the segregation of cost from price, and
 * opening stock reaching the general ledger through a posted entry rather than
 * being written straight into a quantity column.
 */

const num = (v: unknown) => Number(v ?? 0);
/** A form value as a decimal string the numeric columns accept. */
const money = (v: unknown) =>
  v == null || v === "" ? "0" : String(Number(String(v)) || 0);

export interface ProductActionResult {
  error?: Record<string, string[]>;
  success?: boolean;
  productId?: string;
  message?: string;
}

/** A field error in the shape the forms already render. */
const fail = (field: string, message: string): ProductActionResult => ({
  error: { [field]: [message] },
});

/**
 * Creates a product, and — when opening stock is supplied — posts it.
 *
 * OPENING STOCK IS AN ACCOUNTING EVENT, NOT A NUMBER. The product is created
 * with zero on hand and the stock arrives through a movement plus a journal
 * entry (DR Inventory / CR Opening Balance Equity), so the Inventory account
 * on the balance sheet always equals quantity × cost. This is what Odoo,
 * QuickBooks and Zoho all do, and it is the one part of the Mongo action worth
 * carrying over unchanged.
 *
 * It follows that opening stock needs a cost. Without one the entry would post
 * zero and the balance sheet would carry stock worth nothing, so a create that
 * asks for stock without a cost is refused rather than quietly valued at zero.
 */
export async function addProductPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ProductActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim().toUpperCase();
  if (!name) return fail("name", "A product needs a name.");
  if (!sku) return fail("sku", "A product needs a SKU.");

  const initialStock = num(formData.get("initialStock"));
  const costPrice = money(formData.get("costPrice"));
  const sellingPrice = money(formData.get("sellingPrice"));

  try {
    return await withAuthorizedTenant([], async (tx, { companyId, user }) => {
      const role = user?.role;
      if (!canWriteProducts(role)) {
        return fail("_form", "You do not have permission to create products.");
      }

      const maySetCost = canSetProductCost(role);
      const maySetPrice = canEditPricing(role);

      // SEGREGATION OF DUTIES. A role that may register an item is not
      // necessarily one that may value it or price it; those fields are
      // dropped rather than rejected, so the product still gets created.
      const cost = maySetCost ? costPrice : "0";
      const price = maySetPrice ? sellingPrice : "0";

      if (initialStock > 0 && !maySetCost) {
        return fail(
          "initialStock",
          "Opening stock has to be valued, and you do not set cost prices. " +
            "Save with zero stock and ask someone with cost rights to add it.",
        );
      }
      if (initialStock > 0 && num(cost) <= 0) {
        return fail(
          "initialStock",
          "Opening stock needs a cost price. Without one the opening journal " +
            "entry would value the stock at nothing.",
        );
      }
      if (initialStock < 0) {
        return fail("initialStock", "Opening stock cannot be negative.");
      }

      // Same tenant, same SKU. The unique index enforces it; this is here for
      // the readable message rather than a constraint violation.
      const [clash] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.companyId, companyId), eq(products.sku, sku)));
      if (clash) return fail("sku", "A product with this SKU already exists.");

      /**
       * THE FORM POSTS A CATEGORY ID IN A FIELD CALLED `category`, which is
       * how the Mongo action read it too — it looked the Category up by _id.
       * Postgres keeps both: `categoryId` is the foreign key, `category` is
       * the NAME as filed, so renaming a category later does not rewrite what
       * every historical product was classified as.
       */
      const categoryId = (formData.get("category") as string) || null;
      let categoryName: string | null = null;
      if (categoryId) {
        const [category] = await tx
          .select({ name: categories.name })
          .from(categories)
          .where(eq(categories.id, categoryId));
        if (!category) return fail("category", "That category no longer exists.");
        categoryName = category.name;
      }

      const product = await productsRepo.createProduct(tx, {
        companyId,
        sku,
        name,
        description: (formData.get("description") as string) || null,
        category: categoryName,
        categoryId,
        unit: (formData.get("unit") as string) || "pcs",
        productType: (formData.get("type") as string) || "Inventory Item",
        costPrice: cost,
        sellingPrice: price,
        wholesalePrice: maySetPrice ? money(formData.get("wholesalePrice")) : "0",
        minimumPrice: maySetPrice ? money(formData.get("minimumPrice")) : "0",
        reorderLevel: money(formData.get("reorderLevel")),
        reorderQuantity: money(formData.get("reorderQuantity")),
        defaultTaxRate: formData.get("taxRate") != null
          ? money(formData.get("taxRate"))
          : undefined,
        location: (formData.get("location") as string) || null,
        binNumber: (formData.get("binNumber") as string) || null,
        isActive: formData.get("isActive") !== "false",
        createdById: user?.id ?? null,
        // Zero on purpose — the opening entry below is what puts stock on the
        // shelf, so that the movement and the ledger agree with the level.
        quantityOnHand: "0",
      });

      if (initialStock > 0) {
        await postOpeningStock(tx, {
          companyId,
          product,
          quantity: String(initialStock),
          unitCost: cost,
          userId: user?.id ?? null,
          userName: user?.name ?? null,
        });
      }

      revalidatePath("/dashboard/stocks");
      return {
        success: true,
        productId: product.id,
        message: `${name} created.`,
      };
    });
  } catch (e) {
    return fail("_form", e instanceof Error ? e.message : "Could not create the product.");
  }
}

/**
 * Opening stock: the movement, the level, and the entry that explains it.
 *
 * ORDER MATTERS. `recordMovement` reads `quantity_on_hand` to record what the
 * level moved FROM, so it runs before the level changes — its own header says
 * so, and getting it backwards records a transition that never happened.
 */
async function postOpeningStock(
  tx: Parameters<Parameters<typeof withAuthorizedTenant>[1]>[0],
  input: {
    companyId: string;
    product: { id: string; sku: string; name: string };
    quantity: string;
    unitCost: string;
    userId: string | null;
    userName: string | null;
  },
) {
  const value = (Number(input.quantity) * Number(input.unitCost)).toFixed(4);

  const [inventoryAccount] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.systemAccount, "inventory"));
  const [openingEquity] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.systemAccount, "opening_balance_equity"));

  if (!inventoryAccount || !openingEquity) {
    throw new Error(
      "The chart of accounts has no Inventory or Opening Balance Equity " +
        "account, so opening stock cannot be posted.",
    );
  }

  await movementsRepo.recordMovement(tx, {
    companyId: input.companyId,
    productId: input.product.id,
    movementType: "initial",
    direction: "in",
    quantity: input.quantity,
    unitCost: input.unitCost,
    sourceReference: `Opening balance — ${input.product.sku}`,
    performedById: input.userId,
    performedByName: input.userName,
    affectsAccounting: true,
  });

  await productsRepo.receiveStock(
    tx,
    input.product.id,
    input.quantity,
    input.unitCost,
  );

  await createJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: new Date().toISOString().slice(0, 10),
    entryType: "opening_balance",
    description: `Opening stock — ${input.product.name}`,
    reference: input.product.sku,
    lines: [
      {
        accountId: inventoryAccount.id,
        debit: value,
        description: `Opening stock — ${input.product.sku}`,
      },
      {
        accountId: openingEquity.id,
        credit: value,
        description: "Opening balance — to be reclassified to equity",
      },
    ],
    createdById: input.userId,
    postImmediately: true,
  });
}

/** Edits the catalogue record. Quantities and cost are not editable here. */
export async function updateProductPg(
  productId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ProductActionResult> {
  try {
    return await withAuthorizedTenant([], async (tx, { user }) => {
      if (!canWriteProducts(user?.role)) {
        return fail("_form", "You do not have permission to edit products.");
      }

      const categoryId = (formData.get("category") as string) || null;
      let categoryName: string | null | undefined;
      if (categoryId) {
        const [category] = await tx
          .select({ name: categories.name })
          .from(categories)
          .where(eq(categories.id, categoryId));
        if (!category) return fail("category", "That category no longer exists.");
        categoryName = category.name;
      }

      await productsRepo.updateProduct(tx, productId, {
        name: (formData.get("name") as string) || null,
        sku: (formData.get("sku") as string) || null,
        description: (formData.get("description") as string) ?? undefined,
        category: categoryName,
        categoryId: categoryId ?? undefined,
        unit: (formData.get("unit") as string) || null,
        productType: (formData.get("type") as string) || null,
        reorderLevel: formData.get("reorderLevel")
          ? money(formData.get("reorderLevel"))
          : null,
        reorderQuantity: formData.get("reorderQuantity")
          ? money(formData.get("reorderQuantity"))
          : null,
        defaultTaxRate: formData.get("taxRate")
          ? money(formData.get("taxRate"))
          : null,
        location: (formData.get("location") as string) ?? undefined,
        binNumber: (formData.get("binNumber") as string) ?? undefined,
        isActive: formData.get("isActive")
          ? formData.get("isActive") !== "false"
          : null,
        lastModifiedById: user?.id ?? null,
      });

      // Prices travel with the form but through their own gate, so a user who
      // may edit the record but not price it does not silently reset them.
      if (canEditPricing(user?.role)) {
        await productsRepo.updateProductPricing(tx, productId, {
          sellingPrice: formData.get("sellingPrice")
            ? money(formData.get("sellingPrice"))
            : null,
          wholesalePrice: formData.get("wholesalePrice")
            ? money(formData.get("wholesalePrice"))
            : null,
          minimumPrice: formData.get("minimumPrice")
            ? money(formData.get("minimumPrice"))
            : null,
          lastModifiedById: user?.id ?? null,
        });
      }

      revalidatePath("/dashboard/stocks");
      revalidatePath(`/dashboard/stocks/${productId}`);
      return { success: true, productId, message: "Product updated." };
    });
  } catch (e) {
    return fail("_form", e instanceof Error ? e.message : "Could not update the product.");
  }
}

/** Selling, wholesale and floor prices only — the pricing dialog. */
export async function updateProductPricingPg(
  productId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ProductActionResult> {
  try {
    return await withAuthorizedTenant([], async (tx, { user }) => {
      if (!canEditPricing(user?.role)) {
        return fail("_form", "You do not have permission to set prices.");
      }

      const selling = money(formData.get("sellingPrice"));
      const minimum = money(formData.get("minimumPrice"));

      // A floor above the price it protects is not a floor. Caught here
      // because the two arrive together and neither is wrong alone.
      if (num(minimum) > 0 && num(selling) > 0 && num(minimum) > num(selling)) {
        return fail(
          "minimumPrice",
          "The minimum price cannot be above the selling price.",
        );
      }

      await productsRepo.updateProductPricing(tx, productId, {
        sellingPrice: selling,
        wholesalePrice: money(formData.get("wholesalePrice")),
        minimumPrice: minimum,
        lastModifiedById: user?.id ?? null,
      });

      revalidatePath(`/dashboard/stocks/${productId}`);
      return { success: true, productId, message: "Pricing updated." };
    });
  } catch (e) {
    return fail("_form", e instanceof Error ? e.message : "Could not update pricing.");
  }
}

/**
 * Retires a product, deleting it only when it never traded.
 *
 * Returns which happened, because "deleted" and "deactivated" are different
 * answers and the screen should say which one the user got.
 */
export async function deleteProductPg(productId: string) {
  return withAuthorizedTenant([], async (tx, { user }) => {
    if (!canWriteProducts(user?.role)) {
      throw new Error("You do not have permission to remove products.");
    }
    const result = await productsRepo.deleteProductOrDeactivate(tx, productId);
    revalidatePath("/dashboard/stocks");
    return result;
  });
}

/** The products list, its filters and the figures above it. */
export async function getProductsPg(opts: {
  query?: string;
  category?: string;
  status?: "all" | "active" | "inactive";
  lowStockOnly?: boolean;
  page?: number;
  perPage?: number;
} = {}) {
  return withAuthorizedTenant([], async (tx) => {
    const [list, stats] = await Promise.all([
      productsRepo.searchProducts(tx, opts),
      productsRepo.getProductStats(tx),
    ]);
    return { ...list, rows: list.rows.map(shapeProduct), stats };
  });
}

/** One product, for the detail and edit pages. */
export async function getProductPg(productId: string) {
  return withAuthorizedTenant([], async (tx) => {
    const product = await productsRepo.getProduct(tx, productId);
    return product ? shapeProduct(product as Record<string, unknown>) : null;
  });
}

/**
 * The Mongo shape the tables and forms were written against.
 *
 * `_id` alongside `id`, and the nested `inventory` / `costing` / `pricing`
 * groups: the screens key on them, and the port has no reason to redesign four
 * tables to change where the data comes from. `quantityAvailable` is read from
 * the GENERATED column rather than recomputed here — that is the whole point
 * of it being generated.
 */
function shapeProduct(r: Record<string, unknown>) {
  const onHand = String(r.quantity_on_hand ?? r.quantityOnHand ?? "0");
  const reorder = String(r.reorder_level ?? r.reorderLevel ?? "0");
  return {
    _id: String(r.id),
    id: String(r.id),
    name: String(r.name),
    SKU: String(r.sku),
    sku: String(r.sku),
    description: (r.description as string) ?? "",
    category: (r.category as string) ?? null,
    categoryId: (r.category_id ?? r.categoryId ?? null) as string | null,
    unit: String(r.unit ?? "pcs"),
    type: String(r.product_type ?? r.productType ?? "Inventory Item"),
    isActive: Boolean(r.is_active ?? r.isActive),
    inventory: {
      quantityOnHand: Number(onHand),
      quantityCommitted: num(r.quantity_committed ?? r.quantityCommitted),
      quantityOnHold: num(r.quantity_on_hold ?? r.quantityOnHold),
      quantityAvailable: num(r.quantity_available ?? r.quantityAvailable),
      reorderLevel: Number(reorder),
    },
    costing: {
      costPrice: num(r.cost_price ?? r.costPrice),
      costingMethod: String(r.costing_method ?? r.costingMethod ?? "average"),
      lastPurchaseCost: num(r.last_purchase_cost ?? r.lastPurchaseCost),
    },
    pricing: {
      sellingPrice: num(r.selling_price ?? r.sellingPrice),
      wholesalePrice: num(r.wholesale_price ?? r.wholesalePrice),
      minimumPrice: num(r.minimum_price ?? r.minimumPrice),
    },
    isLowStock: Number(onHand) <= Number(reorder),
  };
}

/**
 * The stock list for the PDF export.
 *
 * PAGES THROUGH rather than taking the first 200. `searchProducts` caps a page
 * at 200 by design — a list screen should never ask for more — but an EXPORT
 * that stops at the cap is worse than one that refuses: it looks complete. The
 * Mongo version had no cap and no pagination, so this is the first time the
 * question came up.
 */
export async function getStockPdfDataPg() {
  try {
    const perPage = 200;
    const data: Array<{
      SKU: string;
      name: string;
      unit: string;
      quantity: number;
    }> = [];

    for (let page = 1; ; page += 1) {
      const { rows, pages } = await getProductsPg({
        page,
        perPage,
        status: "active",
      });
      for (const p of rows) {
        data.push({
          SKU: p.SKU,
          name: p.name,
          unit: p.unit,
          quantity: p.inventory.quantityOnHand,
        });
      }
      if (page >= pages || rows.length === 0) break;
    }

    return { success: true, data };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to load stock data",
    };
  }
}

/**
 * The three activity panels on a product's page: what moved, what is waiting
 * on it, and what is out on loan.
 *
 * One call rather than three, because they render together and each was a
 * separate Mongo round trip. Shaped to what the row components already read —
 * `_id`, `type`, `requestNumber`, `employee.name` — so the port does not
 * redesign three panels to change where their data comes from.
 */
export async function getProductActivityPg(productId: string) {
  return withAuthorizedTenant([], async (tx) => {
    const [movements, requests, checkouts] = await Promise.all([
      movementsRepo.listMovements(tx, { productId, limit: 10 }),
      fulfilmentRepo.listPendingRequestsForProduct(tx, productId, 10),
      fulfilmentRepo.getOutstandingCheckouts(tx, 10, productId),
    ]);

    return {
      movements: movements.map((m) => ({
        _id: String(m.id),
        movementNumber: m.movementNumber,
        reference: m.movementNumber,
        type: m.movementType,
        direction: m.direction,
        quantity: num(m.quantity),
        createdAt: m.movementDate,
      })),
      requests: (requests as unknown as Array<Record<string, unknown>>).map(
        (r) => ({
          _id: String(r.id),
          requestNumber: String(r.request_number),
          status: String(r.status),
          requestType: String(r.priority ?? ""),
          requestedBy: { name: (r.requested_by_name as string) ?? "Unknown" },
          // The row sums `items`; this panel is scoped to ONE product, so the
          // only line that matters is the one for it.
          items: [{ quantity: num(r.quantity_requested) }],
        }),
      ),
      checkouts: (checkouts as unknown as Array<Record<string, unknown>>).map(
        (c) => ({
          _id: String(c.checkout_id),
          checkoutNumber: String(c.checkout_number),
          quantity: num(c.quantity_outstanding),
          status: String(c.status),
          expectedReturnDate: c.expected_return_date as Date | null,
          employee: {
            name: (c.checked_out_to_name_at_checkout as string) ?? "Unknown",
          },
        }),
      ),
    };
  });
}

/**
 * Average margin, priced count and below-floor count for the sales dashboard.
 *
 * These were two Mongo aggregations over a collection nothing has written
 * since products moved, so both tiles read 0% and 0 whatever the catalogue
 * held. They also matched on `status: "active"` — a field the Postgres
 * products table does not carry, because `is_active` is the one the rest of
 * the app filters on.
 */
export async function getPricingHealthPg() {
  return withAuthorizedTenant([], (tx) => productsRepo.getPricingHealth(tx));
}

/**
 * The stock valuation report.
 *
 * `canSeeInventoryNav` gates the page; the roles here are the write-and-read
 * set for inventory, since a valuation is a financial figure about stock.
 */
export async function getStockValuationReportPg() {
  return withAuthorizedTenant([], (tx) => productsRepo.getStockValuation(tx));
}
