/**
 * 認證：靜態密碼 + 工作階段。
 *
 * 這個站是邀請制的。密碼由管理者直接寫在 Cloudflare 的 Secret 裡，
 * **沒有註冊流程、沒有使用者資料表**。
 *
 * 格式（環境變數 ACCESS_CODES），一行一組，或用逗號分隔：
 *
 *     lucas:kL8x-2mQp-7vRt
 *     amy:9Gh4-bNw2-Xc5z
 *     ken:tY7m-3Jd8-Qa1s
 *
 * 冒號左邊是名字（歷史紀錄依它分人存），右邊是密碼。登入只要輸入密碼。
 *
 * ── 為什麼不做密碼雜湊 ──────────────────────────────
 *
 * 雜湊真正防的是**資料庫外洩**：密碼表被倒出來時，攻擊者不該直接拿到明文。
 * 但這裡的密碼放在 Worker 的 Secret（加密儲存）裡，不在資料庫裡 ——
 * 能讀到 Secret 的人早就拿下整個 Worker 了，有沒有雜湊差別不大。
 *
 * 順帶解決一個現實問題：Workers 免費方案每次請求 CPU 上限 10ms，
 * 而 PBKDF2 是刻意設計成慢的，跑起來會直接超時。
 *
 * **但這兩件事跟雜湊無關，一定要留著**：定值時間比對（見 timingSafeEqual）
 * 與登入節流（見 loginBlocked）。靜態密碼沒有這兩個就是可以被慢慢爆的。
 */

const COOKIE = 'wm_session';
const SESSION_DAYS = 30;

const enc = new TextEncoder();

// ── 密碼表 ──────────────────────────────────────────

/** 解析 ACCESS_CODES。回傳 [{ name, code }] */
function parseCodes(env) {
  return String(env.ACCESS_CODES || '')
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(':');
      // 沒寫名字就用 guest —— 還是能登入，只是大家共用同一份歷史
      if (i < 0) return { name: 'guest', code: line };
      return { name: line.slice(0, i).trim().toLowerCase(), code: line.slice(i + 1).trim() };
    })
    .filter((e) => e.code);
}

/**
 * 比對密碼，回傳 { name, fingerprint }，不對就回 null。
 *
 * **一定要把整張表都比完**，不要一對到就 return。提早返回會讓回應時間
 * 洩漏「密碼排在第幾組」這種資訊。
 */
export async function matchCode(env, password) {
  const input = enc.encode(String(password || ''));
  let hit = null;

  for (const entry of parseCodes(env)) {
    if (timingSafeEqual(input, enc.encode(entry.code))) hit = entry;
  }

  if (!hit) return null;
  return { name: hit.name, fingerprint: await sha256Hex(`${hit.name}:${hit.code}`) };
}

/** 目前有效的密碼指紋集合。用來讓「從 Secret 刪掉一行」立刻踢掉那個人 */
async function validFingerprints(env) {
  const out = new Set();
  for (const e of parseCodes(env)) out.add(await sha256Hex(`${e.name}:${e.code}`));
  return out;
}

// ── 工具 ────────────────────────────────────────────

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64u(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 定值時間比較。
 *
 * 用 === 比字串會在第一個不同的位元組就返回，所以回應時間會隨著
 * 「猜對了幾個開頭字元」而變化，理論上可以一個字元一個字元問出密碼。
 * 這裡不管對不對都走完全長度。
 *
 * 長度不同時仍然跑一次比對再回 false，避免從「快到不合理」看出長度。
 */
function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

// ── 工作階段 ────────────────────────────────────────

/**
 * 建立工作階段。
 *
 * 回傳的 token 只在這一刻存在於記憶體，D1 存的是它的 SHA-256。
 * 所以整個資料庫被倒出來也沒辦法拿裡面的值冒充任何人。
 */
export async function createSession(env, name, fingerprint, userAgent) {
  const token = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const expires = now + SESSION_DAYS * 86400_000;

  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, code_fingerprint, created_at, expires_at, last_seen, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(await sha256Hex(token), name, fingerprint, now, expires, now, (userAgent || '').slice(0, 200)).run();

  return { token, expires };
}

/**
 * 從 cookie 讀出目前登入的人。沒登入／過期／密碼已從 Secret 移除，都回 null。
 *
 * 每次呼叫查一次 D1。換成簽章 cookie 可以省掉這次查詢，但那樣就沒辦法
 * 單獨踢掉一個人 —— 對邀請制的站，這個能力比省 1ms 重要。
 */
export async function currentUser(env, request) {
  const token = readCookie(request, COOKIE);
  if (!token || !env.DB) return null;

  const row = await env.DB.prepare(
    'SELECT token_hash, user_id, code_fingerprint, expires_at FROM sessions WHERE token_hash = ?',
  ).bind(await sha256Hex(token)).first();

  if (!row) return null;

  const expired = row.expires_at < Date.now();
  // 密碼從 Secret 刪掉或改掉 → 指紋對不上 → 這個人的所有 session 立刻失效
  const revoked = !(await validFingerprints(env)).has(row.code_fingerprint);

  if (expired || revoked) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(row.token_hash).run();
    return null;
  }

  return { id: row.user_id, name: row.user_id };
}

export async function destroySession(env, request) {
  const token = readCookie(request, COOKIE);
  if (!token || !env.DB) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token)).run();
}

// ── 登入節流 ────────────────────────────────────────

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;

/**
 * 同一個 IP 在 15 分鐘內失敗 10 次就先擋著。
 *
 * 用 D1 不用 KV：D1 一定綁得上，而 KV 是選配、沒綁時 guard.js 會直接放行。
 * 「沒綁就放行」這種設計可以套在額度控制上，不能套在登入上。
 */
export async function loginBlocked(env, ip) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ok = 0 AND at > ?',
  ).bind(ip, Date.now() - WINDOW_MS).first();
  return (row?.n || 0) >= MAX_FAILURES;
}

export async function recordAttempt(env, ip, ok) {
  await env.DB.prepare('INSERT INTO login_attempts (ip, at, ok) VALUES (?, ?, ?)')
    .bind(ip, Date.now(), ok ? 1 : 0).run();

  // 偶爾掃掉舊紀錄，免得這張表無限長大
  if (Math.random() < 0.05) {
    await env.DB.prepare('DELETE FROM login_attempts WHERE at < ?')
      .bind(Date.now() - WINDOW_MS * 4).run().catch(() => {});
  }
}

// ── Cookie ──────────────────────────────────────────

export function sessionCookie(token, expires) {
  return [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',       // JavaScript 讀不到，XSS 偷不走
    'Secure',         // 只走 HTTPS
    'SameSite=Lax',   // 擋掉跨站送出的 POST（CSRF 的主要防線）
    `Max-Age=${Math.floor((expires - Date.now()) / 1000)}`,
  ].join('; ');
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * CSRF 的第二道。SameSite=Lax 已經擋掉大部分跨站 POST，
 * 但這兩支端點會花錢，多檢查一次來源很便宜。
 */
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // curl 之類沒有 Origin，交給 cookie 把關
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
