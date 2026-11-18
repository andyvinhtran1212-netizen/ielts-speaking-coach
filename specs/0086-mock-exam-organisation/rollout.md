# Rollout and rollback

## Preconditions

- Spec `approved` trên `staging`. Số migration 445, 446 (backfill), 447, 448 chưa bị file hay PR khác dùng (kiểm ngay trước khi viết); ghi số vào sổ số migration của repo (`backend/migrations/register.tsv` khi G01-T06 đã merge).
- G03 (khung, bảng, modal), G10 (`(authed-admin)`) và các gói ghi ở mục 1 "Phụ thuộc" đã merge trước nhiệm vụ cần chúng.

## Staging

- Áp migration 445, 446 (backfill), 447, 448 lên staging trước, dưới khoá advisory, test PG17 + postcondition; deploy backend rồi frontend; bật `ADMIN_FRAME_V2` chỉ trên staging; chạy các kịch bản của spec bằng tài khoản QA admin có TOTP. Thiếu tài khoản QA → PR ghi "chờ anh Andy kiểm tay trên staging".

## Production

- Chỉ qua PR `staging → main`; migration production cần anh Andy duyệt bằng lời, chạy dưới khoá advisory trước khi mã phụ thuộc lên. Cờ khung mới tắt ở production tới khi anh dùng thử trên staging ≥ 1 ngày làm việc (Q6).

## Rollback and repair

- Tắt cờ `ADMIN_FRAME_V2` → khung admin cũ (chuyển hướng 307 vẫn giữ trang cũ mở được). Deploy lại bản trước; migration chỉ thêm bảng/cột nên tương thích với mã cũ, không hạ migration.
- Backfill 446: chạy lại được (idempotent); sai thì sửa bằng migration mới, không sửa file cũ.

Ràng buộc của gói liên quan:

- Ngưỡng: không hằng số ngưỡng trong mã giao diện hay backend ngoài `services/ops_thresholds.py` (giá trị mặc định) và migration 440.

## Observability

Cờ cấu hình và nhật ký (gói 5.8):

- `ADMIN_FRAME_V2` (biến môi trường build frontend): `1` → khung mới. Bật ở preview/staging, tắt ở production tới khi anh Andy duyệt (Q6). Đường lui của T08.
- Runtime flag (qua `services/runtime_flags.py`, mặc định tắt): `mock_exam_audiences` (T31: tắt → `admin_live_monitor` đọc roster theo `cohort_id` như cũ), `assignment_result_v2` (T27/T28: tắt → trang lớp dùng ba tab cũ), `content_import_batches` (T36), `mock_partial_release` (T33: tắt → `release` từ chối `include_partial`).
- Cờ của gói khác mà G09 đọc: `mock_exam_audiences_learner` (G08-T22: cổng học viên đọc bảng người dự thi và áp quy tắc chạy liền các phần; tắt → `schedule` từ chối kỳ live nhiều nguồn, T31), `credit_metering` (G04: bật đo lượt ở đường chấm; nhãn "Chưa chuyển sang đo lượt" và thao tác T43 **không** phụ thuộc cờ này — chuyển lớp cũ làm được trước khi bật đo).
- Env: `CARE_NOTE_EDIT_HOURS` (mặc định 24, Q16), `REVIEW_SOFT_LOCK_MINUTES` (mặc định 30, Q19), `MOCK_SELF_PACED_GAP_SECONDS` (mặc định 0 = phần kế bắt đầu ngay; Q31).
- Sự kiện log backend (logger, không bảng mới): `admin_search` (độ dài q, số kết quả, không ghi q), `hidden_import_opened` (route, actor id), `incident_group_action`, `assignment_remind` (số người).
