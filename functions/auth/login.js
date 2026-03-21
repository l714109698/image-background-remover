/**
 * Google OAuth Login - 构造授权 URL 并重定向
 * GET /auth/login
 */
export async function onRequestGet({ env }) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const redirectUri = env.SITE_URL + '/auth/callback';

  // 生成随机 state 防止 CSRF
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    state: state,
    prompt: 'consent',
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: googleAuthUrl,
      // 将 state 存入 cookie，回调时验证
      'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
