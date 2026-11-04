# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_vocabulary_set_import.py (cờ tắt → 404 feature_disabled, features.flashcard_mvp false) plus frontend/tests/admin-vocab-set-import.test.mjs (không có nút khi cờ tắt) | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_vocabulary_set_import.py (học viên/giảng viên/khách 401/403 trước khi đọc/parse body, không gọi DB; body đúng hai trường text/expected_version, extra field 422) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_vocabulary_set_import_parser.py (Tab, CSV ngoặc kép, BOM, NFC, tiêu đề, dòng trống, thừa cột) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_vocabulary_set_import_parser.py (vượt 100 KB UTF-8 → 413, đúng 100 KB không lỗi kích thước, 201 dòng, độ dài trường, CEFR, ký tự điều khiển) plus backend/tests/test_vocabulary_set_import.py (dry-run và commit: 190 + 20 thẻ dùng lại chưa trong bộ → 422 too_many_cards, remaining=10, không ghi; 190 + 20 id đã trong bộ vẫn là 190; trùng trong đoạn dán không đếm lại; tổng đúng 200 hợp lệ) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_vocabulary_set_import.py (dry-run không insert/update, đúng status từng dòng và summary) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_vocabulary_set_import.py (còn lỗi → 422 không ghi; version sai → 409 không thẻ mồ côi; thứ tự giữ; id trùng bỏ; bộ archived 409) plus backend/tests/test_migration_372_vocab_cards_public_wiki.py (RPC pin search_path=pg_catalog,pg_temp, chỉ service_role được gọi) | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_vocabulary_set_import.py (thẻ có sẵn không đổi cột nào; cảnh báo nghĩa khác) | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_migration_372_vocab_cards_public_wiki.py (cột default true, dòng cũ true, policy SELECT hiện có giữ nguyên nên anon vẫn đọc thẻ ẩn qua REST) plus backend/tests/test_vocab_public_wiki_filter.py (grid/category/article/search/sitemap bỏ public_wiki=false; admin search, bộ từ và nguồn KP vẫn thấy thẻ) | PENDING |
| FR-009 | kind=test; ref=frontend/tests/admin-vocab-set-import.test.mjs (payload script hiện nguyên văn) plus backend/tests/test_vocabulary_set_import_parser.py (lưu nguyên văn) | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_migration_372_vocab_cards_public_wiki.py (không GRANT mới cho anon/authenticated trên vocabulary_sets*) plus backend/tests/test_vocabulary_set_import.py (library/course_ids/cohort_ids không đổi) | PENDING |
| FR-011 | kind=test; ref=frontend/tests/vocabulary-study-simple.test.mjs (2 nút khi cờ bật, gửi again/good, khoá trước khi lật, phím Space/←/→) | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_vocabulary_set_subset_session.py (id con hợp lệ → phiên đúng thẻ; id ngoài revision → 422; bộ không còn được xem → 403/404) | PENDING |
| FR-013 | kind=test; ref=frontend/tests/aver-admin-chrome.test.mjs (mục Bộ từ theo lớp đầu mục Vocab, active ở /admin/vocab/sets/*) | PENDING |
| FR-014 | kind=manual; ref=staging checklist ui-states.md (375/1280, sáng/tối, bàn phím, screen reader) | PENDING |
