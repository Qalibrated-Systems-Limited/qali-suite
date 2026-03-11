import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import Account from "../../models/account";
import { validateAccount } from "../../mongodb/validators";

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
    await dbConnect();

    const matchStage = {
      $match: { status: "Active" },
    };

    const sortStage = { $sort: { createdAt: -1 } };

    const projectStage = {
      $project: {
        name: 1,
        email: 1,
        nationalId: 1,
        phoneNumber: 1,
        address: 1,
      },
    };

    const pipeline = [matchStage, sortStage, projectStage];

    const result = await Account.aggregate(pipeline);

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
    await dbConnect();

    const rawFormData = await req.json();

    const validatedFields = validateAccount(rawFormData);

    if (!validatedFields.success) {
      return clientSideErrorResponse("Missing Fields. Failed to add stock.");
    }

    const data = validatedFields.data;

    const result = await Account.create({
      name: toTitle(data.name),
      address: data.address,
      email: data.email,
      phoneNumber: data.phoneNumber,
      status: "Active",

      creator: {
        name: req.userName,
        id: req.userId,
      },
    });

    return okResponse(result);
  } catch (e) {
    return errorHandlers(e);
  }
}
