import type { DevicePlatform, Entitlement, GoogleProfile } from "./types";
import { ApiError } from "./types";

type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
};

type DeviceRow = {
  id: string;
  label: string;
  platform: DevicePlatform;
  created_at: number;
  last_seen_at: number;
  revoked_at: number | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  device_id: string;
  expires_at: number;
  revoked_at: number | null;
  device_revoked_at: number | null;
};

type SubscriptionRow = {
  provider: "polar" | "duitku" | "manual";
  current_period_end: number | null;
};

export type DuitkuOrderRow = {
  id: string;
  user_id: string | null;
  customer_email: string;
  customer_name: string;
  customer_phone: string | null;
  plan: "monthly" | "yearly";
  amount: number;
  duration_days: number;
  payment_method: string;
  reference: string | null;
  payment_url: string | null;
  status: "pending" | "paid" | "failed" | "expired";
  created_at: number;
  updated_at: number;
  paid_at: number | null;
};

export async function upsertGoogleUser(
  db: D1Database,
  profile: GoogleProfile,
  now: number,
  trialDays: number,
): Promise<UserRow> {
  const existingByEmail = await db.prepare(
    "SELECT id, google_sub FROM users WHERE email = ?1 COLLATE NOCASE",
  ).bind(profile.email).first<{ id: string; google_sub: string }>();
  if (existingByEmail && existingByEmail.google_sub !== profile.sub) {
    throw new ApiError(409, "ACCOUNT_CONFLICT", "This email is already linked to another Google account");
  }

  const userId = existingByEmail?.id ?? crypto.randomUUID();
  await db.prepare(`
    INSERT INTO users (id, google_sub, email, display_name, avatar_url, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    ON CONFLICT(google_sub) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      updated_at = excluded.updated_at
  `).bind(userId, profile.sub, profile.email, profile.name, profile.picture, now).run();

  await db.prepare(`
    INSERT OR IGNORE INTO trials (user_id, starts_at, ends_at, created_at)
    VALUES (?1, ?2, ?3, ?2)
  `).bind(userId, now, now + trialDays * 86_400).run();

  const user = await db.prepare(
    "SELECT id, email, display_name, avatar_url FROM users WHERE google_sub = ?1",
  ).bind(profile.sub).first<UserRow>();
  if (!user) throw new Error("User upsert did not return a user");
  await claimPaidDuitkuOrders(db, user.id, user.email, now);
  return user;
}

export async function createDuitkuOrder(
  db: D1Database,
  input: {
    id: string;
    customerEmail: string;
    customerName: string;
    customerPhone: string | null;
    plan: "monthly" | "yearly";
    amount: number;
    durationDays: number;
    paymentMethod: string;
  },
  now: number,
): Promise<void> {
  const user = await db.prepare(
    "SELECT id FROM users WHERE email = ?1 COLLATE NOCASE",
  ).bind(input.customerEmail).first<{ id: string }>();
  await db.prepare(`
    INSERT INTO duitku_orders
      (id, user_id, customer_email, customer_name, customer_phone, plan, amount,
       duration_days, payment_method, status, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10, ?10)
  `).bind(
    input.id,
    user?.id ?? null,
    input.customerEmail,
    input.customerName,
    input.customerPhone,
    input.plan,
    input.amount,
    input.durationDays,
    input.paymentMethod,
    now,
  ).run();
}

export async function attachDuitkuTransaction(
  db: D1Database,
  orderId: string,
  reference: string,
  paymentUrl: string,
  now: number,
): Promise<void> {
  const updated = await db.prepare(`
    UPDATE duitku_orders
    SET reference = ?1, payment_url = ?2, updated_at = ?3
    WHERE id = ?4 AND status = 'pending'
    RETURNING id
  `).bind(reference, paymentUrl, now, orderId).first<{ id: string }>();
  if (!updated) throw new ApiError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan");
}

