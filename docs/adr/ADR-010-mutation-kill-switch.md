# ADR-010 — Mutation kill switch: DB-backed runtime flags

**Status:** ACCEPTED 2026-07-13 (mechanism implemented; per-endpoint adoption happens with the mutation ledger at pilot time)
**Context:** FE migration master plan v3 — B37, mục 10; per-pilot mutation checklist (§Phase 2); ADR list mục 5.

## Quyết định

Kill switch cho mutation là **flag đọc per-request từ bảng `runtime_flags`** (migration 155) qua cache in-process TTL **15 giây** (`backend/services/runtime_flags.py`), flip bằng `PUT /admin/runtime-flags/{key}` (admin-gated). Worst-case thời gian hiệu lực = 1 cửa sổ TTL ≈ 15 s, **không cần redeploy/restart**.

Phương án bị loại — env flag + Railway restart: RTO cỡ phút, giết mọi request đang bay, và không flip được từng endpoint độc lập. Nó vẫn là **fallback layer** khi DB không đáng tin (mọi flag config.py hiện hữu giữ nguyên cơ chế cũ).

## Semantics đã chốt (được pin bằng test `test_runtime_flags.py`)

- Row không tồn tại → dùng `default` của call site (mặc định enabled). Absence được cache riêng (giá trị `None`), default resolve lúc đọc — hai call site khác default không nhiễm nhau.
- Lỗi lookup → trả `default`, **không cache** (không negative-cache lỗi), log warning. **Fail-open có chủ đích**: kill switch không được trở thành nguồn outage; nếu DB chết thì mutation được bảo vệ cũng đang chết.
- `set_flag` upsert + invalidate cache entry ngay trong process xử lý request admin.
- Adoption pattern cho mutation endpoint (dùng ở mutation pilot):
  `dependencies=[Depends(require_flag("writing_submit"))]` → 503 `{"code": "feature_disabled", "flag": ...}` khi tắt.

## Điều kiện dùng trong cutover sheet

Cutover sheet chỉ được ghi "kill switch: có" khi (1) endpoint đã gắn `require_flag`, (2) drill flip thật trên staging đo được thời gian command → 503, (3) tên flag ghi trong mutation ledger. Cache TTL 15 s là hằng số thiết kế — đổi phải sửa ADR này.

## Giới hạn biết trước

- Fail-open nghĩa là mất DB = mất kill switch; chấp nhận vì mutation cũng cần DB. Trường hợp cần fail-closed (security), dùng `default=False` tại call site.
- Flag là global per-key, không per-user/percent — canary theo user không thuộc phạm vi ADR này (xem ADR-007).
