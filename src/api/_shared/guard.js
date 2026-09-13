/**
 * 輸入驗證與成本護欄。
 *
 * 這個頁面是公開網址、沒有登入，任何拿到網址的人都能呼叫 /api/*。
 * 金鑰藏在伺服器端只解決「金鑰不外洩」，不解決「有人幫你花錢」。
 * 所以這裡才是整套系統真正的收費防線。
 */

// 這是「說出來的語言」清單，給 TTS 用。課程的組合另見 courses.js
export const LANGS = ['en', 'ja', 'th', 'zh'];

export const MAX_TOPIC = 100;     // 字元
export const MAX_TTS_TEXT = 200;  // 字元。這是每次請求的成本硬上限

// ── 回應 ────────────────────────────────────────────

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

/** code 只有四種：rate_limited / bad_input / upstream / bad_json（見 API 合約） */
export function fail(code, message, status = 400) {
  return json({ ok: false, code, message }, status);
}

// ── 輸入 ────────────────────────────────────────────

/** body 壞掉時回 null，不要讓 Function 因為別人亂送而丟 500 */
export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

export function validLang(lang) {
  return typeof lang === 'string' && LANGS.includes(lang);
}

/**
 * 收斂使用者送來的字串：砍控制字元、去頭尾空白、檢查長度。
 * 回傳 null 代表不合格。
 */
export function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\p{Cc}/gu, '').trim();
  if (!text) return null;
  // 用 Array.from 而不是 .length —— 泰文與 emoji 的碼位數跟視覺長度不一樣
  return Array.from(text).length > max ? null : text;
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || '0.0.0.0';
}

// ── 速率限制 ────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD（UTC）
}

const TWO_DAYS = 60 * 60 * 48;

/**
 * 以「用途 + 當天 + 識別碼」為鍵累加，超過 limit 就擋。
 *
 * ⚠️ KV 免費額度是每天 10 萬次讀、**1000 次寫**，瓶頸在寫。所以 writeEvery > 1 時
 * 採隨機取樣計數：每次請求有 1/writeEvery 的機率寫回去，一次加 writeEvery 份。
 * 期望值仍然是「每次請求 +1」，但寫入量降為 1/writeEvery。代價是單次計數會抖，
 * 換到的是額度撐得住 —— 對「防失控」這個目的，統計上準就夠了。
 *
 * KV 沒綁（本機開發）或讀寫出錯時**放行**。這是刻意的：限流壞掉不該讓功能整個死掉。
 * 代價是護欄會失效，所以 Google Cloud 的預算快訊是必要的第二道，不是備援。
 */
export async function bump(env, bucket, id, amount, limit, { writeEvery = 1, ctx } = {}) {
  const kv = env.RATE;
  if (!kv) return { ok: true, count: 0 };

  const key = `${bucket}:${today()}:${id}`;
  let count = 0;
  try {
    count = parseInt(await kv.get(key), 10) || 0;
  } catch {
    return { ok: true, count: 0 };
  }

  if (count >= limit) return { ok: false, count };

  if (writeEvery === 1 || Math.random() < 1 / writeEvery) {
    const next = count + amount * writeEvery;
    const write = kv.put(key, String(next), { expirationTtl: TWO_DAYS }).catch(() => {});
    // waitUntil 讓計數寫入不擋住回應
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(write);
    else await write;
  }

  return { ok: true, count: count + amount };
}
