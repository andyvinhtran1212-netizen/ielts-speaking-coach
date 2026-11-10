# Tasks

Spec **approved** 10/11/2026 (anh Vinh, t1564s5141; Q-1..Q-9 đã chốt, xem
spec.md "Quyết định của anh Vinh"). Build theo thứ tự phụ thuộc dưới đây. Ưu tiên sau
FLASHCARD-0048. Cỡ S ≈ ≤ 1 giờ job, M ≈ 1–3 giờ. Không có migration.

- [ ] T001 (A1, S, Claude) Cờ `ADMIN_NAV_SIMPLIFIED` + `GET /admin/ui-config`
  + `prod_menu` theo `resolve_tier(ENVIRONMENT, RAILWAY_ENVIRONMENT_NAME)`
  (Q-8, FR-001; không dùng `ENVIRONMENT` đơn) + bốn ca kiểm (ENV trống +
  RAILWAY=production → true; ENV=staging → false; RAILWAY=staging → false;
  tên Railway không nhận ra → true) + test quyền + `api.d.ts` (FR-001,
  FR-009). Không phụ thuộc.
  `owns: backend/config.py, backend/routers/admin_ui_config.py (hoặc router admin sẵn có),
  backend/main.py, backend/tests/test_admin_ui_config.py, frontend/types/api.d.ts`
- [ ] T002 (A2, M, Codex) `NAV_GROUPS_SIMPLIFIED`, nhóm "Thí điểm & QA" thu
  gọn, nhóm Hệ thống, đổi nhãn, đọc cờ + fallback, snapshot test cả hai bản
  (FR-002, FR-003, FR-005). `depends: T001`. Mục "Bộ từ theo lớp" lấy từ
  0048 T001 nếu đã merge, nếu chưa thì thêm ở đây (cùng file — PC xếp tuần tự).
  `owns: frontend/public/js/components/aver-admin-chrome.js,
  frontend/lib/admin-nav-simplified.mjs, frontend/tests/aver-admin-chrome*.test.mjs`
- [ ] T003 (A3, S, Codex) `AdminSimplifiedRedirect` cho 6 hub (không gồm
  `writing/cohorts` — Q-4: GĐ1 chỉ ẩn menu, URL vẫn mở) và sự kiện
  `admin_nav_legacy_hit` (FR-004, FR-006). Test: cờ bật, URL
  `/admin/writing/cohorts` vẫn mở trang cũ, không chuyển. `depends: T002
  (dùng chung danh sách)`.
  `owns: frontend/components/admin-simplified-redirect.tsx, 6 page.tsx hub,
  frontend/tests/admin-simplified-redirect.test.mjs`
- [ ] T004 (A4, S, Codex) Giao bài từ lớp: lựa chọn Writing trong hộp, bỏ nút
  rời khi cờ bật; banner + "← Về lớp" ở Writing assignments (FR-007, FR-008).
  `depends: T001`. `owns: frontend/app/(authed-admin-classes)/admin/classes/[cohortId]/admin-class-homework.tsx,
  frontend/app/(authed-admin-writing-assignments)/admin/writing/assignments/*,
  frontend/tests/admin-class-homework*.test.mjs`
- [ ] T005 (A5, S, QA/Codex) Kiểm staging Scenario 1–7 (1280/390), bật cờ
  staging, ghi `verification.md`. `depends: T002, T003, T004`.
- [ ] T006 (A6, S, Leader/WM, không code) Thu số page_view production 60–90
  ngày cho các trang trong bảng kiểm kê; cập nhật cột Xem60 (Q-1). Song song.
- [ ] T007 (GĐ2, chưa xếp) Phiếu gộp tab/xoá code theo cổng FR-010 — chỉ tạo
  sau ≥ 14 ngày cờ bật production. `depends: T005, T006`.
