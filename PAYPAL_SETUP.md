# PayPal 支付接入指南

## 📋 配置清单

### 1. PayPal 沙箱账号信息

**已配置：**
- Client ID: `AdnrN8M5j-uOJDNAMP3oULpr2DG0d48g-DAayFwxF8J_pmbh_kRGQbmu7kCmKjocXnTHXnNR01iSMnoIR`
- Client Secret: `EE_TTJZ8GaGrC5RG1ix1JdjraI2WL9R6mjZiqYtJiL43p5hEKwHJssFVcVegcwxyZc3WwI1h899XyXjC`
- 环境：沙箱（Sandbox）

### 2. Cloudflare 环境变量配置

需要通过 `wrangler secret` 命令设置以下敏感变量：

```bash
# 设置 PayPal Client ID
wrangler secret put PAYPAL_CLIENT_ID

# 设置 PayPal Client Secret
wrangler secret put PAYPAL_CLIENT_SECRET

# 设置 PayPal API URL（沙箱环境）
wrangler secret put PAYPAL_API_URL
```

**输入值：**
- `PAYPAL_CLIENT_ID`: `AdnrN8M5j-uOJDNAMP3oULpr2DG0d48g-DAayFwxF8J_pmbh_kRGQbmu7kCmKjocXnTHXnNR01iSMnoIR`
- `PAYPAL_CLIENT_SECRET`: `EE_TTJZ8GaGrC5RG1ix1JdjraI2WL9R6mjZiqYtJiL43p5hEKwHJssFVcVegcwxyZc3WwI1h899XyXjC`
- `PAYPAL_API_URL`: `https://api-m.sandbox.paypal.com`

### 3. 数据库迁移

执行以下命令创建 PayPal 相关的数据库表：

```bash
wrangler d1 execute image-bg-remover-db --file=migrations/0004_paypal_subscriptions.sql --remote
```

**或者通过 Cloudflare Dashboard 手动执行：**

1. 访问 https://dash.cloudflare.com/
2. 进入 **Workers & Pages** → **image-background-remover**
3. 点击 **D1 Databases** → **image-bg-remover-db**
4. 点击 **Console** 或 **Query** 标签
5. 执行 `migrations/0004_paypal_subscriptions.sql` 文件中的 SQL 语句

---

## 🔧 部署命令

```bash
cd /root/git/image-background-remover

# 1. 设置环境变量
export CLOUDFLARE_API_TOKEN="cfut_j9G4d8zkC79XJr0h1cRxHGkirqPEltwW5Lpvs2lk4c4b2177"

# 2. 设置 PayPal 密钥
wrangler secret put PAYPAL_CLIENT_ID
wrangler secret put PAYPAL_CLIENT_SECRET
wrangler secret put PAYPAL_API_URL

# 3. 执行数据库迁移
wrangler d1 execute image-bg-remover-db --file=migrations/0004_paypal_subscriptions.sql --remote

# 4. 部署 Worker
wrangler deploy
```

---

## 💳 支付流程

### 用户支付流程

1. 用户访问 https://lovery-ai.com/pricing
2. 选择 Pro 或 Premium 套餐
3. 点击"立即升级"按钮
4. 如果未登录，跳转到登录页面
5. 如果已登录，创建 PayPal 订单
6. 跳转到 PayPal 支付页面（沙箱环境）
7. 用户使用 PayPal 沙箱账号完成支付
8. 支付成功后跳转到 `/payment/success`
9. 系统自动更新用户套餐和额度

### 测试账号

使用 PayPal 沙箱账号进行测试：

1. 访问 https://www.paypal.com/businessmanage/preferences/apiCredentials
2. 创建沙箱测试账号
3. 使用沙箱买家账号进行支付测试

---

## 📊 套餐配置

| 套餐 | 价格 | 额度 | 周期 |
|-----|------|------|------|
| Pro | ¥29.9 | 50 次/月 | 月度 |
| Premium | ¥59.9 | 200 次/月 | 月度 |

---

## 🔍 测试验证

### 1. 验证定价页面

访问 https://lovery-ai.com/pricing

- ✅ 页面显示三个套餐（Free/Pro/Premium）
- ✅ Pro 和 Premium 套餐显示"立即升级"按钮
- ✅ 按钮下方显示 PayPal 标志

### 2. 验证支付流程

1. 登录账号
2. 点击"立即升级"
3. 确认跳转到 PayPal 支付页面
4. 使用沙箱账号完成支付
5. 确认跳转到成功页面
6. 检查个人中心套餐是否已更新

### 3. 验证数据库

```sql
-- 查看订单记录
SELECT * FROM orders ORDER BY created_at DESC LIMIT 10;

-- 查看支付记录
SELECT * FROM payments ORDER BY created_at DESC LIMIT 10;

-- 查看用户套餐
SELECT id, email, plan, credits, monthly_credits FROM users;
```

---

## ⚠️ 注意事项

1. **沙箱环境**：当前配置为 PayPal 沙箱环境，不会产生真实交易
2. **手动续订**：当前实现为一次性支付，需要用户每月手动续订
3. **自动订阅**：如需自动订阅，需要在 PayPal 创建 Subscription Plan
4. **生产环境**：上线前需要切换到生产环境 API URL 和正式账号

---

## 🚀 生产环境切换

上线前需要修改以下配置：

1. **PayPal API URL**: 改为 `https://api-m.paypal.com`
2. **PayPal 账号**: 使用正式的商业账号
3. **货币**: 如需人民币支付，需要确认 PayPal 支持
4. **价格**: 根据目标市场调整价格

---

## 📞 技术支持

- PayPal 开发者文档：https://developer.paypal.com/
- Cloudflare D1 文档：https://developers.cloudflare.com/d1/

---

*最后更新：2026-03-23*
