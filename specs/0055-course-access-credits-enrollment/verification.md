# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** (test hoặc bước kiểm tay) theo nhiệm vụ sẽ làm; khi mã merge, dòng đổi
sang `PASS`/`MANUAL`/`N/A` theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=G04-T01 PG17 + G04-T03 API (T001, T003); E1, E3 | PENDING |
| FR-002 | kind=test; ref=G04-T01 PG17 + G04-T03 API (T001, T003); E1, E3 | PENDING |
| FR-003 | kind=test; ref=G04-T01 PG17 + G04-T03 API (T001, T003); E1, E3 | PENDING |
| FR-004 | kind=test; ref=G04-T01 PG17 + G04-T03 API (T001, T003); E1, E3 | PENDING |
| FR-005 | kind=test; ref=G04-T01 PG17 + G04-T03 API (T001, T003); E1, E3 | PENDING |
| FR-006 | kind=test; ref=G04-T06 activation tests (T006); E7, E8 | PENDING |
| FR-007 | kind=test; ref=G04-T06 activation tests (T006); E7, E8 | PENDING |
| FR-008 | kind=test; ref=G04-T06 activation tests (T006); E7, E8 | PENDING |
| FR-009 | kind=test; ref=G04-T06 activation tests (T006); E7, E8 | PENDING |
| FR-010 | kind=test; ref=G04-T06 activation tests (T006); E7, E8 | PENDING |
| FR-011 | kind=test; ref=G04-T02 PG17 RPC + concurrency (T002, T003); E4, E5, E5b | PENDING |
| FR-012 | kind=test; ref=G04-T02 PG17 RPC + concurrency (T002, T003); E4, E5, E5b | PENDING |
| FR-013 | kind=test; ref=G04-T02 PG17 RPC + concurrency (T002, T003); E4, E5, E5b | PENDING |
| FR-014 | kind=test; ref=G04-T02 PG17 RPC + concurrency (T002, T003); E4, E5, E5b | PENDING |
| FR-015 | kind=test; ref=G04-T02 PG17 RPC + concurrency (T002, T003); E4, E5, E5b | PENDING |
| FR-016 | kind=test; ref=G04-T02 PG17 RPC + concurrency (T002, T003); E4, E5, E5b | PENDING |
| FR-017 | kind=test; ref=G04-T02 PG17 RPC + concurrency (T002, T003); E4, E5, E5b | PENDING |
| FR-031 | kind=test; ref=G04-T12 credit lifecycle (T011); E14 | PENDING |
| FR-032 | kind=test; ref=G04-T12 (T011); E14, E14c | PENDING |
| FR-046 | kind=test; ref=G04-T12 carry validity (T011); E14b, E14c | PENDING |
| FR-033 | kind=test; ref=G04-T05/T12 grant-extra (T005, T011); E7c | PENDING |
| FR-047 | kind=test; ref=G04-T15 convert-class (T013); E21 | PENDING |
| FR-018 | kind=test; ref=G04-T07/T08 grading hooks (T007, T008); E4, E6, E7b | PENDING |
| FR-019 | kind=test; ref=G04-T07/T08 grading hooks (T007, T008); E4, E6, E7b | PENDING |
| FR-020 | kind=test; ref=G04-T07/T08 grading hooks (T007, T008); E4, E6, E7b | PENDING |
| FR-021 | kind=test; ref=G04-T07/T08 grading hooks (T007, T008); E4, E6, E7b | PENDING |
| FR-034 | kind=test; ref=G04-T07 Speaking instant (T007); E7b | PENDING |
| FR-035 | kind=test; ref=G04-T13 Azure sample window, Azure giả (T012); E15 | PENDING |
| FR-036 | kind=test; ref=G04-T13 (T012); E15 | PENDING |
| FR-022 | kind=test; ref=G04-T04 order API + sweep (T004); E1, E2, E3, E9 | PENDING |
| FR-023 | kind=test; ref=G04-T04 order API + sweep (T004); E1, E2, E3, E9 | PENDING |
| FR-024 | kind=test; ref=G04-T04 order API + sweep (T004); E1, E2, E3, E9 | PENDING |
| FR-025 | kind=test; ref=G04-T04 order API + sweep (T004); E1, E2, E3, E9 | PENDING |
| FR-026 | kind=test; ref=G04-T04 order API + sweep (T004); E1, E2, E3, E9 | PENDING |
| FR-027 | kind=test; ref=G04-T04 order API + sweep (T004); E1, E2, E3, E9 | PENDING |
| FR-037 | kind=test; ref=G04-T04 needs_info outbox (T004); E2 | PENDING |
| FR-038 | kind=test; ref=G04-T04 reopen expired (T004); E9b | PENDING |
| FR-039 | kind=test; ref=G04-T04 sweep reminder (T004); E9c | PENDING |
| FR-050 | kind=test; ref=G04-T17 course_open_alert (T015); E20 | PENDING |
| FR-028 | kind=test; ref=G04-T09 single session (T009); E10, E10b, E19 | PENDING |
| FR-040 | kind=test; ref=G04-T09 timed claim refusal (T009); E10b | PENDING |
| FR-041 | kind=test; ref=G04-T09 revoke-all (T009); E10b | PENDING |
| FR-029 | kind=test; ref=G04-T10 retention (T010); E12 | PENDING |
| FR-048 | kind=test; ref=G04-T10 45-day content window (T010); E12b | PENDING |
| FR-049 | kind=test; ref=G04-T16 login events (T014); E19 | PENDING |
| FR-030 | kind=test; ref=test_client_write_invariant_postgres + live RLS (T001, T002, T016); E11 | PENDING |
| FR-042 | kind=test; ref=G04-T03 trial boundary (T003); E16 | PENDING |
| FR-043 | kind=test; ref=route inventory: no password route (T003–T005) | PENDING |
| FR-044 | kind=test; ref=G04-T07 Speaking cluster charge (T007); E17 | PENDING |
| FR-051 | kind=test; ref=G04-T03 feature short_writing_feedback charge (T003); route thuộc TOPICKNOW-0097 | PENDING |
| FR-052 | kind=test; ref=G04-T18 (ACCOUNTDATA-0100): yêu cầu xoá có hạn huỷ, đăng xuất mọi phiên, job ẩn danh/xoá theo danh sách bảng; tải bản sao dữ liệu | PENDING |
| FR-045 | rationale=ĐÃ BỎ theo quyết định 18/11/2026 (00 mục 2 điểm 22): không bảng, không API, không công tắc đồng ý dùng bản ghi âm | N/A |

## Contract evidence

- OpenAPI/type drift: mọi route mới ở plan 5.9 có schema request/response cụ thể; `frontend/types/api.d.ts` sinh lại ở PR có route.
- Backward compatibility: `/auth/activate` với mã không có `product_id` giữ nguyên hành vi, thông báo, mã lỗi (FR-008); khi `credit_metering` tắt, đường chấm không gọi RPC lượt (FR-018).

## Data and release evidence

- Migration/schema query: test PG17 cho 381–385, 387, 388; postcondition trong từng file; kiểm RLS live E11 trên staging.
- Staging SHA và production: ghi ở G04-T11 (T016). Production không bật cờ nào trong gói này.
