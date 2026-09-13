/**
 * POST /api/login   { password }
 * POST /api/logout
 * GET  /api/me
 */

import {
  clearCookie, createSession, currentUser, destroySession,
  loginBlocked, matchCode, recordAttempt, sameOrigin, sessionCookie,
} from './_shared/auth.js';
import { clientIp, fail, json, readJson } from './_shared/guard.js';

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (url.pathname === '/api/logout') return logout({ request, env });
  return login({ request, env });
}

export async function onRequestGet({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return fail('unauthorized', '還沒登入。', 401);
  return json({ ok: true, user: { name: user.name } });
}

async function login({ request, env }) {
  if (!sameOrigin(request)) return fail('bad_input', '來源不對。', 403);
  if (!env.DB) return fail('upstream', '伺服器沒有接上資料庫。', 500);
  if (!env.ACCESS_CODES) return fail('upstream', '伺服器還沒設定 ACCESS_CODES。', 500);

  const ip = clientIp(request);

  if (await loginBlocked(env, ip)) {
    return fail('rate_limited', '嘗試太多次了，等 15 分鐘再試。', 429);
  }

  const body = await readJson(request);
  const password = String(body?.password || '');

  if (!password) return fail('bad_input', '密碼是空的。');

  const hit = await matchCode(env, password);

  if (!hit) {
    await recordAttempt(env, ip, false);
    return fail('unauthorized', '密碼不對。', 401);
  }

  await recordAttempt(env, ip, true);

  const { token, expires } = await createSession(
    env, hit.name, hit.fingerprint, request.headers.get('user-agent'),
  );

  return json(
    { ok: true, user: { name: hit.name } },
    200,
    { 'set-cookie': sessionCookie(token, expires) },
  );
}

async function logout({ request, env }) {
  await destroySession(env, request);
  return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
}
