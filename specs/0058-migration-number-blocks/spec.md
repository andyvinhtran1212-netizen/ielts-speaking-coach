---
id: MIGNUM-0058
title: Each work package takes migration numbers only from its own block, and the migration register test rejects a number outside or in another package's block
status: draft
risk: high
owner: product
---

# Each work package takes migration numbers only from its own block, and the migration register test rejects a number outside or in another package's block

Status: **draft** — soạn ngày 18/11/2026 cho nhiệm vụ `G10-T22` (đợt A, thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-10-repo-pha-2-cau-truc.md` và `00-QUY-UOC-CHUNG.md` mục 2 (bản trên `staging` sau PR #2331). Chưa dòng mã nào chạy theo spec này; mọi hợp đồng kỹ thuật là đề xuất đã kiểm trên giấy (BAN-GIAO mục 7). Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6. Spec này không có migration.

## Tóm tắt (tiếng Việt)

GOI-10 mục (g). Bảng mục, lớp PR và rủi ro của cả gói:

| Mục | Mã spec đề xuất | Lớp PR | `risk` trong spec | Lý do |
| --- | --- | --- | --- | --- |
| (a) chính sách test + ảnh chụp mốc | `TESTPOLICY-NNNN` | feature | medium | thêm job CI và quy ước mới |
| (b) gỡ JS cũ theo đợt | `LEGACYJS-NNNN` | feature | high → PR `high-risk` | xoá file đang được phục vụ công khai `/js/*` |
| (c) tách module backend | `BACKENDSPLIT-NNNN` | high-risk | high | `routers/listening.py` chứa chấm bài, lưu kết quả, kết thúc bài thi (00 §4.7, không hạ cấp) |
| (d) gộp route group admin | `ADMINGROUP-NNNN` | feature | medium | đổi cấu trúc `frontend/app`, có rủi ro cascade CSS |
| (e) media ra khỏi git | `MEDIAOUT-NNNN` | high-risk | high | bài giao của học viên phụ thuộc URL media bất biến |
| (f) rà spec `implementing` | không spec mới | small | — | chỉ cập nhật `IMPLEMENTATION_STATUS.md`/status có bằng chứng |
| (g) số migration không va chạm | `MIGNUM-NNNN` | high-risk | high | quy trình migration |

- **Mục tiêu.** Làm repo dễ sửa song song cho người thực thi trong đợt thương mại hoá: (a) có chính sách test mới và một bộ ảnh chụp giao diện làm mốc để G03/G07/G09 đổi giao diện mà biết mình làm vỡ gì; (b) gỡ khoảng 39.000 dòng JS cũ không trang Next nào nạp, theo đợt nhóm trang; (c) tách ba module backend lớn nhất (`routers/listening.py` 9.558 dòng, `routers/admin.py` 6.273, `services/quiz_service.py` 7.373) mà không đổi import, route hay mục tiêu monkeypatch của test; (d) gộp 39 route group admin thành một; (e) đưa 2.975 file mp3 ra khỏi cây làm việc mà giữ nguyên URL; (f) rà 30 spec đang `implementing`; (g) quy tắc cấp số migration không va chạm. Người dùng cuối không thấy thay đổi nào; nếu thấy là lỗi.
- **Phụ thuộc.** G01 phải merge trước: G01-T01 (chỉ mục docs), G01-T02 (sổ spec, dùng cho mục f), G01-T06 (`backend/migrations/register.tsv`, dùng cho mục g). Mục (a) đi trước (b), (d) và đi trước các PR giao diện lớn của G03/G07/G09. Chi tiết "mục nào mở đường cho gói nào" ở mục 6.0.

## Problem

Hiện trạng repo mà gói đã đọc (staging @ 93c7085), các dòng liên quan mục (g):

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
| --- | --- | --- |
| Migration | `backend/scripts/apply_migrations.sh:104` `for f in $(ls "$MIG_DIR"/*.sql | sort)` (sắp **từ điển**); `backend/tests/test_client_write_invariant_postgres.py:86` và `test_cohort_response_model.py:129` glob `[0-9][0-9][0-9]_*.sql` | Tên 4 chữ số (`1000_x.sql`) hoặc dấu thời gian (`20261120_x.sql`) sẽ sắp **trước** `380_…` và bị hai glob bỏ sót. `validate_specs.py` `HIGH_RISK_PATH_RE` ép PR chạm `backend/migrations/*.sql` thành `high-risk`. |

## Scope

- Mục (g) của GOI-10: các FR dưới đây và nhiệm vụ G10-T23.

## Non-goals

- Gõ kiểu cho `frontend/lib/*.mjs` (báo cáo 01 mục 2.5) và tách `next-native-browser.yml` (2.8) — chưa có trong yêu cầu; đề xuất làm gói sau nếu anh Andy muốn.
- Gộp route group phía học viên (CSS học viên có luật toàn cục, ví dụ `home.css` theo chú thích `authed-shell.tsx:10-13`) — G07 tự quyết khi đổi 16 đường dẫn.
- Viết lại lịch sử Git, LFS, đổi URL media, đổi số migration cũ, đổi tên thư mục spec, đổi tên job CI bắt buộc.
- Thiết kế lại giao diện admin (G09), nền giao diện mới `components/ui/` và token `--av2-` (G03).
- Các mục khác của GOI-10 có spec riêng. Không sửa file `.sql`, `apply_migrations.sh`, `forward-policy.tsv`.

## Users and journeys

- Người thực thi các gói đợt thương mại hoá: lấy số migration không va chạm với phiên khác.
- Anh Andy (người vận hành repo duy nhất): duyệt dải số và số cấp thêm.

## Requirements

Đánh số theo gói (FR-10g-NNN → FR-NNN).

- **FR-001:** `register.tsv` (G01-T06) có hàng `block` cấp dải số cho từng gói; người thực thi chỉ lấy số trong dải của gói mình.
- **FR-002:** `test_migration_register.py` thất bại khi file/hàng giữ chỗ nằm ngoài mọi dải, hoặc nằm trong dải của gói khác mà owner không khớp tiền tố.
- **FR-003:** Quy tắc phụ thuộc: một migration chỉ được phụ thuộc migration số nhỏ hơn; cần phụ thuộc số lớn hơn thì lấy số mới trong dải cao hơn.
- **FR-004:** Có ngưỡng cảnh báo khi số cao nhất vượt 900 (trước giới hạn 3 chữ số).

## Acceptance scenarios

### Scenario 1 — số nằm trong dải của gói khác

- **Given** G06 có dải 400–419
- **When** phiên làm G09 thêm `405_x.sql`
- **Then** `test_migration_register.py` thất bại với thông báo "405 belongs to block G06" (FR-002)

### Scenario 2 — gói số lớn merge trước

- **Given** G07 merge `420_a.sql` trước khi G06 merge `401_b.sql`
- **When** CI dựng DB mới từ đầu (PG17 parity)
- **Then** 401 chạy trước 420; `401_b` không được phụ thuộc đối tượng do `420_a` tạo (FR-003); nếu cần, G06 lấy số > 420

### Scenario 3 — hai gói cùng thêm migration (gói mục 9, E2E-7)

- **Given** dải số trong `register.tsv`
- **When** hai phiên thực thi khác gói cùng thêm migration
- **Then** không trùng số và test register xanh

## Edge cases

- Số cao nhất ≥ 900: test in cảnh báo (FR-004); chuyển sang 4 chữ số là spec riêng khi số chạm 900.
- Hàng `block` chồng nhau: test thất bại, nêu hai gói chồng.
- Số giữ chỗ cũ (370–375, 371 thuộc FREETRIAL-0047) nằm ngoài mọi dải mới: không thuộc gói nào, test không báo sai.
- Số migration có hậu tố (`019b`, `022b`, `161b`) và `032_rollback.sql`: đã khai riêng trong sổ của G01-T06; dải chỉ xét phần số.

## Success criteria

- Không có hai migration cùng số giữa các gói đợt thương mại hoá; test register bắt được số ngoài dải trước khi merge.

## Related specifications

- G01-T06 (sổ `backend/migrations/register.tsv` và `test_migration_register.py`): spec này chỉ thêm hàng `block` và kiểm dải; phải merge sau G01-T06.
- Mọi spec có migration của đợt thương mại hoá lấy số trong dải: COURSEACCESS-0055 (381–389), PUBLICSITE/ENROLL (390–399), LIBRARY-0061 (400–419), G07 (420–439), ADMINIA-0074 và 0085–0087 (440–459), G08 (460–469), NOTIFY/TRIALCAP/COURSETESTRELEASE (470–479), GOI-12 (480–489), GOI-13 (490–499), dự phòng từ 500 (ACCOUNTDATA-0100 dùng 500).
- FREETRIAL-0047: số 371 đã cấp, nằm ngoài mọi dải mới.

## Open questions

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm |
| --- | --- | --- | --- |
| Q-g1 | Dải số migration theo gói như 5.4? | **ĐÃ TRẢ LỜI (00 mục 2 điểm 22):** dải theo bảng 01 mục 6 | Làm T23 |
