import { ApiError } from "./types";

const MAX_JSON_BYTES = 16_384;

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(data, { ...init, headers });
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "JSON_REQUIRED", "Content-Type must be application/json");
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON");
  }
}

export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_REQUEST", "Request body must be an object");
  }
  return value as Record<string, unknown>;
}

export function requireString(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") throw new ApiError(400, "INVALID_REQUEST", `${field} must be a string`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ApiError(400, "INVALID_REQUEST", `${field} must contain ${minimum}-${maximum} characters`);
  }
  return normalized;
}

export function corsHeaders(request: Request, allowedOriginsCsv: string): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  const allowed = new Set(allowedOriginsCsv.split(",").map((value) => value.trim()).filter(Boolean));
  if (allowed.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
    headers.set("Vary", "Origin");
  }
  return headers;
}

export function withCors(response: Response, cors: Headers): Response {
  const headers = new Headers(response.headers);
  cors.forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

