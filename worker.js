/**
 * Cloudflare Worker - Image Background Remover
 * Google OAuth + D1 用户体系 + 个人中心 + PayPal 支付
 *
 * 环境变量 / 绑定:
 * - REMOVE_BG_API_KEY: Remove.bg API Key
 * - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: Google OAuth
 * - JWT_SECRET: JWT 签名密钥
 * - SITE_URL: 站点 URL
 * - DB: D1 数据库绑定
 * - PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET: PayPal API (沙箱环境)
 * - PAYPAL_API_URL: PayPal API 基础 URL (沙箱：https://api-m.sandbox.paypal.com)
 */

// PayPal 配置
const PAYPAL_CONFIG = {
  clientId: '', // 从环境变量读取
  clientSecret: '', // 从环境变量读取
  apiUrl: 'https://api-m.sandbox.paypal.com', // 沙箱环境
  plans: {
    pro: { amount: '29.9', currency: 'CNY', name: 'Pro 专业版' },
    premium: { amount: '59.9', currency: 'CNY', name: 'Premium 高级版' }
  }
};

// ==================== JWT 工具 ====================

function b64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlDecode(str) {
  const b = str.replace(/-/g, '+').replace(/_/g, '/');
  const p = '='.repeat((4 - (b.length % 4)) % 4);
  const bin = atob(b + p);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function createJWT(payload, secret) {
  const h = b64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64UrlEncode(JSON.stringify(payload));
  const input = `${h}.${p}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return `${input}.${b64UrlEncode(String.fromCharCode(...new Uint8Array(sig)))}`;
}

async function verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, b64UrlDecode(s), new TextEncoder().encode(`${h}.${p}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function parseCookies(h) {
  const c = {};
  if (!h) return c;
  h.split(';').forEach(s => { const [n, ...r] = s.trim().split('='); if (n) c[n.trim()] = r.join('=').trim(); });
  return c;
}

// ==================== D1 用户操作 ====================

const PLAN_LIMITS = { free: 3, pro: 50, premium: 999999 };

async function getOrCreateUser(db, googleUser) {
  // 查找已有用户
  let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleUser.id).first();

  if (!user) {
    // 新建用户 - 免费用户注册送 3 次，额度不重置
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    await db.prepare(
      'INSERT INTO users (google_id, email, name, avatar, plan, credits, credits_month, plan_period) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      googleUser.id, googleUser.email, googleUser.name, googleUser.picture,
      'free', PLAN_LIMITS.free, currentMonth, 'monthly'
    ).run();
    user = await db.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleUser.id).first();
  } else {
    // 更新用户信息（头像、名字可能变）
    await db.prepare(
      'UPDATE users SET name = ?, avatar = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(googleUser.name, googleUser.picture, user.id).run();
  }

  return user;
}

async function resetCreditsIfNeeded(db, user) {
  // 免费用户额度不重置（一次性使用）
  // Pro/Premium 用户每月重置额度
  if (user.plan === 'free') {
    return user;
  }
  
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  if (user.credits_month !== currentMonth) {
    const limit = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
    await db.prepare(
      'UPDATE users SET credits = ?, monthly_credits = ?, credits_month = ?, monthly_used = 0, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(limit, limit, currentMonth, user.id).run();
    user.credits = limit;
    user.credits_month = currentMonth;
    user.monthly_used = 0;
  }
  return user;
}

async function consumeCredit(db, userId) {
  const result = await db.prepare(
    'UPDATE users SET credits = credits - 1, updated_at = datetime(\'now\') WHERE id = ? AND credits > 0'
  ).bind(userId).run();
  return result.meta.changes > 0;
}

async function logUsage(db, userId, action, fileName, fileSize, status) {
  await db.prepare(
    'INSERT INTO usage_logs (user_id, action, file_name, file_size, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, action, fileName, fileSize, status).run();
}

async function getUserFromToken(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  if (!cookies.auth_token) return null;
  const payload = await verifyJWT(cookies.auth_token, env.JWT_SECRET);
  if (!payload) return null;
  let user = await env.DB.prepare('SELECT * FROM users WHERE google_id = ?').bind(payload.sub).first();
  if (!user) return null;
  user = await resetCreditsIfNeeded(env.DB, user);
  return user;
}

// ==================== Auth 路由 ====================

async function handleAuthLogin(env) {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.SITE_URL + '/auth/callback',
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    state, prompt: 'consent',
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

async function handleAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) return authRedirectError(env, 'Google 授权失败: ' + error);
  if (!code) return authRedirectError(env, '缺少授权码');

  const cookies = parseCookies(request.headers.get('Cookie'));
  if (!cookies.oauth_state || cookies.oauth_state !== state) {
    return authRedirectError(env, '安全验证失败，请重新登录');
  }

  try {
    // code → token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.SITE_URL + '/auth/callback', grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) { console.error('Token exchange failed:', await tokenRes.text()); return authRedirectError(env, '获取令牌失败'); }
    const tokenData = await tokenRes.json();

    // token → user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) return authRedirectError(env, '获取用户信息失败');
    const googleUser = await userRes.json();

    // 创建/更新 D1 用户
    const user = await getOrCreateUser(env.DB, googleUser);

    // 签发 JWT（包含 DB user id）
    const jwt = await createJWT({
      sub: googleUser.id, uid: user.id, email: googleUser.email,
      name: googleUser.name, picture: googleUser.picture,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    }, env.JWT_SECRET);

    const headers = new Headers();
    headers.set('Location', env.SITE_URL + '/');
    headers.append('Set-Cookie', `auth_token=${jwt}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);
    headers.append('Set-Cookie', 'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error('OAuth callback error:', err);
    return authRedirectError(env, '登录过程出错');
  }
}

function authRedirectError(env, message) {
  const headers = new Headers();
  headers.set('Location', `${env.SITE_URL}/?error=${encodeURIComponent(message)}`);
  headers.append('Set-Cookie', 'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return new Response(null, { status: 302, headers });
}

function handleAuthLogout(env) {
  return new Response(null, {
    status: 302,
    headers: { Location: env.SITE_URL + '/', 'Set-Cookie': 'auth_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' },
  });
}

async function handleAuthMe(request, env) {
  const J = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const user = await getUserFromToken(request, env);
  if (!user) return new Response(JSON.stringify({ authenticated: false }), { headers: J });

  const planLimit = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
  const used = planLimit - user.credits;

  // 获取订阅信息
  const subscription = await env.DB.prepare(
    'SELECT * FROM subscriptions WHERE user_id = ? AND status = ?'
  ).bind(user.id, 'ACTIVE').first();

  return new Response(JSON.stringify({
    authenticated: true,
    user: {
      id: user.id, email: user.email, name: user.name, picture: user.avatar,
      plan: user.plan, credits: user.credits, used, planLimit,
      createdAt: user.created_at,
      subscription: subscription ? {
        id: subscription.subscription_id,
        planType: subscription.plan_type,
        status: subscription.status,
        periodEnd: subscription.current_period_end
      } : null
    },
  }), { headers: J });
}

// ==================== PayPal API 路由 ====================

async function getPayPalAccessToken(env) {
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${env.PAYPAL_API_URL || PAYPAL_CONFIG.apiUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('PayPal token error:', err);
    throw new Error('Failed to get PayPal access token');
  }
  const data = await res.json();
  return data.access_token;
}

async function handlePayPalCreateOrder(request, env) {
  const J = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const user = await getUserFromToken(request, env);
  if (!user) return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: J });

  try {
    const { planType } = await request.json();
    if (!planType || !PAYPAL_CONFIG.plans[planType]) {
      return new Response(JSON.stringify({ error: '无效的套餐类型' }), { status: 400, headers: J });
    }

    const plan = PAYPAL_CONFIG.plans[planType];
    const accessToken = await getPayPalAccessToken(env);

    // 创建 PayPal Order
    const orderRes = await fetch(`${env.PAYPAL_API_URL || PAYPAL_CONFIG.apiUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: plan.currency,
            value: plan.amount
          },
          description: plan.name,
          custom_id: `user_${user.id}_plan_${planType}`
        }],
        application_context: {
          brand_name: 'Image Background Remover',
          landing_page: 'LOGIN',
          user_action: 'PAY_NOW',
          return_url: `${env.SITE_URL}/payment/success`,
          cancel_url: `${env.SITE_URL}/payment/cancel`
        }
      })
    });

    if (!orderRes.ok) {
      const err = await orderRes.text();
      console.error('PayPal create order error:', err);
      return new Response(JSON.stringify({ error: '创建订单失败' }), { status: 500, headers: J });
    }

    const orderData = await orderRes.json();

    // 保存订单到数据库
    await env.DB.prepare(
      'INSERT INTO orders (user_id, order_id, plan_type, amount, currency, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(user.id, orderData.id, planType, parseFloat(plan.amount), plan.currency, 'CREATED').run();

    return new Response(JSON.stringify({
      orderId: orderData.id,
      approvalUrl: orderData.links?.find(l => l.rel === 'approve')?.href || ''
    }), { headers: J });
  } catch (err) {
    console.error('Create order error:', err);
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500, headers: J });
  }
}