export async function getDuitkuOrder(db: D1Database, orderId: string): Promise<DuitkuOrderRow> {
  const order = await db.prepare(`
    SELECT id, user_id, customer_email, customer_name, customer_phone, plan, amount,
           duration_days, payment_method, reference, payment_url, status, created_at,
           updated_at, paid_at
    FROM duitku_orders WHERE id = ?1
  `).bind(orderId).first<DuitkuOrderRow>();
  if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan");
  return order;
}

export async function markDuitkuOrderStatus(
  db: D1Database,
  orderId: string,
  reference: string,
  status: "pending" | "paid" | "failed" | "expired",
  now: number,
): Promise<void> {
  const order = await getDuitkuOrder(db, orderId);
  if (order.reference && order.reference !== reference) {
    throw new ApiError(409, "DUITKU_REFERENCE_MISMATCH", "Referensi transaksi tidak cocok");
  }
  if (status !== "paid") {
    await db.prepare(`
      UPDATE duitku_orders
      SET reference = COALESCE(reference, ?1), status = ?2, updated_at = ?3
      WHERE id = ?4 AND status <> 'paid'
    `).bind(reference, status, now, orderId).run();
    return;
  }

  const user = order.user_id
    ? { id: order.user_id }
    : await db.prepare("SELECT id FROM users WHERE email = ?1 COLLATE NOCASE")
      .bind(order.customer_email).first<{ id: string }>();
  const periodEnd = now + order.duration_days * 86_400;
  const statements = [
    db.prepare(`
      UPDATE duitku_orders
      SET user_id = COALESCE(user_id, ?1), reference = COALESCE(reference, ?2),
          status = 'paid', paid_at = COALESCE(paid_at, ?3), updated_at = ?3
      WHERE id = ?4
    `).bind(user?.id ?? null, reference, now, orderId),
  ];
  if (user) {
    statements.push(db.prepare(`
      INSERT INTO subscriptions
        (id, user_id, provider, provider_customer_id, provider_subscription_id,
         status, current_period_end, created_at, updated_at)
      VALUES (?1, ?2, 'duitku', ?3, ?4, 'active', ?5, ?6, ?6)
      ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET
        user_id = excluded.user_id,
        provider_customer_id = excluded.provider_customer_id,
        status = 'active',
        current_period_end = MAX(subscriptions.current_period_end, excluded.current_period_end),
        updated_at = excluded.updated_at
    `).bind(`duitku-${orderId}`, user.id, order.customer_email, orderId, periodEnd, now));
  }
  await db.batch(statements);
}

export async function claimPaidDuitkuOrders(
  db: D1Database,
  userId: string,
  email: string,
  now: number,
): Promise<void> {
  const result = await db.prepare(`
    SELECT id, duration_days, paid_at
    FROM duitku_orders
    WHERE customer_email = ?1 COLLATE NOCASE AND status = 'paid' AND user_id IS NULL
  `).bind(email).all<{ id: string; duration_days: number; paid_at: number | null }>();
  if (result.results.length === 0) return;
  const statements: D1PreparedStatement[] = [];
  for (const order of result.results) {
    const paidAt = order.paid_at ?? now;
    statements.push(
      db.prepare("UPDATE duitku_orders SET user_id = ?1, updated_at = ?2 WHERE id = ?3 AND user_id IS NULL")
        .bind(userId, now, order.id),
      db.prepare(`
        INSERT INTO subscriptions
          (id, user_id, provider, provider_customer_id, provider_subscription_id,
           status, current_period_end, created_at, updated_at)
        VALUES (?1, ?2, 'duitku', ?3, ?4, 'active', ?5, ?6, ?6)
        ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET
          user_id = excluded.user_id,
          status = 'active',
          current_period_end = MAX(subscriptions.current_period_end, excluded.current_period_end),
          updated_at = excluded.updated_at
      `).bind(
        `duitku-${order.id}`,
        userId,
        email,
        order.id,
        paidAt + order.duration_days * 86_400,
        now,
      ),
    );
  }
  await db.batch(statements);
}

