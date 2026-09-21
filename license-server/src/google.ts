import { base64UrlDecode, decodeJsonSegment } from "./crypto";
import type { GoogleProfile } from "./types";
import { ApiError } from "./types";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_TOKEN_INFO_URL = "https://www.googleapis.com/oauth2/v2/tokeninfo";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const encoder = new TextEncoder();

type GoogleHeader = { alg: "RS256"; kid: string };
type GoogleJwk = JsonWebKey & { kid: string };
type GoogleClaims = {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  exp: number;
  iat: number;
};

function parseHeader(value: unknown): GoogleHeader {
  if (!value || typeof value !== "object") throw new ApiError(401, "INVALID_GOOGLE_TOKEN", "Invalid Google token");
  const header = value as Record<string, unknown>;
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new ApiError(401, "INVALID_GOOGLE_TOKEN", "Invalid Google token");
  }
  return { alg: "RS256", kid: header.kid };
}

function parseClaims(value: unknown): GoogleClaims {
  if (!value || typeof value !== "object") throw new ApiError(401, "INVALID_GOOGLE_TOKEN", "Invalid Google token");
  const claims = value as Record<string, unknown>;
  if (
    typeof claims.iss !== "string" ||
    typeof claims.aud !== "string" ||
    typeof claims.sub !== "string" ||
    typeof claims.email !== "string" ||
    typeof claims.email_verified !== "boolean" ||
    typeof claims.exp !== "number" ||
    typeof claims.iat !== "number"
  ) {
    throw new ApiError(401, "INVALID_GOOGLE_TOKEN", "Invalid Google token");
  }
  return {
    iss: claims.iss,
    aud: claims.aud,
    sub: claims.sub,
    email: claims.email,
    email_verified: claims.email_verified,
    name: typeof claims.name === "string" ? claims.name : undefined,
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
    exp: claims.exp,
    iat: claims.iat,
  };
}

function isGoogleJwk(value: unknown): value is GoogleJwk {
  if (!value || typeof value !== "object") return false;
  const key = value as Record<string, unknown>;
  return typeof key.kid === "string" && typeof key.kty === "string";
}

function parseJwks(value: unknown): GoogleJwk[] {
  if (!value || typeof value !== "object") throw new Error("Google JWKS response is invalid");
  const keys = (value as Record<string, unknown>).keys;
  if (!Array.isArray(keys)) throw new Error("Google JWKS response is invalid");
  return keys.filter(isGoogleJwk);
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientIdsCsv: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<GoogleProfile> {
  const segments = idToken.split(".");
  if (segments.length !== 3) throw new ApiError(401, "INVALID_GOOGLE_TOKEN", "Invalid Google token");
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = parseHeader(decodeJsonSegment(encodedHeader));
  const claims = parseClaims(decodeJsonSegment(encodedPayload));
  const audiences = new Set(clientIdsCsv.split(",").map((value) => value.trim()).filter(Boolean));

  if (
    !GOOGLE_ISSUERS.has(claims.iss) ||
    !audiences.has(claims.aud) ||
    !claims.email_verified ||
    claims.exp <= nowSeconds ||
    claims.iat > nowSeconds + 60
  ) {
    throw new ApiError(401, "INVALID_GOOGLE_TOKEN", "Google token is not valid for CourtVision");
  }

  const response = await fetch(GOOGLE_JWKS_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new ApiError(503, "GOOGLE_UNAVAILABLE", "Google sign-in is temporarily unavailable");
  const key = parseJwks(await response.json()).find((candidate) => candidate.kid === header.kid);
  if (!key) throw new ApiError(401, "INVALID_GOOGLE_TOKEN", "Google signing key was not found");
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    base64UrlDecode(encodedSignature),
    encoder.encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!verified) throw new ApiError(401, "INVALID_GOOGLE_TOKEN", "Invalid Google token signature");

  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}

type GoogleAccessTokenInfo = {
  audience?: string;
  issued_to?: string;
  user_id?: string;
  expires_in?: number;
  email?: string;
  verified_email?: boolean;
};

export async function verifyGoogleAccessToken(
  accessToken: string,
  clientIdsCsv: string,
): Promise<GoogleProfile> {
  const response = await fetch(GOOGLE_TOKEN_INFO_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ access_token: accessToken }),
  });
  if (!response.ok) {
    if (response.status >= 500) {
      throw new ApiError(503, "GOOGLE_UNAVAILABLE", "Google sign-in is temporarily unavailable");
    }
    throw new ApiError(401, "INVALID_GOOGLE_TOKEN", "Google access token is invalid");
  }

  const token = await response.json() as GoogleAccessTokenInfo;
  const audiences = new Set(clientIdsCsv.split(",").map((value) => value.trim()).filter(Boolean));
  const audience = token.audience ?? token.issued_to;
  if (
    !audience ||
    !audiences.has(audience) ||
    typeof token.user_id !== "string" ||
    typeof token.email !== "string" ||
    token.verified_email !== true ||
    typeof token.expires_in !== "number" ||
    token.expires_in <= 0
  ) {
    throw new ApiError(401, "INVALID_GOOGLE_TOKEN", "Google token is not valid for CourtVision");
  }

  return {
    sub: token.user_id,
    email: token.email.toLowerCase(),
    name: null,
    picture: null,
  };
}
