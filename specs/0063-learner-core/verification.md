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
| FR-078 | kind=test; ref=planned pytest GET writes nothing, POST seen forward-only in (seen_until, seen_key) tuple order and own-row only; 3 results at one returned_at show 2, then 1, then 0 (T13); React seen call only after render (T14) | PENDING |
| FR-030 | kind=test; ref=planned React course-hub three tabs, n=0 without count, class tab hidden without class or when /course/class not live (T15) | PENDING |
| FR-031 | kind=test; ref=planned pytest student_course online order and other_products excluding owned slugs; React days_left, credits_left null hides line, commerce flag off hides buy links (T15) | PENDING |
| FR-032 | kind=test; ref=planned pytest archived class excluded and repractice [] before G04; React no class shows empty copy and /activate only when live (T15) | PENDING |
| FR-033 | kind=test; ref=planned React only-online collapses class group with aria-expanded, group never removed (T15) | PENDING |
| FR-034 | kind=test; ref=planned React lessons 404 or missing API shows "Bài học của khoá sẽ mở dần", 500 errors only the lesson block, no locked state, ?course= fallback (T15) | PENDING |
| FR-035 | kind=test; ref=planned React class-only router.replace to assigned tab target before rendering groups; degraded part does not redirect (T15) | PENDING |
| FR-036 | kind=test; ref=planned React exact grading-flow notes under each group (T15) | PENDING |
| FR-037 | kind=test; ref=planned React expired course label and renew button only with can_renew and labels module (T15) | PENDING |
| FR-079 | kind=test; ref=planned React practice-hub four cards in order via liveHref, resume error only on the resume block (T16) | PENDING |
| FR-080 | kind=test; ref=planned React tests-hub self-select rows per skill full and mini only, rows hidden when target not live, no four-skill self-select in any state (T16) | PENDING |
| FR-081 | kind=test; ref=planned React no assigned block when empty; self_paced line with total_minutes; partial skill set named; buttons per state (T16); pytest assigned_exams from list_open_exams and my_sittings (T16) | PENDING |
| FR-082 | kind=test; ref=planned pytest results order and stable cursor, band only for 40-question L/R, overall only for four-skill assigned mock via overall_readiness (T16); React empty Overall cell has screen-reader label (T16) | PENDING |
| FR-083 | kind=test; ref=planned React 390px replaces full-test and assigned entry buttons with PHONEGATE-0081 warning, mini test keeps its button (T16) | PENDING |
| FR-084 | kind=test; ref=planned React credits.total 1 marks Writing full "Không đủ lượt" with CreditsEmptyNotice, credits null marks nothing (T16) | PENDING |
| FR-085 | kind=test; ref=planned pytest response_model shapes, caller-only filters, degraded vs missing source for student_course and student_tests (T15, T16) | PENDING |
| FR-086 | kind=test; ref=planned React flag off: /tests renders T12a page unchanged, /course and /practice replace URL with no new API call (T15, T16); registry guard test after /course and /practice go live | PENDING |
| FR-060 | kind=test; ref=planned React account-page two groups, one shared credit total with by-source lines, history label_vi and balance_after, no skill column, carry line, no "50%" (T17) | PENDING |
| FR-061 | kind=test; ref=planned React progress one row per skill with FR-077 rule, goal edit via PATCH /auth/profile, profile_update off makes fields read-only (T17) | PENDING |
| FR-062 | kind=test; ref=planned node help-search-model accent and case insensitive; React six fixed groups, no contact block before G05-T23 (T17) | PENDING |
| FR-063 | kind=test; ref=planned React account and profile have no consent toggle and make no consent call (T17) | PENDING |
| FR-064 | kind=test; ref=planned React profile-v2 login-events outcomes, is_current label, no location column, hidden on enabled=false or 500 (T17) | PENDING |
| FR-065 | kind=test; ref=planned React start-page skip writes onboarding_completed then /home, class learner skips direction step; node login-model first sign-in target (T17) | PENDING |
| FR-066 | kind=test; ref=planned React start-page makes no request whose URL contains consent (T17) | PENDING |
| FR-087 | kind=test; ref=planned React content_visible_until line present or absent on /account and /progress; 410 content_expired copy (T17) | PENDING |
| FR-088 | kind=test; ref=planned React mocked ChangeEmail rendered when its flag is on and absent when off; /auth/me re-read after change (T17) | PENDING |
| FR-089 | kind=test; ref=planned React data and deletion blocks hidden until G04-T18 API exists (T17) | PENDING |
| FR-090 | kind=test; ref=planned nonce and robots tests for the four new prefixes; React /profile flag off renders old tree; login-model flag on /start, off /onboarding (T17) | PENDING |
| FR-091 | kind=test; ref=planned React auth-provider inactive_open on /home renders the page; staging scenario 16 (T26) | PENDING |
| FR-092 | kind=test; ref=planned React auth-provider inactive_open on /course renders NeedsCourseScreen and the page never mounts (T26) | PENDING |
| FR-093 | kind=test; ref=planned node activation-gate missing learner_v2_enabled gives inactive and /login; unknown stays open (T26) | PENDING |
| FR-094 | kind=test; ref=planned pytest activation gate inventory with exactly two new exemptions, today for inactive queries no work tables, other learner route still 403, check-active flag field in both DB branches (T26) | PENDING |
| FR-095 | kind=test; ref=planned React assigned-v2 flag on draws new tree with course tabs, flag off draws MyClassWorkspace (T30a) | PENDING |
| FR-096 | kind=test; ref=planned pytest student_assigned four groups; React group order, empty groups hidden, overdue banner count (T30a) | PENDING |
| FR-097 | kind=test; ref=planned React button per action and hrefs via my-class-model; Writing band only when returned (T30a) | PENDING |
| FR-098 | kind=test; ref=planned React skill and state filters with counts, clear filter, query keeps selection (T30a) | PENDING |
| FR-099 | kind=test; ref=planned React accepting=false shows "Không còn nhận bài" and only the self-practice button (T30a) | PENDING |
| FR-100 | kind=test; ref=planned pytest self-practice route 404, 409, 422, 422 for vocab/grammar/course and for papers not open to self practice (exam_only, non-public, mock-reserved), launch params without class_assignment_item_id, zero writes, completion leaves item state unchanged (T30b) | PENDING |
| FR-101 | kind=test; ref=planned pytest Speaking self-practice session goes through POST /sessions quota and charge_plan like any self practice (T30b) | PENDING |
| FR-102 | kind=test; ref=planned React repractice block hidden when empty, grading steps copy (T30a) | PENDING |
| FR-103 | kind=test; ref=planned pytest response_model shape, caller-only rows, degraded part, homework_stale passthrough, _visible_assignments unchanged (T30a) | PENDING |

