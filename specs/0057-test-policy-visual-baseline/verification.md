# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** (test hoặc bước kiểm tay) theo nhiệm vụ sẽ làm; khi mã merge, dòng đổi
sang `PASS`/`MANUAL`/`N/A` theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=check; ref=AGENTS.md Testing section + backend/tests/README.md diff (G10-T02) | PENDING |
| FR-002 | kind=check; ref=.github/pull_request_template.md checkbox (G10-T02) | PENDING |
| FR-003 | kind=command; ref=npx playwright test -c playwright.visual.config.js (G10-T03) | PENDING |
| FR-004 | kind=command; ref=3 consecutive runs, 0 diff (G10-T03); scenario 1 | PENDING |
| FR-005 | kind=check; ref=.github/workflows/visual-baseline.yml run with diff artifact (G10-T03); scenario 2 | PENDING |
| FR-006 | kind=command; ref=docker playwright:v1.60.0-noble update command (G10-T03) | PENDING |