async function handlePayPalCaptureOrder(request, env) {
  const J = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const user = await getUserFromToken(request, env);
  if (!user) return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: J });

  try {
    const { orderId } = await request.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: '缺少订单 ID' }), { status: 400, headers: J });
    }

    const accessToken = await getPayPalAccessToken(env);

    // 捕获订单
    const captureRes = await fetch(`${env.PAYPAL_API_URL || PAYPAL_CONFIG.apiUrl}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!captureRes.ok) {
      const err = await captureRes.text();
      console.error('PayPal capture error:', err);
      return new Response(JSON.stringify({ error: '支付失败' }), { status: 500, headers: J });
    }

    const captureData = await captureRes.json();

    // 更新订单状态
    await env.DB.prepare(
      'UPDATE orders SET status = ?, paid_at = ?, updated_at = datetime(\'now\') WHERE order_id = ?'
    ).bind('COMPLETED', new Date().toISOString(), orderId).run();

    // 获取订单信息
    const order = await env.DB.prepare(
      'SELECT * FROM orders WHERE order_id = ?'
    ).bind(orderId).first();

    if (order) {
      // 更新用户套餐
      const planCredits = order.plan_type === 'pro' ? 50 : 200;
      const currentMonth = new Date().toISOString().slice(0, 7);
      
      await env.DB.prepare(
        'UPDATE users SET plan = ?, credits = ?, monthly_credits = ?, credits_month = ?, plan_period = ?, updated_at = datetime(\'now\') WHERE id = ?'
      ).bind(order.plan_type, planCredits, planCredits, currentMonth, 'monthly', user.id).run();

      // 记录支付
      const captureId = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id;
      if (captureId) {
        await env.DB.prepare(
          'INSERT INTO payments (user_id, payment_id, amount, currency, status) VALUES (?, ?, ?, ?, ?)'
        ).bind(user.id, captureId, parseFloat(order.amount), order.currency, 'COMPLETED').run();
      }
    }

    return new Response(JSON.stringify({ success: true, planType: order?.plan_type }), { headers: J });
  } catch (err) {
    console.error('Capture order error:', err);
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500, headers: J });
  }
}

async function handlePayPalCreateSubscription(request, env) {
  const J = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const user = await getUserFromToken(request, env);
  if (!user) return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: J });

  try {
    const { planType } = await request.json();
    if (!planType || !PAYPAL_CONFIG.plans[planType]) {
      return new Response(JSON.stringify({ error: '无效的套餐类型' }), { status: 400, headers: J });
    }

    const plan = PAYPAL_CONFIG.plans[planType];
    const accessToken = await getPayPalAccessToken(env);

    // 创建订阅（简化版：使用 Order + 订阅管理）
    // 注：完整的订阅需要先在 PayPal 创建 Product 和 Plan
    // 这里使用简化方案：用户手动续订
    
    const orderRes = await fetch(`${env.PAYPAL_API_URL || PAYPAL_CONFIG.apiUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: plan.currency,
            value: plan.amount
          },
          description: `${plan.name} - 月度订阅`,
          custom_id: `user_${user.id}_plan_${planType}`
        }],
        application_context: {
          brand_name: 'Image Background Remover',
          landing_page: 'LOGIN',
          user_action: 'SUBSCRIBE',
          return_url: `${env.SITE_URL}/payment/success`,
          cancel_url: `${env.SITE_URL}/payment/cancel`
        }
      })
    });

    if (!orderRes.ok) {
      const err = await orderRes.text();
      console.error('PayPal subscription error:', err);
      return new Response(JSON.stringify({ error: '创建订阅失败' }), { status: 500, headers: J });
    }

    const orderData = await orderRes.json();

    return new Response(JSON.stringify({
      orderId: orderData.id,
      approvalUrl: orderData.links?.find(l => l.rel === 'approve')?.href || ''
    }), { headers: J });
  } catch (err) {
    console.error('Create subscription error:', err);
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500, headers: J });
  }
}

