# Tasks

Build **HOLD** tới khi anh Vinh trả lời Q-1..Q-7 và duyệt spec trên `staging`.
Mỗi task = một phiếu PC độc lập; cỡ S ≈ ≤ 1 giờ job, M ≈ 1–3 giờ. Quota
tuần đang chặt (reset 08/11): ưu tiên F1, F2, F3, F4, F5a; F5b/F6 sau.

- [ ] T001 (F1, S, Codex) Menu: thêm "Bộ từ theo lớp" vào đầu mục Vocab
  trong `aver-admin-chrome.js`, test `tests/aver-admin-chrome.test.mjs`
  (FR-013). Không cờ, không phụ thuộc. Có thể gộp với 0049 T001 nếu PC muốn.
  `owns: frontend/public/js/components/aver-admin-chrome.js,
  frontend/tests/aver-admin-chrome.test.mjs`
- [ ] T002 (F2, M, Claude, high-risk) Migration `372` cột
  `vocab_cards.public_wiki` + lọc mọi đường đọc wiki công khai + PG test
  quyền không đổi (FR-008, FR-010). `depends: số migration do Leader cấp; Q-2,
  Q-7`. `owns: backend/migrations/372_vocab_cards_public_wiki.sql,
  backend/services/vocab_* (đường đọc công khai), backend/tests/test_migration_372_*.py`
- [ ] T003 (F3, M, Claude) Cờ `FLASHCARD_MVP_ENABLED`, parser
  `vocabulary_set_import.py` + route import dry-run/commit nguyên khối,
  `features.flashcard_mvp`, regenerate `frontend/types/api.d.ts` (FR-001..FR-007,
  FR-009, FR-010). `depends: T002`. `owns: backend/config.py,
  backend/services/vocabulary_set_import.py, backend/routers/vocabulary_sets.py,
  backend/services/vocabulary_sets.py, backend/tests/test_vocabulary_set_import*.py,
  frontend/types/api.d.ts`
- [ ] T004 (F4, M, Codex) Panel "Dán danh sách từ" + bảng xem trước + commit
  trong `sets-console.tsx` (FR-001, FR-005, FR-006, FR-009, FR-014).
  `depends: T003`. `owns: frontend/app/(authed-admin-vocab)/admin/vocab/sets/*,
  frontend/tests/admin-vocab-set-import*.test.mjs`
- [ ] T005 (F5a, S, Codex) Trình học Thẻ ghi nhớ: 2 nút + phím tắt + tổng
  cuối phiên khi cờ bật (FR-011, FR-014). `depends: T003 (chỉ cần trường
  features)`. `owns: frontend/app/(authed-vocabulary-hub)/vocabulary/study/*,
  frontend/tests/vocabulary-study-simple*.test.mjs`
- [ ] T006 (F5b, S, Claude) `card_ids` con khi tạo phiên + nút "Học lại thẻ
  chưa nhớ" (FR-012). `depends: T005`. `owns: backend/routers/vocabulary_sets.py,
  backend/services/vocabulary_sets.py, backend/tests/test_vocabulary_set_subset_session.py,
  frontend/app/(authed-vocabulary-hub)/vocabulary/study/*`
- [ ] T007 (F6, S, Codex hoặc QA) Kiểm staging Scenario 1–8, ghi
  `verification.md`, bật cờ staging theo `rollout.md`. `depends: T001..T006`.
- [ ] T008 (F8, S, Codex, tuỳ Q-3) Ẩn Luyện nhớ/Điền từ/Kiểm tra khi cờ bật.
  `depends: T005`. Chỉ làm nếu anh chọn ẩn.
