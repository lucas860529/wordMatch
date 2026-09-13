-- 001 — lessons.lang 從「語言」改成「課程」
--
-- 背景：加入「泰語母語者學中文」之後，一堂課不再只由學習語言決定，
-- 而是「母語 × 學習語言」的組合（見 src/api/_shared/courses.js）。
-- 既有的三個課程說明語言都是繁中，所以一律補上 zh- 前綴。
--
-- 欄位名沒有跟著改（還叫 lang），因為 D1 改欄位名要重建整張表，
-- 為了一個名字不值得。程式裡有註解說明。
--
-- 套用：
--   npx wrangler d1 execute wordmatch --remote --file=db/migrations/001-lang-改成課程.sql
--
-- 這個 migration 是冪等的：WHERE 只挑舊格式的值，重複跑不會變成 zh-zh-en。

UPDATE lessons SET lang = 'zh-' || lang WHERE lang IN ('en', 'ja', 'th');
