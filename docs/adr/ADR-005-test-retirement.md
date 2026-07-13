# ADR-005 — Test retirement theo invariant

**Status:** ACCEPTED 2026-07-13 · Plan v3 §7.4, §11.4, B7 · Ledger: docs/TEST_INVARIANT_LEDGER.md (DRAFT — 34 mục UNCLEAR chờ duyệt)

## Quyết định
1. Không test nào bị xóa theo filename. Mỗi legacy test phải có một kết luận trong ledger: port thành behavior/component test · thay bằng type/schema/runtime enforcement · retire vì invariant không còn, có lý do + reviewer duyệt.
2. Migration PR xóa test PHẢI link mục ledger + replacement test trong cùng PR.
3. Legacy tests tiếp tục chạy trên legacy source cho tới khi route hết soak window (B7 fallback).
4. CI manifest: toàn bộ 214 contract files đã gated bằng glob (PR #729) — exclusion tương lai phải là `--test-skip-pattern` tường minh kèm owner + expiry, không quay lại danh sách tay (B35).

## Số liệu nền
214 contract files / ~168 source-string-pin / disposition draft: 128 port, 43 types, 21 e2e, 24 keep-until-retired, 9 retire-now (cần duyệt).
