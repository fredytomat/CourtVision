import {
  applyPolarSubscriptionWebhook,
  attachDuitkuTransaction,
  createDuitkuOrder,
  createRefreshSession,
  getDuitkuOrder,
  getEntitlement,
  getUser,
  linkPolarLicense,
  listDevices,
  markWebhookProcessed,
  markDuitkuOrderStatus,
  recordWebhookEvent,
  registerDevice,
  requireActiveSession,
  revokeDevice,
  revokeSession,
  rotateRefreshSession,
  upsertGoogleUser,
} from "./database";
import { randomToken, sha256Hex, signAccessToken, verifyAccessToken } from "./crypto";
import {
  createDuitkuTransaction,
  DUITKU_PLANS,
  getDuitkuApiKey,
  getDuitkuMerchantCode,
  getDuitkuPaymentMethods,
  getDuitkuTransactionStatus,
  verifyDuitkuCallbackSignature,
  type DuitkuPlan,
} from "./duitku";
import { verifyGoogleAccessToken, verifyGoogleIdToken } from "./google";
import { corsHeaders, json, readJson, requireObject, requireString, withCors } from "./http";
import { hashWebhookPayload, parsePolarSubscriptionWebhook, validatePolarLicense, verifyStandardWebhook } from "./polar";
import type { RuntimeEnv } from "./env";
import type { AccessTokenClaims, AuthenticatedSession, DevicePlatform } from "./types";
import { ApiError } from "./types";

const PLATFORMS = new Set<DevicePlatform>(["extension", "mobile", "web"]);

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function requireSecret(value: string | undefined, name: string): string {
  if (!value) throw new ApiError(503, "SERVER_NOT_CONFIGURED", `${name} is not configured`);
  return value;
}

function requirePlan(value: unknown): DuitkuPlan {
  if (value !== "monthly" && value !== "yearly") {
    throw new ApiError(400, "INVALID_PLAN", "Pilih paket bulanan atau tahunan");
  }
  return value;
}

function requireEmail(value: unknown): string {
  const email = requireString(value, "email", 5, 50).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, "INVALID_EMAIL", "Alamat email tidak valid");
  }
  return email;
}

function optionalPhone(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const phone = requireString(value, "phoneNumber", 8, 20).replace(/[\s()-]/g, "");
  if (!/^\+?[0-9]{8,16}$/.test(phone)) {
    throw new ApiError(400, "INVALID_PHONE", "Nomor telepon tidak valid");
  }
  return phone;
}

async function readDuitkuCallback(request: Request): Promise<{ raw: string; values: URLSearchParams }> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    throw new ApiError(415, "FORM_REQUIRED", "Content-Type callback tidak valid");
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 65_536) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Callback terlalu besar");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 65_536) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Callback terlalu besar");
  }
  return { raw, values: new URLSearchParams(raw) };
}

async function createTokens(
  env: RuntimeEnv,
  userId: string,
  deviceId: string,
  sessionId: string,
  refreshToken: string,
  now: number,
): Promise<{ accessToken: string; accessTokenExpiresAt: number; refreshToken: string; refreshTokenExpiresAt: number }> {
  const accessTtl = positiveInteger(env.ACCESS_TOKEN_TTL_SECONDS, "ACCESS_TOKEN_TTL_SECONDS");
  const refreshDays = positiveInteger(env.REFRESH_TOKEN_TTL_DAYS, "REFRESH_TOKEN_TTL_DAYS");
  const claims: AccessTokenClaims = {
    sub: userId,
    sid: sessionId,
    did: deviceId,
    iat: now,
    exp: now + accessTtl,
    jti: crypto.randomUUID(),
  };
  return {
    accessToken: await signAccessToken(claims, requireSecret(env.TOKEN_SIGNING_SECRET, "TOKEN_SIGNING_SECRET")),
    accessTokenExpiresAt: claims.exp,
    refreshToken,
    refreshTokenExpiresAt: now + refreshDays * 86_400,
  };
}

async function authenticate(request: Request, env: RuntimeEnv): Promise<AuthenticatedSession> {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required");
  const claims = await verifyAccessToken(
    authorization.slice(7),
    requireSecret(env.TOKEN_SIGNING_SECRET, "TOKEN_SIGNING_SECRET"),
  );
  await requireActiveSession(env.DB, claims.sid, claims.sub, claims.did, nowSeconds());
  return { userId: claims.sub, sessionId: claims.sid, deviceId: claims.did };
}

