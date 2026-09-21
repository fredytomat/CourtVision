import type { RuntimeEnv } from "./env";
import { ApiError } from "./types";

const encoder = new TextEncoder();
const MAX_RESPONSE_BYTES = 65_536;
const REQUEST_TIMEOUT_MS = 12_000;

export const DUITKU_PLANS = {
  monthly: { amount: 130_000, durationDays: 30, label: "CourtVision Pro Bulanan" },
  yearly: { amount: 1_040_000, durationDays: 365, label: "CourtVision Pro Tahunan" },
} as const;

export type DuitkuPlan = keyof typeof DUITKU_PLANS;

export type DuitkuPaymentMethod = {
  paymentMethod: string;
  paymentName: string;
  paymentImage: string;
  totalFee: string;
};

export type DuitkuTransaction = {
  reference: string;
  paymentUrl: string;
  amount: number;
  statusCode: string;
  statusMessage: string;
};

export type DuitkuTransactionStatus = {
  merchantOrderId: string;
  reference: string;
  amount: string;
  statusCode: "00" | "01" | "02" | string;
  statusMessage: string;
};

function requireDuitkuConfig(env: RuntimeEnv): {
  merchantCode: string;
  apiKey: string;
  apiBaseUrl: string;
  callbackUrl: string;
  returnUrl: string;
} {
  const values = {
    merchantCode: env.DUITKU_MERCHANT_CODE,
    apiKey: env.DUITKU_API_KEY,
    apiBaseUrl: env.DUITKU_API_BASE_URL,
    callbackUrl: env.DUITKU_CALLBACK_URL,
    returnUrl: env.DUITKU_RETURN_URL,
  };
  if (Object.values(values).some((value) => !value || value.startsWith("replace-with-"))) {
    throw new ApiError(503, "DUITKU_NOT_CONFIGURED", "Pembayaran Duitku belum dikonfigurasi");
  }
  return values as Record<keyof typeof values, string>;
}

async function importHmacKey(secret: string, usages: Array<"sign" | "verify">): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importHmacKey(secret, ["sign"]),
    encoder.encode(message),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16));
}

export async function verifyDuitkuCallbackSignature(
  merchantCode: string,
  amount: string,
  merchantOrderId: string,
  signature: string,
  apiKey: string,
): Promise<boolean> {
  const signatureBytes = hexToBytes(signature);
  if (!signatureBytes) return false;
  return crypto.subtle.verify(
    "HMAC",
    await importHmacKey(apiKey, ["verify"]),
    signatureBytes,
    encoder.encode(`${merchantCode}${amount}${merchantOrderId}`),
  );
}

export function jakartaDateTime(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second}`;
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new ApiError(502, "DUITKU_INVALID_RESPONSE", "Respons Duitku terlalu besar");
  }
  const body = await response.text();
  if (encoder.encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new ApiError(502, "DUITKU_INVALID_RESPONSE", "Respons Duitku terlalu besar");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new ApiError(502, "DUITKU_INVALID_RESPONSE", "Respons Duitku tidak valid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(502, "DUITKU_INVALID_RESPONSE", "Respons Duitku tidak valid");
  }
  if (!response.ok) {
    const message = typeof (parsed as Record<string, unknown>).Message === "string"
      ? (parsed as Record<string, unknown>).Message as string
      : "Permintaan ke Duitku gagal";
    throw new ApiError(502, "DUITKU_REQUEST_FAILED", message.slice(0, 200));
  }
  return parsed as Record<string, unknown>;
}

async function duitkuPost(url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return await readBoundedJson(response);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "DUITKU_UNAVAILABLE", "Duitku sedang tidak dapat dihubungi");
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDuitkuPaymentMethods(
  env: RuntimeEnv,
  amount: number,
  date = new Date(),
): Promise<DuitkuPaymentMethod[]> {
  const config = requireDuitkuConfig(env);
  const datetime = jakartaDateTime(date);
  const signature = await hmacSha256Hex(`${config.merchantCode}${amount}${datetime}`, config.apiKey);
  const result = await duitkuPost(
    `${config.apiBaseUrl}/paymentmethod/getpaymentmethod`,
    { merchantcode: config.merchantCode, amount, datetime, signature },
  );
  if (result.responseCode !== "00" || !Array.isArray(result.paymentFee)) {
    throw new ApiError(502, "DUITKU_REQUEST_FAILED", "Metode pembayaran Duitku tidak tersedia");
  }
  return result.paymentFee.filter((method): method is DuitkuPaymentMethod => {
    if (!method || typeof method !== "object") return false;
    const item = method as Record<string, unknown>;
    return typeof item.paymentMethod === "string" && typeof item.paymentName === "string";
  });
}

export async function createDuitkuTransaction(
  env: RuntimeEnv,
  input: {
    orderId: string;
    amount: number;
    paymentMethod: string;
    productDetails: string;
    customerName: string;
    email: string;
    phoneNumber: string;
  },
): Promise<DuitkuTransaction> {
  const config = requireDuitkuConfig(env);
  const signature = await hmacSha256Hex(
    `${config.merchantCode}${input.orderId}${input.amount}`,
    config.apiKey,
  );
  const result = await duitkuPost(`${config.apiBaseUrl}/v2/inquiry`, {
    merchantCode: config.merchantCode,
    paymentAmount: input.amount,
    paymentMethod: input.paymentMethod,
    merchantOrderId: input.orderId,
    productDetails: input.productDetails,
    customerVaName: input.customerName,
    email: input.email,
    phoneNumber: input.phoneNumber,
    itemDetails: [{ name: input.productDetails, price: input.amount, quantity: 1 }],
    callbackUrl: config.callbackUrl,
    returnUrl: config.returnUrl,
    signature,
    expiryPeriod: 60,
  });
  if (
    typeof result.reference !== "string" ||
    typeof result.paymentUrl !== "string" ||
    typeof result.statusCode !== "string" ||
    result.statusCode !== "00"
  ) {
    throw new ApiError(502, "DUITKU_REQUEST_FAILED", "Duitku tidak dapat membuat transaksi");
  }
  return {
    reference: result.reference,
    paymentUrl: result.paymentUrl,
    amount: Number(result.amount ?? input.amount),
    statusCode: result.statusCode,
    statusMessage: typeof result.statusMessage === "string" ? result.statusMessage : "SUCCESS",
  };
}

export async function getDuitkuTransactionStatus(
  env: RuntimeEnv,
  merchantOrderId: string,
): Promise<DuitkuTransactionStatus> {
  const config = requireDuitkuConfig(env);
  const signature = await hmacSha256Hex(`${config.merchantCode}${merchantOrderId}`, config.apiKey);
  const result = await duitkuPost(`${config.apiBaseUrl}/transactionStatus`, {
    merchantCode: config.merchantCode,
    merchantOrderId,
    signature,
  });
  if (
    typeof result.merchantOrderId !== "string" ||
    typeof result.reference !== "string" ||
    typeof result.amount !== "string" ||
    typeof result.statusCode !== "string"
  ) {
    throw new ApiError(502, "DUITKU_INVALID_RESPONSE", "Status transaksi Duitku tidak valid");
  }
  return {
    merchantOrderId: result.merchantOrderId,
    reference: result.reference,
    amount: result.amount,
    statusCode: result.statusCode,
    statusMessage: typeof result.statusMessage === "string" ? result.statusMessage : "",
  };
}

export function getDuitkuMerchantCode(env: RuntimeEnv): string {
  return requireDuitkuConfig(env).merchantCode;
}

export function getDuitkuApiKey(env: RuntimeEnv): string {
  return requireDuitkuConfig(env).apiKey;
}