export async function registerDevice(
  db: D1Database,
  userId: string,
  installationHash: string,
  label: string,
  platform: DevicePlatform,
  maxDevices: number,
  now: number,
): Promise<DeviceRow> {
  const existing = await db.prepare(`
    SELECT id, label, platform, created_at, last_seen_at, revoked_at
    FROM devices WHERE user_id = ?1 AND installation_hash = ?2
  `).bind(userId, installationHash).first<DeviceRow>();

  if (existing && existing.revoked_at === null) {
    await db.prepare(
      "UPDATE devices SET label = ?1, platform = ?2, last_seen_at = ?3 WHERE id = ?4",
    ).bind(label, platform, now, existing.id).run();
    return { ...existing, label, platform, last_seen_at: now };
  }

  const deviceId = existing?.id ?? crypto.randomUUID();

  // With the one-laptop policy, a successful Google sign-in on a fresh
  // installation transfers access instead of trapping the owner behind the
  // old installation record. Clips remain local and are never touched here.
  if (maxDevices === 1) {
    await db.batch([
      db.prepare(`
        UPDATE auth_sessions SET revoked_at = ?1
        WHERE revoked_at IS NULL AND device_id IN (
          SELECT id FROM devices
          WHERE user_id = ?2 AND id <> ?3 AND revoked_at IS NULL
        )
      `).bind(now, userId, deviceId),
      db.prepare(`
        UPDATE devices SET revoked_at = ?1
        WHERE user_id = ?2 AND id <> ?3 AND revoked_at IS NULL
      `).bind(now, userId, deviceId),
    ]);
  }

  const count = await db.prepare(
    "SELECT COUNT(*) AS total FROM devices WHERE user_id = ?1 AND revoked_at IS NULL",
  ).bind(userId).first<{ total: number }>();
  if ((count?.total ?? 0) >= maxDevices) {
    throw new ApiError(409, "DEVICE_LIMIT_REACHED", `CourtVision hanya dapat digunakan pada ${maxDevices} laptop aktif`);
  }

  try {
    await db.prepare(`
      INSERT INTO devices (id, user_id, installation_hash, label, platform, created_at, last_seen_at, revoked_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, NULL)
      ON CONFLICT(user_id, installation_hash) DO UPDATE SET
        label = excluded.label,
        platform = excluded.platform,
        last_seen_at = excluded.last_seen_at,
        revoked_at = NULL
    `).bind(deviceId, userId, installationHash, label, platform, now).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("device_limit_reached")) {
      throw new ApiError(409, "DEVICE_LIMIT_REACHED", `CourtVision hanya dapat digunakan pada ${maxDevices} laptop aktif`);
    }
    throw error;
  }

  return { id: deviceId, label, platform, created_at: existing?.created_at ?? now, last_seen_at: now, revoked_at: null };
}

