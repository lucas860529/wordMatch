# wordMatch — 進度總表

> 這是這條線的**單一事實來源**。每次工作結束都要更新這份。
> 最後更新：2026-09-13

## 一句話目標

把在 Claude artifact 裡做好的英文／日文學習工具搬到自己的網址上，
再補上泰文，變成一個隨時能用的 PWA。

## 目前進度

🟢 **已上線** —— https://wordmatch.lucas860529.workers.dev

等 Secret 設好就能用。線上已驗證：未登入抓任何頁面都會被轉到登入頁，
`/api/lesson` 與 `/api/tts` 回 401 —— **會花錢的端點在沒登入時打不動**。

英文與日文的 app **不是這個 session 寫的**，是先前在 artifact 環境做好的成品
（`字詞研究室.html` / `言葉研究室.html`）。這個 session 做的是**把它們變成可部署的東西**，
UI、六段渲染、ruby、localStorage、單字總表一律原樣保留。

### 已完成

- **登入系統** —— 靜態密碼（Cloudflare Secret `ACCESS_CODES`，一行一組「名字:密碼」），
  整站要登入才進得去。Session 存 D1、cookie 存的是 token 的 SHA-256。
  密碼從 Secret 刪掉，那個人的 session 立刻失效
- **D1 持久化歷史** —— 課程改存伺服器，localStorage 降為本機快取。
  換裝置、清快取，紀錄都還在

- **`/api/lesson`（Gemini 代理）** —— 實測可用，英文 16 秒、日文 25 秒
  - 開了 `responseMimeType: application/json` + `responseSchema`，模型吐不出 markdown 圍籬
  - 日文例句的 tokens 接回原句，五句全對
- **`/api/tts`（Google TTS 代理）** —— 程式完成，**還沒實測**（缺 TTS 金鑰）
- **成本護欄** —— 輸入長度、語音白名單、快取優先、每 IP 上限、全域每日字元上限
- **兩份 HTML 改造完成**，共 20 處替換，artifact 專屬的東西清乾淨
  （`window.claude`、診斷面板、版號徽章、`speechSynthesis`）
- **PWA** —— manifest、service worker、圖示（手寫 PNG 產生器，無相依）
- **從 Pages 遷移到 Workers**（ADR 0004）—— 官方已明講新專案要用 Workers
- **語言切換列**、根目錄語言選單（記得上次看的）
- 本機開發腳本 `tools/dev.sh`，金鑰從 Keychain 撈

### 這個 session 修掉的真 bug

1. **`gemini-2.5-flash` 對新帳號已停止供應** —— 原始文件建議的模型直接回 404。
   改用 `gemini-3.6-flash`。
2. **模型把 `<en>` 標記塞進 title 和 summary**，而那兩處是當純文字排版的，
   會看到字面的 `<en>Make</en>`。prompt 加了禁止條款，渲染端也加了剝除保險。
3. 改造 HTML 時的兩個自傷：`plain()` 的正規式跳脫寫壞（`Invalid regular expression
   flags`，整頁白畫面）、刪語音引擎時漏了 `voiceListeners` 的訂閱。
   **兩個都是用瀏覽器實際打開才發現的** —— curl 測 API 全綠不代表畫面活著。

## 下一步

| # | 事情 | 誰做 | 狀態 |
|---|---|---|---|
| 1 | `gh auth login` 授權 GitHub | 使用者 | 🟢 完成 |
| 2 | push 到 `lucas860529/wordMatch` | Claude | 🟢 完成 |
| 3 | 部署到 Cloudflare Workers | Claude | 🟢 完成 |
| 3b | KV namespace | 使用者 | 🟢 完成（已填入） |
| 3c | D1 database | 使用者 | 🟢 完成（已填入） |
| 3d | 套用正式 D1 schema | Claude | 🟢 完成（三張表都在） |
| 3e | 設 `ACCESS_CODES` 與 `GEMINI_API_KEY` | **使用者** | 🔴 **設完才能用** |
| 4 | Google Cloud TTS 金鑰 + US$1 預算快訊 | **使用者** | 🔴 未開始 |
| 5 | 實測發音（三語都要出聲） | Claude | ⏸ 等 4 |
| 6 | 泰文版 `/th/` | Claude | 🟢 **完成**，待你同意才進版 |
| 7 | 進版到 1.1.0 並部署 | **使用者決定** | ⏸ 等同意 |
| 8 | 課程制（母語 × 學習語言） | Claude | 🟢 完成 |
| 9 | 泰語學中文 `/th-zh/`、泰語學英文 `/th-en/` | Claude | 🟢 完成，**prompt 品質未實測** |
| 10 | 入口選擇頁 | Claude | 🟢 完成 |

## 兩個泰語課程的未驗證項目

