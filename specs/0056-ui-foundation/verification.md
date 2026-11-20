# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** (test hoặc bước kiểm tay) theo nhiệm vụ sẽ làm; khi mã merge, dòng đổi
sang `PASS`/`MANUAL`/`N/A` theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=G03-T02 token contract test + contrast calc (T002) | PENDING |
| FR-002 | kind=test; ref=G03-T12 head diff on v2 page (T012); scenario 1 | PENDING |
| FR-003 | kind=test; ref=G03-T12 head diff on legacy pages, authed-shell.test.mjs (T012) | PENDING |
| FR-004 | kind=screenshot; ref=/ui-library font specimen 13–96px (T002, T004) | PENDING |
| FR-005 | kind=test; ref=frontend/tests/react/ui/*.test.tsx per component (T005); scenario 7 | PENDING |
| FR-006 | kind=test; ref=no emoji / no lucide runtime check in components/ui (T005, G11-T32) | PENDING |
| FR-007 | kind=test; ref=LearnerShell react test + screenshots 1280/1024/390 (T014); scenario 3 | PENDING |
| FR-008 | kind=test; ref=account menu react test (T014); scenario 4 | PENDING |
| FR-009 | kind=test; ref=FocusShell react test practice/exam (T015) | PENDING |
| FR-010 | kind=test; ref=StaffShell react test + EnvBadge (T016) | PENDING |
| FR-011 | kind=test; ref=PublicShell react test + legal pages journey (T013) | PENDING |
| FR-012 | kind=test; ref=frontend/tests/route-registry.test.mjs (T011); scenario 5 | PENDING |
| FR-013 | kind=test; ref=/ui-library 404 without diagnostic flag (T004); scenario 6 | PENDING |
| FR-014 | kind=check; ref=CI Next-native browser regression visual step (T004) | PENDING |
| FR-015 | kind=journey; ref=legacy→v2 full reload check (T012); scenario 2 | PENDING |
| FR-016 | kind=test; ref=LearnerShell with is_active=false account (T014) | PENDING |
| FR-017 | kind=test; ref=quick lookup keyboard test (T014) | PENDING |
| FR-018 | kind=screenshot; ref=StaffShell 1024px icon sidebar (T016) | PENDING |
| FR-019 | kind=test; ref=G03-T18 dark mode (T018), FR-03-D1 | PENDING |
| FR-020 | kind=test; ref=G03-T18 dark mode (T018), FR-03-D2 | PENDING |
| FR-021 | kind=test; ref=G03-T18 dark mode (T018), FR-03-D3 | PENDING |
| FR-022 | kind=test; ref=G03-T18 dark mode (T018), FR-03-D4 | PENDING |
| FR-023 | kind=test; ref=G03-T18 dark mode (T018), FR-03-D5 | PENDING |
| FR-024 | kind=test; ref=G03-T18 dark mode (T018), FR-03-D6 | PENDING |
| FR-025 | kind=test; ref=G03-T18 dark mode (T018), FR-03-D7 | PENDING |
| FR-026 | kind=test; ref=G03-T18 dark mode (T018), FR-03-D8 | PENDING |

## UI evidence

- Viewports/themes/input methods: 1280px và 390px (thêm 1024px cho khung admin), sáng và tối (T018), bàn phím và trình đọc màn hình; ảnh `/ui-library` đặt cạnh tờ thiết kế.

## Release evidence

- Staging: `/terms`, `/privacy`, `/contact`, `/about` dùng khung mới; `/home`, `/admin` không đổi; `/ui-library` 404.
