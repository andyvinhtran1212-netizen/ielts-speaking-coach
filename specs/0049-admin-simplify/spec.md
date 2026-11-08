---
id: ADMINSIMPLE-0049
title: Đơn giản hoá trang admin — ẩn hoặc chuyển hướng subpage không dùng sau cờ, gom luồng giao bài về workspace lớp; xoá code ở giai đoạn sau
status: draft
risk: medium
owner: product
---

# Đơn giản hoá trang admin — ẩn hoặc chuyển hướng subpage không dùng sau cờ, gom luồng giao bài về workspace lớp; xoá code ở giai đoạn sau

Status: **draft, chưa duyệt**. FD viết theo yêu cầu anh Vinh (t1392u, 04/11
14:38 UTC+7, Leader chuyển). Số **0049** đã giữ trong
`/workspace/cc-jobs/spec-number-register.md`. Base đọc: `origin/staging` @
`6b8e18894` (04/11 14:19 UTC+7).

**Đầu vào chính:** khảo sát của Web Manager `/workspace/cc-jobs/handoff/feature-developer/20261104-web-manager-admin-subpages-assign-flow.md` (04/11, staging, chỉ đọc):
76 subpage, đề xuất **GIỮ 31 · GỘP 28 · ẨN 17** kèm bằng chứng từng trang, luồng
giao bài 12 bước, 14 điểm đau, menu 5 nhóm, 9 khuyến nghị. Bổ sung: mã nguồn
(73 `page.tsx` + `NAV_GROUPS` trong `aver-admin-chrome.js`) và báo cáo UI
Auditor `/workspace/cc-jobs/reports/ui-admin-consolidation-20261030.md`.
WM chỉ có số **staging** (nhiều dữ liệu QA/script). Vì vậy mọi quyết định **ẨN
là tạm thời**: GĐ1 chỉ bỏ khỏi menu/redirect, đảo ngược bằng tắt cờ; chốt
danh sách ẩn trên production cần anh Vinh duyệt một lượt SELECT chỉ đọc trên
prod (Q-1). Cột "Xem60" bên dưới = số staging.

## Tóm tắt (tiếng Việt)

- **Giai đoạn 1 (spec này, build được):** chỉ **ẩn khỏi menu / chuyển hướng /
  sắp xếp lại menu**, sau cờ `ADMIN_NAV_SIMPLIFIED` (mặc định **tắt**). Không
  xoá trang, không xoá API, không đổi quyền. Mọi URL cũ vẫn mở được (trang
  hub thì chuyển sang công cụ chính).
- **Giai đoạn 2 (sau, spec/phiếu riêng):** gộp trang thành tab (Listening
  import, Vocab kho từ, Quick-Check, Hàng chờ Writing…), rồi **xoá code** trang
  đã ẩn ≥ 14 ngày trên production mà không ai mở (đo bằng sự kiện mới
  `admin_nav_legacy_hit`), cùng 66 HTML legacy + 51 JS admin (G13).
- **Luồng giao bài:** hôm nay có 5 chỗ giao (tab Bài tập của lớp, nút "Giao
  Writing cho lớp", trang Gán bài tập Writing, Thư viện prompt, `/instructor`
  Giao bài) trên 2 sổ cái khác nhau. Giai đoạn 1: **lớp là nơi bắt đầu duy
  nhất trên menu admin** — "Giao bài" chỉ xuất hiện trong workspace lớp, hộp
  "Giao bài mới" có thêm lựa chọn **Writing** (mở đúng form Writing đã điền
  sẵn lớp), trang Gán bài tập Writing đổi vai thành "Lịch sử giao Writing".
  Hợp nhất sổ cái là giai đoạn 2.

## Problem

- 73 trang admin cho 13 mục menu và 39 mục con; 6 trang hub chỉ chứa thẻ
  trùng menu (0–9 lượt xem staging) trong khi trang con mở nhiều (UIA D1).
- Trùng lặp: "Trạng thái chấm" = lane của Hàng chờ chấm (D2); 3 hàng chờ
  Writing (D3); Writing › Lớp học trùng workspace lớp (D4); Vocab 9 mục, 5
  trang thí điểm/rỗng ngang hàng trang đang dùng (D7); trang chính
  `/admin/vocab/sets` không có trong menu (D6); công cụ QA lẫn trong menu
  (D14); trang vận hành mồ côi (D11); IA lệch Reading attempts (D10); Grammar ›
  Bài tập nhảy sang mục Vocab (D9).