介面、路由、排版都在本機驗過了，但**兩個新 prompt 的實際產出還沒看過** ——
本機的 Gemini 金鑰在使用者輪替之後失效了。

泰文版當初實測發現模型的 Paiboon 拼法跟字卡庫逐字一致，這種驗證對新課程同樣重要：

- **th-zh**：拼音的聲調符號對不對、tone 欄位的音節數對不對、
  切詞接不接得回原句、簡體字有沒有混到繁體
- **th-en**：traps 有沒有真的講泰語母語者的錯（尾音、子音串、冠詞），
  還是退回成通用的英文教學

要測的話先放金鑰：`security add-generic-password -a "$USER" -s wordmatch-gemini -w '金鑰' -U`

## 版本

**進版一律要經過使用者同意。** 規則與歷史見 [CHANGELOG.md](CHANGELOG.md)，
進版指令 `./tools/release.sh <版號>`（它不會自己 push 也不會自己部署）。

- **1.0.0**（2026-09-13，已上線）：英文 + 日文 + 登入 + D1 歷史
- **未發布**：泰文版、`hydrate` 覆寫本機示範課程的修正 → 建議 **1.1.0**（新功能）

版號顯示在每頁頁尾，打開就知道眼前是哪一版。

## 泰文版（已完成，2026-09-13）

骨架從日文版長出來 —— 兩者都不用空白斷詞、都靠模型給的 token 陣列切詞。
已經先決定好、也都落實了的：

- **轉寫用 Paiboon**，不用 RTGS（ADR 0002）
- **聲調術語**沿用泰文字卡專案 `tone.ts` 的中文名：中平／低／降／高／上升
- **標記用 `<thai>` 不是 `<th>`** —— `<th>` 是 HTML 表格標題標籤，撞名
- **不用 ruby** —— 泰文上下都被母音與聲調符號佔滿，轉寫再疊上去會糊成一團，
  改成另起一行
- 行高 ≥ 2.2、字型要有頭圈（Sarabun、Noto Sans Thai）
**實際做出來之後的兩個發現：**

1. **Paiboon 的品質比預期好**。模型產出的 `pǒm`／`bpen`／`kon`／`kráp`／`kâ`／`ká`
   跟泰文字卡庫 3,132 張卡的拼法**逐字一致** —— 不送氣塞音（ก=g、ต=dt、ป=bp）、
   聲調附加符號、音節連字號，全部守住。四個例句的切詞也都接得回原句。
2. **上下堆疊比 ruby 好很多**。例句做成「泰文在上、轉寫在下」的一欄一欄，
   讀起來對得上音，而且完全不跟聲調符號打架。轉寫開關用 `visibility` 切換，
   實測**零版面跳動**。

**一個差點釀成大錯的地方**：日文版的 `onSpeak(reading || surface)` 是念假名，
照抄到泰文會把 **Paiboon 轉寫**餵給 Google TTS —— 它會用英文去念 `sà-wàt-dii`。
泰文一律要送泰文字。這個在單字總表的連續播放也有兩處，都修掉了。

## 跟泰文字卡專案（`~/Developer/thai`）的關係

**是新戰場，不是延伸。** 可以參考，但不沿用程式碼。

兩者的分工目前是：`thai/` 管 SRS 間隔重複與 3,132 張卡的字庫；
wordMatch 管「問一個主題、生成一份講解」。要不要接起來（例如單字總表流進字卡庫）
還沒決定。

## 線上網址

https://wordmatch.lucas860529.workers.dev

部署指令（wrangler 已授權）：`npx wrangler deploy`。
後台也可以接 Git 讓 push 自動部署，接不接都行 —— Worker 已經存在了。

## 怎麼跑起來（本機預覽）

```bash
~/Developer/wordMatch/tools/dev.sh
```

會印出兩個位址：本機的 `localhost:8788`，以及**區網位址**讓同一個 Wi-Fi 的
手機也能開 —— 行動端的版面要用真的手機看才準。

本機的登入密碼存在 Keychain 的 `wordmatch-codes`，沒設的話就是 `dev`。

## 決策紀錄

- [ADR 0001](docs/adr/0001-三頁而不是單一-spa.md) — 為什麼是三頁不是一個合併的 SPA
- [ADR 0002](docs/adr/0002-泰文轉寫用-paiboon.md) — 泰文轉寫選 Paiboon 不選 RTGS
- [ADR 0003](docs/adr/0003-tts-成本護欄按字元計算.md) — TTS 護欄為什麼算字元不算次數
- [ADR 0004](docs/adr/0004-用-workers-而不是-pages.md) — 部署改用 Workers，不用 Pages

---

### 狀態圖例

🔴 未開始 ｜ 🟡 進行中 ｜ 🟢 可用 ｜ ⏸ 被擋住
