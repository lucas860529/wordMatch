/**
 * Worker 進入點：路由與登入閘門。
 *
 * 這裡取代了 Cloudflare Pages 的檔案路由。Pages 會把 `functions/api/lesson.js`
 * 自動掛到 `/api/lesson`；Workers 沒有這個機制，路由要自己寫 —— 就是這一支。
 *
 * ⚠️ 靜態檔案也會經過這裡。預設的 Workers 行為是「先比對靜態檔案，對到就直接送出、
 * 根本不叫起 Worker」，那樣就沒辦法擋住未登入的人看到 app。所以 wrangler.jsonc
 * 開了 `run_worker_first: true`，一切都先進來這裡。
 */

import * as lesson from './api/lesson.js';
import * as tts from './api/tts.js';
import * as auth from './api/auth.js';
import * as history from './api/history.js';
import { currentUser } from './api/_shared/auth.js';

const ROUTES = {
  '/api/lesson': lesson,
  '/api/tts': tts,
  '/api/login': auth,
  '/api/logout': auth,
  '/api/me': auth,
  '/api/history': history,
};

/**
 * 不需要登入就能拿到的路徑。
 *
 * 只放「登入頁本身需要的東西」。icons 與 manifest 在這裡是因為
 * 登入頁與加入主畫面要用到；其餘一律要登入。
 */
const PUBLIC = [
  '/login/',
  '/login/index.html',
  '/manifest.webmanifest',
  '/sw.js',
];

const PUBLIC_PREFIX = ['/icons/'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // API：各端點自己檢查登入（它們要回 JSON 錯誤，不是轉址到登入頁）
    const mod = ROUTES[path];
    if (mod) return dispatch(mod, request, env, ctx);

    if (path.startsWith('/api/')) return notFound(true);

    // 靜態檔案：公開的直接放行
    if (isPublic(path)) return serve(env, request);

    // 其餘一律要登入。沒登入就送去登入頁，並記住原本要去哪
    const user = await currentUser(env, request).catch(() => null);
    if (!user) {
      const next = encodeURIComponent(path + url.search);
      return Response.redirect(`${url.origin}/login/?next=${next}`, 302);
    }

    return serve(env, request);
  },
};

function isPublic(path) {
  if (PUBLIC.includes(path)) return true;
  return PUBLIC_PREFIX.some((p) => path.startsWith(p));
}

function serve(env, request) {
  if (env.ASSETS) return env.ASSETS.fetch(request);
  return notFound(false);
}

/**
 * 依 HTTP method 找對應的處理函式。
 *
 * 處理函式沿用 Pages Functions 的寫法（`onRequestPost({ request, env, waitUntil })`），
 * 不是因為還在用 Pages，而是那個形狀本來就夠用，換掉只會製造無謂的 diff。
 */
async function dispatch(mod, request, env, ctx) {
  const handler = mod[`onRequest${cap(request.method)}`] || mod.onRequest;

  if (!handler) {
    return json({ ok: false, code: 'bad_input', message: `這個端點不收 ${request.method}。` }, 405);
  }

  try {
    return await handler({
      request,
      env,
      // Pages 給的是裸的 waitUntil，Workers 是 ctx 上的方法，要綁住 this
      waitUntil: ctx.waitUntil.bind(ctx),
      ctx,
    });
  } catch (e) {
    // 任何漏接的例外都不要變成 Cloudflare 的預設錯誤頁 ——
    // 前端只認得我們自己那幾種 code
    console.log('unhandled', pathOf(request), e && e.stack ? e.stack : e);
    return json({ ok: false, code: 'upstream', message: '伺服器出了狀況，再試一次。' }, 500);
  }
}

const cap = (m) => m.charAt(0) + m.slice(1).toLowerCase();

const pathOf = (request) => {
  try { return new URL(request.url).pathname; } catch { return '?'; }
};

function notFound(asJson) {
  if (asJson) return json({ ok: false, code: 'not_found', message: '沒有這個端點。' }, 404);
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
