---
id: ADMINGROUP-0077
title: Admin pages share one route group and one shell layout while every page keeps its URL, its stylesheets in the same cascade order and its current look
status: draft
risk: medium
owner: product
---

# Admin pages share one route group and one shell layout while every page keeps its URL, its stylesheets in the same cascade order and its current look

Status: **draft** — soạn ngày 20/11/2026 cho nhiệm vụ `G10-T13` (thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-10-repo-pha-2-cau-truc.md` mục 4(d), 5.3, G10-T13…T15 và `docs/audits/nextjs-optimization-remediation-2026-09-14.md` (NXT-06). Số liệu đo lại trên `staging @ 119ad352` (20/11). Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6. Spec này không có migration.

## Tóm tắt (tiếng Việt)

Người dùng cuối và admin **không thấy gì thay đổi**: mọi URL `/admin/**` giữ nguyên, mọi trang giữ đúng bộ stylesheet và đúng thứ tự cascade, ảnh chụp mốc không đổi. Thay đổi là cấu trúc thư mục: 39 route group `(authed-admin-*)` (75 `page.tsx`), mỗi group một `layout.tsx` gần như chép lại nhau, được gom dưới **một** group cha `(authed-admin)` có một layout gọi `AuthedShell chrome="admin"`. Việc này mở đường cho ADMINIA-0074 (đã duyệt): khung admin mới "gắn một lần ở layout `(authed-admin)`" và khoảng 20 route mới của G09 không phải tạo group riêng.

Đo lại thấy thiết kế ở gói việc (5.3) có hai chỗ sẽ làm đổi giao diện, nên spec đổi cách làm:

1. **Layout theo đoạn URL làm rò stylesheet xuống trang con.** Gói đề xuất `(authed-admin)/admin/feedback/layout.tsx` phát sheet trang. Nhưng 5 nhóm URL lồng nhau giữa các group khác nhau: `/admin` (overview) chứa mọi trang admin; `/admin/writing` (group `writing`) chứa `/admin/writing/queue`, `/status`, `/tips`… (10 group khác); `/admin/grammar` chứa `/analytics`, `/articles`, `/recommend-test`; `/admin/reading` chứa `/content`, `/preview`; `/admin/speaking` chứa `/sessions`, `/topics`. Một `admin/writing/layout.tsx` sẽ nạp sheet của `/admin/writing` lên cả các trang con đó → đổi cascade. Spec dùng **group con** thay vì layout theo đoạn URL: `app/(authed-admin)/(feedback)/admin/feedback/page.tsx` — giữ đúng ranh giới phạm vi stylesheet như hôm nay (Next đã cho nhiều group cùng có thư mục `admin/writing/…` mà không trùng URL; repo đang làm đúng như vậy).
2. **`<link precedence>` của React 19 không gỡ stylesheet khi rời trang.** Theo tài liệu React 19, sheet có `precedence` được treo lên `<head>` và không bị gỡ khi component phát nó unmount (thí điểm phải xác nhận bằng DOM thật), nên điều hướng phía client từ `/admin/listening` (15 sheet trang) sang `/admin/feedback` sẽ mang theo 15 sheet đó. Spec đề nghị mặc định **`<link rel="stylesheet">` thường** trong layout group con: phần tử nằm ngay sau 4 sheet nền trong DOM (đúng thứ tự hôm nay vì admin tắt `tailwindLayer`), có trong HTML server render, và bị gỡ khi group con unmount. `precedence` chỉ là phương án so sánh trong thí điểm.

Ngoài `(authed-admin-writing-grade)` (gói đã ghi), thêm hai group **giữ riêng**: `(authed-admin-reading-preview)` và `(authed-admin-writing-tips)` truyền `extraScripts` (`marked`, `purify`, `/js/markdown.js`) vào `AuthedShell`; script này phải chạy **trong** `SupabaseRuntimeBoundary` theo thứ tự cố định, nên không dời được xuống layout con khi không sửa `authed-shell.tsx` (cấm trong gói, mục 8 điểm 5).

## Problem

`frontend/app/` có 93 group ở `119ad352`; 39 là `(authed-admin-*)` với 75 `page.tsx`. Mỗi group có `layout.tsx` riêng; 38/39 layout gọi `AuthedShell` với cùng `chrome="admin"`, `bodyClass="av-page av-admin-surface"`, `utilityLayer={false}`, `tailwindLayer={false}`, cùng 4 sheet nền (`aver-design/admin-surface.css` có `dataAverAdminSurface`, `admin-components.css`, `admin-buttons.css`, `admin-status.css`) và 1–15 sheet trang; mọi layout có `export const instant = false;`.

Hệ quả:

- ADMINIA-0074 (approved) cần khung admin mới gắn **một lần**; với 39 layout, mỗi thay đổi khung phải sửa 39 file và dễ quên một (đúng nợ mà chú thích đầu `components/authed-shell.tsx` mô tả).
- ADMINIA-0074 ghi rủi ro "Thêm route mới trước G10 → phải tạo `(authed-admin-xxx)/layout.tsx` → không tạo; chờ G10": khoảng 20 route mới của G09 (danh sách ở `specs/0074-admin-ia/plan.md`) đang chờ spec này.
- Test ghim đường dẫn group: 109 file trong `frontend/tests` (26 trong `tests/react`), 47 lần trong `.github/workflows/next-native-browser.yml`, 75 lần trong `docs/ROUTE_LEDGER.md`.

## Scope

- Mục (d) của GOI-10: FR dưới đây và nhiệm vụ G10-T14 (thí điểm 3 group), G10-T15 (các group còn lại theo đợt nhóm sidebar).
- Tạo `frontend/app/(authed-admin)/layout.tsx`; chuyển 36 group vào làm group con; sửa đường dẫn group trong test, tooling, CI và `docs/ROUTE_LEDGER.md`.

## Non-goals

- Không sửa `frontend/components/authed-shell.tsx` (cascade; gói mục 8 điểm 5) và không đổi 4 sheet nền.
- Không gộp group phía học viên (G07 tự quyết).
- Không đổi URL, nội dung trang, thứ tự sheet, `bodyClass`, script; không thiết kế lại giao diện admin (G09) hay thay khung bằng `StaffShell` (UIBASE-0056 / ADMINIA-0074 làm sau, trên group mới).
- Không chuyển `(authed-admin-writing-grade)`, `(authed-admin-reading-preview)`, `(authed-admin-writing-tips)` (FR-003).

## Users and journeys

- Admin và giáo viên: mở mọi trang `/admin/**`, chuyển trang bằng sidebar; không thấy khác biệt.
- Người thực thi G09: thêm trang admin mới bằng một thư mục dưới `(authed-admin)`, không tạo layout shell.
- Người review: PR chuyển group là `git mv` + layout con 3–20 dòng + sửa đường dẫn trong test.

## Requirements

Đánh số theo gói (FR-10d-NNN → FR-NNN); FR-004…FR-007 thêm khi đo lại ở `119ad352`.

- **FR-001:** Có một group `(authed-admin)`; mỗi trang admin chuyển vào đó giữ URL, giữ danh sách `<link rel="stylesheet">` trong HTML trả về (cùng href, cùng thứ tự tương đối, cùng thuộc tính `data-aver-admin-surface`) và giữ ảnh chụp mốc (TESTPOLICY-0057) trong ngưỡng.
- **FR-002:** Trang admin mới (G09) đặt dưới `(authed-admin)` không cần tạo layout gọi `AuthedShell`; nếu cần sheet trang riêng, nó có group con với layout chỉ phát `<link>`.
- **FR-003:** `(authed-admin-writing-grade)` (khác `bodyClass`, có Tailwind), `(authed-admin-reading-preview)` và `(authed-admin-writing-tips)` (có `extraScripts`) giữ group riêng.
- **FR-004:** Sheet trang của một group cũ chỉ áp lên đúng các trang của group đó: không layout nào đặt theo đoạn URL dùng chung (`admin/`, `admin/writing/`, `admin/grammar/`, `admin/reading/`, `admin/speaking/`) phát sheet trang.
- **FR-005:** Điều hướng phía client từ trang admin A sang trang admin B cho cùng tập stylesheet trong DOM và cùng ảnh chụp như tải trực tiếp B.
- **FR-006:** `route-ownership-check.mjs`, `route-ledger-matches-app.test.mjs`, `workflow-path-coverage.test.mjs`, `authed-shell.test.mjs` qua sau mỗi PR; mọi đường dẫn group cũ trong test/tooling/CI/ledger được đổi trong cùng PR (không để test qua vì không còn đọc file).
- **FR-007:** Mỗi PR chuyển tối đa 6 group và sửa tối đa 30 file test.

## Acceptance scenarios

### Scenario 1 — ảnh mốc không đổi

- **Given** ảnh mốc admin của TESTPOLICY-0057 (G10-T03/T04) cho trang thuộc group X
- **When** chuyển X vào `(authed-admin)` thành group con
- **Then** ảnh của 4 dự án (1280×800 sáng/tối, 390×844 sáng/tối) không đổi trong ngưỡng `maxDiffPixelRatio` của 0057 (FR-001)

### Scenario 2 — điều hướng phía client bằng sidebar (gói)

- **Given** đang ở `/admin/classes`
- **When** bấm sidebar sang `/admin/feedback`
- **Then** ảnh chụp `/admin/feedback` sau điều hướng client giống ảnh tải trực tiếp; `document.querySelectorAll('link[rel=stylesheet]')` cho cùng danh sách href như khi tải trực tiếp (FR-005)

### Scenario 3 — rời trang có nhiều sheet

- **Given** đang ở `/admin/listening/tests` (group listening, 15 sheet trang)
- **When** điều hướng client sang `/admin/feedback`
- **Then** không còn sheet `admin-listening-*` nào trong DOM; nếu thí điểm dùng `<link precedence>` mà sheet còn ở lại, phương án đó bị loại (FR-005)

### Scenario 4 — URL lồng giữa hai group

- **Given** `/admin/writing` (group `writing`) và `/admin/writing/queue` (group `writing-queue`) cùng ở dưới `(authed-admin)`
- **When** tải `/admin/writing/queue`
- **Then** HTML chỉ có sheet của `writing-queue` cộng 4 sheet nền, không có sheet trang của `writing`; tương tự `/admin` (overview) không rò sheet xuống trang admin nào (FR-004)

### Scenario 5 — `<head>` trước/sau

- **Given** server fixture chạy SHA trước và SHA của PR
- **When** `curl -s http://localhost:<port>/admin/feedback | grep -o '<link rel="stylesheet"[^>]*>'` trên cả hai
- **Then** hai danh sách giống hệt (href, thứ tự, thuộc tính); kết quả dán vào PR (FR-001)

### Scenario 6 — trang mới của G09

- **Given** `(authed-admin)` đã có
- **When** G09 thêm `app/(authed-admin)/(learners)/admin/learners/page.tsx` (không layout shell)
- **Then** trang có khung admin, 4 sheet nền và qua `route-ownership-check.mjs` (FR-002)

## Edge cases

- **`dataAverAdminSurface`:** `aver-admin-chrome.js` tự chèn `admin-surface.css` nếu không thấy `link[data-aver-admin-surface]`; sheet này ở layout cha nên luôn có — kiểm trong Scenario 5.
- **Group có 15 sheet** (`listening`): layout con phát đủ 15 `<link>` theo đúng thứ tự cũ.
- **Group nạp sheet của group khác** (`students` nạp `admin-classes-next.css`): layout con nạp đủ danh sách như cũ, đúng thứ tự.
- **`(authed-admin-writing-grade)`, `reading-preview`, `writing-tips`:** giữ riêng (FR-003). Khi điều hướng client giữa một trang trong `(authed-admin)` và một trong ba group này, cây layout khác nhau nên `AuthedShell` remount như hôm nay giữa mọi group — không đổi hành vi.
- **Hai layout cùng render `<html>`/`<body>`?** Không: `app/layout.tsx` là root layout duy nhất (dòng 102–112); `AuthedShell` trả fragment; layout con chỉ trả `<>{links}{children}</>`.
- **`export const instant = false;`** (CSP nonce theo request, PC-J38): có ở layout cha **và** giữ ở mọi layout con (không xoá khi chưa chứng minh segment config kế thừa đúng).
- **Sheet thường trong `<body>`:** hôm nay `AuthedShell` cũng phát `<link>` trong `<body>` (root layout sở hữu `<html>`/`<body>`), nên đặt `<link>` ở layout con không đổi vị trí loại (body) mà chỉ đổi cha DOM; cascade chỉ phụ thuộc thứ tự tài liệu. Admin tắt `tailwindLayer`, nên không có `tailwind.build.css` đứng giữa sheet nền và sheet trang.
- **Ảnh mốc chưa có** (TESTPOLICY-0057 chưa duyệt/chưa làm T03–T04): thí điểm T14 bắt buộc có ảnh mốc cho 3 trang thí điểm và cảnh điều hướng client; T15 cho group chưa có ảnh mốc dựa vào Scenario 5 (so `<link>`) và ghi "chưa có ảnh mốc".
- **Bộ lọc CI** ghim `frontend/app/(authed-admin-feedback)/**`: đổi sang đường dẫn mới; nếu quên, `workflow-path-coverage.test.mjs` báo.

## Success criteria

- Sau T15: `ls frontend/app | grep authed-admin` chỉ còn `(authed-admin)`, `(authed-admin-writing-grade)`, `(authed-admin-reading-preview)`, `(authed-admin-writing-tips)` (gói E2E-4, chỉnh theo FR-003); ảnh mốc admin không đổi.
- Số file layout gọi `AuthedShell chrome="admin"` giảm từ 39 xuống 4.
- G09 mở trang admin mới đầu tiên mà không tạo layout shell.

## Related specifications

- TESTPOLICY-0057 (draft): ảnh chụp mốc là bằng chứng chính của FR-001/FR-005; thí điểm T14 cần T03 của 0057 hoặc tự thêm spec ảnh cho 3 trang thí điểm theo hợp đồng 5.1 của gói.
- ADMINIA-0074 (approved): "Khung admin mới gắn một lần ở layout `(authed-admin)`"; khoảng 20 route mới đặt trong group này; spec này phải merge trước nhiệm vụ frontend tạo trang mới của 0074 (T08 trở đi).
- UIBASE-0056 (approved): `StaffShell` sẽ thay `AuthedShell` ở layout cha trong một PR của 0074, không phải PR của spec này.
- LEGACYJS-0075: độc lập; cả hai cùng chạm `next-native-browser.yml` → không mở PR hai spec cùng lúc trên cùng bộ lọc.

## Open questions

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm |
| --- | --- | --- | --- |
| Q-d1 | Gộp 39 group admin thành **1** group cha (với group con giữ sheet trang) hay thành **khoảng 8** group theo 8 nhóm sidebar? | 1 group cha + group con dùng `<link>` thường (không cần `<link precedence>`), nếu thí điểm T14 cho `<head>` giống hệt và ảnh không đổi; nếu không, ~8 group theo nhóm sidebar | Thí điểm T14 rồi dừng hỏi |
| Q-d2 | Cho giữ riêng `(authed-admin-reading-preview)` và `(authed-admin-writing-tips)` (có `extraScripts`) cùng `(authed-admin-writing-grade)`, thay vì sửa `authed-shell.tsx` để layout con truyền script? | Đồng ý giữ riêng; xem lại khi 0074 thay khung | Giữ riêng |