- Giao bài phân tán (đọc mã):
  - `/admin/classes/[cohortId]` tab Bài tập: nút "Giao bài lớp" (sổ cái
    `class_assignments`, skill speaking/reading/listening/course/grammar —
    **không có writing**, `backend/routers/admin_class_assignments.py:119`)
    và nút "Giao Writing cho lớp" (link sang `/admin/writing/assignments?assign_cohort=`).
  - `/admin/writing/assignments` "Gán bài tập" (215 lượt xem staging, sổ cái
    `writing_assignments`).
  - `/admin/writing/prompts` có nút giao đề.
  - `/admin/writing/cohorts` theo dõi lớp Writing riêng.
  - `/instructor` tab "Giao bài" (giảng viên, Writing).
  - Bộ từ (0020) "giao" bằng chọn khoá/lớp trong trình biên tập bộ, không có
    hạn nộp.
  Điểm đau (WM §2.3, top 5): (1) 5 đường giao, 4 bảng, 4 kiểu form; trang
  lớp có 2 nút "Giao Writing cho lớp" / "Giao bài lớp"; (2) hạn nộp không thống
  nhất (mặc định "hôm nay 19:00", Writing có 2 cột hạn); (3) việc chấm rải ở
  4–5 hàng chờ; (4) giảng viên chỉ thấy lớp mình tạo, chỉ giao Writing; (5)
  trạng thái/nhãn khó hiểu. Thêm: không xác nhận khi giao cả lớp, kỹ năng mặc
  định Speaking dễ giao nhầm, "Bù học viên" thủ công từng bài, 3 cơ chế làm lại.
  GĐ1 chỉ xử lý (1) phần điểm bắt đầu + menu; (2)(3)(4)(7)(8) là spec sau.

## Scope

Giai đoạn 1:

- Một cấu hình menu duy nhất trong `aver-admin-chrome.js` có hai bản: hiện
  tại và "simplified"; cờ chọn bản.
- Ẩn/chuyển/sắp xếp theo bảng "Kiểm kê" dưới đây (cột "GĐ1").
- Chuyển hướng phía client cho 6 trang hub và `/admin/writing/cohorts` khi
  cờ bật (giữ query).
- Sự kiện `admin_nav_legacy_hit {path}` khi trang bị ẩn được mở trực tiếp.
- Hộp "Giao bài mới" của lớp có lựa chọn Writing (điều hướng tới form
  Writing có `assign_cohort`), banner trên `/admin/writing/assignments`.

## Non-goals

- Xoá trang, xoá route API, xoá HTML/JS legacy (giai đoạn 2).
- Gộp trang thành tab (G6, G8, G10, G11), sửa iframe Mock Test (G8).
- Hợp nhất sổ cái `writing_assignments` vào `class_assignments`, thêm
  `vocabulary_set` vào giao bài lớp (spec riêng).
- Đổi quyền/phân vai; ẩn menu **không phải** kiểm soát truy cập.
- Đổi `/instructor` (giảng viên giữ luồng hiện tại).
- Migration DB: **không có**.

## Kiểm kê subpage admin (73 trang)

Cột: **Xem60** = page_view 60 ngày **staging** theo UIA (chờ WM: production).
**GĐ1** = việc ở giai đoạn 1. **GĐ2** = đề xuất sau. "ngữ cảnh" = trang cần id,
không có trong menu, giữ nguyên.

