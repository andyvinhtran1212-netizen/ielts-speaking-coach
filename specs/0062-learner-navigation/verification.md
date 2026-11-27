# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang `draft`, chưa có dòng mã nào. Cột bằng chứng ghi bằng chứng **dự kiến** theo nhiệm vụ sẽ làm; khi mã merge, dòng đổi sang `PASS`/`MANUAL`/`N/A` theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=planned G03 learner-shell tests with G07 registry rows (T06–T15u); journey=staging scenario 3 | PENDING |
| FR-002 | kind=test; ref=planned route-registry sectionFor cases per moved page (T06–T23); journey=staging scenario 3 | PENDING |
| FR-003 | kind=test; ref=planned React account-menu cases admin (2 switches), instructor (1), learner (0), expired session (0) in T03s; ACCOUNT_LINKS order unchanged | PENDING |
| FR-004 | kind=screenshot; ref=planned 390/820/1280px captures of one moved page per đợt | PENDING |
| FR-005 | kind=test; ref=planned route-registry check that result/review rows are kind=child and only timed/recording rows are focus (T10, T11, T12b) | PENDING |
| FR-006 | kind=test; ref=planned breadcrumb parent cases incl. from=my-class and from=mock-result (T08, T11) | PENDING |
| FR-007 | kind=check; ref=planned grep for "← Back|Quay lại|Trở về|workspace" on pages touched per đợt, listed in PR | PENDING |
| FR-010 | kind=test; ref=planned frontend/tests/learner-route-moves.test.mjs MOVES table; command=curl -sI on next start per row | PENDING |
| FR-011 | kind=test; ref=frontend/tests/legacy-url-redirects.test.mjs with updated EXACT_REPLACEMENTS and hash per đợt | PENDING |
| FR-012 | kind=test; ref=planned my-class-model two-form link tests (T08, T09); backend tests/test_assigned_grammar_lessons.py | PENDING |
| FR-013 | kind=journey; ref=planned staging scenario 2 signed out; route-auth-guard-inventory PUBLIC_BY_DESIGN entry | PENDING |
| FR-014 | kind=test; ref=planned exam-language-bridge case for /tests/mock/session and /mock-exam (T12b) | PENDING |
| FR-015 | kind=test; ref=planned learner-route-moves permanent===false; T24 flips the assertion | PENDING |
| FR-016 | kind=test; ref=planned query-preservation cases in learner-route-moves and my-class-model | PENDING |
| FR-017 | kind=journey; ref=planned staging scenario 5 with QA mock exam across a preview deploy (T12b) | PENDING |
| FR-018 | kind=command; ref=node frontend/tooling/route-ownership-check.mjs and --manifest after build print clean | PENDING |

## Kịch bản staging (gói 9.1 mục 4 và 7, 9.4)

Tài khoản QA và dữ liệu thử; không dùng tài khoản hay kỳ thi của học viên thật.

1. **Link cũ.** Given bookmark `/my-class`, `/full-test`, `/mock/result?sitting=<id thử>`, `/pages/my-class.html`. When mở. Then một bước 307 tới trang mới, đủ query, trang mở đúng. (Chạy dần theo đợt; dòng nào chưa tới đợt thì ghi `chưa tới đợt`.)
2. **Thẻ từ chia sẻ.** Given chưa đăng nhập, `/flashcard-study?stack=wiki:food`. When mở. Then `/vocabulary/flashcards/study?stack=wiki:food`, thấy bộ thẻ.
3. **Mục đang ở.** Given học viên QA. When mở `/tests/mock/result?sitting=…`, `/profile`, `/course/exercises?bank=…`. Then sáng Thi thử, không mục nào, Lộ trình; breadcrumb đúng trang cha.
4. **Bài giao khi backend chưa đổi.** Given bài Grammar giao cho QA, backend trả link cũ. When mở từ trang bài được giao. Then `/course/grammar-lesson?assignment_item=…`, lưu được một câu.
5. **Phòng thi khi triển khai.** Given QA đang làm kỳ thi thử QA. When triển khai preview đợt 7b, chuyển sang Speaking và quay lại. Then không mất câu trả lời, nhãn tiếng Anh, URL `/tests/mock/session?…`; mở URL cũ có `sitting=` tới đúng lượt.
6. **Thi thử không giao.** Given QA không được giao kỳ nào. When mở `/tests` (sau đợt 7a). Then trang chọn kỳ thi hiện có mở đúng; `/exam` → `/tests`.

Ca biên phải có test (gói 9.4, phần thuộc spec này): URL cũ kèm query và `#hash`; `/grammar-checkup/review` trần và `/course/grammar-checkup/review` trần.

## Contract evidence

- OpenAPI/type drift: không đổi API; `frontend/types/api.d.ts` không đổi (kiểm `git diff --exit-code` ở CI typecheck).
- Backward compatibility: mọi URL cũ còn mở qua 307; link backend dạng cũ còn mở trong khoảng frontend lên trước backend (FR-016).

## Data evidence

- Migration/schema query: N/A — spec không có migration.
- Immediate state versus full reload: tải lại trang đích sau chuyển hướng cho cùng nội dung (kịch bản 1, 4).

## UI evidence

- Viewports/themes/input methods: 390px, 820px, 1280px cho một trang dời mỗi đợt; phòng thi giữ nhãn tiếng Anh.

## Release evidence

- Staging SHA and checks: ghi SHA staging sau merge từng đợt, kết quả CI tích hợp và Staging E2E đúng SHA.
- Production verification: sau promote, `curl -sI https://www.averlearning.com/<đường cũ>` cho từng dòng của đợt, chỉ đọc (không đăng nhập, không nộp bài).
