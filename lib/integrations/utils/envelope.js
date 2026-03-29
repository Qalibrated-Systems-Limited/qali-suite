import { NextResponse } from "next/server";
import crypto from "crypto";

// ============================================
// STANDARD RESPONSE ENVELOPE
// Every /api/v1/* response uses this shape:
// { success, data, meta } or { success, error, meta }
// ============================================

/**
 * Generate a short request ID for tracing.
 */
function requestId() {
  return "req_" + crypto.randomBytes(8).toString("hex");
}

/**
 * Success response.
 */
export function okResponse(data, status = 200, meta = {}) {
  return NextResponse.json(
    {
      success: true,
      data,
      meta: {
        requestId: requestId(),
        timestamp: new Date().toISOString(),
        ...meta,
      },
    },
    { status }
  );
}

/**
 * Created response (201).
 */
export function createdResponse(data, meta = {}) {
  return okResponse(data, 201, meta);
}

/**
 * Error response.
 */
export function errorResponse(code, message, httpStatus = 400, extra = {}) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        ...extra,
      },
      meta: {
        requestId: requestId(),
        timestamp: new Date().toISOString(),
      },
    },
    { status: httpStatus }
  );
}

/**
 * Paginated list response.
 */
export function listResponse(items, pagination, meta = {}) {
  return okResponse(
    { items, pagination },
    200,
    meta
  );
}
