# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** (test hoặc bước kiểm tay) theo nhiệm vụ sẽ làm; khi mã merge, dòng đổi
sang `PASS`/`MANUAL`/`N/A` theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-140 | kind=test; ref=planned in G09-T31, G09-T32, G09-T33, G09-T34; staging journey per gói mục 9 | PENDING |
| FR-141 | kind=test; ref=planned in G09-T31, G09-T32, G09-T33, G09-T34; staging journey per gói mục 9 | PENDING |
| FR-142 | kind=test; ref=planned in G09-T31, G09-T32, G09-T33, G09-T34; staging journey per gói mục 9 | PENDING |
| FR-143 | kind=test; ref=planned in G09-T31, G09-T32, G09-T33, G09-T34; staging journey per gói mục 9 | PENDING |
| FR-144 | kind=test; ref=planned in G09-T31, G09-T32, G09-T33, G09-T34; staging journey per gói mục 9 | PENDING |
| FR-145 | kind=test; ref=planned in G09-T31, G09-T32, G09-T33, G09-T34; staging journey per gói mục 9 | PENDING |
| FR-146 | kind=test; ref=planned in G09-T31, G09-T32, G09-T33, G09-T34; staging journey per gói mục 9 | PENDING |
| FR-151 | kind=test; ref=planned in G09-T31, G09-T32, G09-T33, G09-T34; staging journey per gói mục 9 | PENDING |
| FR-147 | kind=test; ref=planned in G09-T31, G09-T32, G09-T33, G09-T34; staging journey per gói mục 9 | PENDING |
| FR-148 | kind=test; ref=planned in G09-T31, G09-T32, G09-T33, G09-T34; staging journey per gói mục 9 | PENDING |
| FR-149 | kind=test; ref=planned in G09-T31, G09-T32, G09-T33, G09-T34; staging journey per gói mục 9 | PENDING |
| FR-150 | kind=test; ref=planned in G09-T31, G09-T32, G09-T33, G09-T34; staging journey per gói mục 9 | PENDING |

## Release evidence

- Gói chỉ báo "xong" khi mọi kịch bản có bằng chứng trên `staging` đã merge. Production: khung mới tắt cờ tới khi anh Andy dùng thử trên staging (Q6).
