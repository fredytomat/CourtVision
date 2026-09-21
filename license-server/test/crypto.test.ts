import { describe, expect, it } from "vitest";
import { randomToken, sha256Hex, signAccessToken, verifyAccessToken } from "../src/crypto";

const secret = "test-signing-secret-with-at-least-32-characters";

describe("access tokens", () => {
  it("signs and verifies a valid access token", async () => {
    const token = await signAccessToken({
      sub: "user-1",
      sid: "session-1",
      did: "device-1",
      iat: 100,
      exp: 200,
      jti: "token-1",
    }, secret);
    await expect(verifyAccessToken(token, secret, 150)).resolves.toMatchObject({ sub: "user-1", did: "device-1" });
  });

  it("rejects a token after its expiry", async () => {
    const token = await signAccessToken({
      sub: "user-1",
      sid: "session-1",
      did: "device-1",
      iat: 100,
      exp: 200,
      jti: "token-1",
    }, secret);
    await expect(verifyAccessToken(token, secret, 201)).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });

  it("creates opaque random refresh tokens and stable hashes", async () => {
    const first = randomToken();
    const second = randomToken();
    expect(first).not.toBe(second);
    expect(await sha256Hex(first)).toBe(await sha256Hex(first));
  });
});

