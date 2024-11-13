import dbConnect from "../../../config/dbConnect";
import { isAuth } from "../../../middlewares/auth";
import Account from "../../../models/account";
import Counter from "../../../models/counter";

import {
  authErrorResponse,
  clientSideErrorResponse,
  failedResponse,
  okResponse,
} from "../../../utils/customres";
import { errorHandlers } from "../../../utils/errorHandler";
import { toTitle } from "../../../utils/validators";
import {
  validateInvoice,
  validateInvoiceWithId,
} from "../../../mongodb/validators";
import Invoice from "../../../models/invoice";

export async function POST(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    dbConnect();

    const rawFormData = await req.json();

    const validatedFields = validateInvoice(rawFormData);

    if (!validatedFields.success) {
      return clientSideErrorResponse("Missing Fields. Failed to add invoices");
    }

    const data = validatedFields.data;

    const account = await Account.findById(data.customerId);
    let invoiceNumber = "1";

    if (!account) {
      return clientSideErrorResponse(" No customer was found");
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // e.g., 20241031
    const counter = await Counter.findOneAndUpdate(
      { name: `invoiceNumber-${today}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    invoiceNumber = `INV-${today}-${counter.seq.toString().padStart(4, "0")}`; // e.g., 20241031-0001
    const customer = {
      name: account.name,
      address: account.address,

      id: account._id.toString(),
      email: account.email,
      phone: account.phone,
    };
    const invoice = Invoice({
      description: data.description,
      taxRate: data.taxRate,
      customer,
      items: [],
      invoiceNumber,
      status: data.status,
    });
    const res = await invoice.save();

    return okResponse(res);
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

    const validatedFields = validateInvoiceWithId(rawFormData);

    if (!validatedFields.success) {
      return clientSideErrorResponse("Missing Fields. Failed to add invoices.");
    }

    const data = validatedFields.data;

    const account = await Account.findById(data.customerId);

    if (!account) {
      return clientSideErrorResponse("No customer was found");
    }

    const customer = {
      name: account.name,
      address: account.address,

      id: account._id.toString(),
      email: account.email,
      phone: account.phone,
    };

    const invoice = await Invoice.findOneAndUpdate(
      { _id: data.id },
      {
        $set: {
          customer: customer,
          discount: data.discount,
          description: data.description,
          status: data.status,
          taxRate: data.taxRate,
        },
      }
    );
    if (!invoice) {
      return failedResponse();
    }

    return okResponse(invoice);
  } catch (e) {
    return errorHandlers(e);
  }
}
