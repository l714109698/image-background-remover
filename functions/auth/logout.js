/**
 * Logout - 清除认证 Cookie
 * GET /auth/logout
 */
export async function onRequestGet({ env }) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: (env.SITE_URL || '') + '/',
      'Set-Cookie': 'auth_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
  });
}
