# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** (test hoặc bước kiểm tay) theo nhiệm vụ sẽ làm; khi mã merge, dòng đổi
sang `PASS`/`MANUAL`/`N/A` theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-110 | kind=test; ref=planned in G11-T30; scenarios G1* (gói mục 9) | PENDING |
| FR-111 | kind=test; ref=planned in G11-T30, G11-T31; scenarios G1* (gói mục 9) | PENDING |
| FR-112 | kind=test; ref=planned in G11-T31; scenarios G1* (gói mục 9) | PENDING |
