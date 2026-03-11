import { isAuth } from "../../../middlewares/auth";
import {
  getTransactionById,
  getBridgeConfig,
} from "../../../mongodb/queries/weighbridge-queries";
import { deactivateTransaction } from "../../../mongodb/actions/weighbridge-actions";
import {
  authErrorResponse,
  failedResponse,
  okResponse,
} from "../../../utils/customres";

export async function GET(req, props) {
  const params = await props.params;
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not authorized");
  }

  try {
    const configs = await getBridgeConfig(req.companyId);
    if (!configs || configs.isLocked === 1) {
      return authErrorResponse("Weighbridge locked by admin");
    }

    const result = await getTransactionById(params.id);
    return okResponse(result);
  } catch (e) {
    return failedResponse("Could not get ticket");
  }
}

export async function PUT(req, props) {
  const params = await props.params;
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not authorized");
  }

  try {
    const result = await deactivateTransaction(params.id);
    if (result.error) return failedResponse(result.error);
    return okResponse("Deactivated");
  } catch (e) {
    return failedResponse();
  }
}
