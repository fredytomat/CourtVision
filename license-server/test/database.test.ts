import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  attachDuitkuTransaction,
  createDuitkuOrder,
  getDuitkuOrder,
  getEntitlement,
  listDevices,
  markWebhookProcessed,
  markDuitkuOrderStatus,
  recordWebhookEvent,
  registerDevice,
  upsertGoogleUser,
} from "../src/database";

describe("server-side account rules", () => {
  it("starts one server-side trial and transfers the single active device", async () => {
    const now = 1_789_459_200;
    const user = await upsertGoogleUser(env.DB, {
      sub: crypto.randomUUID(),
      email: `${crypto.randomUUID()}@example.com`,
      name: "CourtVision Test",
      picture: null,
    }, now, 7);

    const first = await registerDevice(env.DB, user.id, "hash-one", "MacBook", "extension", 1, now);
    const sameInstallation = await registerDevice(env.DB, user.id, "hash-one", "MacBook", "extension", 1, now + 1);
    expect(sameInstallation.id).toBe(first.id);
    const replacement = await registerDevice(
      env.DB, user.id, "hash-two", "Other laptop", "extension", 1, now + 2,
    );
    expect(replacement.id).not.toBe(first.id);
    await expect(listDevices(env.DB, user.id)).resolves.toEqual([
      expect.objectContaining({ id: replacement.id }),
    ]);

    await expect(getEntitlement(env.DB, user.id, now)).resolves.toMatchObject({ status: "trial" });
    await expect(getEntitlement(env.DB, user.id, now + 7 * 86_400)).resolves.toMatchObject({ status: "expired" });
  });

  it("accepts a failed webhook retry but ignores an already claimed duplicate", async () => {
    const eventId = crypto.randomUUID();
    await expect(recordWebhookEvent(env.DB, "polar", eventId, "subscription.active", "hash", 100))
      .resolves.toBe(true);
    await expect(recordWebhookEvent(env.DB, "polar", eventId, "subscription.active", "hash", 101))
      .resolves.toBe(false);
    await markWebhookProcessed(env.DB, "polar", eventId, 102, "temporary failure");
    await expect(recordWebhookEvent(env.DB, "polar", eventId, "subscription.active", "hash", 103))
      .resolves.toBe(true);
  });

  it("activates a Duitku purchase for a matching Google account", async () => {
    const now = 1_789_459_200;
    const email = `${crypto.randomUUID()}@example.com`;
    const user = await upsertGoogleUser(env.DB, {
      sub: crypto.randomUUID(),
      email,
      name: "Duitku Coach",
      picture: null,
    }, now, 7);
    const orderId = `CV${crypto.randomUUID().replace(/-/g, "")}`;
    await createDuitkuOrder(env.DB, {
      id: orderId,
      customerEmail: email,
      customerName: "Duitku Coach",
      customerPhone: null,
      plan: "monthly",
      amount: 130_000,
      durationDays: 30,
      paymentMethod: "SP",
    }, now);
    await attachDuitkuTransaction(env.DB, orderId, "REF-1", "https://example.com/pay", now);
    await markDuitkuOrderStatus(env.DB, orderId, "REF-1", "paid", now + 10);
    await expect(getDuitkuOrder(env.DB, orderId)).resolves.toMatchObject({ status: "paid", user_id: user.id });
    await expect(getEntitlement(env.DB, user.id, now + 20)).resolves.toMatchObject({
      status: "pro",
      provider: "duitku",
    });
  });
});
