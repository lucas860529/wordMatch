#!/bin/zsh
#
# 本機開發伺服器。
#
# 金鑰從 macOS Keychain 撈，不寫進任何檔案 —— 專案規範是
# 「API key 一律走環境變數或 Keychain，絕不寫進檔案」。
#
# 第一次使用先把金鑰存進去（-U 是覆蓋既有的，換金鑰時照跑）：
#
#   security add-generic-password -a "$USER" -s wordmatch-gemini -w '你的金鑰' -U
#   security add-generic-password -a "$USER" -s wordmatch-tts    -w '你的金鑰' -U
#   security add-generic-password -a "$USER" -s wordmatch-codes  -w 'lucas:本機密碼' -U
#
# 取捨說明：金鑰是用 --binding 傳給 wrangler 的，所以它會出現在
# 這台機器的行程參數裡（ps 看得到）。換來的是磁碟上完全沒有明文、
# shell history 也不會留。單人開發機上這個取捨划算。

set -e
cd "${0:A:h}/.."

keychain() {
  security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null || true
}

GEMINI=$(keychain wordmatch-gemini)
TTS=$(keychain wordmatch-tts)
CODES=$(keychain wordmatch-codes)

if [[ -z "$GEMINI" ]]; then
  echo "⚠️  Keychain 裡找不到 wordmatch-gemini —— 課程生成會回 500。"
  echo "   security add-generic-password -a \"\$USER\" -s wordmatch-gemini -w '金鑰' -U"
fi
if [[ -z "$TTS" ]]; then
  echo "⚠️  Keychain 裡找不到 wordmatch-tts —— 發音會靜默失敗（不會跳錯誤，就是沒聲音）。"
  echo "   security add-generic-password -a \"\$USER\" -s wordmatch-tts -w '金鑰' -U"
fi
if [[ -z "$CODES" ]]; then
  CODES="dev:dev"
  echo "ℹ️  Keychain 裡沒有 wordmatch-codes，本機先用 dev:dev（密碼就是 dev）。"
fi

MODEL="${MODEL_ID:-gemini-3.6-flash}"

# 區網位址 —— 手機連同一個 Wi-Fi 就能開，行動端的版面要用真的手機看才準
LAN=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)

echo "模型：$MODEL"
echo
echo "  本機      http://localhost:8788"
[[ -n "$LAN" ]] && echo "  手機      http://$LAN:8788   （同一個 Wi-Fi）"
echo
echo "  本機的登入密碼看 Keychain 的 wordmatch-codes；沒設的話就是 dev"
echo

# 金鑰用 --var 傳。wrangler dev 會自己讀 wrangler.jsonc 的 assets 與路由設定。
# KV 在本機是自動模擬的（wrangler.jsonc 裡有宣告才會有 RATE binding；
# 還沒宣告的話 guard.js 會放行，限流測不到 —— 這是預期行為）。
# --ip 0.0.0.0 才會聽區網介面，不然只有這台機器連得到
exec npx wrangler dev \
  --ip 0.0.0.0 \
  --port 8788 \
  --var GEMINI_API_KEY:"$GEMINI" \
  --var GOOGLE_TTS_API_KEY:"$TTS" \
  --var MODEL_ID:"$MODEL" \
  --var ACCESS_CODES:"$CODES" \
  "$@"
