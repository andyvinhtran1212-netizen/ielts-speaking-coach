#!/usr/bin/env bash
# Cài hook của repo vào `.git/hooks`.
#
#   ./scripts/hooks/install.sh
#
# Cài wrapper vào `--git-common-dir` để mọi worktree dùng chung. Wrapper tìm
# script trong checkout ĐANG PUSH, không giữ đường dẫn của worktree tạm.
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
HOOKS=$(cd "$(git -C "$REPO" rev-parse --git-common-dir)" && pwd)/hooks
mkdir -p "$HOOKS"

for h in pre-push; do
  src="$REPO/scripts/hooks/$h"
  dst="$HOOKS/$h"
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    cp -P "$dst" "$dst.backup-$(date +%s)"
    echo "  đã sao lưu hook cũ → $(basename "$dst").backup-…"
  fi
  cat > "$dst.new" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
REPO=$(git rev-parse --show-toplevel)
# Git exports repository-local variables to hooks. Tests create foreign repos;
# inheriting GIT_DIR can write their config into the real repository.
# https://git-scm.com/docs/githooks#_description
while IFS= read -r git_var; do
  unset "$git_var"
done < <(git rev-parse --local-env-vars)
exec "$REPO/scripts/hooks/pre-push" "$@"
HOOK
  chmod +x "$dst.new" "$src"
  mv -f "$dst.new" "$dst"
  echo "  ✓ $h → script trong checkout đang push"
done
chmod +x "$REPO/scripts/hooks/lib/resolve-python.sh"
echo "Xong. Kiểm: git push --dry-run"
