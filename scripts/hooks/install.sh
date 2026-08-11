#!/usr/bin/env bash
# Cài hook của repo vào `.git/hooks`.
#
#   ./scripts/hooks/install.sh
#
# Dùng SYMLINK chứ không copy: sửa hook trong repo là có hiệu lực ngay, không
# ai phải nhớ cài lại. Trỏ vào `--git-common-dir` nên worktree dùng chung hook
# với clone chính (git vốn thiết kế như vậy).
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
HOOKS=$(cd "$(git -C "$REPO" rev-parse --git-common-dir)" && pwd)/hooks
mkdir -p "$HOOKS"

for h in pre-push; do
  src="$REPO/scripts/hooks/$h"
  dst="$HOOKS/$h"
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    cp "$dst" "$dst.backup-$(date +%s)"
    echo "  đã sao lưu hook cũ → $(basename "$dst").backup-…"
  fi
  ln -sf "$src" "$dst"
  chmod +x "$src"
  echo "  ✓ $h → $src"
done
chmod +x "$REPO/scripts/hooks/lib/resolve-python.sh"
echo "Xong. Kiểm: git push --dry-run"