async function handleGoogleLogin(request: Request, env: RuntimeEnv): Promise<Response> {
  const body = requireObject(await readJson(request));
  const profile = typeof body.idToken === "string"
    ? await verifyGoogleIdToken(
      requireString(body.idToken, "idToken", 100, 10_000),
      env.GOOGLE_CLIENT_IDS,
      nowSeconds(),
    )
    : await verifyGoogleAccessToken(
      requireString(body.accessToken, "accessToken", 20, 10_000),
      env.GOOGLE_CLIENT_IDS,
    );
  const installationId = requireString(body.installationId, "installationId", 16, 200);
  const deviceLabel = requireString(body.deviceLabel, "deviceLabel", 1, 80);
  const platform = requireString(body.platform, "platform", 3, 20) as DevicePlatform;
  if (!PLATFORMS.has(platform)) throw new ApiError(400, "INVALID_PLATFORM", "Unsupported device platform");

  const now = nowSeconds();
  const user = await upsertGoogleUser(
    env.DB,
    profile,
    now,
    positiveInteger(env.TRIAL_DAYS, "TRIAL_DAYS"),
  );
  const device = await registerDevice(
    env.DB,
    user.id,
    await sha256Hex(installationId),
    deviceLabel,
    platform,
    positiveInteger(env.MAX_ACTIVE_DEVICES, "MAX_ACTIVE_DEVICES"),
    now,
  );
  const refreshToken = randomToken();
  const refreshExpiresAt = now + positiveInteger(env.REFRESH_TOKEN_TTL_DAYS, "REFRESH_TOKEN_TTL_DAYS") * 86_400;
  const sessionId = await createRefreshSession(
    env.DB,
    user.id,
    device.id,
    await sha256Hex(refreshToken),
    refreshExpiresAt,
    now,
  );
  const entitlement = await getEntitlement(env.DB, user.id, now);
  return json({
    user: { id: user.id, email: user.email, name: user.display_name, picture: user.avatar_url },
    device: { id: device.id, label: device.label, platform: device.platform },
    entitlement,
    maxActiveDevices: positiveInteger(env.MAX_ACTIVE_DEVICES, "MAX_ACTIVE_DEVICES"),
    tokens: await createTokens(env, user.id, device.id, sessionId, refreshToken, now),
  });
}

async function handleRefresh(request: Request, env: RuntimeEnv): Promise<Response> {
  const body = requireObject(await readJson(request));
  const oldRefreshToken = requireString(body.refreshToken, "refreshToken", 32, 200);
  const newRefreshToken = randomToken();
  const now = nowSeconds();
  const refreshExpiresAt = now + positiveInteger(env.REFRESH_TOKEN_TTL_DAYS, "REFRESH_TOKEN_TTL_DAYS") * 86_400;
  const session = await rotateRefreshSession(
    env.DB,
    await sha256Hex(oldRefreshToken),
    await sha256Hex(newRefreshToken),
    refreshExpiresAt,
    now,
  );
  return json({
    tokens: await createTokens(env, session.userId, session.deviceId, session.sessionId, newRefreshToken, now),
  });
}

async function handleMe(request: Request, env: RuntimeEnv): Promise<Response> {
  const session = await authenticate(request, env);
  const [user, entitlement, devices] = await Promise.all([
    getUser(env.DB, session.userId),
    getEntitlement(env.DB, session.userId, nowSeconds()),
    listDevices(env.DB, session.userId),
  ]);
  return json({
    user: { id: user.id, email: user.email, name: user.display_name, picture: user.avatar_url },
    entitlement,
    maxActiveDevices: positiveInteger(env.MAX_ACTIVE_DEVICES, "MAX_ACTIVE_DEVICES"),
    devices: devices.map((device) => ({
      id: device.id,
      label: device.label,
      platform: device.platform,
      createdAt: device.created_at,
      lastSeenAt: device.last_seen_at,
      current: device.id === session.deviceId,
    })),
  });
}

async function handleLogout(request: Request, env: RuntimeEnv): Promise<Response> {
  const session = await authenticate(request, env);
  await revokeSession(env.DB, session.sessionId, nowSeconds());
  return json({ success: true });
}

async function handleDeviceDelete(request: Request, env: RuntimeEnv, deviceId: string): Promise<Response> {
  const session = await authenticate(request, env);
  const removed = await revokeDevice(env.DB, session.userId, deviceId, nowSeconds());
  if (!removed) throw new ApiError(404, "DEVICE_NOT_FOUND", "Active device was not found");
  return json({ success: true, signedOutCurrentDevice: deviceId === session.deviceId });
}

