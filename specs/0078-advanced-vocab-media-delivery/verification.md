# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang `draft` và chưa có dòng mã nào. Cột bằng chứng ghi bằng chứng **dự kiến** theo task. Khi mã merge, dòng đổi sang `PASS`/`MANUAL`/`N/A` theo mẫu `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=command; ref=plan.md lệnh kiểm kê ở `5987bc018`: 3100 file, 391706682 byte, 1482 SHA-256 khác nhau, 1481 nhóm trùng; cây legacy = bản hiện hành (lệch 0, thiếu 0); đổi sang PASS khi người review chạy lại lệnh | PENDING |
| FR-002 | kind=query; ref=plan.md rà tham chiếu trong repo (đã làm) + ba truy vấn đếm staging/production (T001) | PENDING |
| FR-003 | kind=command; ref=curl Range 206 + so SHA-256: URL có checksum với bảng kê `5987bc018`, URL legacy với bản hiện hành theo manifest (T002, T004); Scenario 1, 2 | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_advanced_vocab_package_validator.py ca sync khi cờ bật: D ghi `versions/` + legacy đồng bộ trước T005, không tạo legacy sau T005; A/B không ghi public (T003, T005); Scenario 4 | PENDING |
| FR-005 | kind=manual; ref=phát hành checksum mới khi cờ bật rồi tắt cờ trên staging, Scenario 6 (T004); `--restore-legacy` trên nhánh preview, Scenario 7 (T005) | PENDING |
| FR-006 | kind=command; ref=routes-manifest.json khi cờ tắt so với `5987bc018` (T002); Scenario 3 | PENDING |
| FR-007 | kind=test; ref=test bảng rewrite khớp manifest (D) hoặc test script tải lên từ chối SHA lệch (A/B) (T002/T006); Scenario 5 | PENDING |
| FR-008 | kind=test; ref=frontend/tests CSP hiện có không đổi; diff `content-security-policy.mjs` rỗng (T002–T006) | PENDING |
| FR-009 | kind=test; ref=test_advanced_vocab_service.py::test_core30_assets_exist_for_every_card_and_core_media và advanced-vocabulary-next-behavior.test.mjs chạy qua trước và sau T005 | PENDING |
