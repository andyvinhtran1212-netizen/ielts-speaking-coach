# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** (test hoặc bước kiểm tay) theo nhiệm vụ sẽ làm; khi mã merge, dòng đổi
sang `PASS`/`MANUAL`/`N/A` theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-120 | kind=test; ref=planned in G09-T25, G09-T26, G09-T27, G09-T28, G09-T30; staging journey per gói mục 9 | PENDING |
| FR-121 | kind=test; ref=planned in G09-T25, G09-T26, G09-T27, G09-T28, G09-T30; staging journey per gói mục 9 | PENDING |
| FR-122 | kind=test; ref=planned in G09-T25, G09-T26, G09-T27, G09-T28, G09-T30; staging journey per gói mục 9 | PENDING |
| FR-123 | kind=test; ref=planned in G09-T25, G09-T26, G09-T27, G09-T28, G09-T30; staging journey per gói mục 9 | PENDING |
| FR-124 | kind=test; ref=planned in G09-T25, G09-T26, G09-T27, G09-T28, G09-T30; staging journey per gói mục 9 | PENDING |
| FR-125 | kind=test; ref=planned in G09-T25, G09-T26, G09-T27, G09-T28, G09-T30; staging journey per gói mục 9 | PENDING |
| FR-126 | kind=test; ref=planned in G09-T25, G09-T26, G09-T27, G09-T28, G09-T30; staging journey per gói mục 9 | PENDING |
| FR-127 | kind=test; ref=planned in G09-T25, G09-T26, G09-T27, G09-T28, G09-T30; staging journey per gói mục 9 | PENDING |
| FR-128 | kind=test; ref=planned in G09-T25, G09-T26, G09-T27, G09-T28, G09-T30; staging journey per gói mục 9 | PENDING |
| FR-129 | kind=test; ref=planned in G09-T25, G09-T26, G09-T27, G09-T28, G09-T30; staging journey per gói mục 9 | PENDING |
| FR-130 | kind=test; ref=planned in G09-T25, G09-T26, G09-T27, G09-T28, G09-T30; staging journey per gói mục 9 | PENDING |
| FR-131 | kind=test; ref=planned in G09-T25, G09-T26, G09-T27, G09-T28, G09-T30; staging journey per gói mục 9 | PENDING |

## Release evidence

- Gói chỉ báo "xong" khi mọi kịch bản có bằng chứng trên `staging` đã merge. Production: khung mới tắt cờ tới khi anh Andy dùng thử trên staging (Q6).
