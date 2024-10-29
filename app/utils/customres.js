import { NextResponse } from "next/server";

export const okResponse = (result) => {
  return Response.json({ result: result, message: "success" }, { status: 200 });
};

export const failedResponse = () => {
  return Response.json({ message: "Failed" }, { status: 500 });
};

export const valResponse = (message) => {
  return new Response({ message }, { status: 422 });
};

export const clientSideErrorResponse = (message) => {
  return Response.json({ message }, { status: 400 });
};

export const authErrorResponse = (message) => {
  return Response.json({ message }, { status: 403 });
};