async function handlePolarLink(request: Request, env: RuntimeEnv): Promise<Response> {
  const session = await authenticate(request, env);
  const body = requireObject(await readJson(request));
  const licenseKey = requireString(body.licenseKey, "licenseKey", 10, 200).toUpperCase();
  const license = await validatePolarLicense(
    licenseKey,
    env.POLAR_ORGANIZATION_ID,
    requireSecret(env.POLAR_ACCESS_TOKEN, "POLAR_ACCESS_TOKEN"),
    env.POLAR_API_BASE_URL,
  );
  await linkPolarLicense(env.DB, {
    userId: session.userId,
    licenseHash: await sha256Hex(licenseKey),
    licenseHint: licenseKey.slice(-6),
    licenseId: license.id,
    customerId: license.customerId,
    expiresAt: license.expiresAt,
  }, nowSeconds());
  return json({ success: true, entitlement: await getEntitlement(env.DB, session.userId, nowSeconds()) });
}

async function handlePolarWebhook(request: Request, env: RuntimeEnv): Promise<Response> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 262_144) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Webhook payload is too large");
  }
  const verified = await verifyStandardWebhook(
    body,
    request.headers,
    requireSecret(env.POLAR_WEBHOOK_SECRET, "POLAR_WEBHOOK_SECRET"),
  );
  let event: unknown;
  try {
    event = JSON.parse(body) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Webhook payload is not valid JSON");
  }
  const eventType = event && typeof event === "object" && typeof (event as Record<string, unknown>).type === "string"
    ? (event as Record<string, unknown>).type as string
    : "unknown";
  const inserted = await recordWebhookEvent(
    env.DB,
    "polar",
    verified.id,
    eventType,
    await hashWebhookPayload(body),
    nowSeconds(),
  );
  if (!inserted) return json({ received: true, duplicate: true });

  const subscriptionUpdate = parsePolarSubscriptionWebhook(event);
  try {
    const changedSubscriptions = subscriptionUpdate
      ? await applyPolarSubscriptionWebhook(env.DB, subscriptionUpdate, nowSeconds())
      : 0;
    await markWebhookProcessed(env.DB, "polar", verified.id, nowSeconds(), null);
    return json({ received: true, duplicate: false, changedSubscriptions });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown webhook processing error";
    await markWebhookProcessed(env.DB, "polar", verified.id, nowSeconds(), message);
    throw error;
  }
}

async function handleDuitkuMethods(url: URL, env: RuntimeEnv): Promise<Response> {
  const plan = requirePlan(url.searchParams.get("plan"));
  const methods = await getDuitkuPaymentMethods(env, DUITKU_PLANS[plan].amount);
  return json({
    plan,
    amount: DUITKU_PLANS[plan].amount,
    methods: methods.map((method) => ({
      code: method.paymentMethod,
      name: method.paymentName,
      image: method.paymentImage,
      fee: Number(method.totalFee || 0),
    })),
  });
}

