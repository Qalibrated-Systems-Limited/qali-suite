import { isAuth } from "../../middlewares/auth";
import {
  checkBridgeLocked,
  takeFirstWeight,
  takeSecondWeight,
  deactivateTransaction,
} from "../../mongodb/actions/weighbridge-actions";
import {
  authErrorResponse,
  clientSideErrorResponse,
  failedResponse,
  okResponse,
} from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";

// Take first weight
export async function POST(req) {
  await isAuth(req);

  if (!["Admin", "Operator"].includes(req.role)) {
    return authErrorResponse("Not authorized to add transaction");
  }

  try {
    const bridgeCheck = await checkBridgeLocked(req.companyId);
    if (bridgeCheck.error) return authErrorResponse(bridgeCheck.error);

    const body = await req.json();
    const result = await takeFirstWeight({
      ...body,
      companyId: req.companyId,
      creator: { id: req.userId, name: req.userName },
    });

    if (result.error) return clientSideErrorResponse(result.error);
    return okResponse(result.data);
  } catch (e) {
    return errorHandlers(e);
  }
}

// Take second weight
export async function PUT(req) {
  await isAuth(req);

  if (!["Admin", "Operator"].includes(req.role)) {
    return authErrorResponse("Not authorized to add transaction");
  }

  try {
    const bridgeCheck = await checkBridgeLocked(req.companyId);
    if (bridgeCheck.error) return authErrorResponse(bridgeCheck.error);

    const body = await req.json();
    const result = await takeSecondWeight({
      ...body,
      companyId: req.companyId,
      creator: { id: req.userId, name: req.userName },
    });

    if (result.error) return clientSideErrorResponse(result.error);
    return okResponse(result.data);
  } catch (e) {
    return errorHandlers(e);
  }
}

// Archive or deactivate transaction
export async function PATCH(req) {
  await isAuth(req);

  if (!["Admin", "Operator"].includes(req.role)) {
    return authErrorResponse("Not authorized to add transaction");
  }

  try {
    const { id } = await req.json();
    const result = await deactivateTransaction(id);

    if (result.error) return failedResponse(result.error);
    return okResponse(result.data);
  } catch (e) {
    return errorHandlers(e);
  }
}
