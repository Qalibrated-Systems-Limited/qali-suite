import dbConnect from "../../../../config/dbConnect";
import { isAuth } from "../../../../middlewares/auth";

import {
  authErrorResponse,
  clientSideErrorResponse,
  okResponse,
} from "../../../../utils/customres";
import { errorHandlers } from "../../../../utils/errorHandler";

import Invoice from "../../../../models/invoice";
import { toTitle } from "../../../../utils/validators";
import Product from "../../../../models/product";
import StockTransaction from "../../../../models/stockTransaction";
import { validateInvoiceItem } from "../../../../mongodb/validators";
import { format } from "date-fns/format";

export async function POST(req, { params }) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    const id = (await params).id;
    dbConnect();

    const rawFormData = await req.json();

    const validatedFields = validateInvoiceItem(rawFormData);

    if (!validatedFields.success) {
      return clientSideErrorResponse("Missing Fields. Failed to add item.");
    }

    const data = validatedFields.data;
    let modInvoice = {};

    const invoice = await Invoice.findById(id);
    if (!invoice) {
      return clientSideErrorResponse("No invoice found");
    }
    const items = invoice.items ?? [];
    let item = {
      name: toTitle(data.name),

      quantity: data.quantity,
      unitPrice: data.unitPrice,
      unit: data.unit,
      type: data.type,
    };

    if (data.type === "Service") {
      if (items.length > 0) {
        const existingItem = items.find(
          (item) => item.name === toTitle(data.name)
        );

        if (existingItem) {
          return clientSideErrorResponse("This item is already added");
        }
      }

      const modifiedInvoice = await Invoice.findOneAndUpdate(
        { _id: id },
        {
          $push: {
            items: {
              name: toTitle(data.name),

              quantity: +data.quantity,
              unitPrice: +data.unitPrice,
              unit: data.unit,
              type: data.type,
            },
          },
        },
        { new: true }
      );
      modInvoice = modifiedInvoice;
    } else {
      const stock = await Product.findOne({
        SKU: data.name,
        stock: { $gt: 0 },
      });
      if (!stock) {
        return clientSideErrorResponse("No stock, Item found");
      }

      const remainingStock = stock.stock;

      if (Number(data.quantity) > remainingStock) {
        return clientSideErrorResponse("Insufficient stock");
      }

      const existingItem = items.find((item) => item.name === stock.SKU);

      if (existingItem) {
        return clientSideErrorResponse("This item is already added");
      }

      item = {
        id: stock._id.toString(),
        quantity: Number(data.quantity),
        unitPrice: Number(data.unitPrice),
        serialNo: data.serialNo,
        type: "Stock",
        unit: data.unit.toString(),
        name: stock.SKU.toString(),
      };

      const invoice = await Invoice.findOneAndUpdate(
        { _id: id },
        { $push: { items: item } },
        { new: true }
      );
      const newStock = remainingStock - Number(data.quantity);
      modInvoice = invoice;
      stock.stock = newStock;
      await stock.save();

      const amount = Number(data.quantity) * Number(data.unitPrice);

      await StockTransaction.create({
        SKU: stock.SKU,
        amount,
        ref: invoice.invoiceNumber,
        transactionType: "Sale",
        quantity: data.quantity,
      });
    }

    let totalAmount = 0;
    if (modInvoice && modInvoice.items) {
      for (var i of modInvoice.items) {
        totalAmount += i.unitPrice * i.quantity;
      }
    }
    const date = format(modInvoice.createdAt, "dd-MM-yyyy");
    return okResponse({
      date,
      items: modInvoice.items,
      invoiceNumber: modInvoice.invoiceNumber,

      customerName: modInvoice.customer.name,
      _id: modInvoice._id.toString(),
      description: modInvoice.description,
      customerEmail: modInvoice.customer.email,
      customerAddress: modInvoice.customer.address,
      status: modInvoice.satus,
      discount: modInvoice.discount,
      taxRate: modInvoice.taxRate,
      totalAmount: totalAmount,
      paymentMethod: modInvoice.paymentMethod,

      totalAmount: totalAmount.toString(),
    });
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function DELETE(req, { params }) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    dbConnect();
    const id = (await params).id;
    const { itemId } = await req.json();

    const res = await Invoice.findOneAndUpdate(
      { _id: id },
      { $pull: { items: { _id: itemId } } },
      { new: true }
    );
    if (res) {
      const deletedItem = res.items.find((item) => item._id == itemId);
      if (deletedItem) {
        console.log(deletedItem);
        const result = await StockTransaction.deleteOne({
          SKU: deletedItem.name,
          ref: res.invoiceNumber,
        });

        console.log(result);
        const res2 = await Product.updateOne(
          { SKU: deletedItem.name },
          { $inc: { stock: deletedItem.quantity } }
        );

        console.log(res2);
      }
    }

    let totalAmount = 0;
    if (res && res.items) {
      for (var item of res.items) {
        totalAmount += item.unitPrice * item.quantity;
      }
    }

    const date = format(res.createdAt, "mm-MM-yyyy");
    console.log(totalAmount);
    return okResponse({
      date,
      invoiceNumber: res.invoiceNumber,
      items: res.items ?? [],
      customerName: res.customer.name,
      customerEmail: res.customer.email,
      customerAddress: res.customer.address,
      status: res.satus,
      discount: res.discount,
      taxRate: res.taxRate,
      totalAmount: totalAmount,
      paymentMethod: res.paymentMethod,
      _id: res._id.toString(),
    });
  } catch (e) {
    return errorHandlers(e);
  }
}
