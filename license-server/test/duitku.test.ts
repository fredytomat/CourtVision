import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDuitkuTransaction,
  getDuitkuPaymentMethods,
  getDuitkuTransactionStatus,
  hmacSha256Hex,
  jakartaDateTime,
  verifyDuitkuCallbackSignature,
} from "../src/duitku";
import type { RuntimeEnv } from "../src/env";

const testEnv = {
  DUITKU_MERCHANT_CODE: "DTEST",
  DUITKU_API_KEY: "sandbox-api-key",
  DUITKU_API_BASE_URL: "https://sandbox.duitku.com/webapi/api/merchant",
  DUITKU_CALLBACK_URL: "https://api.example/v1/webhooks/duitku",
  DUITKU_RETURN_URL: "https://courtvision.id/payment-result.html",
} as unknown as RuntimeEnv;

afterEach(() => vi.unstubAllGlobals());

describe("Duitku signatures", () => {
  it("creates and verifies the documented callback HMAC", async () => {
    const message = "DTEST130000CVORDER1";
    const signature = await hmacSha256Hex(message, "sandbox-api-key");
    await expect(verifyDuitkuCallbackSignature(
      "DTEST", "130000", "CVORDER1", signature, "sandbox-api-key",
    )).resolves.toBe(true);
    await expect(verifyDuitkuCallbackSignature(
      "DTEST", "130001", "CVORDER1", signature, "sandbox-api-key",
    )).resolves.toBe(false);
  });

  it("formats payment-method timestamps in Jakarta time", () => {
    expect(jakartaDateTime(new Date("2026-09-21T00:01:02.000Z"))).toBe("2026-09-21 07:01:02");
  });
});

describe("Duitku API requests", () => {
  it("gets active methods using a server-generated signature", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(_input).toBe("https://sandbox.duitku.com/webapi/api/merchant/paymentmethod/getpaymentmethod");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ merchantcode: "DTEST", amount: 130000 });
      expect(body.signature).toMatch(/^[0-9a-f]{64}$/);
      return Response.json({
        paymentFee: [{ paymentMethod: "SP", paymentName: "QRIS", paymentImage: "https://images.duitku.com/qris.png", totalFee: "1000" }],
        responseCode: "00",
        responseMessage: "SUCCESS",
      });
    }));
    await expect(getDuitkuPaymentMethods(testEnv, 130_000, new Date("2026-09-21T00:01:02Z")))
      .resolves.toEqual([expect.objectContaining({ paymentMethod: "SP", paymentName: "QRIS" })]);
  });

  it("creates a checkout transaction without exposing the API key", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(_input).toBe("https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        merchantCode: "DTEST",
        paymentAmount: 130000,
        paymentMethod: "SP",
        merchantOrderId: "CVORDER1",
        callbackUrl: "https://api.example/v1/webhooks/duitku",
        returnUrl: "https://courtvision.id/payment-result.html",
      });
      return Response.json({
        reference: "REF-1",
        paymentUrl: "https://sandbox.duitku.com/payment/REF-1",
        amount: 130000,
        statusCode: "00",
        statusMessage: "SUCCESS",
      });
    }));
    await expect(createDuitkuTransaction(testEnv, {
      orderId: "CVORDER1",
      amount: 130000,
      paymentMethod: "SP",
      productDetails: "CourtVision Pro Bulanan",
      customerName: "Coach Test",
      email: "coach@example.com",
      phoneNumber: "08123456789",
    })).resolves.toMatchObject({ reference: "REF-1", statusCode: "00" });
  });

  it("verifies a transaction through the status endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      merchantOrderId: "CVORDER1",
      reference: "REF-1",
      amount: "130000",
      fee: "0.00",
      statusCode: "00",
      statusMessage: "SUCCESS",
    })));
    await expect(getDuitkuTransactionStatus(testEnv, "CVORDER1"))
      .resolves.toMatchObject({ statusCode: "00", amount: "130000" });
  });
});
