-- PayPal 订阅和订单表

-- 订单表
CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    order_id        TEXT UNIQUE NOT NULL,  -- PayPal Order ID
    plan_type       TEXT NOT NULL,         -- free/pro/premium
    amount          REAL NOT NULL,
    currency        TEXT DEFAULT 'CNY',
    status          TEXT DEFAULT 'CREATED', -- CREATED/APPROVED/COMPLETED/FAILED
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    paid_at         TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 订阅表
CREATE TABLE IF NOT EXISTS subscriptions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    subscription_id     TEXT UNIQUE NOT NULL,  -- PayPal Subscription ID
    plan_type           TEXT NOT NULL,         -- pro/premium
    plan_amount         REAL NOT NULL,
    plan_currency       TEXT DEFAULT 'CNY',
    plan_period         TEXT DEFAULT 'monthly', -- monthly/yearly
    status              TEXT DEFAULT 'ACTIVE',  -- ACTIVE/EXPIRED/CANCELLED/FAILED
    current_period_start TEXT,
    current_period_end   TEXT,
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now')),
    cancelled_at        TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 支付记录表
CREATE TABLE IF NOT EXISTS payments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    subscription_id TEXT,
    payment_id      TEXT UNIQUE NOT NULL,  -- PayPal Capture ID
    amount          REAL NOT NULL,
    currency        TEXT DEFAULT 'CNY',
    status          TEXT DEFAULT 'COMPLETED',
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(subscription_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
