import { describe, expect, it } from "vitest";
import worker from "../src/index";

const testEnv = {
  ALLOWED_ORIGINS: "https://courtvision.id",
} as Env;

describe("public routes", () => {
  it("returns a health response with security headers", async () => {
    const response = await worker.fetch(new Request("https://api.courtvision.id/health"), testEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok", service: "courtvision-license-api" });
  });

  it("rejects an unknown browser origin during preflight", async () => {
    const response = await worker.fetch(new Request("https://api.courtvision.id/v1/me", {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    }), testEnv);
    expect(response.status).toBe(403);
  });
});
