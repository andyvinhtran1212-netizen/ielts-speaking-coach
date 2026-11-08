# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_admin_ui_config.py (mặc định current, env true → simplified) plus frontend/tests/aver-admin-chrome.test.mjs (lỗi/timeout → menu hiện tại) | PENDING |
| FR-002 | kind=test; ref=frontend/tests/aver-admin-chrome.test.mjs (snapshot NAV_GROUPS không đổi; NAV_GROUPS_SIMPLIFIED khớp bảng Menu giai đoạn 1 và mọi dòng GĐ1: Feedback không có trong menu, Speaking Topics giữ tới khi có số prod, Listening đủ 6 mục không có Audit, Listening Audit ở nhóm QA thu gọn; các mục chuyển/ẩn/thêm còn lại đúng kiểm kê) | PENDING |
| FR-003 | kind=test; ref=frontend/tests/aver-admin-chrome.test.mjs (mọi route trong bảng kiểm kê vẫn có page.tsx và AdminAccessGate; active hợp lệ) | PENDING |
| FR-004 | kind=test; ref=frontend/tests/admin-simplified-redirect.test.mjs (6 hub chuyển, giữ query, embed=1 không chuyển, cờ tắt không chuyển) | PENDING |
| FR-005 | kind=test; ref=frontend/tests/aver-admin-chrome.test.mjs (nhóm thu gọn mặc định, tự mở khi active trong nhóm, nhớ localStorage) | PENDING |
| FR-006 | kind=test; ref=frontend/tests/admin-simplified-redirect.test.mjs (1 sự kiện, chỉ path không query, không PII) | PENDING |
| FR-007 | kind=test; ref=frontend/tests/admin-class-homework.test.mjs (lựa chọn Writing → assignmentHref với cohortId; nút rời ẩn khi cờ bật) | PENDING |
| FR-008 | kind=test; ref=frontend/tests/admin-writing-assignments-next-behavior.test.mjs (banner, nút về lớp khi có assign_cohort, nhãn menu) | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_admin_ui_config.py (học viên/giảng viên/khách 401/403) | PENDING |
| FR-010 | kind=manual; ref=PC ticket gate checklist before any phase-2 deletion ticket | PENDING |
