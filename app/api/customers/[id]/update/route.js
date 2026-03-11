import dbConnect from "../../../../config/dbConnect";
import { isAuth } from "../../../../middlewares/auth";
import Account from "../../../../models/account";

import { validateAccount } from "../../../../mongodb/validators";

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
    await dbConnect();
    const id = (await params).id;

    const rawFormData = await req.json();

    const validatedFields = validateAccount(rawFormData);

    if (!validatedFields.success) {
      return clientSideErrorResponse("Missing Fields. Failed to add stock.");
    }

    const data = validatedFields.data;

    const result = await Account.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          name: toTitle(data.name),
          address: data.address,
          email: data.email,
          phoneNumber: data.phoneNumber,
          status: "Active",

          creator: {
            name: req.userName,
            id: req.userId,
          },
        },
      }
    );

    return okResponse(result);
  } catch (e) {
    return errorHandlers(e);
  }
}