async function handleDuitkuCheckout(request: Request, env: RuntimeEnv): Promise<Response> {
  const body = requireObject(await readJson(request));
  const plan = requirePlan(body.plan);
  const customerName = requireString(body.name, "name", 2, 50);
  const email = requireEmail(body.email);
  const phoneNumber = optionalPhone(body.phoneNumber);
  const paymentMethod = requireString(body.paymentMethod, "paymentMethod", 1, 10).toUpperCase();
  if (!/^[A-Z0-9]+$/.test(paymentMethod)) {
    throw new ApiError(400, "INVALID_PAYMENT_METHOD", "Metode pembayaran tidak valid");
  }
  const selected = DUITKU_PLANS[plan];
  const orderId = `CV${Date.now()}${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = nowSeconds();
  await createDuitkuOrder(env.DB, {
    id: orderId,
    customerEmail: email,
    customerName,
    customerPhone: phoneNumber || null,
    plan,
    amount: selected.amount,
    durationDays: selected.durationDays,
    paymentMethod,
  }, now);
  const transaction = await createDuitkuTransaction(env, {
    orderId,
    amount: selected.amount,
    paymentMethod,
    productDetails: selected.label,
    customerName,
    email,
    phoneNumber,
  });
  await attachDuitkuTransaction(env.DB, orderId, transaction.reference, transaction.paymentUrl, nowSeconds());
  return json({
    orderId,
    reference: transaction.reference,
    amount: selected.amount,
    paymentUrl: transaction.paymentUrl,
  }, { status: 201 });
}

async function handleDuitkuOrder(env: RuntimeEnv, orderId: string): Promise<Response> {
  const order = await getDuitkuOrder(env.DB, orderId);
  return json({
    orderId: order.id,
    plan: order.plan,
    amount: order.amount,
    status: order.status,
    createdAt: order.created_at,
    paidAt: order.paid_at,
  });
}

async function handleDuitkuWebhook(request: Request, env: RuntimeEnv): Promise<Response> {
  const { raw, values } = await readDuitkuCallback(request);
  const merchantCode = values.get("merchantCode") ?? "";
  const merchantOrderId = values.get("merchantOrderId") ?? "";
  const amount = values.get("amount") ?? "";
  const reference = values.get("reference") ?? "";
  const signature = values.get("signature") ?? "";
  if (!merchantOrderId || !amount || !reference || merchantCode !== getDuitkuMerchantCode(env)) {
    throw new ApiError(400, "INVALID_DUITKU_CALLBACK", "Callback Duitku tidak lengkap");
  }
  const verified = await verifyDuitkuCallbackSignature(
    merchantCode,
    amount,
    merchantOrderId,
    signature,
    getDuitkuApiKey(env),
  );
  if (!verified) throw new ApiError(401, "INVALID_DUITKU_SIGNATURE", "Signature Duitku tidak valid");

  const order = await getDuitkuOrder(env.DB, merchantOrderId);
  if (Number(amount) !== order.amount) {
    throw new ApiError(409, "DUITKU_AMOUNT_MISMATCH", "Nominal transaksi tidak cocok");
  }
  const eventId = `${merchantOrderId}:${reference}:${values.get("resultCode") ?? "unknown"}`;
  const inserted = await recordWebhookEvent(env.DB, "duitku", eventId, "payment.callback", await sha256Hex(raw), nowSeconds());
  if (!inserted) return json({ received: true, duplicate: true });

  try {
    const status = await getDuitkuTransactionStatus(env, merchantOrderId);
    if (
      status.merchantOrderId !== merchantOrderId ||
      status.reference !== reference ||
      Number(status.amount) !== order.amount
    ) {
      throw new ApiError(409, "DUITKU_STATUS_MISMATCH", "Status transaksi tidak cocok");
    }
    const mappedStatus = status.statusCode === "00"
      ? "paid"
      : status.statusCode === "01"
        ? "pending"
        : "failed";
    await markDuitkuOrderStatus(env.DB, merchantOrderId, reference, mappedStatus, nowSeconds());
    await markWebhookProcessed(env.DB, "duitku", eventId, nowSeconds(), null);
    return json({ received: true, duplicate: false });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown Duitku webhook error";
    await markWebhookProcessed(env.DB, "duitku", eventId, nowSeconds(), message);
    throw error;
  }
}

async function route(request: Request, env: RuntimeEnv): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method === "GET" && url.pathname === "/health") {
    return json({ status: "ok", service: "courtvision-license-api" });
  }
  if (method === "POST" && url.pathname === "/v1/auth/google") return handleGoogleLogin(request, env);
  if (method === "POST" && url.pathname === "/v1/auth/refresh") return handleRefresh(request, env);
  if (method === "POST" && url.pathname === "/v1/auth/logout") return handleLogout(request, env);
  if (method === "GET" && url.pathname === "/v1/me") return handleMe(request, env);
  if (method === "POST" && url.pathname === "/v1/billing/polar/link") return handlePolarLink(request, env);
  if (method === "POST" && url.pathname === "/v1/webhooks/polar") return handlePolarWebhook(request, env);
  if (method === "GET" && url.pathname === "/v1/billing/duitku/methods") return handleDuitkuMethods(url, env);
  if (method === "POST" && url.pathname === "/v1/billing/duitku/checkout") return handleDuitkuCheckout(request, env);
  if (method === "POST" && url.pathname === "/v1/webhooks/duitku") return handleDuitkuWebhook(request, env);
  const orderMatch = url.pathname.match(/^\/v1\/billing\/duitku\/orders\/([A-Z0-9-]{10,50})$/i);
  if (method === "GET" && orderMatch) return handleDuitkuOrder(env, orderMatch[1]);
  const deviceMatch = url.pathname.match(/^\/v1\/devices\/([0-9a-f-]{36})$/i);
  if (method === "DELETE" && deviceMatch) return handleDeviceDelete(request, env, deviceMatch[1]);
  throw new ApiError(404, "NOT_FOUND", "Endpoint was not found");
}

export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    const cors = corsHeaders(request, env.ALLOWED_ORIGINS);
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin");
      if (origin && !cors.has("Access-Control-Allow-Origin")) {
        return json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin is not allowed" } }, { status: 403 });
      }
      return withCors(new Response(null, { status: 204 }), cors);
    }
    try {
      return withCors(await route(request, env), cors);
    } catch (error) {
      const apiError = error instanceof ApiError
        ? error
        : new ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred");
      if (!(error instanceof ApiError)) {
        console.error(JSON.stringify({
          message: "unhandled request error",
          method: request.method,
          path: new URL(request.url).pathname,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      return withCors(json({ error: { code: apiError.code, message: apiError.message } }, { status: apiError.status }), cors);
    }
  },
} satisfies ExportedHandler<RuntimeEnv>;
