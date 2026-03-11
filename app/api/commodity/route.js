import { isAuth } from "../../middlewares/auth";
import {
  createCommodity,
  deleteCommodity,
} from "../../mongodb/actions/weighbridge-actions";
import { getCommodities } from "../../mongodb/queries/weighbridge-queries";
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

  try {
    const { code, name } = await req.json();
    const result = await createCommodity({
      code,
      name: toTitle(name),
      companyId: req.companyId,
      creator: { name: req.userName, id: req.userId },
    });

    return result.data ? okResponse(result.data) : failedResponse();
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    const result = await getCommodities(req.companyId);
    return result ? okResponse(result) : okResponse([]);
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function DELETE(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    const { commodityId } = await req.json();
    const result = await deleteCommodity(commodityId);
    return result.data ? okResponse("ok") : errorHandlers(new Error("Not found"));
  } catch (e) {
    return errorHandlers(e);
  }
}
