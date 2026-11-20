# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** (test hoặc bước kiểm tay) theo nhiệm vụ sẽ làm; khi mã merge, dòng đổi
sang `PASS`/`MANUAL`/`N/A` theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-160 | kind=test; ref=planned in G09-T36, G09-T37; staging journey per gói mục 9 | PENDING |
| FR-161 | kind=test; ref=planned in G09-T36, G09-T37; staging journey per gói mục 9 | PENDING |
| FR-162 | kind=test; ref=planned in G09-T36, G09-T37; staging journey per gói mục 9 | PENDING |
| FR-163 | kind=test; ref=planned in G09-T36, G09-T37; staging journey per gói mục 9 | PENDING |

## Release evidence

- Gói chỉ báo "xong" khi mọi kịch bản có bằng chứng trên `staging` đã merge. Production: khung mới tắt cờ tới khi anh Andy dùng thử trên staging (Q6).
