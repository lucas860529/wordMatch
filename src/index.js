/**
 * Worker 進入點。
 *
 * 這裡取代了 Cloudflare Pages 的檔案路由。Pages 會把 `functions/api/lesson.js`
 * 自動掛到 `/api/lesson`；Workers 沒有這個機制，路由要自己寫 —— 就是這 30 行。
 *
 * （官方有 `wrangler pages functions build` 可以把 Pages Functions 編譯成 Worker，
 *   但那是相容層，多一層轉換也多一個會壞的地方。手寫的路由看得懂、改得動。）
 *
 * 靜態檔案不經過這裡：Workers 預設先比對 `assets.directory` 底下的檔案，
 * 有對到就直接送出、根本不會叫起這支 Worker。所以會走到這裡的只有
 * `/api/*` 和所有打錯的網址。
 */

import * as lesson from './api/lesson.js';
import * as tts from './api/tts.js';

const ROUTES = {
  '/api/lesson': lesson,
  '/api/tts': tts,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const mod = ROUTES[url.pathname];
    if (mod) return dispatch(mod, request, env, ctx);

    // 靜態檔案沒對到、又不是 API。交給資產伺服器去回它的 404，
    // 這樣 /en/ 這種目錄網址仍然能解析到 /en/index.html
    if (env.ASSETS) return env.ASSETS.fetch(request);

    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};

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
    // 任何漏接的例外都不要變成 Cloudflare 的預設 1101 錯誤頁 ——
    // 前端只認得我們自己那四種 code
    console.log('unhandled', url(request), e && e.stack ? e.stack : e);
    return json({ ok: false, code: 'upstream', message: '伺服器出了狀況，再試一次。' }, 500);
  }
}

const cap = (m) => m.charAt(0) + m.slice(1).toLowerCase();

const url = (request) => {
  try { return new URL(request.url).pathname; } catch { return '?'; }
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
