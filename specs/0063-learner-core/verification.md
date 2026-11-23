# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang `draft`, chưa có dòng mã nào. Cột bằng chứng ghi bằng chứng **dự kiến**; khi mã merge, dòng đổi sang `PASS`/`MANUAL`/`N/A` theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-019 | kind=test; ref=planned backend pytest four state values in FR-019 order (T13) and React state cases (T14) | PENDING |
| FR-020 | kind=test; ref=planned React today-v2 heading N and N=0 copy (T14); pytest overdue/due-tomorrow counting in VN time and assigned_due_soon counted before the cap of 5 (T13) | PENDING |
| FR-021 | kind=test; ref=planned React next_lesson null hides card, present shows resume minute (T14) | PENDING |
| FR-022 | kind=test; ref=planned pytest assigned order and cap 5, later deadlines only in assigned_due_later (T13); React overdue first and exact-item href via my-class-model (T14) | PENDING |
| FR-023 | kind=test; ref=planned pytest expired resume dropped, cap 4 newest first, four mig-224 tables only (T13) | PENDING |
| FR-024 | kind=test; ref=planned React credits one total, two rows by_kind, legacy class code hides block, null hides block (T14) | PENDING |
| FR-025 | kind=test; ref=planned pytest new_results oldest-two-unseen, delivered-only Writing (T13); journey=staging scenario 5 | PENDING |
| FR-026 | kind=test; ref=planned pytest one part raises -> degraded; React one block broken, others render (T13, T14) | PENDING |
| FR-027 | kind=test; ref=planned React no_course state with fake data, trial line present/absent (T14) | PENDING |
| FR-028 | kind=test; ref=planned pytest needs_info carries supplement_by (T13); React order_pending card (T14) | PENDING |
| FR-029 | kind=test; ref=planned React three banner values, expiring hidden when renewal order open (T14) | PENDING |
| FR-070 | kind=test; ref=planned pytest weeks_left with and without exam_date (T13); React goal line without exam date (T14) | PENDING |
| FR-071 | kind=test; ref=planned pytest _repeat_error_for None / fake error / raises -> null and degraded unchanged (T13) | PENDING |
| FR-072 | kind=test; ref=planned pytest four flag combinations on both DB branches (T05); journey=staging scenario 2 | PENDING |
| FR-073 | kind=test; ref=frontend/tests/auth-wire-model.test.mjs planned case missing field -> false not null; tests/test_auth_response_models.py (T05) | PENDING |
| FR-074 | kind=test; ref=planned pytest admin 200, learner 403, read-back after write (T05); journey=staging scenario 6 | PENDING |
| FR-075 | kind=screenshot; ref=planned /home before/after with flag off on staging (T14) | PENDING |
| FR-076 | kind=test; ref=planned pytest response_model shape and own-user filters (T13); git diff --exit-code frontend/types/api.d.ts | PENDING |
| FR-077 | kind=test; ref=planned React no 0/0, no bare dash, hidden blocks when source null (T14) | PENDING |
| FR-078 | kind=test; ref=planned pytest GET writes nothing, POST seen forward-only and own-row only (T13); React seen call only after render (T14) | PENDING |

## Kịch bản staging (gói 9.1 mục 1, 3, 3b, 3c, 8; 9.4)

Tài khoản QA và dữ liệu thử; không bật cờ cho học viên thật.

1. **Chỉ lớp.** Given QA có 2 bài quá hạn, 1 bài hạn ngày mai, cờ bật. When mở `/home`. Then "Hôm nay bạn có 3 việc", hai bài "Đã quá hạn" lên đầu, không thẻ "Bài tiếp theo", bài Writing mở đúng trình soạn.
2. **Tắt khẩn.** Given cờ bật cho QA. When tắt `runtime_flags('learner_v2')`, tải lại sau 15 giây. Then giao diện cũ.
3. **Một khối hỏng** (dữ liệu giả ở test React, không gây lỗi thật trên staging).
4. **Chưa có khoá / đơn chờ / hết lượt** (gói 3, 3b, 3c): chỉ chạy trên staging sau G07-T26 và G04 có dữ liệu thử; trước đó là test React với dữ liệu giả.
5. **Vừa có kết quả.** Given bài Writing thử của QA được trả. When mở `/home`, tải lại. Then lần đầu có khối, lần sau không.
6. **Bật cờ theo người.** Given admin. When bật rồi tắt cờ cho QA. Then `/auth/me` đổi đúng, tài khoản khác không đổi.

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` sinh lại trong T05 và T13; CI typecheck `git diff --exit-code`.
- Backward compatibility: `/auth/me` thêm trường có default; frontend đọc mềm; `/api/student/home-summary` không đổi.

## Data evidence

- Migration/schema query: `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='today_seen_at';` trên staging sau khi áp (chỉ đọc).
- Immediate state versus full reload: tải lại `/home` cho cùng khối, trừ "Vừa có kết quả" theo FR-025.

## UI evidence

- Viewports/themes/input methods: 1280px và 390px cho bốn `state`, ba `banner`, một khối lỗi; bàn phím tới được mọi nút; cờ tắt so ảnh trước/sau.

## Release evidence

- Staging SHA and checks: ghi SHA staging sau từng PR, CI tích hợp và Staging E2E đúng SHA.
- Production verification: sau promote với cờ tắt, `/home` của một tài khoản QA trên production giống trước (chỉ xem, không nộp bài).
