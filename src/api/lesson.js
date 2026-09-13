/**
 * POST /api/lesson —— Gemini 代理。
 *
 * 前端只送 { lang, topic } 兩個值。prompt 在伺服器端（_shared/prompts.js），
 * 所以沒有人能拿這支端點當免費的通用 LLM 用。
 */

import { promptFor, schemaFor } from './_shared/prompts.js';
import { currentUser, sameOrigin } from './_shared/auth.js';
import { save } from './history.js';
import {
  MAX_TOPIC, bump, cleanText, fail, json, readJson, validLang,
} from './_shared/guard.js';

// 站是邀請制的，所以額度按「人」算而不是按 IP —— 同一個人換網路不該重新計數，
// 同一個咖啡廳的兩個人也不該互相排擠
const PER_USER_PER_DAY = 50;
const TIMEOUT_MS = 55_000;

export async function onRequestPost({ request, env, waitUntil }) {
  const ctx = { waitUntil };

  if (!sameOrigin(request)) return fail('bad_input', '來源不對。', 403);

  const user = await currentUser(env, request);
  if (!user) return fail('unauthorized', '還沒登入，或登入已經過期。', 401);

  const body = await readJson(request);
  if (!body) return fail('bad_input', '請求格式不對。');

  const lang = body.lang;
  if (!validLang(lang)) return fail('bad_input', '語言代碼不在 en / ja / th 之內。');

  const topic = cleanText(body.topic, MAX_TOPIC);
  if (!topic) return fail('bad_input', `主題是空的，或超過 ${MAX_TOPIC} 個字。`);

  if (!env.GEMINI_API_KEY) {
    return fail('upstream', '伺服器沒有設定 GEMINI_API_KEY。', 500);
  }

  const gate = await bump(env, 'lesson', user.id, 1, PER_USER_PER_DAY, { ctx });
  if (!gate.ok) {
    return fail('rate_limited', `今天的課程生成已經用到上限（${PER_USER_PER_DAY} 次），明天再來。`, 429);
  }

  const model = env.MODEL_ID || 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 金鑰走 header 不走 query string —— 免得出現在任何一層的日誌網址裡
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptFor(lang, topic) }] }],
        generationConfig: {
          // 有了 responseSchema 模型就吐不出 markdown 圍籬，bad_json 幾乎消失
          responseMimeType: 'application/json',
          responseSchema: schemaFor(lang),
          temperature: 0.75,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return fail('upstream', timedOut ? '生成太久沒有回應，再試一次。' : '連不上生成服務，再試一次。', 504);
  }

  if (res.status === 429) {
    return fail('rate_limited', 'Gemini 的免費額度暫時用完了，等幾分鐘再試。', 429);
  }
  if (!res.ok) {
    // 上游的錯誤訊息可能帶金鑰或內部細節，不要原封不動往前端丟
    console.log('gemini error', res.status, (await res.text()).slice(0, 500));
    return fail('upstream', `生成服務回了 ${res.status}，再試一次。`, 502);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return fail('upstream', '生成服務的回應讀不出來。', 502);
  }

  const blocked = payload?.promptFeedback?.blockReason;
  if (blocked) {
    return fail('upstream', '這個主題被生成服務擋下了。換個講法再問一次。', 502);
  }

  const candidate = payload?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p?.text || '').join('') || '';

  if (!text) {
    const why = candidate?.finishReason;
    if (why === 'MAX_TOKENS') {
      return fail('upstream', '課程寫到一半就滿了。把主題講得更窄一點再試。', 502);
    }
    return fail('upstream', '這次沒有寫出任何內容。把主題講得更具體一點再試。', 502);
  }

  let lesson;
  try {
    lesson = JSON.parse(text);
  } catch {
    return fail('bad_json', '回傳的內容格式不完整，通常再生成一次就會好。', 502);
  }

  if (!lesson || typeof lesson !== 'object') {
    return fail('bad_json', '回傳的內容格式不完整，通常再生成一次就會好。', 502);
  }

  // 存進 D1。存不進去不要讓整堂課白生成 —— 前端仍然拿得到內容，
  // 只是這次不會出現在歷史裡
  const id = crypto.randomUUID();
  const title = strip(lesson.title) || topic;

  try {
    await save(env, user.id, { id, lang, topic, title, lesson });
  } catch (e) {
    console.log('history save failed', e && e.message);
  }

  return json({ ok: true, id, title, lesson });
}

/**
 * 剝掉 <en>/<jp>/<thai> 標記。
 * 存進 D1 的 title 會被歷史清單當純文字用，留著標記會看到字面的 <en>Make</en>。
 */
function strip(text) {
  return String(text || '').replace(
    /<(en|jp|thai)>([\s\S]*?)<\/\1>/g,
    (m, tag, inner) => inner.split('|')[0],
  ).trim();
}

/** 直接用瀏覽器打開這個網址時給句人話，比空白的 405 好查 */
export async function onRequestGet() {
  return fail('bad_input', '這個端點只收 POST。', 405);
}
