import dbConnect from "../../../../config/dbConnect";
import { isAuth } from "../../../../middlewares/auth";
import Product from "../../../../models/product";
import StockTransaction from "../../../../models/stockTransaction";
import { ValidateStock } from "../../../../mongodb/validators";

import {
  authErrorResponse,
  clientSideErrorResponse,
  okResponse,
} from "../../../../utils/customres";
import { errorHandlers } from "../../../../utils/errorHandler";
import { toTitle } from "../../../../utils/validators";

export async function PUT(req, { params }) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    const id = (await params).id;
    await dbConnect();

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

    return okResponse("success");
  } catch (e) {
    return errorHandlers(e);
  }
}
