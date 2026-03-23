-- 更新用户表额度逻辑
-- 免费用户额度一次性使用，Pro/Premium 用户月度重置

-- 确保 credits_month 字段存在（用于月度额度重置）
-- 如果字段不存在则添加
ALTER TABLE users ADD COLUMN credits_month TEXT;

-- 更新现有免费用户的 credits_reset_at 为 NULL（表示不重置）
UPDATE users SET credits_month = strftime('%Y-%m', 'now') WHERE plan = 'free' AND credits_month IS NULL;

-- 更新现有 Pro/Premium 用户的 credits_month
UPDATE users SET credits_month = strftime('%Y-%m', 'now') WHERE plan IN ('pro', 'premium') AND credits_month IS NULL;

-- 确保 monthly_credits 和 monthly_used 字段存在
ALTER TABLE users ADD COLUMN monthly_credits INTEGER;
ALTER TABLE users ADD COLUMN monthly_used INTEGER DEFAULT 0;

-- 初始化现有用户的 monthly_credits
UPDATE users SET monthly_credits = credits WHERE monthly_credits IS NULL;