| Route | Menu hiện tại | Xem60 | GĐ1 | GĐ2 |
| --- | --- | --- | --- | --- |
| `/admin` | Tổng quan | 35 | Giữ | Thêm tab Lưu lượng (G9) |
| `/admin/dashboard/reading-attempts` | Tổng quan › Reading — Lượt làm bài | 0 | Chuyển sang mục Reading | — |
| `/admin/foot-traffic` | (mồ côi) | 0 | Thêm vào nhóm Hệ thống | Tab của Tổng quan |
| `/admin/usage` | (mồ côi) | 0 | Thêm vào nhóm Hệ thống | Tab Hoạt động của Người dùng |
| `/admin/system` | (hub) | 0 | Ẩn; chuyển → `/admin/system/alerts` (theo WM) | Xoá |
| `/admin/system/ai-usage` | (mồ côi) | 1 | Thêm vào nhóm Hệ thống "Chi phí AI" | — |
| `/admin/system/alerts` | (mồ côi) | 0 | Thêm vào nhóm Hệ thống "Sự cố chấm" | — |
| `/admin/error-logs` | Báo lỗi | 0 | Chuyển vào nhóm Hệ thống | Ẩn nút "Tạo lỗi test" ngoài staging |
| `/admin/feedback` | Feedback | 0 (user_feedback 0 dòng) | Ẩn khỏi menu tạm thời (WM), hiện huy hiệu ở Tổng quan khi có mục mới; URL giữ | Chờ số prod |
| `/admin/speaking` | Speaking (hub) | 3 | Ẩn hub; mục Speaking → Sessions | Xoá |
| `/admin/speaking/sessions` | Speaking › Sessions | 8 | Giữ | — |
| `/admin/speaking/topics` | Speaking › Topics | 1 (topics 0 dòng) | Ẩn tạm thời — **chỉ sau khi có số prod** (WM) | — |
| `/admin/writing` | Writing (hub) | 9 | Ẩn hub; mục Writing → Hàng chờ chấm | Xoá |
| `/admin/writing/new` | Soạn bài viết | 0 | Đổi nhãn "Gửi bài chấm thay HV" | — |
| `/admin/writing/queue?status=grading` | Trạng thái chấm | — | Bỏ mục menu (G1) | — |
| `/admin/writing/status` | (ngữ cảnh) | 0 | Giữ ngữ cảnh | — |
| `/admin/writing/assignments` | Gán bài tập | 215 | Đổi nhãn "Lịch sử giao Writing" + banner | Gộp vào sổ cái lớp |
| `/admin/writing/prompts` | Thư viện prompt | 807 | Giữ (nhãn "Kho đề") | — |
| `/admin/writing/tips` | Mẹo viết | 6 | Giữ | — |
| `/admin/writing/cohorts` | Writing › Lớp học | 7 | Ẩn; chuyển → `/admin/classes` (Q-4) | Xoá sau khi mang lọc "Có bài đang mở" |
| `/admin/writing/queue` | Hàng chờ chấm | 51 | Giữ | Thêm lane Instructor/Chấm lại (G6) |
| `/admin/writing/regrade-requests` | Yêu cầu chấm lại | 0 | Giữ (chờ WM; Q-3) | Lane trong Hàng chờ |
| `/admin/writing/instructor-queue` | Hàng đợi Instructor | 20 | Giữ | Lane trong Hàng chờ |
| `/admin/writing/grade` | (ngữ cảnh) | 144 | Giữ | — |
| `/admin/mock-tests` | Mock Test | 31 | Giữ | Tab native (G8) |
| `/admin/mock-exams`, `/admin/mock-live`, `/admin/mock-reviews` | (qua tab Mock) | 25/6/18 | Giữ (iframe đang dùng) | Chuyển hướng về tab |
| `/admin/mock-exams/corrections` | (mồ côi) | 0 | Thêm vào nhóm Thí điểm & QA | — |
| `/admin/mock-pacing`, `/admin/mock-reviews/report` | (ngữ cảnh) | 1/0 | Giữ | — |
| `/admin/instructors` | Giảng viên | 0 | Chuyển vào nhóm Lớp & Người dùng | — |
| `/admin/listening` + `tests`, `tests/[id]`, `content/[id]`, `content/[id]/edit`, `gist`, `mcq`, `tf`, `segments` | Listening / ngữ cảnh | 0–6 | Giữ | — |
| `/admin/listening/audit`, `audit-detail` | Listening › Audit | 2/5 (listening_audit 0 dòng) | Chuyển vào nhóm Thí điểm & QA (WM) | Phân trang (G12) |
| `/admin/listening/import-drills`, `import-fulltest` | 2 mục | 0/0 | Giữ (chờ WM) | 1 trang "Import" 2 tab (G10) |
| `/admin/listening/attempts`, `dictation` | 2 mục | 0/0 | Giữ (chờ WM) | 1 trang "Kết quả học viên" (G10) |
| `/admin/reading` | Reading (hub) | 7 | Ẩn hub; mục Reading → Thư viện nội dung | Xoá |
| `/admin/reading/content`, `/admin/reading/preview` | Reading / ngữ cảnh | 6/55 | Giữ | — |
| `/admin/vocab` | Vocab (hub) | 3 | Ẩn hub; mục Vocab → Bộ từ theo lớp | Xoá |
| `/admin/vocab/sets`, `sets/[id]` | (không có) | 2/14 | Thêm vào đầu menu Vocab (= 0048 T001) | — |
| `/admin/vocab/content`, `topics`, `lemmas` | 3 mục | 9/3/0 | Giữ content, topics; Lemma → nhóm Thí điểm & QA | 1 trang 3 tab (G11) |
| `/admin/vocab/quiz`, `quiz-analytics` | 2 mục | 3/0 | Giữ | 1 trang 2 tab (G11) |
| `/admin/vocab/stats` | Stats | 0 | Giữ (nhãn "Thống kê") | — |
| `/admin/vocab/curated`, `pilot-metrics`, `d1-curation`, `exercises` | 3 mục + 1 mồ côi | 1/1/1/2 | Chuyển vào nhóm "Thí điểm & QA" (thu gọn) | Gộp D1; xoá nếu WM xác nhận 0 dùng |
| `/admin/grammar` | Grammar (hub) | 3 | Ẩn hub; mục Grammar → Articles | Xoá |
| `/admin/grammar/articles`, `analytics` | 2 mục | 1/0 | Giữ | — |
| Grammar › "Bài tập (Exercises)" → `/admin/vocab/topics?skill_area=grammar` | mục | — | Giữ link, tô sáng mục Grammar (D9) | Tab riêng |
| `/admin/grammar/recommend-test` | Recommendation tester | 0 | Chuyển vào nhóm Thí điểm & QA | — |
| `/admin/grammar-lessons`, `/admin/grammar-diagnostic` | (ngữ cảnh) | 6/0 | Giữ | — |
| `/admin/users`, `/admin/students`, `/admin/classes`, `/admin/classes/[id]` | Người dùng / Lớp | 15/22/18/11 | Giữ (nhóm Lớp & Người dùng) | — |
| `/admin/mfa` | (ngữ cảnh) | — | Giữ | — |

