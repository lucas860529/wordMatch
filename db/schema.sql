-- wordMatch 的 D1 schema
--
-- 套用：
--   npx wrangler d1 execute wordmatch --remote --file=db/schema.sql
--
-- 本機：把 --remote 換成 --local

-- ── 沒有使用者資料表 ──────────────────────────────
--
-- 密碼直接寫在 Cloudflare 的 Secret `ACCESS_CODES` 裡，一行一組「名字:密碼」。
-- 沒有註冊流程、沒有密碼欄位、沒有要保護的密碼表。
-- 詳細理由見 src/api/_shared/auth.js 開頭。

-- ── 登入工作階段 ────────────────────────────────────
--
-- 存的是 token 的 SHA-256，不是 token 本身 —— 這樣就算整個 D1 被倒出來，
-- 也沒辦法拿裡面的值去冒充任何人登入。

CREATE TABLE IF NOT EXISTS sessions (
  token_hash       TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,   -- ACCESS_CODES 裡冒號左邊的名字
  -- 這組密碼的指紋。密碼從 Secret 改掉或刪掉，指紋就對不上，
  -- 那個人的所有 session 立刻失效 —— 這是「踢掉某一個人」的機制
  code_fingerprint TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  -- 只留最後一次使用的時間與來源，用來看「這個帳號還在用嗎」
  last_seen  INTEGER NOT NULL,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- ── 登入嘗試 ────────────────────────────────────────
--
-- 防暴力破解。刻意用 D1 而不是 KV：D1 一定綁得上，KV 是選配，
-- 而「限流沒綁就放行」這種設計不能套用在登入上。

CREATE TABLE IF NOT EXISTS login_attempts (
  ip         TEXT NOT NULL,
  at         INTEGER NOT NULL,
  ok         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_ip_at ON login_attempts(ip, at);

-- ── 課程歷史 ────────────────────────────────────────
--
-- 原本只存在瀏覽器的 localStorage，換裝置就沒了。搬到這裡之後
-- 換手機、換瀏覽器、清快取都還在。localStorage 仍然保留當本機快取。

CREATE TABLE IF NOT EXISTS lessons (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,               -- ACCESS_CODES 裡的名字
  lang       TEXT NOT NULL,               -- en / ja / th
  topic      TEXT NOT NULL,               -- 使用者輸入的主題
  title      TEXT NOT NULL,               -- 模型給的標題（已剝掉標記）
  body       TEXT NOT NULL,               -- 課程 JSON 全文
  created_at INTEGER NOT NULL
);

-- 歷史清單一律是「某人 + 某語言，依時間新到舊」，所以索引就照這個形狀開
CREATE INDEX IF NOT EXISTS idx_lessons_user_lang ON lessons(user_id, lang, created_at DESC);
