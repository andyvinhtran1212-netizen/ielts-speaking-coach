# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_vocabulary_set_import.py (cờ tắt → 404 feature_disabled, features.flashcard_mvp false) plus frontend/tests/admin-vocab-set-import.test.mjs (không có nút khi cờ tắt) | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_vocabulary_set_import.py (học viên/giảng viên/khách 401/403, không gọi DB; extra field 422) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_vocabulary_set_import_parser.py (Tab, CSV ngoặc kép, BOM, NFC, tiêu đề, dòng trống, thừa cột) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_vocabulary_set_import_parser.py (100 KB → 413, 201 dòng, tổng > 200 → too_many_cards, độ dài trường, CEFR, ký tự điều khiển) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_vocabulary_set_import.py (dry-run không insert/update, đúng status từng dòng và summary) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_vocabulary_set_import.py (còn lỗi → 422 không ghi; version sai → 409 không thẻ mồ côi; thứ tự giữ; id trùng bỏ; bộ archived 409) | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_vocabulary_set_import.py (thẻ có sẵn không đổi cột nào; cảnh báo nghĩa khác) | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_migration_372_vocab_cards_public_wiki.py (cột default true, dòng cũ true) plus backend/tests/test_vocab_public_wiki_filter.py (grid/category/article/sitemap bỏ public_wiki=false; admin search vẫn thấy) | PENDING |
| FR-009 | kind=test; ref=frontend/tests/admin-vocab-set-import.test.mjs (payload script hiện nguyên văn) plus backend/tests/test_vocabulary_set_import_parser.py (lưu nguyên văn) | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_migration_372_vocab_cards_public_wiki.py (không GRANT mới cho anon/authenticated trên vocabulary_sets*) plus backend/tests/test_vocabulary_set_import.py (library/course_ids/cohort_ids không đổi) | PENDING |
| FR-011 | kind=test; ref=frontend/tests/vocabulary-study-simple.test.mjs (2 nút khi cờ bật, gửi again/good, khoá trước khi lật, phím Space/←/→) | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_vocabulary_set_subset_session.py (id con hợp lệ → phiên đúng thẻ; id ngoài revision → 422; bộ không còn được xem → 403/404) | PENDING |
| FR-013 | kind=test; ref=frontend/tests/aver-admin-chrome.test.mjs (mục Bộ từ theo lớp đầu mục Vocab, active ở /admin/vocab/sets/*) | PENDING |
| FR-014 | kind=manual; ref=staging checklist ui-states.md (375/1280, sáng/tối, bàn phím, screen reader) | PENDING |
