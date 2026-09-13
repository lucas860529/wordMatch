# wordMatch — 進度總表

> 這是這條線的**單一事實來源**。每次工作結束都要更新這份。
> 最後更新：2026-09-13

## 一句話目標

把在 Claude artifact 裡做好的英文／日文學習工具搬到自己的網址上，
再補上泰文，變成一個隨時能用的 PWA。

## 目前進度

🟡 **部署中** —— 程式打通、已推上 GitHub，等 Cloudflare 接上。

英文與日文的 app **不是這個 session 寫的**，是先前在 artifact 環境做好的成品
（`字詞研究室.html` / `言葉研究室.html`）。這個 session 做的是**把它們變成可部署的東西**，
UI、六段渲染、ruby、localStorage、單字總表一律原樣保留。

### 已完成

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

### 這個 session 修掉的兩個真 bug

1. **`gemini-2.5-flash` 對新帳號已停止供應** —— 原始文件建議的模型直接回 404。
   改用 `gemini-3.6-flash`。
2. **模型把 `<en>` 標記塞進 title 和 summary**，而那兩處是當純文字排版的，
   會看到字面的 `<en>Make</en>`。prompt 加了禁止條款，渲染端也加了剝除保險。

## 下一步

| # | 事情 | 誰做 | 狀態 |
|---|---|---|---|
| 1 | `gh auth login` 授權 GitHub | 使用者 | 🟢 完成 |
| 2 | push 到 `lucas860529/wordMatch` | Claude | 🟢 完成 |
| 3 | Cloudflare 接 Git（Workers）、設 Secret | **使用者** | 🟡 進行中 |
| 3b | 建 KV namespace 並填進 `wrangler.jsonc` | 兩人 | 🔴 **設 TTS 金鑰前必做** |
| 4 | Google Cloud TTS 金鑰 + US$1 預算快訊 | **使用者** | 🔴 未開始 |
| 5 | 實測發音（三語都要出聲） | Claude | ⏸ 等 4 |
| 6 | 泰文版 `/th/` | Claude | 🔴 **step 2，還沒開始** |

## 泰文版（step 2）

使用者決定先把部署與 Gemini 打通，泰文之後再做。已經先決定好的：

- **轉寫用 Paiboon**，不用 RTGS（ADR 0002）
- **聲調術語**沿用泰文字卡專案 `tone.ts` 的中文名：中平／低／降／高／上升
- **標記用 `<thai>` 不是 `<th>`** —— `<th>` 是 HTML 表格標題標籤，撞名
- **不用 ruby** —— 泰文上下都被母音與聲調符號佔滿，轉寫再疊上去會糊成一團，
  改成另起一行
- 行高 ≥ 2.2、字型要有頭圈（Sarabun、Noto Sans Thai）
- 骨架從日文版複製 —— 兩者同樣不用空白斷詞、同樣走 token 陣列

`src/api/_shared/prompts.js` 裡的泰文 prompt 與 schema **已經寫好了**，
缺的只是前端那一頁。

## 跟泰文字卡專案（`~/Developer/thai`）的關係

**是新戰場，不是延伸。** 可以參考，但不沿用程式碼。

兩者的分工目前是：`thai/` 管 SRS 間隔重複與 3,132 張卡的字庫；
wordMatch 管「問一個主題、生成一份講解」。要不要接起來（例如單字總表流進字卡庫）
還沒決定。

## 怎麼跑起來

```bash
~/Developer/wordMatch/tools/dev.sh
```

## 決策紀錄

- [ADR 0001](docs/adr/0001-三頁而不是單一-spa.md) — 為什麼是三頁不是一個合併的 SPA
- [ADR 0002](docs/adr/0002-泰文轉寫用-paiboon.md) — 泰文轉寫選 Paiboon 不選 RTGS
- [ADR 0003](docs/adr/0003-tts-成本護欄按字元計算.md) — TTS 護欄為什麼算字元不算次數
- [ADR 0004](docs/adr/0004-用-workers-而不是-pages.md) — 部署改用 Workers，不用 Pages

---

### 狀態圖例

🔴 未開始 ｜ 🟡 進行中 ｜ 🟢 可用 ｜ ⏸ 被擋住
