import { sha256Hex } from "./crypto";
import { ApiError } from "./types";

type PolarLicense = {
  id: string;
  status: string;
  customerId: string | null;
  expiresAt: number | null;
};

export type PolarSubscriptionWebhook = {
  customerId: string;
  status: "active" | "past_due" | "canceled" | "revoked";
  currentPeriodEnd: number | null;
};

function parsePolarLicense(value: unknown): PolarLicense {
  if (!value || typeof value !== "object") throw new ApiError(502, "POLAR_INVALID_RESPONSE", "Polar returned an invalid response");
  const root = value as Record<string, unknown>;
  const rawLicense = root.license_key && typeof root.license_key === "object"
    ? root.license_key as Record<string, unknown>
    : root;
  if (typeof rawLicense.id !== "string" || typeof rawLicense.status !== "string") {
    throw new ApiError(502, "POLAR_INVALID_RESPONSE", "Polar returned an invalid license response");
  }
  const rawExpiry = rawLicense.expires_at;
  const expiryMs = typeof rawExpiry === "string" ? Date.parse(rawExpiry) : Number.NaN;
  return {
    id: rawLicense.id,
    status: rawLicense.status,
    customerId: typeof rawLicense.customer_id === "string" ? rawLicense.customer_id : null,
    expiresAt: Number.isFinite(expiryMs) ? Math.floor(expiryMs / 1000) : null,
  };
}

export async function validatePolarLicense(
  key: string,
  organizationId: string,
  accessToken: string,
  apiBaseUrl: string,
): Promise<PolarLicense> {
  const validateUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/license-keys/validate`;
  const response = await fetch(validateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ key, organization_id: organizationId }),
  });
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new ApiError(503, "POLAR_UNAVAILABLE", "Polar verification is temporarily unavailable");
  }
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(503, "POLAR_NOT_CONFIGURED", "Polar verification is not configured correctly");
  }
  if (!response.ok) throw new ApiError(400, "POLAR_LICENSE_INVALID", "Polar license is invalid");
  const license = parsePolarLicense(await response.json());
  if (license.status !== "granted") throw new ApiError(400, "POLAR_LICENSE_INACTIVE", "Polar license is not active");
  return license;
}

export async function verifyStandardWebhook(
  body: string,
  headers: Headers,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ id: string; timestamp: number }> {
  const id = headers.get("webhook-id");
  const timestampValue = headers.get("webhook-timestamp");
  const signatureValue = headers.get("webhook-signature");
  if (!id || !timestampValue || !signatureValue) {
    throw new ApiError(401, "INVALID_WEBHOOK_SIGNATURE", "Missing webhook signature headers");
  }
  const timestamp = Number(timestampValue);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) {
    throw new ApiError(401, "WEBHOOK_TIMESTAMP_INVALID", "Webhook timestamp is outside the allowed window");
  }

  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(encodedSecret), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("POLAR_WEBHOOK_SECRET is not valid base64");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signedContent = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const signatures = signatureValue.split(" ").flatMap((entry) => {
    const [version, signature] = entry.split(",", 2);
    return version === "v1" && signature ? [signature] : [];
  });
  for (const signature of signatures) {
    try {
      const bytes = Uint8Array.from(atob(signature), (character) => character.charCodeAt(0));
      if (await crypto.subtle.verify("HMAC", key, bytes, signedContent)) return { id, timestamp };
    } catch {
      continue;
    }
  }
  throw new ApiError(401, "INVALID_WEBHOOK_SIGNATURE", "Webhook signature is invalid");
}

export async function hashWebhookPayload(body: string): Promise<string> {
  return sha256Hex(body);
}

export function parsePolarSubscriptionWebhook(event: unknown): PolarSubscriptionWebhook | null {
  if (!event || typeof event !== "object") return null;
  const root = event as Record<string, unknown>;
  if (typeof root.type !== "string" || !root.data || typeof root.data !== "object") return null;
  const data = root.data as Record<string, unknown>;
  if (typeof data.customer_id !== "string") return null;

  const statusByEvent: Record<string, PolarSubscriptionWebhook["status"] | undefined> = {
    "subscription.active": "active",
    "subscription.uncanceled": "active",
    "subscription.past_due": "past_due",
    "subscription.revoked": "revoked",
  };
  let status = statusByEvent[root.type];
  if (root.type === "subscription.canceled") {
    // Polar's default cancellation is end-of-period. Access stays active until
    // current_period_end; an immediate loss of access emits subscription.revoked.
    status = "active";
  } else if (root.type === "subscription.updated" && typeof data.status === "string") {
    const normalized = data.status.toLowerCase();
    if (normalized === "active" || normalized === "trialing") status = "active";
    else if (normalized === "past_due") status = "past_due";
    else if (normalized === "revoked" || normalized === "unpaid") status = "revoked";
    else if (normalized === "canceled") status = "canceled";
  }
  if (!status) return null;

  const rawPeriodEnd = data.current_period_end;
  const periodEndMs = typeof rawPeriodEnd === "string" ? Date.parse(rawPeriodEnd) : Number.NaN;
  return {
    customerId: data.customer_id,
    status,
    currentPeriodEnd: Number.isFinite(periodEndMs) ? Math.floor(periodEndMs / 1000) : null,
  };
}
