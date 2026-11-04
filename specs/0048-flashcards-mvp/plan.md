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

Chỉ khi anh Vinh chọn Q-2 = làm migration. Số `372` đã được Leader giữ cho
FLASHCARD-0048 T002 tại `/workspace/cc-jobs/migrations-register.md`, mục
2026-11-04T14:51:45+07:00; việc giữ số chưa cho phép áp migration.

```sql
-- 372_vocab_cards_public_wiki.sql (FLASHCARD-0048 FR-008), additive
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.vocab_cards ADD COLUMN IF NOT EXISTS public_wiki boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.vocab_cards.public_wiki IS 'false = ẩn khỏi wiki; SELECT qua REST vẫn theo policy hiện có (FLASHCARD-0048)';
COMMIT;
```

T002 thêm hàng `pending_feature`, nhóm `flashcard_mvp`, cho file `372` trong
`backend/migrations/forward-policy.tsv`: merge không áp migration; Leader áp
staging trước bằng runner có advisory lock với opt-in nhóm này. Production
chỉ ở lần promotion được cho phép riêng. Kiểm sau áp: cột NOT NULL/default
true, thẻ cũ true, quyền/RLS không đổi; timeout hoặc kiểm tra sai thì dừng.

Không đổi GRANT/RLS (`vocab_cards` giữ chính sách SELECT của mig 110; xem
rủi ro dưới). Rollback: tắt cờ và quay về code cũ; giữ cột và dữ liệu import,
không cần drop. Nếu T003 sửa RPC cũ, ghi kèm cách khôi phục đúng định nghĩa,
ACL và `search_path` trước đó; sửa schema đã áp bằng migration tiến mới.

Rủi ro RLS: mig 110 cho `SELECT` công khai trên `vocab_cards`, nên khách vẫn
đọc được dòng `public_wiki=false` qua Supabase REST trực tiếp. FR-008 chỉ
ẩn khỏi wiki; dữ liệu nhập không có bảo đảm riêng tư ở tầng REST. Nếu cần
chặn REST, FD phải trình duyệt thay đổi FR và kiểm mọi client đọc trực tiếp
trong PR spec-only riêng trước khi T002 đổi policy.

### `POST /admin/vocabulary-sets/{set_id}/import`

- Query `dry_run: bool = true`. Body `ImportBody {text: str,
  expected_version: int}`, `extra='forbid'`, khớp FR-002. Route xác thực
  `require_admin` trước khi đọc/parse body; không để FastAPI tự parse body
  bằng tham số model trước bước xác thực.
- Sau xác thực, kiểm `len(text.encode("utf-8")) > 100_000` và trả 413 theo
  FR-004; ràng buộc độ dài chuỗi của Pydantic không thay thế kiểm byte này
  vì có thể trả 422 hoặc đếm ký tự. Cả dry-run và commit kiểm tổng membership
  sau khử trùng như FR-004, kể cả id thẻ dùng lại chưa có trong bộ.
- 200 `ImportResult {dry_run, rows: [ImportRow], summary: {new, existing,
  duplicate, error}, set?: SetOut}`. `ImportRow {line, status, headword,
  gloss_vi, example, level, card_id?, warning?, error?}`.
- Lỗi: 401/403 (không admin), 404 (`feature_disabled` hoặc bộ không tồn tại),
  409 (`set_conflict`, `set_archived`), 413 (quá 100 KB), 422 (`rows_invalid`
  kèm rows, `too_many_cards` kèm `remaining`).
- Commit: một hàm SQL `SECURITY DEFINER` mới hoặc mở rộng
  `fn_save_vocabulary_set` để chèn thẻ mới + cập nhật bản nháp trong một
  giao dịch (T003 chọn; nếu hàm mới thì nằm trong cùng migration `372` và
  `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`, chỉ backend
  `service_role` được gọi theo FNEXEC-0045). Hàm mới hoặc sửa lại đều pin
  `SET search_path = pg_catalog, pg_temp`, tham chiếu bảng/hàm ứng dụng bằng
  schema `public` tường minh; PG test kiểm `proconfig` và ACL. T003 chốt SQL
  với T002 trước khi T002 merge/áp `372`; T002 sở hữu file migration.

Điểm cần FD quyết trước build (PR spec-only riêng nếu đổi FR): P3-4 chưa
định nghĩa kết quả khi hai import đồng thời tạo cùng slug (FR-006/FR-007);
P3-5 ô Chủ đề ở Q-4 chưa có trường truyền tương ứng trong FR-002. Plan bám
body hai trường hiện có; đề xuất `category` chưa là hợp đồng được duyệt.

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

`backend/services/vocab_content.py` (`VocabContentService._load_from_db`,
`_build_indexes`, `reload`) cấp dữ liệu cho wiki và cả
`backend/services/kp_registry.py`/`backend/scripts/seed_knowledge_points.py`.
T002 lọc `public_wiki=false` ở các đường đọc wiki công khai (grid, category,
article, search, sitemap), giữ nguồn đầy đủ cho KP. T002 kiểm các consumer
trước khi đặt bộ lọc; lọc ngay truy vấn dùng chung sẽ làm KP mất thẻ.
Admin search trong `backend/routers/vocabulary_sets.py::search_cards` và
bộ từ trong `backend/services/vocabulary_sets.py::cards_by_ids` tiếp tục đọc DB
không lọc wiki.

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
- PG test migration (cột mặc định, không đổi quyền, search_path/ACL của RPC).
- Node/React test cho panel và 2 nút, phím tắt.
- Kiểm thủ công staging theo Scenario 1–8.
