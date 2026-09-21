PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE trials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('extension', 'mobile', 'web')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE(user_id, installation_hash)
);

CREATE INDEX devices_active_by_user
  ON devices(user_id, revoked_at, last_seen_at);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX auth_sessions_active_by_user
  ON auth_sessions(user_id, revoked_at, expires_at);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('polar', 'duitku', 'manual')),
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('trialing', 'active', 'past_due', 'canceled', 'revoked', 'expired')
  ),
  current_period_end INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_subscription_id)
);

CREATE INDEX subscriptions_entitlement_by_user
  ON subscriptions(user_id, status, current_period_end);

CREATE TABLE provider_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('polar', 'duitku')),
  external_ref_hash TEXT NOT NULL,
  external_ref_hint TEXT,
  provider_customer_id TEXT,
  provider_license_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, external_ref_hash)
);

CREATE INDEX provider_links_by_user
  ON provider_links(user_id, provider);

CREATE TABLE webhook_events (
  provider TEXT NOT NULL CHECK (provider IN ('polar', 'duitku')),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  processing_error TEXT,
  PRIMARY KEY(provider, event_id)
);

