-- 匿名用户限流表（基于 IP）
CREATE TABLE IF NOT EXISTS anonymous_usage (
    ip_hash         TEXT PRIMARY KEY,
    usage_count     INTEGER DEFAULT 0,
    usage_date      TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- 用户表新增订阅字段
ALTER TABLE users ADD COLUMN plan_period TEXT DEFAULT 'monthly';
ALTER TABLE users ADD COLUMN plan_expires_at TEXT;
ALTER TABLE users ADD COLUMN monthly_credits INTEGER DEFAULT 5;
ALTER TABLE users ADD COLUMN monthly_used INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN credits_month TEXT;
