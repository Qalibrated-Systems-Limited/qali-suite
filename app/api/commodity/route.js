import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import Commodity from "../../models/commodity";

import {
  okResponse,
  failedResponse,
  authErrorResponse,
} from "../../utils/customres";

import { errorHandlers } from "../../utils/errorHandler";
import { toTitle } from "../../utils/validators";

export async function POST(req) {
  await isAuth(req);

  if (!req.role) {
    return authErrorResponse("Not allowed");
  }
  const { code, name } = await req.json();

  const creator = { name: req.userName, id: req.userId };
  try {
    dbConnect();
    const modName = toTitle(name);

    const commodity = new Commodity({ code, name: modName, creator });

    const result = await commodity.save();

    if (result) {
      return okResponse(result);
    } else {
      return failedResponse();
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

//Get commodities

export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    dbConnect();
    const result = await Commodity.find();
    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    errorHandlers(e);
  }
}

export async function DELETE(req) {
  await isAuth(req);

  if (!req.isAuth) return authErrorResponse("Not allowed");

  const { commodityId } = await req.json();

  try {
    dbConnect();
    await Commodity.findByIdAndDelete(commodityId);

    return okResponse("ok");
  } catch (e) {
    console.log(e);
    return errorHandlers(e);
  }
}
