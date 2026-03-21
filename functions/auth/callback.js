/**
 * Google OAuth Callback - 用 authorization code 换 token，签发 JWT
 * GET /auth/callback
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Google 返回错误
  if (error) {
    return redirectWithError('Google 授权失败: ' + error);
  }

  if (!code) {
    return redirectWithError('缺少授权码');
  }

  // 验证 state（防 CSRF）
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  if (!cookies.oauth_state || cookies.oauth_state !== state) {
    return redirectWithError('安全验证失败，请重新登录');
  }

  try {
    // 1. 用 code 换 access_token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.SITE_URL + '/auth/callback',
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error('Token exchange failed:', err);
      return redirectWithError('获取令牌失败');
    }

    const tokenData = await tokenResponse.json();

    // 2. 用 access_token 获取用户信息
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userResponse.ok) {
      return redirectWithError('获取用户信息失败');
    }

    const user = await userResponse.json();

    // 3. 签发 JWT
    const jwt = await createJWT(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, // 7 天过期
      },
      env.JWT_SECRET
    );

    // 4. 设置 Cookie 并重定向回首页
    return new Response(null, {
      status: 302,
      headers: {
        Location: env.SITE_URL + '/',
        'Set-Cookie': [
          `auth_token=${jwt}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
          // 清除 oauth_state cookie
          'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        ].join(', '),
      },
    });
  } catch (err) {
    console.error('OAuth callback error:', err);
    return redirectWithError('登录过程出错');
  }
}

function redirectWithError(message) {
  const params = new URLSearchParams({ error: message });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/?${params.toString()}`,
      // 清除 state cookie
      'Set-Cookie': 'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
  });
}

function parseCookies(cookieHeader) {
  const cookies = {};
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) cookies[name.trim()] = rest.join('=').trim();
  });
  return cookies;
}

/**
 * 使用 Web Crypto API 创建 JWT（HMAC-SHA256）
 * Cloudflare Workers 原生支持，无需外部依赖
 */
async function createJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));

  const encodedSignature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));

  return `${signingInput}.${encodedSignature}`;
}

function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
