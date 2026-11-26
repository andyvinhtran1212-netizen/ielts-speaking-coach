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
| FR-037 | kind=test; ref=planned React expired course label and renew button only with can_renew and labels module; 403 course_access_expired from 0064 lessons renders no lesson list and no load-error banner (T15) | PENDING |
| FR-079 | kind=test; ref=planned React practice-hub four cards in order via liveHref, resume error only on the resume block (T16) | PENDING |
| FR-080 | kind=test; ref=planned React tests-hub self-select rows per skill full and mini only, rows hidden when target not live, no four-skill self-select in any state (T16) | PENDING |
| FR-081 | kind=test; ref=planned React no assigned block when empty; self_paced line with total_minutes; partial skill set named; buttons per state (T16); pytest assigned_exams from list_open_exams and my_sittings (T16) | PENDING |
| FR-082 | kind=test; ref=planned pytest results order and stable cursor, band only for 40-question L/R, overall only for four-skill assigned mock via overall_readiness (T16); pytest mock sitting with four bands but status not released returns no band/overall/pending_skills in JSON, then released returns them (T16); React empty Overall cell has screen-reader label (T16) | PENDING |
| FR-083 | kind=test; ref=planned React 390px replaces full-test and assigned entry buttons with PHONEGATE-0081 warning, mini test keeps its button (T16) | PENDING |
| FR-084 | kind=test; ref=planned React credits.total 1 marks Writing full "Không đủ lượt" with CreditsEmptyNotice, credits null marks nothing (T16) | PENDING |
| FR-085 | kind=test; ref=planned pytest response_model shapes, caller-only filters, degraded vs missing source for student_course and student_tests (T15, T16) | PENDING |
| FR-086 | kind=test; ref=planned React flag off: /tests renders T12a page unchanged, /course and /practice replace URL with no new API call (T15, T16); registry guard test after /course and /practice go live | PENDING |

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
