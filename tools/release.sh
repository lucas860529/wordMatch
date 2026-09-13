#!/bin/zsh
#
# 進版。用法：
#
#   ./tools/release.sh 1.1.0
#
# 做四件事：更新 package.json、更新 public/shared/ll.js 的版本字串、
# 把 CHANGELOG 的「未發布」段落收成這個版號、打 git tag。
#
# ⚠️ **進版一律要經過使用者同意。** 這支腳本不會自己 push 也不會自己部署，
# 跑完之後還要手動 `git push --follow-tags` 與 `npx wrangler deploy`。
#
# 版號怎麼決定看 CHANGELOG.md 開頭那張表。

set -e
cd "${0:A:h}/.."

VERSION="$1"

if [[ -z "$VERSION" ]]; then
  echo "用法：./tools/release.sh <版號>"
  echo "目前版本：$(node -p "require('./package.json').version")"
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "✕ 版號格式不對，要像 1.2.3"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "✕ 工作目錄有未提交的變更，先 commit 再進版。"
  git status --short
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "✕ tag v$VERSION 已經存在。"
  exit 1
fi

TODAY=$(date +%Y-%m-%d)

# package.json
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.version = '$VERSION';
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"

# 前端的版本字串（顯示在頁尾，用來確認眼前這頁是哪一版）
node -e "
const fs = require('fs');
const f = 'public/shared/ll.js';
let s = fs.readFileSync(f, 'utf8');
const re = /LL\.VERSION = \"[^\"]*\";/;
if (!re.test(s)) { console.error('✕ ll.js 裡找不到 LL.VERSION'); process.exit(1); }
fs.writeFileSync(f, s.replace(re, 'LL.VERSION = \"$VERSION\";'));
"

# CHANGELOG：把「未發布」收成這一版
node -e "
const fs = require('fs');
const f = 'CHANGELOG.md';
let s = fs.readFileSync(f, 'utf8');
if (!s.includes('## 未發布')) { console.error('✕ CHANGELOG 裡找不到「未發布」段落'); process.exit(1); }
s = s.replace('## 未發布', '## $VERSION — $TODAY');
// 補一個新的空白「未發布」段落在最前面
s = s.replace('---\n\n## $VERSION', '---\n\n## 未發布\n\n---\n\n## $VERSION');
fs.writeFileSync(f, s);
"

git add package.json public/shared/ll.js CHANGELOG.md
git commit -q -m "chore: 進版 v$VERSION"
git tag -a "v$VERSION" -m "v$VERSION"

echo "✓ 已進版到 v$VERSION（commit 與 tag 都建好了）"
echo
echo "還沒 push、也還沒部署。要上線的話："
echo "  git push --follow-tags"
echo "  npx wrangler deploy"
