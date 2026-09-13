#!/bin/zsh
# 沒有建置工具，所以語法檢查靠 node --check。
# .js 在沒有 package.json type:module 時會被當 CommonJS，所以複製成 .mjs 再檢查。
set -e
TMP=$(mktemp -d)
fail=0
for f in "$@"; do
  cp "$f" "$TMP/$(basename "$f" .js).mjs"
  if node --check "$TMP/$(basename "$f" .js).mjs" 2>/dev/null; then
    echo "  ok  $f"
  else
    echo "  ✕   $f"
    node --check "$TMP/$(basename "$f" .js).mjs" 2>&1 | head -6
    fail=1
  fi
done
rm -rf "$TMP"
exit $fail