export async function createRefreshSession(
  db: D1Database,
  userId: string,
  deviceId: string,
  refreshTokenHash: string,
  expiresAt: number,
  now: number,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO auth_sessions
      (id, user_id, device_id, refresh_token_hash, created_at, expires_at, last_used_at, revoked_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5, NULL)
  `).bind(sessionId, userId, deviceId, refreshTokenHash, now, expiresAt).run();
  return sessionId;
}

export async function rotateRefreshSession(
  db: D1Database,
  oldRefreshTokenHash: string,
  newRefreshTokenHash: string,
  newExpiresAt: number,
  now: number,
): Promise<{ sessionId: string; userId: string; deviceId: string }> {
  const oldSession = await db.prepare(`
    SELECT s.id, s.user_id, s.device_id, s.expires_at, s.revoked_at,
           d.revoked_at AS device_revoked_at
    FROM auth_sessions s
    JOIN devices d ON d.id = s.device_id
    WHERE s.refresh_token_hash = ?1
  `).bind(oldRefreshTokenHash).first<SessionRow>();
  if (!oldSession || oldSession.revoked_at !== null || oldSession.device_revoked_at !== null || oldSession.expires_at <= now) {
    throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Refresh session is no longer valid");
  }

  const revoked = await db.prepare(`
    UPDATE auth_sessions SET revoked_at = ?1, last_used_at = ?1
    WHERE id = ?2 AND revoked_at IS NULL
    RETURNING id
  `).bind(now, oldSession.id).first<{ id: string }>();
  if (!revoked) throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Refresh token has already been used");

  const sessionId = await createRefreshSession(
    db,
    oldSession.user_id,
    oldSession.device_id,
    newRefreshTokenHash,
    newExpiresAt,
    now,
  );
  return { sessionId, userId: oldSession.user_id, deviceId: oldSession.device_id };
}

export async function requireActiveSession(
  db: D1Database,
  sessionId: string,
  userId: string,
  deviceId: string,
  now: number,
): Promise<void> {
  const session = await db.prepare(`
    SELECT s.id FROM auth_sessions s
    JOIN devices d ON d.id = s.device_id
    WHERE s.id = ?1 AND s.user_id = ?2 AND s.device_id = ?3
      AND s.revoked_at IS NULL AND s.expires_at > ?4 AND d.revoked_at IS NULL
  `).bind(sessionId, userId, deviceId, now).first<{ id: string }>();
  if (!session) throw new ApiError(401, "SESSION_REVOKED", "Session is no longer valid");
}

export async function revokeSession(db: D1Database, sessionId: string, now: number): Promise<void> {
  await db.prepare("UPDATE auth_sessions SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL")
    .bind(now, sessionId).run();
}

export async function getUser(db: D1Database, userId: string): Promise<UserRow> {
  const user = await db.prepare(
    "SELECT id, email, display_name, avatar_url FROM users WHERE id = ?1",
  ).bind(userId).first<UserRow>();
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User was not found");
  return user;
}

export async function getEntitlement(db: D1Database, userId: string, now: number): Promise<Entitlement> {
  const subscription = await db.prepare(`
    SELECT provider, current_period_end FROM subscriptions
    WHERE user_id = ?1 AND status IN ('trialing', 'active')
      AND (current_period_end IS NULL OR current_period_end > ?2)
    ORDER BY COALESCE(current_period_end, 9223372036854775807) DESC
    LIMIT 1
  `).bind(userId, now).first<SubscriptionRow>();
  if (subscription) {
    return { status: "pro", provider: subscription.provider, validUntil: subscription.current_period_end, trialEndsAt: null };
  }

  const trial = await db.prepare(
    "SELECT ends_at FROM trials WHERE user_id = ?1",
  ).bind(userId).first<{ ends_at: number }>();
  if (trial && trial.ends_at > now) {
    return { status: "trial", provider: null, validUntil: trial.ends_at, trialEndsAt: trial.ends_at };
  }
  return { status: "expired", provider: null, validUntil: null, trialEndsAt: trial?.ends_at ?? null };
}

export async function listDevices(db: D1Database, userId: string): Promise<DeviceRow[]> {
  const result = await db.prepare(`
    SELECT id, label, platform, created_at, last_seen_at, revoked_at
    FROM devices WHERE user_id = ?1 AND revoked_at IS NULL
    ORDER BY last_seen_at DESC
  `).bind(userId).all<DeviceRow>();
  return result.results;
}

export async function revokeDevice(db: D1Database, userId: string, deviceId: string, now: number): Promise<boolean> {
  const updated = await db.prepare(`
    UPDATE devices SET revoked_at = ?1
    WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL
    RETURNING id
  `).bind(now, deviceId, userId).first<{ id: string }>();
  if (!updated) return false;
  await db.prepare(
    "UPDATE auth_sessions SET revoked_at = ?1 WHERE device_id = ?2 AND revoked_at IS NULL",
  ).bind(now, deviceId).run();
  return true;
}

export async function linkPolarLicense(
  db: D1Database,
  input: {
    userId: string;
    licenseHash: string;
    licenseHint: string;
    licenseId: string;
    customerId: string | null;
    expiresAt: number | null;
  },
  now: number,
): Promise<void> {
  const linked = await db.prepare(`
    SELECT user_id FROM provider_links
    WHERE provider = 'polar' AND external_ref_hash = ?1
  `).bind(input.licenseHash).first<{ user_id: string }>();
  if (linked && linked.user_id !== input.userId) {
    throw new ApiError(409, "POLAR_LICENSE_ALREADY_LINKED", "This Polar license is linked to another CourtVision account");
  }

  const linkId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO provider_links
      (id, user_id, provider, external_ref_hash, external_ref_hint, provider_customer_id, provider_license_id, created_at, updated_at)
    VALUES (?1, ?2, 'polar', ?3, ?4, ?5, ?6, ?7, ?7)
    ON CONFLICT(provider, external_ref_hash) DO UPDATE SET
      provider_customer_id = excluded.provider_customer_id,
      provider_license_id = excluded.provider_license_id,
      updated_at = excluded.updated_at
  `).bind(linkId, input.userId, input.licenseHash, input.licenseHint, input.customerId, input.licenseId, now).run();

  await db.prepare(`
    INSERT INTO subscriptions
      (id, user_id, provider, provider_customer_id, provider_subscription_id, status, current_period_end, created_at, updated_at)
    VALUES (?1, ?2, 'polar', ?3, ?4, 'active', ?5, ?6, ?6)
    ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET
      user_id = excluded.user_id,
      provider_customer_id = excluded.provider_customer_id,
      status = 'active',
      current_period_end = excluded.current_period_end,
      updated_at = excluded.updated_at
  `).bind(crypto.randomUUID(), input.userId, input.customerId, input.licenseId, input.expiresAt, now).run();
}

