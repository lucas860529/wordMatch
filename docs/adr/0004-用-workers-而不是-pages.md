# ADR 0004 — 部署用 Workers static assets，不用 Pages

日期：2026-09-13
狀態：已採納（取代了原架構文件的 Pages 方案）

## 背景

原始架構文件指定「Cloudflare Pages + Pages Functions」，理由是同源、免 CORS、
一份 repo 一次部署。程式最初也照 Pages 的檔案路由寫好了（`functions/api/lesson.js`
自動掛到 `/api/lesson`），本機實測可用。

接著發現後台的 Create 流程已經以 Workers 為預設，`Deploy command` 預填
`npx wrangler deploy`，而且**沒有 Build output directory 欄位** —— 那是 Pages 才有的。

查證 Cloudflare 官方文件，Pages 首頁掛著：

> Workers supports most Pages use cases and offers a broader feature set.
> It is Cloudflare's primary platform for building applications.
> Start new projects with Workers.

## 決定

改用 **Workers + static assets**。

- `wrangler.jsonc` 的 `assets.directory` 指向 `public/`
- `functions/api/` 搬成 `src/api/`
- 新增 `src/index.js` 手寫路由（30 行）取代 Pages 的檔案路由

## 理由

1. **Pages 沒有廢止，但官方明講新專案要用 Workers。** 現在選 Pages 等於一開始
   就站在會被慢慢收掉的那條路上。
2. **後台已經以 Workers 為預設入口。** 硬要走 Pages 得繞路，而且未來只會更繞。
3. **遷移成本很小。** 兩支 Function 一行沒改 —— 它們的
   `onRequestPost({ request, env, waitUntil })` 形狀被路由器原樣沿用。
   真正新增的只有 `src/index.js`。

## 為什麼不用 `wrangler pages functions build`

官方提供這個指令把 Pages Functions 編譯成 Worker。沒有採用：那是相容層，
多一層轉換也多一個會壞的地方。手寫的 30 行路由看得懂、改得動、出錯時知道錯在哪。

## 跟著改變的事

| | Pages | Workers |
|---|---|---|
| 本機開發 | `wrangler pages dev public` | `wrangler dev` |
| 設定檔 | 刻意不放（會蓋掉後台 bindings） | **必須有** `wrangler.jsonc` |
| KV 綁定 | 後台點選 | 寫在 `wrangler.jsonc`，要填 namespace ID |
| 靜態檔案路由 | Pages 內建 | `assets.directory`，比對不到才進 Worker |

Secret（金鑰）兩邊一樣，都在後台設，不進設定檔。

## 代價

`wrangler.jsonc` 裡要填 KV 的 namespace ID，不像 Pages 可以在後台點一點。
所以 **KV 沒綁好之前，速率限制是失效的**（`guard.js` 刻意失敗放行）——
設 `GOOGLE_TTS_API_KEY` 之前務必先補上。
