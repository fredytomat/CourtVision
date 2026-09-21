import type { AccessTokenClaims } from "./types";
import { ApiError } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64UrlEncode(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function decodeJsonSegment(value: string): unknown {
  return JSON.parse(decoder.decode(base64UrlDecode(value))) as unknown;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64UrlEncode(value);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) {
    throw new Error("TOKEN_SIGNING_SECRET must contain at least 32 characters");
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signedPart = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importHmacKey(secret),
    encoder.encode(signedPart),
  );
  return `${signedPart}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function isAccessTokenClaims(value: unknown): value is AccessTokenClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.sub === "string" &&
    typeof claims.sid === "string" &&
    typeof claims.did === "string" &&
    typeof claims.iat === "number" &&
    typeof claims.exp === "number" &&
    typeof claims.jti === "string"
  );
}

export async function verifyAccessToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AccessTokenClaims> {
  const segments = token.split(".");
  if (segments.length !== 3) throw new ApiError(401, "INVALID_TOKEN", "Invalid access token");
  const [header, payload, signature] = segments;
  const parsedHeader = decodeJsonSegment(header);
  if (
    !parsedHeader ||
    typeof parsedHeader !== "object" ||
    (parsedHeader as Record<string, unknown>).alg !== "HS256"
  ) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid access token");
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    await importHmacKey(secret),
    base64UrlDecode(signature),
    encoder.encode(`${header}.${payload}`),
  );
  if (!valid) throw new ApiError(401, "INVALID_TOKEN", "Invalid access token");
  const claims = decodeJsonSegment(payload);
  if (!isAccessTokenClaims(claims) || claims.exp <= nowSeconds) {
    throw new ApiError(401, "TOKEN_EXPIRED", "Access token has expired");
  }
  return claims;
}

