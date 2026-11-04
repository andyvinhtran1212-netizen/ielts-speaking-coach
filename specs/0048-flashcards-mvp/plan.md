# Implementation plan

## Architecture impact

- Dùng lại toàn bộ VOCABSETS-0020: bảng `vocabulary_sets*`,
  `fn_save_vocabulary_set`, `fn_vocabulary_set_visible`, router
  `backend/routers/vocabulary_sets.py` (`router` học viên, `admin_router`
  admin), service `backend/services/vocabulary_sets.py`, UI admin
  `frontend/app/(authed-admin-vocab)/admin/vocab/sets/sets-console.tsx`, trình
  học `frontend/app/(authed-vocabulary-hub)/vocabulary/study/[sessionId]/study.tsx`.
- Mới: `backend/services/vocabulary_set_import.py` (phân tích + kiểm tra,
  thuần, không I/O), route import trong `admin_router`, cờ
  `FLASHCARD_MVP_ENABLED` trong `backend/config.py`, tham số `card_ids` con
  khi tạo phiên, panel dán trong `sets-console.tsx`, 2 nút trong `study.tsx`,
  mục menu trong `frontend/public/js/components/aver-admin-chrome.js`.
- Không đụng: SRS (`services/srs.py`), flashcard cá nhân
  (`routers/flashcards.py`), quiz bank, hệ thống giao bài lớp.

## Data and contracts

### Migration 372 (Leader cấp 04/11 14:51)

Chỉ khi anh Vinh chọn Q-2 = làm migration.

```sql
-- 372_vocab_cards_public_wiki.sql (FLASHCARD-0048 FR-008), additive
BEGIN;
ALTER TABLE vocab_cards ADD COLUMN IF NOT EXISTS public_wiki boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN vocab_cards.public_wiki IS 'false = chỉ dùng trong bộ từ, không hiện trên wiki công khai (FLASHCARD-0048)';
COMMIT;
```

Không đổi GRANT/RLS (`vocab_cards` giữ chính sách SELECT của mig 110; xem
rủi ro dưới). Rollback: cột có default, code cũ bỏ qua cột; không cần drop.

Rủi ro RLS: mig 110 cho `SELECT` công khai trên `vocab_cards`, nên khách vẫn
đọc được dòng `public_wiki=false` qua Supabase REST trực tiếp. MVP chấp nhận
(nội dung từ vựng, không phải dữ liệu cá nhân) và ghi rõ; nếu anh muốn chặn
hẳn, T002 thêm điều kiện `public_wiki` vào policy SELECT cho `anon` (cần kiểm
mọi client đang đọc trực tiếp — để câu hỏi phụ trong rollout).

### `POST /admin/vocabulary-sets/{set_id}/import`

- Query `dry_run: bool = true`. Body `ImportBody {text: str (max 100_000
  bytes), expected_version: int, category: str (max 80) = "flashcard"}`,
  `extra='forbid'`.
- 200 `ImportResult {dry_run, rows: [ImportRow], summary: {new, existing,
  duplicate, error}, set?: SetOut}`. `ImportRow {line, status, headword,
  gloss_vi, example, level, card_id?, warning?, error?}`.
- Lỗi: 401/403 (không admin), 404 (`feature_disabled` hoặc bộ không tồn tại),
  409 (`set_conflict`, `set_archived`), 413 (quá 100 KB), 422 (`rows_invalid`
  kèm rows, `too_many_cards` kèm `remaining`).
- Commit: một hàm SQL `SECURITY DEFINER` mới hoặc mở rộng
  `fn_save_vocabulary_set` để chèn thẻ mới + cập nhật bản nháp trong một
  giao dịch (T003 chọn; nếu hàm mới thì nằm trong cùng migration `372` và
  `REVOKE EXECUTE ... FROM anon, authenticated` theo FNEXEC-0045).

### `POST /api/vocabulary-sets/{set_id}/sessions`

Thêm trường tuỳ chọn `card_ids: list[UUID] (max 200)` cho mode `flashcards`;
server giao với `cards` của revision đã xuất bản; id ngoài revision → 422
`invalid_cards`. Mode khác bỏ qua trường (hoặc 422 — T005 chọn, test cả hai
nhánh đã chọn).

### Cờ

`FLASHCARD_MVP_ENABLED: bool = False` (`backend/config.py`). Trả trong
`CatalogOut.features.flashcard_mvp` (admin và học viên). Frontend chỉ đọc cờ
từ API.

### Wiki filter (FR-008)

Index công khai đọc `vocab_cards` trong `vocab_service.reload()` (đường dẫn
chính xác T002 xác định bằng `rg "vocab_cards" backend/services`). Thêm
`.eq("public_wiki", True)` cho mọi đường đọc công khai (grid, category,
article, sitemap); admin search và bộ từ không lọc.

## UI and interaction

Xem `ui-states.md`. Panel dán: textarea (monospace, 12 dòng), ô Chủ đề, nút
"Xem trước"; bảng xem trước có cột Dòng / Từ / Nghĩa / Ví dụ / Trạng thái;
nút "Thêm N thẻ vào bộ" chỉ bật khi 0 lỗi. Trình học: 2 nút lớn ≥ 44 px.

## Work decomposition

Xem `tasks.md` (mỗi phiếu PC xếp độc lập được, có phụ thuộc, cỡ, Claude/Codex).

## Rollout and rollback

Xem `rollout.md`. Cờ tắt mặc định; migration cộng cột chạy trước code đọc
cột; tắt cờ là rollback chức năng; cột để nguyên.

## Verification strategy

- Pytest thuần cho parser (bảng dữ liệu Tab/CSV/lỗi/giới hạn).
- Pytest route với Supabase giả: quyền, dry-run không ghi, commit nguyên khối,
  409, 413, 422, cờ tắt.
- PG test migration (cột mặc định, không đổi quyền).
- Node/React test cho panel và 2 nút, phím tắt.
- Kiểm thủ công staging theo Scenario 1–8.
