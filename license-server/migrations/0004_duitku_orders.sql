CREATE TABLE duitku_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL COLLATE NOCASE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  plan TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  payment_method TEXT NOT NULL,
  reference TEXT UNIQUE,
  payment_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER
);

CREATE INDEX duitku_orders_by_email
  ON duitku_orders(customer_email, status, created_at);

CREATE INDEX duitku_orders_by_user
  ON duitku_orders(user_id, status, created_at);