### Menu giai đoạn 1 (cờ bật)

Snapshot theo cột GĐ1: Feedback ẩn tạm khỏi menu; Speaking Topics giữ tới khi
có số prod theo điều kiện trong kiểm kê. Không chốt thêm phân biệt môi trường
ở Q-8 trong snapshot này. Listening còn 6 mục; Audit chuyển sang nhóm QA.

```
Tổng quan
VIỆC CẦN XỬ LÝ: Chấm Writing (Hàng chờ · Hàng đợi Instructor · Yêu cầu chấm lại) · Speaking sessions · Mock Test
LỚP & NGƯỜI DÙNG: Lớp (giao bài ở đây) · Học viên · Giảng viên · Tài khoản
NỘI DUNG: Writing (Kho đề · Lịch sử giao Writing · Mẹo viết · Gửi bài chấm thay HV)
          Speaking (Topics) · Reading (Thư viện · Lượt làm bài) · Listening (Quản lý nội dung · Cambridge tests · Import bài luyện · Import Cambridge · Lượt làm bài · Báo cáo chép chính tả)
          Vocab (Bộ từ theo lớp · Nội dung từ vựng · Chủ đề · Quick-Check · Quiz — Học viên · Thống kê)
          Grammar (Articles · Analytics · Bài tập)
HỆ THỐNG: Báo lỗi · Sự cố chấm · Chi phí AI · Lưu lượng · Hoạt động
▸ Thí điểm & công cụ QA (thu gọn): Curated · Pilot metrics · D1 Curation · D1 Exercises · Lemma · Recommendation tester · Correction performance · Listening Audit
```

## Users and journeys

- **Admin giao bài cho lớp (mới):** Lớp → chọn lớp → tab Bài tập → "Giao bài
  mới" → chọn kỹ năng (Speaking/Reading/Listening/Khoá học/Grammar/**Writing**)
  → Writing mở `/admin/writing/assignments?assign_cohort=<id>` với form điền
  sẵn lớp → giao → quay lại lớp qua nút "← Về lớp".
- **Admin quen đường cũ:** mở bookmark `/admin/writing` → chuyển sang Hàng
  chờ chấm; mở `/admin/writing/cohorts` → chuyển sang Lớp; mở
  `/admin/vocab/curated` → trang vẫn mở, menu tô sáng nhóm Thí điểm.

## Requirements

