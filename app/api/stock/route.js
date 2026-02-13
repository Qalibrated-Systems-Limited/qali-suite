import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import Product from "../../models/product";
import StockTransaction from "../../models/stockTransaction";
import { ValidateStock } from "../../mongodb/validators";

import {
  authErrorResponse,
  clientSideErrorResponse,
  okResponse,
} from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";
import { toTitle } from "../../utils/validators";

export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("You must login first");
  }

  try {
    dbConnect();

    const limitStage = { $limit: 1000 };
    const sortStage = { $sort: { createdAt: -1 } };

    const pipeline = [sortStage, limitStage];
    const result = await Product.aggregate(pipeline);

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function POST(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    dbConnect();

    const rawFormData = await req.json();

    const validatedFields = ValidateStock(rawFormData);

    if (!validatedFields.success) {
      return clientSideErrorResponse("Missing Fields. Failed to add stock.");
    }

    const data = validatedFields.data;

    const result = await Product.create({
      name: toTitle(data.name),
      price: data.price,
      SKU: data.SKU,
      description: data.description,
      category: data.category,
      stock: data.stock,
    });

    const amount = Number(data.stock) * Number(data.price);

    if (result) {
      await StockTransaction.create({
        SKU: data.SKU,
        amount: amount,
        transactionType: "Purchase",
        quantity: data.stock,
      });
    }

    return okResponse(result);
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function PUT(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    dbConnect();

    const rawFormData = await req.json();
    const validatedFields = ValidateStock(rawFormData);
    if (!validatedFields.success) {
      return clientSideErrorResponse("Some required fields missing");
    }
    const product = await Product.findById(id);
    const oldStock = product.inventory?.quantityOnHand ?? 0;
    if (product) {
      product.name = toTitle(validatedFields.data.name);
      product.SKU = validatedFields.data.SKU;
      product.pricing = product.pricing || {};
      product.pricing.sellingPrice = validatedFields.data.price;
      product.inventory = product.inventory || {};
      product.inventory.quantityOnHand = validatedFields.data.stock;
      product.category = validatedFields.data.category;
      product.description = validatedFields.data.description;
      const result = await product.save();
      if (result) {
        const addedProducts = Number(validatedFields.data.stock) - oldStock;
        if (addedProducts > 0) {
          const amount = Number(validatedFields.data.price) * addedProducts;
          await StockTransaction.create({
            SKU: validatedFields.data.SKU,
            amount: amount,
            transactionType: "Purchase",
            quantity: addedProducts,
          });
        }
      }
    }

    return okResponse(invoice);
  } catch (e) {
    return errorHandlers(e);
  }
}
