import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyGoogleAccessToken } from "../src/google";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Chrome extension access tokens", () => {
  it("accepts a verified token issued to the configured extension client", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(_input).toBe("https://www.googleapis.com/oauth2/v2/tokeninfo");
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toBe("access_token=google-access-token");
      return new Response(JSON.stringify({
        audience: "courtvision-client",
        user_id: "google-user-1",
        expires_in: 3_600,
        email: "Coach@Example.com",
        verified_email: true,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyGoogleAccessToken("google-access-token", "courtvision-client"))
      .resolves.toEqual({
        sub: "google-user-1",
        email: "coach@example.com",
        name: null,
        picture: null,
      });
  });

  it("rejects a token issued to another OAuth client", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      audience: "other-client",
      user_id: "google-user-1",
      expires_in: 3_600,
      email: "coach@example.com",
      verified_email: true,
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(verifyGoogleAccessToken("google-access-token", "courtvision-client"))
      .rejects.toMatchObject({ code: "INVALID_GOOGLE_TOKEN", status: 401 });
  });
});