- **FR-001:** (cờ) Cờ `ADMIN_NAV_SIMPLIFIED` (backend env, mặc định `false`)
  được trả trong `GET /admin/ui-config` (mới, chỉ admin, `{nav: "current" |
  "simplified"}`, cache trình duyệt ≤ 60 s). Cờ tắt, gọi lỗi hoặc chậm > 3 s
  → menu hiện tại, byte-giống hôm nay.
- **FR-002:** (một nguồn cấu hình) `aver-admin-chrome.js` định nghĩa
  `NAV_GROUPS` (hiện tại) và `NAV_GROUPS_SIMPLIFIED` từ cùng danh sách mục; test
  so menu simplified với bảng "Menu giai đoạn 1" (nhãn, href, thứ tự, nhóm).
- **FR-003:** (ẩn không phải chặn) Mọi trang bị bỏ khỏi menu vẫn mở được bằng
  URL với đúng `AdminAccessGate` như cũ, menu tô sáng nhóm cha; không trang
  nào trả 404 vì 0049.
- **FR-004:** (chuyển hướng hub) Khi cờ bật, `/admin/speaking`,
  `/admin/writing`, `/admin/reading`, `/admin/vocab`, `/admin/grammar`,
  `/admin/system` chuyển (replace, giữ query) sang công cụ chính theo bảng;
  `/admin/writing/cohorts` chuyển sang `/admin/classes` (tuỳ Q-4). Cờ tắt:
  không chuyển.
- **FR-005:** (nhóm thu gọn) Nhóm "Thí điểm & công cụ QA" thu gọn mặc định,
  trạng thái mở/đóng lưu `localStorage`; tự mở khi trang đang ở trong nhóm.
- **FR-006:** (đo đường cũ) Khi cờ bật và trang thuộc danh sách "ẩn/chuyển"
  được mở trực tiếp, gửi `admin_nav_legacy_hit {path, referrer_kind}` qua
  pipeline analytics sẵn có (không gửi email/PII). Đây là dữ liệu cho cổng xoá
  giai đoạn 2.
- **FR-007:** (giao bài từ lớp) Hộp "Giao bài mới" ở tab Bài tập của lớp có
  lựa chọn "Writing" điều hướng tới `assignmentHref({}, {cohortId})` (hàm sẵn
  có); nút rời "Giao Writing cho lớp" bị bỏ khi cờ bật (một nút "Giao bài");
  không đổi API giao bài nào.
- **FR-008:** (Writing assignments đổi vai) Khi cờ bật, nhãn menu "Gán bài
  tập" → "Lịch sử giao Writing"; trang hiện banner "Giao bài mới cho lớp ở Lớp
  → Bài tập" kèm link; khi mở có `assign_cohort` thì có nút "← Về lớp".
  Form giao cá nhân trên trang giữ nguyên.
- **FR-009:** (không đổi quyền) Không route backend nào đổi quyền; test xác
  nhận học viên/giảng viên gọi `GET /admin/ui-config` → 403 và các trang ẩn
  vẫn 403 với không-admin như cũ.
- **FR-010:** (cổng giai đoạn 2) Không xoá file trang/API nào trong 0049.
  Phiếu xoá giai đoạn 2 chỉ được tạo khi: cờ bật trên production ≥ 14 ngày,
  `admin_nav_legacy_hit` của trang đó = 0 (hoặc anh Vinh duyệt từng trang), và
  WM xác nhận số dùng production.

## Acceptance scenarios

### Scenario 1 — cờ tắt
Given cờ tắt; when admin mở mọi trang admin, then menu và điều hướng y hệt
`origin/staging` hiện tại (snapshot test).

### Scenario 2 — menu mới
Given cờ bật; then menu khớp "Menu giai đoạn 1", Vocab mở đầu bằng "Bộ từ
theo lớp", không còn "Trạng thái chấm".

### Scenario 3 — bookmark hub
Given cờ bật; when mở `/admin/writing?x=1`, then về `/admin/writing/queue?x=1`
không vòng lặp; nút Back của trình duyệt không kẹt.

### Scenario 4 — trang ẩn vẫn mở
Given cờ bật; when mở `/admin/vocab/lemmas`, then trang làm việc bình thường,
nhóm Thí điểm tự mở, có 1 sự kiện `admin_nav_legacy_hit`.

### Scenario 5 — giao Writing từ lớp
Given cờ bật, lớp L; when Giao bài mới → Writing, then mở form Writing đã
chọn lớp L; giao xong bấm "← Về lớp" về đúng tab Bài tập của L.