async function handlePaymentSuccess(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>支付成功 - Image Background Remover</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center">
    <div class="bg-white rounded-2xl shadow-xl p-12 text-center max-w-md mx-4">
        <div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <i class="fas fa-check text-green-600 text-4xl"></i>
        </div>
        <h1 class="text-3xl font-bold text-gray-900 mb-4">支付成功！</h1>
        <p class="text-gray-600 mb-8">感谢您的订阅，套餐已立即生效。</p>
        <div class="space-y-3">
            <a href="/" class="block w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition-colors">返回首页</a>
            <a href="/profile" class="block w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-lg font-medium transition-colors">查看个人中心</a>
        </div>
    </div>
    <script>
        // 自动刷新用户状态
        fetch('/auth/me').then(() => {});
    <\/script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function handlePaymentCancel(request, env) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>支付取消 - Image Background Remover</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="min-h-screen bg-gradient-to-br from-gray-50 to-red-50 flex items-center justify-center">
    <div class="bg-white rounded-2xl shadow-xl p-12 text-center max-w-md mx-4">
        <div class="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <i class="fas fa-times text-gray-400 text-4xl"></i>
        </div>
        <h1 class="text-3xl font-bold text-gray-900 mb-4">支付已取消</h1>
        <p class="text-gray-600 mb-8">您取消了支付流程，如需继续请重新开始。</p>
        <div class="space-y-3">
            <a href="/pricing" class="block w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition-colors">返回定价页</a>
            <a href="/" class="block w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-lg font-medium transition-colors">返回首页</a>
        </div>
    </div>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ==================== API 路由 ====================

async function handleRemoveBg(request, env) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  const J = { ...cors, 'Content-Type': 'application/json' };

  // 鉴权
  const user = await getUserFromToken(request, env);
  if (!user) return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: J });

  // 检查额度
  if (user.credits <= 0) {
    return new Response(JSON.stringify({ error: '免费额度已用完，请升级套餐后继续使用', credits: 0 }), { status: 403, headers: J });
  }

  try {
    const formData = await request.formData();
    const imageFile = formData.get('image_file');
    if (!imageFile) return new Response(JSON.stringify({ error: 'No image file provided' }), { status: 400, headers: J });
    if (!env.REMOVE_BG_API_KEY) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: J });

    const fileName = imageFile.name || 'unknown';
    const fileSize = imageFile.size || 0;

    // 扣减额度
    const consumed = await consumeCredit(env.DB, user.id);
    if (!consumed) {
      return new Response(JSON.stringify({ error: '免费额度已用完，请升级套餐后继续使用' }), { status: 403, headers: J });
    }

    // 调用 Remove.bg
    const bgFormData = new FormData();
    bgFormData.append('image_file', imageFile);
    bgFormData.append('size', 'auto');
    const bgRes = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST', headers: { 'X-Api-Key': env.REMOVE_BG_API_KEY }, body: bgFormData,
    });

    if (!bgRes.ok) {
      // 处理失败，回退额度
      await env.DB.prepare('UPDATE users SET credits = credits + 1 WHERE id = ?').bind(user.id).run();
      await logUsage(env.DB, user.id, 'remove_bg', fileName, fileSize, 'failed');
      const errText = await bgRes.text();
      console.error('Remove.bg error:', errText);
      return new Response(JSON.stringify({ error: 'Failed to process image' }), { status: bgRes.status, headers: J });
    }

    // 成功，记录使用日志
    await logUsage(env.DB, user.id, 'remove_bg', fileName, fileSize, 'success');

    const img = await bgRes.arrayBuffer();
    return new Response(img, {
      headers: { ...cors, 'Content-Type': 'image/png', 'Content-Disposition': 'attachment; filename="background-removed.png"' },
    });
  } catch (err) {
    console.error('Error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: J });
  }
}

async function handleUsageLogs(request, env) {
  const J = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const user = await getUserFromToken(request, env);
  if (!user) return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: J });

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
  const offset = (page - 1) * limit;

  const logs = await env.DB.prepare(
    'SELECT id, action, file_name, file_size, status, created_at FROM usage_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(user.id, limit, offset).all();

  const total = await env.DB.prepare('SELECT COUNT(*) as count FROM usage_logs WHERE user_id = ?').bind(user.id).first();

  return new Response(JSON.stringify({
    logs: logs.results,
    total: total.count,
    page, limit,
  }), { headers: J });
}

// ==================== HTML 页面 ====================

const indexHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Background Remover - 智能图片去背景</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        .checkerboard{background-image:linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0px}
        .upload-area:hover{border-color:#3b82f6;background-color:#eff6ff}
        .upload-area.dragover{border-color:#2563eb;background-color:#dbeafe}
        .loading-spinner{border:3px solid #e5e7eb;border-top:3px solid #3b82f6;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite}
        @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
    </style>
</head>
<body class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
    <header class="bg-white shadow-sm">
        <div class="max-w-6xl mx-auto px-4 py-6">
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-3">
                    <div class="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                        <i class="fas fa-magic text-white text-xl"></i>
                    </div>
                    <div>
                        <h1 class="text-2xl font-bold text-gray-900">Image Background Remover</h1>
                        <p class="text-sm text-gray-500">智能图片去背景工具</p>
                    </div>
                </div>
                <div id="authSection">
                    <div id="loginBtn" class="hidden">
                        <a href="/auth/login" class="flex items-center space-x-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm">
                            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                            <span>Google 登录</span>
                        </a>
                    </div>
                    <div id="userInfo" class="hidden flex items-center space-x-3">
                        <span id="creditsInfo" class="text-xs bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full font-medium"></span>
                        <a href="/pricing" class="text-xs bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-3 py-1.5 rounded-full font-medium hover:shadow-md transition-all">升级</a>
                        <a href="/profile" title="个人中心">
                            <img id="userAvatar" class="w-9 h-9 rounded-full border-2 border-blue-200 hover:border-blue-400 transition-colors cursor-pointer" alt="avatar">
                        </a>
                    </div>
                </div>
            </div>
        </div>
    </header>
    <main class="max-w-6xl mx-auto px-4 py-8">
        <div id="uploadSection" class="bg-white rounded-2xl shadow-xl p-8 mb-8">
            <div class="text-center mb-6">
                <h2 class="text-2xl font-bold text-gray-900 mb-2">上传图片</h2>
                <p class="text-gray-500">支持 JPG、PNG、WebP 格式，最大 10MB</p>
            </div>
            <div id="uploadArea" class="upload-area border-2 border-dashed border-gray-300 rounded-xl p-12 text-center cursor-pointer transition-all">
                <input type="file" id="fileInput" accept="image/*" class="hidden">
                <div class="space-y-4">
                    <div class="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto"><i class="fas fa-cloud-upload-alt text-blue-600 text-3xl"></i></div>
                    <div><p class="text-lg font-medium text-gray-900">拖拽图片到此处，或点击上传</p><p class="text-sm text-gray-500 mt-1">图片仅在内存中处理，不会存储</p></div>
                    <button class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors">选择图片</button>
                </div>
            </div>
            <div id="previewSection" class="hidden mt-8">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-semibold text-gray-900">原图预览</h3>
                    <button id="removeBgBtn" class="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium transition-all shadow-lg hover:shadow-xl flex items-center space-x-2">
                        <i class="fas fa-magic"></i><span>去除背景</span>
                    </button>
                </div>
                <div class="relative rounded-xl overflow-hidden shadow-lg checkerboard"><img id="previewImage" class="w-full max-h-96 object-contain" alt="Preview"></div>
            </div>
        </div>
        <div id="loadingSection" class="hidden bg-white rounded-2xl shadow-xl p-12 text-center">
            <div class="loading-spinner mx-auto mb-4"></div>
            <h3 class="text-xl font-semibold text-gray-900 mb-2">正在处理中...</h3>
            <p class="text-gray-500">请稍候，通常需要 3-5 秒</p>
        </div>
        <div id="resultSection" class="hidden bg-white rounded-2xl shadow-xl p-8">
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-2xl font-bold text-gray-900">处理结果</h2>
                <button id="startOverBtn" class="text-gray-600 hover:text-gray-900 flex items-center space-x-2"><i class="fas fa-redo"></i><span>重新开始</span></button>
            </div>
            <div class="grid md:grid-cols-2 gap-6 mb-8">
                <div><h3 class="text-lg font-semibold text-gray-900 mb-3 text-center">原图</h3><div class="rounded-xl overflow-hidden shadow-lg checkerboard"><img id="originalImage" class="w-full h-64 object-contain bg-white" alt="Original"></div></div>
                <div><h3 class="text-lg font-semibold text-gray-900 mb-3 text-center">去背后</h3><div class="rounded-xl overflow-hidden shadow-lg checkerboard"><img id="resultImage" class="w-full h-64 object-contain" alt="Result"></div></div>
            </div>
            <div class="mb-6">
                <h3 class="text-lg font-semibold text-gray-900 mb-3">更换背景色</h3>
                <div class="flex flex-wrap gap-3">
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300 checkerboard" data-color="transparent" title="透明"></button>
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300" style="background-color:#fff" data-color="#ffffff" title="白色"></button>
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300" style="background-color:#000" data-color="#000000" title="黑色"></button>
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300" style="background-color:#ef4444" data-color="#ef4444" title="红色"></button>
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300" style="background-color:#22c55e" data-color="#22c55e" title="绿色"></button>
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300" style="background-color:#3b82f6" data-color="#3b82f6" title="蓝色"></button>
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300" style="background-color:#fbbf24" data-color="#fbbf24" title="黄色"></button>
                </div>
            </div>
            <div class="flex flex-wrap gap-4 justify-center">
                <button id="downloadPngBtn" class="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-medium transition-colors flex items-center space-x-2"><i class="fas fa-download"></i><span>下载透明 PNG</span></button>
                <button id="downloadWithBgBtn" class="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-lg font-medium transition-colors flex items-center space-x-2"><i class="fas fa-download"></i><span>下载带背景图</span></button>
            </div>
        </div>
        <div id="errorSection" class="hidden bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-exclamation-triangle text-red-600 text-2xl"></i></div>
            <h3 class="text-lg font-semibold text-red-900 mb-2">处理失败</h3>
            <p id="errorMessage" class="text-red-600 mb-4"></p>
            <button id="retryBtn" class="bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors">重试</button>
        </div>
    </main>
    <footer class="bg-white border-t mt-12">
        <div class="max-w-6xl mx-auto px-4 py-6 text-center text-gray-500 text-sm">
            <p>⚠️ 免责声明：请勿上传敏感、侵权或违规图片。图片仅在内存中处理，请求结束后自动销毁。</p>
            <p class="mt-3 space-x-4">
                <a href="/pricing" class="hover:text-blue-600 transition-colors">定价方案</a>
                <span class="text-gray-300">|</span>
                <a href="/profile" class="hover:text-blue-600 transition-colors">个人中心</a>
                <span class="text-gray-300">|</span>
                <span>Powered by Remove.bg API</span>
            </p>
        </div>
    </footer>
    <script>
        let isAuthenticated=false,currentUser=null;
        async function checkAuth(){try{const r=await fetch('/auth/me');const d=await r.json();if(d.authenticated){isAuthenticated=true;currentUser=d.user;document.getElementById('loginBtn').classList.add('hidden');document.getElementById('userInfo').classList.remove('hidden');document.getElementById('userAvatar').src=d.user.picture||'';document.getElementById('creditsInfo').textContent='剩余 '+d.user.credits+'/'+d.user.planLimit+' 次'}else{isAuthenticated=false;currentUser=null;document.getElementById('loginBtn').classList.remove('hidden');document.getElementById('userInfo').classList.add('hidden')}}catch(e){isAuthenticated=false;document.getElementById('loginBtn').classList.remove('hidden');document.getElementById('userInfo').classList.add('hidden')}}
        const urlParams=new URLSearchParams(window.location.search);if(urlParams.get('error')){alert('登录失败: '+urlParams.get('error'));window.history.replaceState({},'','/')}
        checkAuth();
        const uploadArea=document.getElementById('uploadArea'),fileInput=document.getElementById('fileInput'),previewSection=document.getElementById('previewSection'),previewImage=document.getElementById('previewImage'),removeBgBtn=document.getElementById('removeBgBtn'),loadingSection=document.getElementById('loadingSection'),resultSection=document.getElementById('resultSection'),originalImage=document.getElementById('originalImage'),resultImage=document.getElementById('resultImage'),errorSection=document.getElementById('errorSection'),errorMessage=document.getElementById('errorMessage'),retryBtn=document.getElementById('retryBtn'),startOverBtn=document.getElementById('startOverBtn'),downloadPngBtn=document.getElementById('downloadPngBtn'),downloadWithBgBtn=document.getElementById('downloadWithBgBtn'),bgColorBtns=document.querySelectorAll('.bg-color-btn');
        let currentFile=null,resultBlob=null,selectedBgColor='transparent';
        uploadArea.addEventListener('click',()=>fileInput.click());
        fileInput.addEventListener('change',e=>{if(e.target.files.length>0)handleFile(e.target.files[0])});
        uploadArea.addEventListener('dragover',e=>{e.preventDefault();uploadArea.classList.add('dragover')});
        uploadArea.addEventListener('dragleave',()=>{uploadArea.classList.remove('dragover')});
        uploadArea.addEventListener('drop',e=>{e.preventDefault();uploadArea.classList.remove('dragover');if(e.dataTransfer.files.length>0)handleFile(e.dataTransfer.files[0])});
        function handleFile(file){if(!file.type.startsWith('image/')){showError('请上传图片文件');return}if(file.size>10*1024*1024){showError('图片大小不能超过 10MB');return}currentFile=file;const reader=new FileReader();reader.onload=e=>{previewImage.src=e.target.result;previewSection.classList.remove('hidden');uploadArea.classList.add('hidden')};reader.readAsDataURL(file)}
        removeBgBtn.addEventListener('click',async()=>{if(!currentFile)return;if(!isAuthenticated){if(confirm('请先登录 Google 账号后使用此功能，是否前往登录？')){window.location.href='/auth/login'}return}previewSection.classList.add('hidden');loadingSection.classList.remove('hidden');errorSection.classList.add('hidden');try{const fd=new FormData();fd.append('image_file',currentFile);fd.append('size','auto');const res=await fetch('/api/remove-bg',{method:'POST',body:fd});if(!res.ok){const err=await res.json().catch(()=>({error:'处理失败'}));if(res.status===401){isAuthenticated=false;checkAuth();throw new Error('登录已过期，请重新登录')}if(res.status===403){checkAuth();throw new Error(err.error||'额度已用完')}throw new Error(err.error||'处理失败，请重试')}resultBlob=await res.blob();originalImage.src=previewImage.src;resultImage.src=URL.createObjectURL(resultBlob);loadingSection.classList.add('hidden');resultSection.classList.remove('hidden');checkAuth()}catch(error){loadingSection.classList.add('hidden');showError(error.message||'处理失败')}});
        bgColorBtns.forEach(btn=>{btn.addEventListener('click',()=>{bgColorBtns.forEach(b=>b.classList.remove('border-blue-600','border-4'));btn.classList.add('border-blue-600','border-4');selectedBgColor=btn.dataset.color;resultImage.style.background=selectedBgColor==='transparent'?'transparent':selectedBgColor})});
        bgColorBtns[0].click();
        downloadPngBtn.addEventListener('click',()=>{if(!resultBlob)return;const u=URL.createObjectURL(resultBlob);const a=document.createElement('a');a.href=u;a.download='background-removed.png';a.click();URL.revokeObjectURL(u)});
        downloadWithBgBtn.addEventListener('click',()=>{if(!resultBlob)return;const c=document.createElement('canvas'),ctx=c.getContext('2d'),img=new Image();img.onload=()=>{c.width=img.width;c.height=img.height;if(selectedBgColor!=='transparent'){ctx.fillStyle=selectedBgColor;ctx.fillRect(0,0,c.width,c.height)}ctx.drawImage(img,0,0);c.toBlob(b=>{const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='image-with-background.png';a.click();URL.revokeObjectURL(u)},'image/png')};img.src=URL.createObjectURL(resultBlob)});
        startOverBtn.addEventListener('click',()=>{resultSection.classList.add('hidden');uploadArea.classList.remove('hidden');previewSection.classList.add('hidden');fileInput.value='';currentFile=null;resultBlob=null;resultImage.style.background='transparent'});
        retryBtn.addEventListener('click',()=>{errorSection.classList.add('hidden');previewSection.classList.remove('hidden')});
        function showError(m){errorMessage.textContent=m;errorSection.classList.remove('hidden')}
    <\/script>
</body>
</html>`;

// ==================== 定价页面 ====================

const pricingHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>定价方案 - Image Background Remover</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
    <header class="bg-white shadow-sm">
        <div class="max-w-6xl mx-auto px-4 py-6">
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-3">
                    <a href="/" class="text-gray-500 hover:text-gray-700 transition-colors"><i class="fas fa-arrow-left text-lg"></i></a>
                    <h1 class="text-2xl font-bold text-gray-900">定价方案</h1>
                </div>
                <a href="/" class="text-blue-600 hover:text-blue-700 font-medium flex items-center space-x-1"><i class="fas fa-home"></i><span>返回首页</span></a>
            </div>
        </div>
    </header>
    <main class="max-w-6xl mx-auto px-4 py-12">
        <!-- 页面标题 -->
        <div class="text-center mb-12">
            <h2 class="text-4xl font-bold text-gray-900 mb-4">选择适合您的套餐</h2>
            <p class="text-lg text-gray-600">灵活定价，满足不同类型用户需求</p>
        </div>

        <!-- 定价卡片 -->
        <div class="grid md:grid-cols-3 gap-8 mb-12">
            <!-- Free 套餐 -->
            <div class="bg-white rounded-2xl shadow-xl p-8 border-2 border-gray-200 hover:border-blue-300 transition-all">
                <div class="text-center mb-6">
                    <div class="inline-block bg-gray-100 text-gray-700 px-4 py-1 rounded-full text-sm font-semibold mb-4">🆓 Free</div>
                    <h3 class="text-3xl font-bold text-gray-900 mb-2">免费</h3>
                    <p class="text-gray-500">适合偶尔使用的用户</p>
                </div>
                <div class="text-center mb-6">
                    <span class="text-5xl font-bold text-gray-900">¥0</span>
                    <span class="text-gray-500">/永久</span>
                </div>
                <ul class="space-y-4 mb-8">
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">3 次免费额度</span></li>
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">标准画质输出</span></li>
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">基础背景色切换</span></li>
                    <li class="flex items-center space-x-3 text-gray-400"><i class="fas fa-times"></i><span>批量处理</span></li>
                    <li class="flex items-center space-x-3 text-gray-400"><i class="fas fa-times"></i><span>高清画质输出</span></li>
                    <li class="flex items-center space-x-3 text-gray-400"><i class="fas fa-times"></i><span>优先处理</span></li>
                </ul>
                <a href="/auth/login" class="block w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-center py-3 rounded-lg font-medium transition-colors">免费注册</a>
            </div>

            <!-- Pro 套餐 -->
            <div class="bg-white rounded-2xl shadow-xl p-8 border-2 border-blue-500 relative transform scale-105">
                <div class="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg">最受欢迎</div>
                <div class="text-center mb-6">
                    <div class="inline-block bg-blue-100 text-blue-700 px-4 py-1 rounded-full text-sm font-semibold mb-4">⭐ Pro</div>
                    <h3 class="text-3xl font-bold text-gray-900 mb-2">专业版</h3>
                    <p class="text-gray-500">适合创作者和小微企业</p>
                </div>
                <div class="text-center mb-6">
                    <span class="text-5xl font-bold text-gray-900">¥29.9</span>
                    <span class="text-gray-500">/月</span>
                </div>
                <ul class="space-y-4 mb-8">
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">50 次额度/月</span></li>
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">高清画质输出</span></li>
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">全部背景色选项</span></li>
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">批量处理（最多 10 张）</span></li>
                    <li class="flex items-center space-x-3 text-gray-400"><i class="fas fa-times"></i><span>超高清画质</span></li>
                    <li class="flex items-center space-x-3 text-gray-400"><i class="fas fa-times"></i><span>API 访问</span></li>
                </ul>
                <button onclick="handlePayment('pro')" class="pay-btn block w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-center py-3 rounded-lg font-medium transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed">立即升级</button>
                <div class="mt-3 text-center">
                    <img src="https://www.paypalobjects.com/webstatic/mktg/logo/pp_cc_mark_111x69.jpg" alt="PayPal" class="h-8 mx-auto opacity-70">
                </div>
            </div>

            <!-- Premium 套餐 -->
            <div class="bg-white rounded-2xl shadow-xl p-8 border-2 border-gray-200 hover:border-purple-300 transition-all">
                <div class="text-center mb-6">
                    <div class="inline-block bg-purple-100 text-purple-700 px-4 py-1 rounded-full text-sm font-semibold mb-4">💎 Premium</div>
                    <h3 class="text-3xl font-bold text-gray-900 mb-2">高级版</h3>
                    <p class="text-gray-500">适合高频用户和企业</p>
                </div>
                <div class="text-center mb-6">
                    <span class="text-5xl font-bold text-gray-900">¥59.9</span>
                    <span class="text-gray-500">/月</span>
                </div>
                <ul class="space-y-4 mb-8">
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">200 次额度/月</span></li>
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">超高清画质输出</span></li>
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">自定义背景图</span></li>
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">批量处理（最多 50 张）</span></li>
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">优先处理通道</span></li>
                    <li class="flex items-center space-x-3"><i class="fas fa-check text-green-500"></i><span class="text-gray-700">API 访问权限</span></li>
                </ul>
                <button onclick="handlePayment('premium')" class="pay-btn block w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-center py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">立即升级</button>
                <div class="mt-3 text-center">
                    <img src="https://www.paypalobjects.com/webstatic/mktg/logo/pp_cc_mark_111x69.jpg" alt="PayPal" class="h-8 mx-auto opacity-70">
                </div>
            </div>
        </div>

        <!-- 常见问题 -->
        <div class="bg-white rounded-2xl shadow-xl p-8">
            <h3 class="text-2xl font-bold text-gray-900 mb-6 text-center">常见问题</h3>
            <div class="space-y-4">
                <div class="border-b border-gray-200 pb-4">
                    <h4 class="font-semibold text-gray-900 mb-2"><i class="fas fa-question-circle text-blue-500 mr-2"></i>免费额度的 3 次用完后怎么办？</h4>
                    <p class="text-gray-600">免费额度为注册赠送，一次性使用。用完后您可以选择升级到 Pro 或 Premium 套餐继续使用，或者使用新账号注册获得额外 3 次免费额度。</p>
                </div>
                <div class="border-b border-gray-200 pb-4">
                    <h4 class="font-semibold text-gray-900 mb-2"><i class="fas fa-question-circle text-blue-500 mr-2"></i>套餐额度会累积吗？</h4>
                    <p class="text-gray-600">不会。Pro 和 Premium 套餐的月度额度会在每个计费周期开始时重置，未使用的额度不会累积到下一周期。</p>
                </div>
                <div class="border-b border-gray-200 pb-4">
                    <h4 class="font-semibold text-gray-900 mb-2"><i class="fas fa-question-circle text-blue-500 mr-2"></i>如何升级或降级套餐？</h4>
                    <p class="text-gray-600">登录后可在个人中心页面进行套餐升级或降级。升级立即生效，降级将在下个计费周期生效。</p>
                </div>
                <div class="border-b border-gray-200 pb-4">
                    <h4 class="font-semibold text-gray-900 mb-2"><i class="fas fa-question-circle text-blue-500 mr-2"></i>支持退款吗？</h4>
                    <p class="text-gray-600">如购买后 7 天内未使用任何额度，可申请全额退款。超过 7 天或有使用记录则不支持退款。</p>
                </div>
                <div>
                    <h4 class="font-semibold text-gray-900 mb-2"><i class="fas fa-question-circle text-blue-500 mr-2"></i>支持哪些支付方式？</h4>
                    <p class="text-gray-600">目前支持微信支付、支付宝和银联卡支付。更多支付方式正在接入中。</p>
                </div>
            </div>
        </div>
    </main>
    <footer class="bg-white border-t mt-12">
        <div class="max-w-6xl mx-auto px-4 py-6 text-center text-gray-500 text-sm">
            <p>© 2026 Image Background Remover. All rights reserved.</p>
            <p class="mt-2">💳 安全支付由 PayPal 提供支持（沙箱环境）</p>
        </div>
    </footer>
    <script>
        let currentUser=null;
        async function checkAuth(){
            try{
                const r=await fetch('/auth/me');
                const d=await r.json();
                if(d.authenticated){
                    currentUser=d.user;
                    updateButtons();
                }
            }catch(e){console.error('Auth check failed:',e)}
        }
        function updateButtons(){
            const btns=document.querySelectorAll('.pay-btn');
            btns.forEach(btn=>{
                if(!currentUser){
                    btn.textContent='登录后购买';
                    btn.onclick=()=>{window.location.href='/auth/login'};
                }else{
                    const planType=btn.parentElement.querySelector('button').dataset?.plan||
                                   (btn.parentElement.querySelector('.bg-blue-100')?'pro':'premium');
                    if(currentUser.plan===planType){
                        btn.textContent='当前套餐';
                        btn.disabled=true;
                    }else{
                        btn.textContent='立即升级';
                        btn.disabled=false;
                    }
                }
            });
        }
        async function handlePayment(planType){
            if(!currentUser){
                window.location.href='/auth/login';
                return;
            }
            const btn=document.querySelector(\`.pay-btn[onclick="handlePayment('\${planType}')"]\`);
            const originalText=btn.textContent;
            btn.disabled=true;
            btn.textContent='处理中...';
            try{
                const res=await fetch('/api/paypal/create-order',{
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({planType})
                });
                const data=await res.json();
                if(!res.ok) throw new Error(data.error||'创建订单失败');
                // 跳转到 PayPal 支付页面
                if(data.approvalUrl){
                    window.location.href=data.approvalUrl;
                }else{
                    throw new Error('未获取到支付链接');
                }
            }catch(error){
                alert('支付失败：'+error.message);
                btn.disabled=false;
                btn.textContent=originalText;
            }
        }
        checkAuth();
    <\/script>
</body>
</html>`;

// ==================== 个人中心页面 ====================

const profileHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>个人中心 - Image Background Remover</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
    <header class="bg-white shadow-sm">
        <div class="max-w-4xl mx-auto px-4 py-6">
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-3">
                    <a href="/" class="text-gray-500 hover:text-gray-700 transition-colors"><i class="fas fa-arrow-left text-lg"></i></a>
                    <h1 class="text-2xl font-bold text-gray-900">个人中心</h1>
                </div>
                <a href="/" class="text-blue-600 hover:text-blue-700 font-medium flex items-center space-x-1"><i class="fas fa-home"></i><span>返回首页</span></a>
            </div>
        </div>
    </header>
    <main class="max-w-4xl mx-auto px-4 py-8">
        <!-- 未登录提示 -->
        <div id="notLoggedIn" class="hidden bg-white rounded-2xl shadow-xl p-12 text-center">
            <div class="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-user-lock text-gray-400 text-3xl"></i></div>
            <h2 class="text-xl font-bold text-gray-900 mb-2">请先登录</h2>
            <p class="text-gray-500 mb-6">登录后即可查看个人中心</p>
            <a href="/auth/login" class="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors">
                <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                <span>Google 登录</span>
            </a>
        </div>

        <!-- 已登录内容 -->
        <div id="profileContent" class="hidden space-y-6">
            <!-- 用户信息卡片 -->
            <div class="bg-white rounded-2xl shadow-xl p-8">
                <div class="flex items-center space-x-6">
                    <img id="pAvatar" class="w-20 h-20 rounded-full border-4 border-blue-200 shadow-lg" alt="avatar">
                    <div class="flex-1">
                        <h2 id="pName" class="text-2xl font-bold text-gray-900"></h2>
                        <p id="pEmail" class="text-gray-500 mt-1"></p>
                        <div class="flex items-center space-x-4 mt-3">
                            <span id="pPlan" class="text-xs font-semibold px-3 py-1 rounded-full bg-blue-100 text-blue-700 uppercase"></span>
                            <span id="pCreatedAt" class="text-xs text-gray-400"></span>
                        </div>
                    </div>
                    <div class="flex flex-col items-end space-y-2">
                        <a href="/pricing" id="upgradeBtn" class="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-all shadow-md hover:shadow-lg text-sm">升级套餐</a>
                        <a href="/auth/logout" class="text-sm text-gray-400 hover:text-red-600 transition-colors flex items-center space-x-1"><i class="fas fa-sign-out-alt"></i><span>退出</span></a>
                    </div>
                </div>
            </div>

            <!-- 使用额度 -->
            <div class="bg-white rounded-2xl shadow-xl p-8">
                <h3 class="text-lg font-bold text-gray-900 mb-4 flex items-center space-x-2"><i class="fas fa-chart-bar text-blue-600"></i><span>当前套餐额度</span></h3>
                <div class="flex items-center justify-between mb-3">
                    <span class="text-gray-600">已使用 <span id="pUsed" class="font-bold text-gray-900"></span> / <span id="pTotal" class="font-bold text-gray-900"></span> 次</span>
                    <span id="pPercent" class="text-sm font-medium text-blue-600"></span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-3">
                    <div id="pBar" class="h-3 rounded-full transition-all duration-500" style="width:0%"></div>
                </div>
                <p id="pResetTip" class="text-sm text-gray-400 mt-3"><i class="fas fa-info-circle mr-1"></i>免费套餐额度一次性使用，用完即止</p>
            </div>

            <!-- 使用记录 -->
            <div class="bg-white rounded-2xl shadow-xl p-8">
                <h3 class="text-lg font-bold text-gray-900 mb-4 flex items-center space-x-2"><i class="fas fa-history text-blue-600"></i><span>使用记录</span></h3>
                <div id="logsLoading" class="text-center py-8 text-gray-400"><div class="loading-spinner mx-auto mb-2" style="border:3px solid #e5e7eb;border-top:3px solid #3b82f6;border-radius:50%;width:30px;height:30px;animation:spin 1s linear infinite"></div>加载中...</div>
                <div id="logsEmpty" class="hidden text-center py-8"><div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3"><i class="fas fa-inbox text-gray-300 text-2xl"></i></div><p class="text-gray-400">暂无使用记录</p></div>
                <div id="logsTable" class="hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead><tr class="border-b border-gray-200"><th class="text-left py-3 px-2 text-gray-500 font-medium">时间</th><th class="text-left py-3 px-2 text-gray-500 font-medium">文件名</th><th class="text-right py-3 px-2 text-gray-500 font-medium">大小</th><th class="text-center py-3 px-2 text-gray-500 font-medium">状态</th></tr></thead>
                            <tbody id="logsBody"></tbody>
                        </table>
                    </div>
                    <div id="logsPagination" class="flex justify-center items-center space-x-4 mt-4"></div>
                </div>
            </div>
        </div>
    </main>
    <style>@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}.loading-spinner{display:inline-block}</style>
    <script>
        let currentPage=1;
        async function loadProfile(){
            try{
                const r=await fetch('/auth/me');const d=await r.json();
                if(!d.authenticated){document.getElementById('notLoggedIn').classList.remove('hidden');return}
                document.getElementById('profileContent').classList.remove('hidden');
                const u=d.user;
                document.getElementById('pAvatar').src=u.picture||'';
                document.getElementById('pName').textContent=u.name||'用户';
                document.getElementById('pEmail').textContent=u.email;
                const planText=u.plan==='free'?'🆓 Free':u.plan==='pro'?'⭐ Pro':'💎 Premium';
                document.getElementById('pPlan').textContent=planText;
                document.getElementById('pCreatedAt').textContent='注册于 '+new Date(u.createdAt).toLocaleDateString('zh-CN');
                // 根据套餐显示不同的升级按钮
                const upgradeBtn=document.getElementById('upgradeBtn');
                if(u.plan==='free'){upgradeBtn.textContent='升级套餐';upgradeBtn.href='/pricing';}
                else{upgradeBtn.textContent='管理订阅';upgradeBtn.href='/pricing';}
                const used=u.used,total=u.planLimit,pct=total>0?Math.round(used/total*100):0;
                document.getElementById('pUsed').textContent=used;
                document.getElementById('pTotal').textContent=total;
                document.getElementById('pPercent').textContent=pct+'%';
                const bar=document.getElementById('pBar');bar.style.width=pct+'%';
                bar.className='h-3 rounded-full transition-all duration-500 '+(pct>=90?'bg-red-500':pct>=60?'bg-yellow-500':'bg-blue-500');
                // 根据套餐显示不同提示
                const resetTip=document.getElementById('pResetTip');
                if(u.plan==='free'){resetTip.innerHTML='<i class="fas fa-info-circle mr-1"></i>免费套餐额度一次性使用，用完即止';}
                else if(u.plan==='pro'||u.plan==='premium'){resetTip.innerHTML='<i class="fas fa-redo mr-1"></i>额度将于下月同日自动重置';}
                loadLogs(1);
            }catch(e){document.getElementById('notLoggedIn').classList.remove('hidden')}
        }
        async function loadLogs(page){
            currentPage=page;
            document.getElementById('logsLoading').classList.remove('hidden');
            document.getElementById('logsTable').classList.add('hidden');
            document.getElementById('logsEmpty').classList.add('hidden');
            try{
                const r=await fetch('/api/usage?page='+page+'&limit=10');const d=await r.json();
                document.getElementById('logsLoading').classList.add('hidden');
                if(!d.logs||d.logs.length===0){document.getElementById('logsEmpty').classList.remove('hidden');return}
                document.getElementById('logsTable').classList.remove('hidden');
                const body=document.getElementById('logsBody');body.innerHTML='';
                d.logs.forEach(l=>{
                    const tr=document.createElement('tr');tr.className='border-b border-gray-100 hover:bg-gray-50';
                    const t=new Date(l.created_at+'Z').toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
                    const sz=l.file_size?(l.file_size/1024).toFixed(1)+' KB':'—';
                    const st=l.status==='success'?'<span class="text-green-600">✅ 成功</span>':'<span class="text-red-600">❌ 失败</span>';
                    tr.innerHTML='<td class="py-3 px-2 text-gray-600">'+t+'</td><td class="py-3 px-2 text-gray-800 max-w-[200px] truncate">'+((l.file_name||'—'))+'</td><td class="py-3 px-2 text-gray-600 text-right">'+sz+'</td><td class="py-3 px-2 text-center">'+st+'</td>';
                    body.appendChild(tr);
                });
                // 分页
                const totalPages=Math.ceil(d.total/d.limit);
                const pg=document.getElementById('logsPagination');pg.innerHTML='';
                if(totalPages>1){
                    if(page>1){const b=document.createElement('button');b.className='px-3 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300';b.textContent='上一页';b.onclick=()=>loadLogs(page-1);pg.appendChild(b)}
                    const s=document.createElement('span');s.className='text-sm text-gray-500';s.textContent=page+' / '+totalPages;pg.appendChild(s);
                    if(page<totalPages){const b=document.createElement('button');b.className='px-3 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300';b.textContent='下一页';b.onclick=()=>loadLogs(page+1);pg.appendChild(b)}
                }
            }catch(e){document.getElementById('logsLoading').classList.add('hidden');document.getElementById('logsEmpty').classList.remove('hidden')}
        }
        loadProfile();
    <\/script>
</body>
</html>`;

// ==================== 主路由 ====================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // Auth
    if (url.pathname === '/auth/login' && request.method === 'GET') return handleAuthLogin(env);
    if (url.pathname === '/auth/callback' && request.method === 'GET') return handleAuthCallback(request, env);
    if (url.pathname === '/auth/logout' && request.method === 'GET') return handleAuthLogout(env);
    if (url.pathname === '/auth/me' && request.method === 'GET') return handleAuthMe(request, env);

    // PayPal API
    if (url.pathname === '/api/paypal/create-order' && request.method === 'POST') return handlePayPalCreateOrder(request, env);
    if (url.pathname === '/api/paypal/capture-order' && request.method === 'POST') return handlePayPalCaptureOrder(request, env);
    if (url.pathname === '/api/paypal/create-subscription' && request.method === 'POST') return handlePayPalCreateSubscription(request, env);

    // Payment Pages
    if (url.pathname === '/payment/success' && request.method === 'GET') return handlePaymentSuccess(request, env);
    if (url.pathname === '/payment/cancel' && request.method === 'GET') return handlePaymentCancel(request, env);

    // API
    if (url.pathname === '/api/remove-bg' && request.method === 'POST') return handleRemoveBg(request, env);
    if (url.pathname === '/api/usage' && request.method === 'GET') return handleUsageLogs(request, env);

    // Pages
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return new Response(indexHTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors } });
    }
    if (request.method === 'GET' && url.pathname === '/pricing') {
      return new Response(pricingHTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors } });
    }
    if (request.method === 'GET' && url.pathname === '/profile') {
      return new Response(profileHTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors } });
    }

    return new Response('Not Found', { status: 404, headers: { ...cors, 'Content-Type': 'text/plain' } });
  },
};
