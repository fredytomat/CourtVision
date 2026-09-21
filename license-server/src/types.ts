export type DevicePlatform = "extension" | "mobile" | "web";

export type GoogleProfile = {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
};

export type AccessTokenClaims = {
  sub: string;
  sid: string;
  did: string;
  iat: number;
  exp: number;
  jti: string;
};

export type AuthenticatedSession = {
  userId: string;
  sessionId: string;
  deviceId: string;
};

export type Entitlement = {
  status: "pro" | "trial" | "expired";
  provider: "polar" | "duitku" | "manual" | null;
  validUntil: number | null;
  trialEndsAt: number | null;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

