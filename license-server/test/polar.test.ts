import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePolarSubscriptionWebhook, validatePolarLicense } from "../src/polar";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Polar license validation", () => {
  it("validates through the authenticated server API", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(_input).toBe("https://api.polar.sh/v1/license-keys/validate");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer polar-token");
      expect(JSON.parse(String(init?.body))).toEqual({
        key: "LICENSE-KEY",
        organization_id: "organization-id",
      });
      return new Response(JSON.stringify({
        id: "license-id",
        status: "granted",
        customer_id: "customer-id",
        expires_at: "2026-10-01T00:00:00.000Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(validatePolarLicense(
      "LICENSE-KEY",
      "organization-id",
      "polar-token",
      "https://api.polar.sh",
    )).resolves.toEqual({
      id: "license-id",
      status: "granted",
      customerId: "customer-id",
      expiresAt: 1_790_812_800,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("Polar subscription events", () => {
  it("keeps an end-of-period cancellation active until its period end", () => {
    expect(parsePolarSubscriptionWebhook({
      type: "subscription.canceled",
      data: {
        customer_id: "customer-1",
        status: "active",
        current_period_end: "2026-10-01T00:00:00.000Z",
      },
    })).toEqual({
      customerId: "customer-1",
      status: "active",
      currentPeriodEnd: 1_790_812_800,
    });
  });

  it("revokes access immediately for a revoked subscription", () => {
    expect(parsePolarSubscriptionWebhook({
      type: "subscription.revoked",
      data: { customer_id: "customer-1", status: "unpaid" },
    })).toEqual({ customerId: "customer-1", status: "revoked", currentPeriodEnd: null });
  });
});
