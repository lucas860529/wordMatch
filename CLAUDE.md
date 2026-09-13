# wordMatch — 專案規範

## 這是什麼

繁體中文母語者的英／日／泰學習工具。輸入主題 → 生成六段課程 → 每個外語詞可點擊發音。
一個 PWA，部署在 Cloudflare Workers（static assets），`git push` 自動上線。

**開場先讀 `PROGRESS.md`。**

## 這條線跟泰文字卡專案的關係

`~/Developer/thai` 是**另一條線**，不是這個專案的前身。可以參考它的領域知識
（特別是泰文的聲調與轉寫），但**不要沿用它的程式碼**。

目前分工：`thai/` 管 SRS 間隔重複與字庫；wordMatch 管「問一個主題、生成一份講解」。

## 已定案（勿重新討論，見 docs/adr/）

- **三頁不是單一 SPA**（ADR 0001）—— `/en/` `/ja/` `/th/` 各自完整，只共用 `shared/ll.js`
- **泰文轉寫用 Paiboon**，不用 RTGS（ADR 0002）
- **TTS 護欄按字元算不按次數**（ADR 0003）
- **沒有打包工具** —— 原生 ES modules + 直接送目錄
- **用 Workers 不用 Pages**（ADR 0004）—— 路由手寫在 `src/index.js`，不用 Pages 的檔案路由

## 英文與日文的程式碼不是在這裡寫的

`public/en/index.html` 與 `public/ja/index.html` 是先前在 Claude artifact 環境做好的成品，
搬過來只做了「可部署化」的改造（改接 `/api/*`、拿掉 `window.claude` 與診斷面板）。

**它們是能動的東西，不要為了「統一風格」去重寫。** 要改視覺就三份一起改。

## 最重要的一條安全規則

**prompt 只能存在於 `src/api/_shared/prompts.js`（伺服器端）。**

前端只准送 `lang` 與 `topic`。如果前端可以送任意 prompt，任何人都能把這支
Gemini 金鑰當成免費的通用 LLM 代理來用。

同理：`/api/tts` 的語音只能從伺服器白名單挑，前端送的是代號不是語音名稱。

## 金鑰

- 本機：存 macOS Keychain（`wordmatch-gemini` / `wordmatch-tts`），`tools/dev.sh` 會自己撈
- 正式：Cloudflare 後台的 **Secret**（加密），Production 與 Preview 兩個環境都要設
- **絕不寫進任何檔案**，也不要貼進對話

## 成本

三個服務只有 Google Cloud TTS 會真的寄帳單。改動 `src/api/tts.js` 前，
先讀 ADR 0003 與 README 的「成本護欄」。護欄有五層，不要因為「這樣比較方便」拆掉任何一層。

**KV 寫爆之後限流會失效**（刻意失敗放行）。所以 Google Cloud 的 US$1 預算快訊是必要的第二道。

## 語言專屬的坑

**日文**：例句的 `tokens` 接起來必須完全等於 `jp`，對不上就整句不切詞 ——
錯的切詞比沒有切詞更誤導人。假名開關用 `visibility` 不用 `display`，切換時版面才不會跳。

**泰文**（已實作，`public/th/index.html`）：

- ⚠️ **發音一律送泰文字，絕不送 Paiboon 轉寫** —— Google TTS 讀不懂轉寫，
  會用英文去念，聲調全錯。日文版是 `onSpeak(reading || surface)`（念假名），
  照抄過來就會踩到
- 不用空格斷詞，切詞只能靠模型
- 母音與聲調符號疊在子音上下，**行高 ≥ 2.2**，容器不要 `overflow: hidden`
- 字型要有頭圈（Sarabun、Noto Sans Thai）
- **不要用 ruby** —— 上下都被符號佔滿，轉寫疊上去會糊掉，改成另起一行
- 標記用 `<thai>` 不是 `<th>`（`<th>` 是 HTML 表格標題標籤）

## 開發指令

```
tools/dev.sh              本機開發（http://localhost:8788）
tools/check.sh <檔案...>   語法檢查（沒有建置工具，靠 node --check）
npm run voices            查 Google TTS 實際可用的語音
npm run icons             重新產生 PWA 圖示
```

## 版本

**進版一律要經過使用者同意，不要自己 bump、自己打 tag、自己部署。**

規則見 `CHANGELOG.md` 開頭那張表：資料要遷移 → 主版本；加功能 → 次版本；
修 bug／改文案 → 修訂號。進版用 `./tools/release.sh <版號>`。

## 收尾

做完有意義的變更就更新 `PROGRESS.md` 並 commit。commit 訊息用中文，
格式 `<類型>: <一句話>`。
