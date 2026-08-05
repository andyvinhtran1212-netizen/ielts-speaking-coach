#!/usr/bin/env bash
# In ra đường dẫn TUYỆT ĐỐI của interpreter Python có pytest, hoặc thoát 1.
#
# TÁCH RIÊNG ĐỂ TEST CHẠY ĐƯỢC NÓ. Cùng lý do `lib/when-global-ready.mjs` tồn
# tại: logic nằm trong hook thì chỉ chặn được bằng regex trên mã nguồn — cách
# chốt yếu. Ở đây test THỰC THI tệp này từ nhiều thư mục khác nhau.
#
# HAI CÁI BẪY ĐÃ DÍNH LẦN LƯỢT, đừng "đơn giản hoá" lại:
#   1. `--git-common-dir` trả ".git" (TƯƠNG ĐỐI) khi chạy từ clone chính. Hook
#      có `cd` nên đường dẫn tương đối hết phân giải sau đó. Triệu chứng:
#      "backend tests red" trong khi pytest CHƯA HỀ CHẠY.
#   2. `--show-toplevel` trả gốc WORKTREE, nơi KHÔNG có `backend/venv`.
# Cách đúng: `--git-common-dir` (luôn trỏ clone chính) rồi tuyệt-đối-hoá bằng
# `cd … && pwd`.
set -uo pipefail

COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd) || {
  echo "resolve-python: không xác định được thư mục .git" >&2; exit 1; }
VENV="$COMMON/../backend/venv/bin/python"

if [ -x "$VENV" ]; then
  # `cd … && pwd -P` để bỏ phần `/../` cho dễ đọc trong log.
  ( cd "$(dirname "$VENV")" && printf '%s/%s\n' "$(pwd -P)" "$(basename "$VENV")" )
  exit 0
fi
if python3 -c 'import pytest' 2>/dev/null; then
  command -v python3
  exit 0
fi

echo "resolve-python: không tìm thấy pytest (đã thử: $VENV, python3)" >&2
exit 1
