# Implementation plan

## Architecture impact

- Menu: `frontend/public/js/components/aver-admin-chrome.js` (web component
  dùng chung cho mọi trang admin). Thêm `NAV_GROUPS_SIMPLIFIED`, nhóm thu gọn,
  đọc cờ từ `GET /admin/ui-config` (fetch có timeout 3 s, cache
  `sessionStorage` 60 s), fallback menu hiện tại.
- Chuyển hướng: component nhỏ `AdminSimplifiedRedirect` (client) đặt trong
  `page.tsx` của 6 hub + `writing/cohorts`; chỉ chạy khi cờ `simplified` và
  không có `embed=1`. Không dùng `next.config` redirects (tĩnh, không theo cờ).
- Backend: route `GET /admin/ui-config` trong router admin sẵn có
  (`require_admin`), cờ `ADMIN_NAV_SIMPLIFIED: bool = False` trong
  `backend/config.py`.
- Lớp: `admin-class-homework.tsx` thêm lựa chọn Writing trong hộp "Giao bài
  mới". Writing assignments: banner + nút về lớp.
- Không migration, không đổi API giao bài, không đổi quyền.

## Data and contracts

- `GET /admin/ui-config` → 200 `{nav: "current"|"simplified"}`; 401/403 cho
  không-admin. OpenAPI có schema cụ thể; regenerate `frontend/types/api.d.ts`.
- Sự kiện analytics `admin_nav_legacy_hit {path, referrer_kind: "direct" |
  "internal" | "external"}` qua `POST /api/analytics/events` sẵn có (kiểm tên
  sự kiện có trong allowlist của backend; nếu có allowlist thì thêm vào).
- Danh sách "ẩn/chuyển" là hằng số dùng chung giữa chrome và redirect
  (`frontend/lib/admin-nav-simplified.mjs`).

## Rollout and rollback

Cờ tắt mặc định. Bật staging → kiểm Scenario 1–6 → chờ số WM production (Q-1)
→ bật production với cho phép của anh Vinh. Rollback = tắt cờ (≤ 60 s theo
cache). Giai đoạn 2 theo cổng FR-010.

## Verification strategy

- Node test cho chrome: snapshot menu hiện tại (cờ tắt) và menu simplified.
- React test redirect (giữ query, không chạy khi embed=1, không vòng lặp).
- Pytest `GET /admin/ui-config` quyền + giá trị cờ.
- React test hộp Giao bài có Writing → đúng href.
- Kiểm staging thủ công 1280/390.
