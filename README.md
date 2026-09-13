# wordMatch — 三語研究室

繁體中文母語者的英／日／泰學習工具。輸入一個主題，生成一份六段課程：
核心解釋、對照表、例句、常見錯誤、常用搭配、延伸筆記。每個外語詞都可以點擊發音。

一個 PWA，三個語言各一頁，主畫面一個圖示。

## 架構

```
iPhone / Mac 上的 PWA
   │
   ├─ 靜態檔案 ────────► Cloudflare Pages（免費）
   │
   └─ 同源 fetch
        ├─ POST /api/lesson ─► Pages Function ─► Gemini API
        └─ POST /api/tts    ─► Pages Function ─► Google Cloud TTS
```

金鑰只存在 Cloudflare 的環境變數裡，前端永遠拿不到。瀏覽器只會看到 `/api/*` 兩個同源路徑。

**沒有打包工具。** 原生 ES modules + 直接送目錄，所以沒有 `node_modules` 進建置、
沒有建置失敗、改完 push 就上線。

## 目錄

```
public/
  index.html              語言選單（記得上次看的就直接跳過去）
  en/ ja/ th/index.html   三個語言各一頁，各自完整
  shared/ll.js            共用底層：/api/lesson 與 /api/tts 的封裝、發音、語言列
  sw.js                   service worker（只快取外殼，/api/* 一律走網路）
  manifest.webmanifest
  icons/
functions/api/
  lesson.js               Gemini 代理
  tts.js                  Google TTS 代理 + 快取 + 成本護欄
  _shared/prompts.js      三語的 prompt 與 responseSchema（伺服器端）
  _shared/guard.js        輸入驗證與速率限制
tools/
  dev.sh                  本機開發（金鑰從 Keychain 撈）
  make-icons.mjs          產生 PWA 圖示（無相依，手寫 PNG）
  list-voices.mjs         查 Google TTS 實際可用的語音
  check.sh                語法檢查
```

## 本機開發

金鑰存 Keychain，不寫進任何檔案：

```bash
security add-generic-password -a "$USER" -s wordmatch-gemini -w '你的金鑰' -U
```

```bash
security add-generic-password -a "$USER" -s wordmatch-tts -w '你的金鑰' -U
```

```bash
./tools/dev.sh
```

開 http://localhost:8788。

## 部署

接上 GitHub 之後，push 到 `main` 就會自動建置上線，其他分支會拿到獨立的預覽網址。

Cloudflare Pages 的設定：

| 欄位 | 值 |
|---|---|
| Framework preset | None |
| Build command | 留空 |
| Build output directory | `public` |

環境變數（Production 與 Preview **兩個都要設**）：

| 變數名 | 型別 | 說明 |
|---|---|---|
| `GEMINI_API_KEY` | Secret | AI Studio 的金鑰 |
| `GOOGLE_TTS_API_KEY` | Secret | Google Cloud 的 TTS 金鑰 |
| `MODEL_ID` | Plain text | 例如 `gemini-3.6-flash` |

KV：建一個 namespace（例如 `wordmatch_rate`），在 Settings → Functions → KV namespace
bindings 用變數名 `RATE` 綁上去。**沒綁的話速率限制會整個失效**（見下）。

> 這個專案刻意**不放 `wrangler.toml`**。Pages 一旦看到 `wrangler.toml`，
> 就會用它當 bindings 的唯一事實來源，後台設定的綁定會被忽略 ——
> 對「在後台點一點就好」的流程反而是個陷阱。

## 成本護欄

三個服務裡只有一個會真的寄帳單：

| 服務 | 超額行為 |
|---|---|
| Cloudflare Pages / Functions | 拒絕服務，不收費 |
| Gemini 免費層 | 回 429，不收費 |
| **Google Cloud TTS** | **自動扣款** |

所以 TTS 那支 Function 的護欄比別處厚：

1. `text` 上限 200 字元 —— 單次請求的成本硬上限
2. 語音只能從伺服器白名單挑 —— 擋掉單價 4～16 倍的 Neural2／Studio
3. **先查快取再算帳** —— 重複點同一個詞完全不花錢（這招最有效）
4. 每 IP 每日 500 次
5. **全域每日 10 萬字元** —— 跟 IP 無關，所以換 IP 灌也沒用。
   10 萬／日 ≈ 300 萬／月，安全落在 Standard 的 400 萬免費額度內

**一個誠實的限制**：KV 免費額度是每天 1000 次寫入。寫爆之後計數器會停在原地、
限流等於失效（程式是刻意「失敗放行」的 —— 限流壞掉不該讓功能整個死掉）。
所以 **Google Cloud 的 US$1 預算快訊不是備援，是必要的第二道**。

## 已知的取捨

- **沒有串流**。artifact 版會即時顯示「現在寫到：例句」，現在改成顯示經過秒數。
  要恢復的話 `/api/lesson` 得改成 SSE 轉送。
- **課程只存在這台裝置**的 localStorage，不同步。
- **泰文轉寫用 Paiboon**（有標聲調），不是 RTGS。見 `docs/adr/0002`。
