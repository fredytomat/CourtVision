# CourtVision License Server

Cloudflare Worker + D1 foundation for CourtVision accounts, server-side trials,
subscriptions, and a one-device limit. This service does not store user clips;
clip data remains local in the extension.

## Security model

- Google is the account identity provider. Chrome extensions may exchange the
  access token returned by `chrome.identity` at `/v1/auth/google`; web and
  mobile clients may continue to send an ID token.
- Access tokens are signed and expire after 15 minutes.
- Refresh tokens are opaque, stored only as SHA-256 hashes, and rotated on use.
- Installation IDs are random client-generated values stored only as hashes.
- Trial dates live in D1 and cannot be reset by reinstalling the client.
- A fresh installation signed in with the same Google account automatically
  replaces the previous installation, while keeping only one active device.
- Polar license keys are verified server-side and stored only as hashes/hints.
- Signed Polar subscription webhooks update linked subscription status and are
  stored idempotently to reject duplicate deliveries.
- Polar and Duitku secrets are Worker secrets, never source-controlled values.

## Local verification

1. Install dependencies with `npm install`.
2. Generate Worker binding types with `npm run types`.
3. Apply the local D1 migration with `npm run migrate:local`.
4. Run `npm run check`.

For local authenticated flows, create an uncommitted `.dev.vars` file:

```text
TOKEN_SIGNING_SECRET=<at least 32 random characters>
POLAR_ACCESS_TOKEN=<Polar organization access token with license_keys:write>
POLAR_WEBHOOK_SECRET=<Polar webhook signing secret>
```

Replace `GOOGLE_CLIENT_IDS` with the comma-separated OAuth client IDs used by
the extension and mobile app. Add their exact origins to `ALLOWED_ORIGINS`.
Use `https://sandbox-api.polar.sh` for staging and `https://api.polar.sh` for
production; Polar tokens and organizations are isolated between environments.

## Production provisioning (not performed yet)

Before deployment, create the production D1 database, replace the local
database ID in `wrangler.jsonc`, apply migrations remotely, and add secrets with
`wrangler secret put`. The Duitku webhook is intentionally deferred until the
Duitku Production merchant application is approved.