### Scenario 6 — không phải admin
Given JWT giảng viên; when gọi `/admin/ui-config` hoặc mở trang admin ẩn,
then 403 như cũ.

## Edge cases

- Cờ đổi giữa phiên: menu cập nhật ở lần tải trang sau (cache ≤ 60 s).
- Trang hub đang là đích "rollback" theo comment code: cờ tắt là rollback.
- `/admin/mock-tests` nhúng iframe `embed=1` các trang con: chuyển hướng
  không áp dụng khi `embed=1`.
- Màn 390 px: nhóm thu gọn vẫn dùng được bằng chạm và bàn phím.

## Security risks

| Rủi ro | Biện pháp | FR |
| --- | --- | --- |
| Hiểu nhầm "ẩn menu" là bảo mật | Ghi rõ; trang ẩn giữ AdminAccessGate + backend `require_admin` | FR-003, FR-009 |
| Endpoint cấu hình lộ thông tin | Chỉ admin, chỉ trả `nav` | FR-001, FR-009 |
| Open redirect | Đích chuyển hướng là hằng số trong code, không lấy từ query | FR-004 |
| PII trong sự kiện | Chỉ `path` (không query string), `referrer_kind` enum | FR-006 |

## Success criteria

- Menu cấp con giảm từ 39 xuống ≈ 30 mục hiển thị mặc định (nhóm Thí điểm thu
  gọn), 6 hub không còn là bước trung gian.
- Admin giao bài cho lớp (mọi kỹ năng) bắt đầu từ một chỗ.
- 0 tăng lỗi 4xx/5xx admin sau bật cờ staging 24 h.

## Câu hỏi cho anh Vinh

- **Q-1 (SELECT chỉ đọc trên prod):** anh duyệt một lượt truy vấn chỉ đọc
  trên production (page_view 60–90 ngày cho `/admin%` + đếm dòng các bảng WM
  nêu: user_feedback, topics, listening_audit, vocab_unit_*, vocabulary_exercises,
  user_d1_questions, essay_regrade_requests) để chốt 17 trang ẨN? **Em đề
  xuất:** duyệt; trước khi có số, ẩn chỉ bật trên staging, prod giữ menu cũ.
  Build không cần chờ.
- **Q-2 (điểm đau giao bài):** theo WM có 14 điểm đau. Anh xác nhận điểm đau
  chính có phải "Writing giao ở chỗ khác lớp" và "không thấy toàn cảnh bài của
  lớp"? **Em đề xuất:** GĐ1 gom điểm bắt đầu về lớp (FR-007/FR-008); hợp nhất sổ
  cái để spec riêng sau khi có số WM.
- **Q-3 (Yêu cầu chấm lại 0 dòng):** ẩn ngay hay giữ? **Em đề xuất:** giữ ở
  GĐ1 (là luồng học viên gửi lên, 0 dòng staging chưa chắc 0 trên prod), gộp
  thành lane ở GĐ2.
- **Q-4 (Writing › Lớp học):** chuyển hướng sang `/admin/classes` ngay ở GĐ1
  dù mất lọc "Có bài đang mở"? **Em đề xuất:** chỉ ẩn khỏi menu ở GĐ1 (URL vẫn
  mở), chuyển hướng ở GĐ2 khi lớp có lọc tương đương.
- **Q-5 (6 trang hub):** đồng ý bỏ hub, mục menu mở thẳng công cụ chính?
  **Em đề xuất:** đồng ý (0–9 lượt xem, chỉ thêm một cú bấm).
- **Q-6 (giảng viên):** `/instructor` "Giao bài" giữ nguyên? **Em đề xuất:**
  giữ nguyên ở 0049; giảng viên không dùng menu admin.
- **Q-8 (Feedback, Speaking topics):** ẩn tạm hai trang này (0 dòng staging) hay giữ tới khi có số prod? **Em đề xuất:** giữ trên prod tới khi có số; ẩn trên staging.
- **Q-9 (wizard giao bài WM):** wizard 4 bước + một quy tắc hạn + tự bù học viên + Bàn chấm chung (WM §3) làm spec riêng sau 0049? **Em đề xuất:** có, spec riêng (đụng sổ cái, hạn, migration).
- **Q-7 (xoá code GĐ2):** đồng ý cổng FR-010 (≥ 14 ngày, 0 lượt mở, WM xác
  nhận) trước mọi phiếu xoá, kể cả 66 HTML legacy? **Em đề xuất:** đồng ý.