## Kịch bản staging (gói 9.1 mục 1, 3, 3b, 3c, 8; 9.4)

Tài khoản QA và dữ liệu thử; không bật cờ cho học viên thật.

1. **Chỉ lớp.** Given QA có 2 bài quá hạn, 1 bài hạn ngày mai, cờ bật. When mở `/home`. Then "Hôm nay bạn có 3 việc", hai bài "Đã quá hạn" lên đầu, không thẻ "Bài tiếp theo", bài Writing mở đúng trình soạn.
2. **Tắt khẩn.** Given cờ bật cho QA. When tắt `runtime_flags('learner_v2')`, tải lại sau 15 giây. Then giao diện cũ.
3. **Một khối hỏng** (dữ liệu giả ở test React, không gây lỗi thật trên staging).
4. **Chưa có khoá / đơn chờ / hết lượt** (gói 3, 3b, 3c): chỉ chạy trên staging sau G07-T26 và G04 có dữ liệu thử; trước đó là test React với dữ liệu giả.
5. **Vừa có kết quả.** Given bài Writing thử của QA được trả. When mở `/home`, tải lại. Then lần đầu có khối, lần sau không.
6. **Bật cờ theo người.** Given admin. When bật rồi tắt cờ cho QA. Then `/auth/me` đổi đúng, tài khoản khác không đổi.

7. **Lộ trình** (bản sửa đổi 1). Given QA chỉ lớp, cờ bật. When mở `/course`. Then URL đổi sang trang bài được giao. Given QA chỉ online (khi G04 có dữ liệu thử). Then nhóm lớp thu gọn, dòng khoá có "còn X ngày"; ảnh 1280px và 390px.
8. **Thi thử** (bản sửa đổi 1). Given QA không được giao kỳ nào. When mở `/tests`. Then không có khối "Mock test được giao", không có đề bốn kỹ năng. Given QA được giao một kỳ thử trên staging (không thi trên production). Then dòng kỳ đúng trạng thái; ở 390px nút full test là dòng cảnh báo, mini test vẫn vào được.
9. **Tắt cờ ba trang mới** (bản sửa đổi 1). Given cờ tắt. When mở `/course`, `/practice`, `/tests`. Then về trang tạm như hôm nay, không có lời gọi API mới (xem tab mạng).

10. **Tài khoản và Hồ sơ** (bản sửa đổi 2). Given QA có lớp, cờ bật. When mở `/account`, `/profile`. Then đúng nhóm khoá, lượt một số chung; khối phiên đăng nhập hiện hoặc ẩn đúng theo G04-T16; ảnh 1280px và 390px.
11. **Lần đầu vào** (bản sửa đổi 2). Given tài khoản QA mới, cờ bật. When đăng nhập. Then tới `/start`, "Bỏ qua" về `/home`, lần sau không tới `/start`.
12. **Chưa kích hoạt** (bản sửa đổi 2, high-risk auth). Kịch bản 16 của spec trên staging, bằng tài khoản QA mới tạo; ghi SHA, giờ bật/tắt cờ; gọi một route học viên khác bằng token đó và ghi mã 403.

13. **Bài được giao** (bản sửa đổi 3). Kịch bản 17, 18 của spec trên staging với lớp thử; ảnh 1280px và 390px; ghi bảng nộp bài của giáo viên trước và sau khi tự luyện (không đổi).

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` sinh lại trong T05 và T13; CI typecheck `git diff --exit-code`.
- Backward compatibility: `/auth/me` thêm trường có default; frontend đọc mềm; `/api/student/home-summary` không đổi.

## Data evidence

- Migration/schema query: `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name IN ('today_seen_at','today_seen_key');` trên staging sau khi áp (chỉ đọc).
- Immediate state versus full reload: tải lại `/home` cho cùng khối, trừ "Vừa có kết quả" theo FR-025.

## UI evidence

- Viewports/themes/input methods: 1280px và 390px cho bốn `state`, ba `banner`, một khối lỗi; bàn phím tới được mọi nút; cờ tắt so ảnh trước/sau.

## Release evidence

- Staging SHA and checks: ghi SHA staging sau từng PR, CI tích hợp và Staging E2E đúng SHA.
- Production verification: sau promote với cờ tắt, `/home` của một tài khoản QA trên production giống trước (chỉ xem, không nộp bài).
