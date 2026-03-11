import { isAuth } from "../../middlewares/auth";
import {
  createVehicle,
  updateVehicle,
  deactivateVehicle,
  deleteVehicle,
} from "../../mongodb/actions/weighbridge-actions";
import { authErrorResponse, okResponse } from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";

export async function POST(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    const body = await req.json();
    const result = await createVehicle({
      ...body,
      companyId: req.companyId,
      creator: { name: req.userName, id: req.userId },
    });

    if (result.error) {
      return new Response(JSON.stringify({ message: result.error }), { status: 422 });
    }
    return okResponse(result.data);
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
    const body = await req.json();
    const result = await updateVehicle(body);

    if (result.error) {
      return new Response(JSON.stringify({ message: result.error }), { status: 422 });
    }
    return okResponse(result.data);
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function PATCH(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Cannot deactivate");
  }

  try {
    const { id } = await req.json();
    const result = await deactivateVehicle(id);

    if (result.error) return okResponse(result.error);
    return okResponse(result.data);
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function DELETE(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Cannot delete");
  }

  try {
    const { id } = await req.json();
    const result = await deleteVehicle(id);

    if (result.error) return okResponse(result.error);
    return okResponse(result.data);
  } catch (e) {
    return errorHandlers(e);
  }
}