export async function recordWebhookEvent(
  db: D1Database,
  provider: "polar" | "duitku",
  eventId: string,
  eventType: string,
  payloadHash: string,
  now: number,
): Promise<boolean> {
  const inserted = await db.prepare(`
    INSERT OR IGNORE INTO webhook_events
      (provider, event_id, event_type, payload_hash, received_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    RETURNING event_id
  `).bind(provider, eventId, eventType, payloadHash, now).first<{ event_id: string }>();
  if (inserted) return true;

  const retry = await db.prepare(`
    UPDATE webhook_events
    SET processing_error = NULL, processed_at = NULL, received_at = ?1
    WHERE provider = ?2 AND event_id = ?3 AND processing_error IS NOT NULL
    RETURNING event_id
  `).bind(now, provider, eventId).first<{ event_id: string }>();
  return Boolean(retry);
}

export async function applyPolarSubscriptionWebhook(
  db: D1Database,
  input: {
    customerId: string;
    status: "active" | "past_due" | "canceled" | "revoked";
    currentPeriodEnd: number | null;
  },
  now: number,
): Promise<number> {
  const result = await db.prepare(`
    UPDATE subscriptions
    SET status = ?1, current_period_end = COALESCE(?2, current_period_end), updated_at = ?3
    WHERE provider = 'polar' AND provider_customer_id = ?4
  `).bind(input.status, input.currentPeriodEnd, now, input.customerId).run();
  return result.meta.changes;
}

export async function markWebhookProcessed(
  db: D1Database,
  provider: "polar" | "duitku",
  eventId: string,
  now: number,
  error: string | null,
): Promise<void> {
  await db.prepare(`
    UPDATE webhook_events
    SET processed_at = ?1, processing_error = ?2
    WHERE provider = ?3 AND event_id = ?4
  `).bind(now, error, provider, eventId).run();
}
