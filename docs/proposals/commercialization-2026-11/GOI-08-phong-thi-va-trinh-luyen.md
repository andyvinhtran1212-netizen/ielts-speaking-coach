# GÓI 08 — Phòng thi chung và các trình luyện

**Khớp chéo ngày 18/11/2026:** mock test chỉ có khi được giao — phía học viên đọc danh sách người dự thi và chế độ `live` / `self_paced` của G09-T31 (T22 mới: chưa được giao thì không thấy kỳ thi; kỳ không đủ bốn kỹ năng; tự làm một lần, đã bắt đầu thì các phần chạy liền nhau — sửa chiều 18/11; phiếu có "Đang chấm" từng phần); chế độ thi không có tạm dừng bài nghe, luyện thì có; full test không có "Save and exit", thoát ra đồng hồ vẫn chạy; đề tự chọn có "Abandon test" và màn hết giờ với bài dở (T23 mới); full test dưới ngưỡng chỉ có màn chặn của GOI-11 phần D (mini test và luyện từng phần không chặn), phòng thi full test luôn sáng, màn ngoài bài thi có dòng phụ tiếng Việt; đăng nhập lại ngay trong phòng thi và không bị thiết bị khác chiếm phiên khi đang làm bài có giờ — G08 cấp nguồn "bài có giờ" cho `services/timed_work.py` của G04 (T24 mới); Writing tự luyện gọi `reserve_writing_credit` của G04, Speaking thi thử không trừ lượt (T25 mới); khối "Hết lượt chấm" dùng component của G07-T27; số spec 0066–0073 theo `01-KE-HOACH-TONG.md` mục 6. Ước lượng: 25 nhiệm vụ, 33–34 PR, khoảng 44 phiên.

**Cập nhật 18/11/2026 chiều (00 mục 2 điểm 23):** (1) Mock test `self_paced` ("làm trong khoảng thời gian"): KHÔNG nghỉ giữa các phần — đã bắt đầu thì các phần chạy liền nhau, máy chủ bấm giờ phần kế; bỏ "Continue later", "Start next section" và màn chọn phần (FR-08-043, mục 5 bảng nhãn, T22, kịch bản 15; mục 10 câu 13 đóng, các ca biên dùng chung GOI-09 Q31). (2) Full test Writing = 2 lượt: đã xác nhận (FR-08-044; câu 16 đóng). (3) Bài làm xem được tới 45 ngày sau khi khoá hết hạn (G04 `content_visible_until`): phiếu và xem lại bài trả 410 `content_expired` thì hiện màn "hết thời hạn xem" của G07, không coi là lỗi. (4) Người làm gói này là người thực thi (project Claude Code của repo). Số nhiệm vụ, PR, phiên không đổi (25 / 33–34 / khoảng 44).

## 1. Tóm tắt

- **Mục tiêu.** Học viên làm mọi bài thi (full test từng kỹ năng và mini test tự chọn; mock test được giáo viên/admin giao, thi live cùng giờ, hoặc tự làm trong khoảng thời gian được mở: bắt đầu lúc nào cũng được nhưng đã bắt đầu thì làm liền các phần) trong một khung phòng thi giống thi máy thật: thanh trên có lối thoát và "Time remaining" (full test không có "Save and exit": thoát ra đồng hồ vẫn chạy; đề tự chọn có "Abandon test"), hai cột kéo đổi tỉ lệ, dải 40 câu theo Passage/Part, cờ xem lại, tự lưu có chữ báo, một hộp hỏi lại khi nộp, xử lý mất mạng và phiên hết hạn không mất bài. Các trình luyện (Listening luyện, Writing bài giao, Speaking, Quick Check, flashcard) dùng chung các thành phần đó ở chế độ luyện, nhãn tiếng Việt. Không còn chỗ nào nộp ngay khi còn câu trống mà không hỏi, và không còn hộp thoại mặc định của trình duyệt.
- **Lớp thay đổi:** `high-risk` (kết thúc bài thi, lưu kết quả, hành vi nộp). Không được hạ cấp dù gói chỉ đổi giao diện. Chia thành 8 thư mục spec, mỗi spec một trình, chuyển từng trình một:

| Spec | Mã đề xuất | Thư mục đề xuất | Nội dung |
|---|---|---|---|
| S0 | `EXAMROOM-NNNN` | `NNNN-exam-room-shell` | Khung chung, bộ chuỗi Anh/Việt, cờ bật, hợp đồng nộp/tự lưu/mất mạng/phiên hết hạn/hai tab |
| S1 | `EXAMREAD-NNNN` | `NNNN-exam-room-reading` | Reading full test và mini test chuyển sang khung |
| S2 | `EXAMWRITE-NNNN` | `NNNN-exam-room-writing` | Trình soạn Writing bài giao (chế độ luyện) |
| S3 | `EXAMLISTENP-NNNN` | `NNNN-exam-room-listening-practice` | Trình luyện Listening (programme, 80 ngày) |
| S4 | `EXAMLISTENT-NNNN` | `NNNN-exam-room-listening-test` | Listening full test/mini test |
| S5 | `EXAMMOCK-NNNN` | `NNNN-exam-room-mock` | Phòng thi thử 4 kỹ năng, gồm Writing full test |
| S6 | `EXAMSPEAK-NNNN` | `NNNN-exam-room-speaking` | Trình luyện Speaking (micro, ghi âm, nộp) |
| S7 | `EXAMDRILL-NNNN` | `NNNN-exam-room-vocab-grammar` | Quick Check và flashcard |

  Số đã cấp ở `01-KE-HOACH-TONG.md` mục 6 (anh Andy là người duy nhất vận hành repo; bảng đó là sổ cấp số): S0 `EXAMROOM-0066`, S1 `EXAMREAD-0067`, S2 `EXAMWRITE-0068`, S3 `EXAMLISTENP-0069`, S4 `EXAMLISTENT-0070`, S5 `EXAMMOCK-0071`, S6 `EXAMSPEAK-0072`, S7 `EXAMDRILL-0073` — đọc `NNNN` trong bảng trên là các số này. Người thực thi kiểm `ls specs | sort | tail` và PR mở có chữ `specs/` trước khi dùng, rồi ghi vào sổ đăng ký trong repo. Hậu tố bốn số của `id` phải trùng số thư mục (`backend/scripts/validate_specs.py` kiểm). Dải migration của gói: 460–469.
- **Phụ thuộc:** G03 (component nền trong `frontend/components/ui/`, thanh tập trung, token `--av2-`) phải merge trước T03. G10 mục tách `backend/routers/listening.py` phải merge trước T13–T14 (Listening full test). G07 (phiếu kết quả) không chặn: sau khi nộp, gói này chuyển tới trang kết quả hiện có; khi G07 xong thì đổi đích theo G07. G04 (bản 18/11): số dư lượt cho hộp nộp (FR-08-034); `essay_service.reserve_writing_credit` và `resolve_review_mode` cho Writing tự luyện (T25); mã lỗi 402 `insufficient_credits` kèm `credit_source`; cổng một phiên — 409 `session_not_current`, 401 `session_displaced` (T24); `services/timed_work.py` nhận nguồn "bài có giờ" của gói này (T24). G09-T31 (`mock_exam_audiences`, `exam_mode_v2`) trước T22. GOI-11 phần D (`ExamEntryGate`, màn chặn) — T03 gắn vào khung. G07-T27 (`CreditsEmptyNotice`).
- **Chạy song song được:** sau T05, các cặp spec+mã S1, S2, S3, S7 độc lập nhau (khác file). S4 chờ G10. S5 chờ S1 và S4 (Mock nhúng hai trình đó). S6 độc lập nhưng khó nhất, làm sau S2.
- **Ước lượng (giả định):** 26 nhiệm vụ, 38–39 PR (T20 hai PR, T21 bảy PR nhỏ, T22 hai PR, T26 năm PR — thêm tối 18/11), khoảng 49 phiên agent (bảng cuối mục 6; bản 16/11 là 21 nhiệm vụ / 28–29 PR / 36 phiên — tăng vì thêm T22–T25). Độ khó chung 4/5: phần lớn là giao diện, nhưng các trình hiện tại mỗi cái có vòng đời lưu/nộp riêng đã được vá nhiều lần (khoá renderer, hàng đợi lưu, nhúng Mock qua iframe, biên nhận nộp Writing), có nhiều test đọc chuỗi mã nguồn sẽ vỡ khi đổi cấu trúc, và T22, T25 chạm backend đang chạy thật. Giả định: G03 đã có Button, Dialog, Banner, Tabs; không phải chờ duyệt spec quá một lượt; mỗi vòng review không quá 3. Đây là ước lượng, không phải cam kết.

## 2. Hiện trạng trong repo (đã kiểm ở staging @ 93c7085)

### 2.1 Từng trình: file, hàm, API, lưu, nộp, nơi tính kết quả

| Trình | Route và file giao diện | API ghi (backend) | Tự lưu hiện nay | Nộp hiện nay | Tính kết quả |
|---|---|---|---|---|---|
| Reading full/mini test | `/reading/exam/session` · `frontend/app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx` (1.359 dòng, `ReadingExamSession`), logic `frontend/lib/reading-exam-controller.mjs`; layout `(authed-reading-player)/layout.tsx` (bodyClass `exam-chrome`, CSS `reading-exam*.css`) | `backend/routers/reading_student.py`: `POST /api/reading/test/{test_id}/attempts` (L1284), `POST /api/reading/test/attempts/{id}/renderer-affinity` (L1429), `PATCH .../answers` (L1967), `POST .../submit` (L1492, `submit_reading_test_attempt`); share: `POST /api/reading/test/share/{token}/attempts` (L1166) | `createReadingSaveCoordinator` lưu từng câu, flush khi `pagehide`/`visibilitychange`, thử lại khi `online` (L903–923); chỉ có chữ "Saving" từng câu (`SaveHint`), không có "Saved at" | Hộp nộp trong trang `submitOpen` (L1341) có đếm câu trống; tự nộp khi `readingRemainingSeconds` về 0 (L1095–1108); nút "Start new attempt" dùng `window.confirm` (L1247) | `services/reading_test_grader.py`; backend từ chối nộp quá `time_limit + 5 phút` |
| Writing bài giao | `/writing/dashboard?assignment_id=` · `(authed-writing)/writing/dashboard/writing-behavior.tsx` (2.164 dòng, DOM mệnh lệnh gắn vào id của `page-shell.tsx`) | `backend/routers/writing_student.py`: `POST .../{id}/renderer-affinity`, `POST .../start` (L2434), `PATCH .../draft` (L1683), `GET .../timer` (L2161), `POST .../paste-log` (L2554), `POST .../submit` (L1788) | `PATCH /draft` sau 3 giây ngừng gõ; chữ "Đang lưu…"; `WritingSubmitReceipt` (`public/js/writing-submit-receipt.js`) giữ biên nhận nộp | `submitFromModal` (L1245–1300): **hai `confirm()` mặc định** ("Bài viết chỉ có N từ…" khi dưới 100 từ, rồi "Sau khi nộp em không thể chỉnh sửa…"); hết giờ gọi `submitFromModal(ms, true)` bỏ qua hỏi | `services/grading_orchestrator.py` + `claude_grader.py`/`gemini_writing_grader.py` |
| Listening luyện (programme, 80 ngày) | `/listening/programmes/form/[testId]` · `(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner.tsx` (459 dòng, `ProgrammeFormRunner`); nhúng lại trong `(authed-listening)/listening/ielts/80-days/[day]/source-day.tsx` với `embedded` | `backend/routers/listening.py` (9.558 dòng): `POST /api/listening/tests/{id}/attempts?standalone=true` (L8016), `PATCH /api/listening/tests/attempts/{id}/answers` (L8455), `POST .../questions/{q}/reveal`, `POST .../playback-started` (L8317), `POST .../submit` (L8958) | `createProgrammeAnswerWriteQueue` + `createProgrammeSaveStatusTracker` (`lib/listening-programme-answer-queue.mjs`), chữ "Đã lưu" ở thanh đáy | `submit()` (L308–335): flush rồi **nộp ngay, không hỏi**, kể cả khi còn câu trống; lượt làm được tạo ngay khi mở trang (L142) | `services/listening_test_grader.py`, `services/listening_programme_feedback.py` |
| Listening full test/mini test | `/listening/test/session?id=` · `(authed-listening-player)/listening/test/session/listening-test-session.tsx` (1.001 dòng), `lib/listening-test-controller.mjs` | cùng nhóm `/api/listening/tests/...` như trên + `GET .../attempts/in-progress` (L7899), `POST .../renderer-affinity` (L8386) | `createListeningSaveCoordinator`; chặn nộp khi còn câu chưa lưu (`submitBlocked`, L714) | Hộp nộp trong trang (`submitOpen`, L452); không thấy nội dung trên staging (không có đề) | như trên |
| Mock 4 kỹ năng | `/mock-exam?code=` · `(authed-mock-exam)/mock-exam/mock-exam-runner.tsx` (1.225 dòng), `lib/mock-exam-model.mjs`; layout `chrome="none"` | `backend/routers/mock_exams.py`: `POST /api/mock-exams/{code}/sittings`, `.../sections/{s}/start` (L246), `.../sections/{s}/flush-ack` (L225), `.../writing` (L274), `.../sections/{s}/submit` (L287), `.../integrity` (L360), `.../speaking` (L379) | Reading/Listening chạy trong `<iframe>` với `mock_embed=1`; runner gửi `postMessage({type:'mock-flush'})`, trang con trả `mock-flushed` (Reading L1070–1093). Writing Mock có `WritingWorkspace` riêng (L269), lưu 5 s/15 s + bản sao `localStorage` | Hết giờ section thì tự thu; chữ trạng thái `ConnectionState` (L43, L99–101) đã tiếng Anh | `services/mock_exam_service.py`, `mock_review_workflow.py` |
| Speaking luyện | `/practice/session?session_id=` · `(authed-practice)/practice/session/*.tsx` (cầu nối) + **`frontend/public/js/practice.js` (6.036 dòng)** | `backend/routers/grading.py`: `POST /sessions/{id}/responses` (L474, từ chối 422 `AudioTooShortError` L729); `backend/routers/sessions.py`: `PATCH /sessions/{id}/complete` (L2108), `POST /sessions/{id}/renderer-affinity` (L1075) | Bản ghi giữ trong bộ nhớ trang, tải lên từng câu | `window.confirm` khi rời bài có bản ghi chưa gửi (`_canLeave`, L272) và khi nộp còn bản chưa gửi (L5264); chặn bản quá ngắn `MIN_RECORD_SEC = {1:15, 2:80, 3:25}` (L18, L5159) | AI chấm qua `grading.py` |
| Quick Check, flashcard | `/quiz?bank=` `(authed-quiz-player)`, `/flashcard-study` `(flashcard-study)` | `backend/routers/quiz.py` | — | Tự kết thúc khi "đã nắm" | `quiz.py` |

### 2.2 Hạ tầng dùng chung cần biết

| Thứ cần biết | File thật | Ghi chú |
|---|---|---|
| Chuyển trình theo đường dẫn (affinity) | `frontend/lib/core-player-affinity.mjs`, `frontend/app/core-player/launch/route.ts` | Mỗi bề mặt `speaking`, `reading_exam`, `listening_test`, `listening_dictation`, `writing_assignment` có `legacy.path` (`/pages/*.html`) và `next.path`; `admit_new` hiện là `next` cho cả năm. Lượt đã bắt đầu dính với đường dẫn của nó. `allowed_query` từ chối mọi tham số lạ (ném lỗi `unknown-core-player-query`). |
| Khoá renderer ở backend | `claimReadingAttemptRenderer` (`reading-exam-controller.mjs` L52), cột `renderer_affinity` chỉ nhận `legacy` hoặc `next` | Giao diện mới **phải** vẫn là renderer `next`; không thêm giá trị thứ ba (đó là đổi hợp đồng backend). |
| Trình cũ để quay lui | `frontend/pages/reading-exam.html`, `listening-test.html`, `practice.html`, `writing-dashboard.html`, `mock-exam.html` + `frontend/public/js/reading-exam.js` (3.441 dòng), `listening-test-player.js` (2.068), `mock-exam-runner.js` (1.003), `listening-*.js` | Là đường quay lui của affinity cho lượt cũ. Gói này không xoá và không sửa chúng. |
| Cầu nối Mock trong trang con | `frontend/public/js/mock-exam-hook.js` (nạp trong layout Reading/Listening), `window.MockHook.isSealedResponse`, `showSealedAndReturn` | Spec 0008 (MOCKATTACH) bắt buộc gắn sitting trước khi lượt dùng được. Không đổi thứ tự này. |
| 401 tự chuyển trang | `frontend/public/js/api.js` L261–267: 401 mà không có `opts.noRedirect` thì `window.location.href = '/login'` | Hiện tại phiên hết hạn giữa bài là bị đẩy sang `/login`, không quay lại được. |
| Hộp thoại có bẫy tiêu điểm | `frontend/lib/use-dialog-focus` (`useDialogFocus`) | Reading/Listening đang dùng; tái dùng. |
| Cờ trạng thái xem lại | `frontend/lib/use-attempt-review-flags.ts`, `components/attempt-review-flag-status.tsx` | Cờ đã lưu ở server cho Reading/Listening. Giữ nguyên. |
| Cấu hình chạy công khai | `frontend/tooling/generate-runtime-config.mjs` → `window.__AVER_RUNTIME_CONFIG__` (ví dụ `coreOperationCorrelationEnabled`) | Bản commit `frontend/public/js/runtime-config.js` là bản "chưa cấu hình"; phải trả về như cũ trước khi commit (`frontend/AGENTS.md`). |
| Cờ runtime phía server | bảng `runtime_flags`, `backend/services/runtime_flags.py` (cache 15 s), admin `backend/routers/admin_flags.py`; đã có tiền lệ đưa cờ cho học viên qua `GET /auth/me` (`backend/routers/auth.py` L247) | Dùng cho phương án B của cờ bật (mục 10, câu 1). |
| Kiểu OpenAPI | `frontend/types/api.d.ts`, job `typecheck.yml` sinh lại và `git diff --exit-code` | Đổi `response_model` backend mà không sinh lại kiểu thì CI đỏ. |

### 2.3 Hiện trạng so với tờ thiết kế

| Hạng mục (PhongThi, TrangLoi, ThanhPhan…) | Reading test | Listening test | Listening luyện | Writing | Speaking | Mock |
|---|---|---|---|---|---|---|
| Tay nắm 30–70% | có (bước phím 2%, không có bấm đúp, không lưu theo lượt) | không | không | — | — | Writing Mock có (`ReactPointerEvent`) — CHƯA KIỂM giới hạn |
| Dải số câu theo phần, thu gọn phần khác | có palette theo Part, chưa thu gọn | có | chip "Đường nghe" sai nghĩa | — | — | — |
| "Save and exit" | **không có lối thoát sau khi bắt đầu** | CHƯA KIỂM | link "← Bài học" | nút X im lặng | "Quay lại" + `confirm` | CHƯA KIỂM |
| In email trên thanh trên | **có** (L1205 `user?.email`) | có (theo báo cáo 09a) | — | — | — | — |
| Hộp hỏi khi nộp | trong trang | trong trang | **không có** | **2 `confirm()`** | **`confirm()`** | tự thu |
| "Saved at HH:MM" | không | không | "Đã lưu" | "Đang lưu…" | không | "Answers saved automatically" |
| Mất mạng | thử lại ngầm; nộp lỗi thì sang màn lỗi | thử lại audio | lỗi chung | CHƯA KIỂM | CHƯA KIỂM | có chữ tiếng Anh |

## 3. Phạm vi

**Trong phạm vi**
- Component khung phòng thi và các thành phần con dùng chung (thanh trên, tách hai cột, dải câu, ô câu, hộp nộp, hộp thoát, dải mất mạng, hộp phiên hết hạn, đồng hồ, trạng thái tự lưu, trình phát audio, công cụ Highlight/Note), bộ chuỗi tiếng Anh và tiếng Việt, cờ bật theo trình.
- Lắp khung vào 7 trình ở mục 2.1 sau cờ; trình cũ chạy song song tới khi nghiệm thu; quay lui bằng cờ.
- Giao diện 6 dạng câu khách quan và dạng riêng Listening/Reading theo tờ `BaiTapKhachQuan`, `BaiTapListening`, `BaiTapReading`; Writing theo `BaiTapWriting`; Speaking theo `BaiTapSpeaking`; Quick Check, flashcard theo `BaiTapTuVungNguPhap`.
- Thống nhất hành vi nộp: luôn hỏi lại trong trang khi còn câu trống hoặc khi nộp tốn lượt; không còn `window.confirm` trong 7 trình.
- Phía học viên của mock test được giao: cổng vào, phòng chờ, kỳ tự làm chạy liền các phần (không nghỉ giữa các phần), kỳ không đủ bốn kỹ năng, trạng thái "Đang chấm" từng phần (T22). Danh sách kỳ thi ở `/tests` là của G07-T16.
- "Abandon test" và màn hết giờ với bài dở của đề tự chọn (T23); đăng nhập lại trong phòng thi, xử lý 409 `session_not_current` (T24); Writing tự luyện giữ lượt, Speaking thi thử không trừ lượt (T25).
- Gắn cổng chặn điện thoại của GOI-11 phần D vào khung (`ExamEntryGate`); phòng thi full test luôn sáng.

**Ngoài phạm vi**
- Hợp đồng chấm, lưu kết quả, khoá renderer, thời gian giới hạn, ân hạn 5 phút, dữ liệu lượt làm ở backend: **không đổi** trong các nhiệm vụ T01–T21 (lý do: rủi ro mất điểm; mọi đổi backend phải có spec riêng). Ngoại lệ có chủ đích, mỗi cái nằm trong spec high-risk của nó: (1) cổng học viên của kỳ thi được giao đọc danh sách người dự thi (T22, spec S5); (2) bỏ bài và màn hết giờ của đề tự chọn (T23, spec S0/S1/S4/S6 tương ứng); (3) nguồn "bài có giờ" cho G04 (T24); (4) route Writing tự luyện giữ lượt (T25, spec S2); (5) một trường cờ chỉ-đọc nếu anh Andy chọn phương án B ở mục 10.
- Trang kết quả, trang xem lại, phiếu kết quả (G07). Đổi đường dẫn `/mock-exam`, `/full-test` sang `/tests/...` (G07). Hub `/practice`, `/tests` (G07).
- Tách `listening.py` (G10). Component nền, token, thanh điều hướng (G03). Lượt chấm AI, `credit_ledger` (G04).
- Xoá trình cũ trong `frontend/pages/*.html` và `frontend/public/js/*.js` (G10, sau khi nghiệm thu toàn bộ).
- Dictation (`/listening/dictation/session`), gist/MCQ/TF clip, sách bài tập Black Eye, Grammar Check-up, `/exam`: giữ nguyên trong gói này; ghi vào "Cần anh Andy quyết" câu 7.

## 4. Yêu cầu (FR đánh số)

Khi chép sang `spec.md` trong repo, đánh lại số thành `FR-001`… theo từng spec (validator chỉ nhận `FR-\d{3}`), và ghi bảng đối chiếu số gói ↔ số spec trong `verification.md`.

**Khung chung (S0)**
- **FR-08-001:** Một component `ExamRoomShell` dựng thanh trên gồm: lối thoát bên trái, tên bài ở giữa (ví dụ "Reading · Academic Test 1 · Passage 1 of 3"), trạng thái lưu và đồng hồ bên phải. Không in email, tên, mã học viên.
- **FR-08-002:** Chế độ `test` dùng nền mực (thanh trên theo tờ PhongThi) và toàn bộ chuỗi tiếng Anh, kể cả lỗi, `aria-label`, chữ cho trình đọc màn hình; số câu ghi "Q5"/"Question 5". Chế độ `practice` dùng nền giấy và chuỗi tiếng Việt, xưng "bạn". Nhãn công cụ Highlight, Note, Clear luôn tiếng Anh. Một màn không trộn hai bộ chuỗi. **Phòng thi full test luôn sáng** (00 mục 2 điểm 17): vùng phòng thi đặt `data-theme="light"` bất kể lựa chọn Sáng · Tối · Theo thiết bị của người dùng; mini test và chế độ luyện theo lựa chọn của người dùng. Ngoại lệ ngôn ngữ duy nhất: màn **ngoài** bài thi của full test (chặn điện thoại, lỗi thiết bị) có thêm một dòng phụ tiếng Việt `lang="vi"` (00 mục 2 điểm 22; GOI-11 FR-11-056).
- **FR-08-003:** Tay nắm giữa hai cột: `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow` 30–70, `tabindex="0"`, `touch-action: none`; kéo bằng pointer, kẹp 30–70% và mỗi bên không dưới 360px; bấm đúp hoặc Enter về 50/50; mũi tên trái/phải đổi 5%; Home/End về 30%/70%; khi kéo tắt chọn chữ; không có cuộn ngang.
- **FR-08-004:** Tỉ lệ lưu theo lượt làm (khoá theo `attempt_id`), còn sau khi đổi Passage và tải lại trang; lượt mới bắt đầu 50/50. Đổi cỡ cửa sổ giữ phần trăm, tự nới về 360px khi hẹp, trả lại tỉ lệ cũ khi rộng ra.
- **FR-08-005:** Dưới 900px bỏ tay nắm, dùng hai thẻ "Passage"/"Questions" (Listening: chỉ cột câu hỏi), mỗi thẻ giữ vị trí cuộn riêng.
- **FR-08-006:** Dải số câu sinh từ cấu trúc đề (danh sách phần kèm câu đầu, cuối), không viết cứng 13·13·14. Phần chứa câu hiện tại bung đủ ô; phần khác là nút "Passage 2 · 3/13" (Listening "Part 3 · 0/10"); bấm nút thì bung phần đó và nhảy tới câu đầu tiên chưa trả lời. Phần thu gọn có câu đánh dấu thì nút có vạch đáy đỏ mận và nhãn đọc thêm "N flagged".
- **FR-08-007:** Bốn trạng thái ô câu, không chỉ dựa vào màu: chưa trả lời (nền trắng, vạch đáy nhạt), đã trả lời (nền đậm), đánh dấu xem lại (vạch đáy đỏ mận, đi cùng hai trạng thái trên), hiện tại (viền ngoài 3px màu nhấn, `aria-current="true"`). Nhãn đọc dạng "Question 18, answered, flagged for review".
- **FR-08-008:** Ô câu rộng 32px, cao 44px, cách 4px ở 1280px; 1024–1279px bỏ chữ "Answered … of 40" trước rồi rút ô còn 28px; dưới 1024px (gồm 768px) thanh đáy gọn: nút lùi, "Q18 of 40 · Passage 2 · 4/13", nút tới, "Review", "Submit test"; bảng Review trượt từ đáy, 10 ô một hàng, ô 44px; 390px bỏ "Passage 2 · 4/13", bảng phủ cả màn, 6 ô một hàng.
- **FR-08-009:** Mỗi câu chỉ có một điều khiển cờ xem lại (bỏ trùng lặp nút "Review" từng câu và ô "Review" ở thanh đáy của Reading hiện nay); bấm đổi trạng thái tại chỗ và trên dải câu.
- **FR-08-010:** Hộp nộp một kiểu cho mọi trình (thành phần của trang, không dùng `window.confirm`): tiêu đề là câu hỏi, nút chính lặp đúng động từ. Còn câu trống: hộp cảnh báo (viền `--mark`, vạch trái dày, biểu tượng tam giác, nhãn "Warning"/"Cảnh báo"), liệt kê tối đa 5 số câu trống rồi "và N câu khác", nút chính đỏ mận "Submit test"/"Nộp bài", nút phụ "Return to test"/"Quay lại làm tiếp". Không còn câu trống: hộp thường. Tiêu điểm đầu vào nút an toàn; Esc đóng khi không đang nộp.
- **FR-08-011:** Lối thoát (00 mục 2 điểm 22): **full test không có "Save and exit"**. Chế độ test mở hộp "Leave the test?" với nút chính "Continue test" và nút phụ "Leave test", kèm câu "Your answers so far are saved. The timer keeps running while you are away."; quay lại trong giờ thì làm tiếp đúng lượt (FR-08-018). **Đề tự chọn** (full test từng kỹ năng, mini test) có thêm nút "Abandon test" (FR-08-041); mock test được giao **không** có "Abandon test". Trước khi rời phải flush hết hàng đợi lưu; còn câu chưa lưu được thì hộp báo rõ số câu chưa lưu và không cho thoát âm thầm. Chế độ luyện: mọi thứ đã lưu thì thoát ngay ("Thoát"), chỉ hỏi khi thoát sẽ mất bài (ví dụ bản ghi Speaking chưa gửi).
- **FR-08-012:** Trạng thái tự lưu hiện bằng chữ ở thanh trên: "Saving…"/"Đang lưu…", "Saved at 10:42"/"Đã lưu lúc 10:42", "Not saved. Retrying…"/"Chưa lưu được, đang thử lại", kèm nút "Retry"/"Thử lưu lại" khi hết lượt thử tự động. Giờ là lần lưu thành công gần nhất theo giờ máy.
- **FR-08-013:** Mất mạng (sự kiện `offline` hoặc một lần lưu thất bại vì mạng): dải trên cùng theo TrangLoi mục 7, không che ô làm bài; "Connection lost. Your work was saved up to [HH:MM]…" (test) hoặc "Mất kết nối mạng. Bài của bạn đã lưu tới [HH:MM]…" (luyện). Nút nộp đổi thành "Waiting for connection"/"Chờ kết nối" và bị khoá có lý do bằng chữ. Có mạng lại: tự lưu phần còn lại rồi hiện dải "Back online. Your work has been saved."/"Đã kết nối lại. Bài của bạn đã được lưu." 5 giây. Đồng hồ vẫn chạy.
- **FR-08-014:** Phiên hết hạn (API trả 401) khi đang làm: không chuyển trang; lưu nháp tại máy (bản sao câu trả lời/bài viết) trước, rồi hiện hộp chặn "Sign in again"/"Đăng nhập lại", nói bài đã lưu tới [HH:MM]; **đăng nhập lại ngay trong phòng thi** — hộp có hai cách vào như trang đăng nhập (Google, hoặc email + mã 6 số; dùng component của G05-T19, không rời URL phòng thi; Google mở cửa sổ/bước chuyển rồi quay lại đúng URL); đồng hồ vẫn chạy trong lúc đăng nhập. Mở trang mà phiên đã hết thì chuyển thẳng tới đăng nhập như hiện nay.
- **FR-08-014a (mới, khớp G04 mục 5.13):** Đang làm bài có giờ thì không bị thiết bị khác chiếm phiên: máy chủ từ chối `claim` khi `active_timed_work` thấy bài đang chạy — gói này bảo đảm mọi bài có giờ của mình có trong nguồn đó (FR-08-045). Nếu phòng thi nhận 401 `session_displaced` (bài không có giờ, hoặc bài đã hết giờ): lưu nháp tại máy, hiện màn 8c của G05-T20 (tiếng Anh trong full test). Nếu nhận 409 `session_not_current` khi mở phòng thi ở thiết bị mới: hiện màn 8a/8b của G05-T20, không tạo lượt.
- **FR-08-015:** Mở cùng một lượt ở tab thứ hai: tab mới hiện thông báo "This test is open in another tab" / "Bài này đang mở ở tab khác" với nút "Use this tab"/"Dùng tab này"; bấm thì tab kia chuyển sang chỉ-đọc kèm thông báo tương tự. Không có hai tab cùng ghi một lượt.
- **FR-08-016:** Đồng hồ chế độ test: "Time remaining" + mm:ss số đều cột; mốc 5 phút đổi trạng thái có chữ "5 minutes left" và đọc cho trình đọc màn hình đúng một lần; tới 0 hiện "Time is up" và "Your answers have been saved and submitted."; không nhấp nháy.
- **FR-08-017:** Hết giờ khi đang gõ: khoá ô nhập ngay khi đồng hồ về 0, lấy giá trị cuối cùng đã gõ (kể cả chưa qua debounce) đưa vào lần nộp; không hỏi lại; không mất ký tự đã gõ trước mốc 0.
- **FR-08-018:** Tải lại giữa bài: trở về đúng lượt, đúng câu trả lời đã lưu ở server, đúng cờ, đúng thời gian còn lại tính từ server, đúng tỉ lệ cột và Passage đang xem. Không tạo lượt mới.
- **FR-08-019:** Bật/tắt theo từng trình bằng cờ (mục 5.4). Cờ tắt: trình hiện tại chạy y như trước, không đổi DOM, id, request. Cờ bật: cùng URL, cùng request, cùng thứ tự gọi API; chỉ lớp giao diện khác.
- **FR-08-020:** Chế độ nhúng (`mock_embed=1`) không hiện thanh trên, đồng hồ, nút nộp, hộp thoát của trang con; vẫn trả lời `mock-flush` đúng như hiện nay.

**Dạng câu hỏi và công cụ (S0, dùng trong S1–S4, S7)**
- **FR-08-021:** Sáu dạng khách quan theo `BaiTapKhachQuan`: chọn một, chọn nhiều (luôn ghi phải chọn mấy, đếm "Đã chọn 1 trên 2"), True/False/Not Given (cùng kiểu Yes/No/Not Given và Đúng/Sai), điền chỗ trống (giới hạn từ ghi ngay trên đề, ô nhập nằm trong câu), nối tiêu đề/thông tin (danh sách lựa chọn luôn thấy, lựa chọn đã dùng gạch ngang + mờ 0.6 + chữ ẩn "(used in Q6)"), hoàn thành bảng/biểu mẫu/ghi chú (giữ hình dạng biểu mẫu, ô nhập nằm trong bảng). Chưa trả lời nền trắng, đã trả lời nền nhạt viền đậm.
- **FR-08-022:** Sau khi chấm (chỉ chế độ luyện, hoặc trang xem lại): mỗi câu có đúng/sai bằng chữ, đáp án đúng, một dòng giải thích; ghi "đúng 9 trên 13 câu"; không quy ra band khi chưa làm đủ đề 40 câu; không bao giờ hiện "0/0".
- **FR-08-023:** Dạng riêng: Listening gắn nhãn bản đồ/sơ đồ (lựa chọn đặt cạnh hình, không cách hai màn), Reading trả lời ngắn, hoàn thành tóm tắt, nối đặc điểm (bảng ma trận) theo `BaiTapListening`/`BaiTapReading`.
- **FR-08-024:** Trình phát audio một thành phần (`ThanhPhanHocTap` mục 2): chế độ luyện có **tạm dừng**, tua 5 giây, tốc độ 0,75–1,5× (nhớ cho bài sau), lặp đoạn A–B (Đặt A → Đặt B → đang lặp → Bỏ lặp, đoạn tô đỏ mận); **chế độ thi không có nút tạm dừng** (00 mục 2 điểm 22), không A–B, tua, tốc độ, chỉ có âm lượng. Bản đầy đủ, thu gọn dính đầu và điện thoại dùng chung một trạng thái. Phím cách phát/tạm dừng khi con trỏ không ở ô nhập (chỉ chế độ luyện).
- **FR-08-025:** Bài nghe một lần ở chế độ luyện (programme "Vận dụng"): trước khi phát hỏi lại "Bài này chỉ được nghe một lần · Dài 3:42…"; **giữ nút tạm dừng** (luyện từng phần có tạm dừng — 00 mục 2 điểm 22; tờ ghi "không tạm dừng được" thì 00 thắng), không tua lùi, không phát lại; xong ghi "Đã nghe · đã khoá"; mất kết nối giữa chừng thì báo phút dừng và cho nghe tiếp từ đó, không phát lại từ đầu.
- **FR-08-026:** Highlight/Note trên bài đọc: chọn chữ hiện thanh nổi "Highlight · Note · Clear"; ghi chú hiện ở lề (bản hẹp của mini test và chế độ luyện: số nhỏ trong bài, bấm mở); tô và ghi chú còn khi tải lại trong cùng lượt (nơi lưu: mục 10 câu 4).
- **FR-08-027 (mới, khớp GOI-11 phần D):** Full test (full test từng kỹ năng, mock test được giao) ở vùng nhìn hẹp hơn ngưỡng (mặc định 768px, cấu hình) **chỉ có màn chặn** của GOI-11 (`ExamEntryGate`, `full-test-phone-block`); không tạo lượt, không chạy đồng hồ. Khung `ExamRoomShell` nhận `isFullTest` và bọc cổng này trước mọi lệnh tạo lượt. **Mini test và luyện từng phần không bị chặn** và có bản 390px. Ảnh 390px của full test trong PR là ảnh màn chặn. Màn lỗi thiết bị của full test (micro, loa, trình duyệt) dùng cùng component với prop `viNote` để có dòng phụ tiếng Việt.

**Theo trình (S1–S7)**
- **FR-08-030 (Reading):** `/reading/exam/session` dùng khung khi cờ `reading` bật, cho cả `from=full`, `from=mini`, share link, class item; `admin_preview=1` giữ dải "Admin preview" và không lưu gì; `mock_embed=1` theo FR-08-020.
- **FR-08-031 (Reading):** Màn trước khi bắt đầu tiếng Anh, có "Start test" là nút chính và "Back" là nút phụ; nút "Start a new attempt" khi đang có lượt dở dùng hộp trong trang thay `window.confirm` (L1247).
- **FR-08-032 (Writing):** Trình soạn bài giao (chế độ luyện, tiếng Việt, "bạn") có bộ đếm "182 từ · cần ít nhất 250" (Task 1: 150) cập nhật khi gõ; nộp khi thiếu từ hiện hộp "Cảnh báo · Nộp chấm khi bài mới có 182 từ?" với "Viết tiếp" (chính) và "Vẫn nộp chấm"; sau đó luôn hiện hộp "Nộp chấm bài này?". Hai `confirm()` ở `writing-behavior.tsx` L1261, L1263 bị thay. Ngưỡng cảnh báo lấy theo yêu cầu tối thiểu của Task (150/250), không theo con số cứng 100 hiện nay.
- **FR-08-033 (Writing):** Khôi phục nháp khi mở lại: máy còn bản mới hơn bản server thì hỏi "Viết tiếp bản nháp còn trên máy này?" với số từ và giờ của cả hai bản; không tự ghi đè bên nào. Nút X đóng trình soạn báo "Đã lưu lúc HH:MM" hoặc hỏi khi còn chưa lưu; đóng xong bỏ `assignment_id` khỏi URL.
- **FR-08-034 (Writing, Speaking):** Hộp nộp nói rõ việc tốn lượt chấm khi có số liệu lượt từ API của G04 (`GET /api/me/credits` — một kho chung Writing và Speaking): "Nộp chấm sẽ dùng 1 lượt chấm AI. Bạn còn X lượt."; khi API đó chưa có thì bỏ câu về lượt, không hiện `XXX`, không bịa số. Máy chủ trả 402 `insufficient_credits` → giữ nguyên bài (nháp đã lưu), hiện khối "Hết lượt chấm" (`CreditsEmptyNotice` của G07-T27) theo `credit_source`: `class` → "Liên hệ giáo viên để được cấp thêm"; `online` → "Đăng ký lại". 403 `no_entitlement`, 503 `credits_unavailable` → thông điệp máy chủ, bài không mất.
- **FR-08-035 (Listening luyện):** "Hoàn thành và xem lại" luôn mở hộp nộp; còn câu trống thì theo FR-08-010 (tiếng Việt). Không tạo lượt làm khi chỉ mở trang nếu backend cho phép tạo lúc tương tác đầu tiên — CHƯA KIỂM; nếu cần đổi backend thì ghi thành câu hỏi mở, không làm trong gói này. Bài luyện không giờ giữ thanh điều hướng bình thường (quy tắc thanh tập trung).
- **FR-08-036 (Listening test):** Trình phát chế độ test theo FR-08-024; dải câu theo Part; bấm số câu chỉ cuộn tới câu, không tua audio.
- **FR-08-037 (Mock test được giao):** Thanh trên của runner theo FR-08-001/016 (tiếng Anh), các section Reading/Listening nhúng hiển thị bằng khung chế độ nhúng; Writing hai task dùng cùng trình soạn chế độ test (không có nút lưu nháp riêng, đồng hồ ở thanh trên, "Words: 187 · minimum 250"); hết giờ tự nộp cả hai task không hỏi, hiện "Time is up. Your test has been submitted." kèm số từ từng task. Runner dựng danh sách phần theo dữ liệu kỳ thi (kỳ không đủ bốn kỹ năng chỉ có các phần được giao), không viết cứng bốn phần.
- **FR-08-038 (Speaking):** Bốn trạng thái micro theo `BaiTapSpeaking` mục 3 (trước khi xin, đang chờ trình duyệt, bị từ chối có 3 bước mở lại, không tìm thấy micro) — không còn hai nút "Bắt đầu ghi âm" liên tiếp mà không phản hồi. Ghi âm có Sẵn sàng/Đang ghi/Im lặng/Tạm dừng/Đã ghi; bản quá ngắn bị chặn với lý do bằng chữ, số giây tối thiểu lấy từ `MIN_RECORD_SEC` hoặc `detail.min_seconds` của backend (không viết cứng thêm chỗ mới). "Ghi lại" hỏi trước khi xoá bản hiện tại. Rời bài và nộp khi còn bản chưa gửi dùng hộp trong trang thay `window.confirm` (`practice.js` L275, L5264).
- **FR-08-039 (Quick Check, flashcard):** Theo `BaiTapTuVungNguPhap`: flashcard có nút lật và chấm nằm trong màn hình đầu ở 1280×800 và 390×844; nút chấm chỉ bật sau khi lật; Quick Check báo "câu N trên M" khi biết tổng; kết quả không hiện mã nội bộ.
- **FR-08-040:** Không trình nào còn gọi `window.confirm`/`alert`/`prompt` trong luồng làm bài khi cờ của trình đó bật (kiểm bằng journey trình duyệt bắt sự kiện `dialog`, không bằng grep mã nguồn).

**Bổ sung theo quyết định 18/11/2026 (00 mục 2 điểm 22)**
- **FR-08-041 (Abandon test — chỉ đề tự chọn):** Trong hộp "Leave the test?" của full test từng kỹ năng và mini test có nút "Abandon test"; bấm → hộp hỏi lại "Abandon this test? Your answers will not be marked and this attempt will not appear in your results." với "Keep working" (chính) và "Abandon test" (đỏ mận, ngữ cảnh cảnh báo). Bỏ bài: lượt đóng, không chấm, không trừ lượt, không ghi vào bảng kết quả; làm lại được ngay. Mock test được giao không có nút này.
- **FR-08-042 (hết giờ với bài dở — đề tự chọn):** Reading/Listening: hết giờ tự nộp như FR-08-017 (cả khi học viên đã rời trang — máy chủ đóng lượt theo giờ của nó). Writing/Speaking: hết giờ mà bài chưa đạt mức tối thiểu (Writing dưới số từ tối thiểu của task; Speaking còn Part chưa ghi) thì **chưa trừ lượt**, hiện màn "Time is up" với hai lựa chọn: "Send for marking" (trừ 1 lượt, chấm phần đã có) hoặc "Discard this attempt" (không trừ, không ghi vào bảng kết quả); không chọn gì trong thời hạn cấu hình thì coi như bỏ (mặc định tạm, mục 10 câu 12). Bài đạt mức tối thiểu: tự nộp chấm như thường. Mock test được giao: hết giờ luôn tự nộp, không có lựa chọn bỏ.
- **FR-08-043 (mock test được giao, phía học viên — khớp G09-T31, T33):** (a) Cổng vào phòng và API danh sách kỳ thi của học viên đọc `mock_exam_audiences` (nhiều lớp, người lẻ, nhóm đã lưu); **học viên chưa được giao thì không thấy và không vào được kỳ thi nào** (mở thẳng URL → 404 kiểu "không tìm thấy", không lộ kỳ thi tồn tại). (b) Hiểu hai chế độ của `exam_mode_v2`: `live` (mọi người cùng giờ, phòng chờ, giáo viên mở từng phần) và `self_paced` (học viên tự bấm bắt đầu trong khoảng thời gian kỳ thi mở; **đã bắt đầu thì các phần chạy liền nhau, không nghỉ giữa các phần** — 00 mục 2 điểm 23; mỗi phần có đồng hồ riêng do máy chủ bấm, thứ tự cố định Listening → Reading → Writing trong các kỹ năng của người đó, **làm một lần**, không làm lại phần đã nộp). Hợp đồng đồng hồ theo GOI-09 mục 5.5 (8 điểm): một mốc bắt đầu cho cả bài; mốc phần kế do máy chủ ghi ngay khi phần trước được nộp hoặc hết giờ (cộng `MOCK_SELF_PACED_GAP_SECONDS`, mặc định 0); phần hết giờ chưa nộp thì máy chủ tự nộp phần đã làm; thoát ra, mất mạng hay đóng trình duyệt thì đồng hồ vẫn chạy; đã bắt đầu thì làm hết chuỗi phần dù vượt giờ đóng của khoảng mở; chưa bắt đầu khi khoảng mở đóng → "Không dự thi". Trước khi bắt đầu, màn vào bài nêu tổng thời lượng và câu "Once you start, the sections run back to back. You cannot pause between sections." kèm dòng phụ tiếng Việt (màn ngoài bài thi — 00 điểm 22); khoảng mở còn lại ngắn hơn tổng thời lượng thì thêm dòng Warning nêu giờ đóng. (c) Kỳ không đủ bốn kỹ năng: chỉ hiện các phần có; không có Overall (G07 FR-07-054). (d) Giữa hai phần của kỳ `self_paced` **không có màn chờ do người học điều khiển**: nộp một phần (hoặc phần hết giờ) thì runner chuyển thẳng sang phần kế với đồng hồ đã chạy theo mốc máy chủ; chỉ hiện dải "Section submitted. Next: <tên phần>" trong lúc tải, và màn đếm ngược cố định khi `MOCK_SELF_PACED_GAP_SECONDS` > 0 (không có nút bỏ qua hay hoãn). Không có "Start next section", không có "Continue later", không có màn chọn phần. Mở lại trang giữa chừng → vào thẳng phần đang chạy với thời gian còn lại theo máy chủ; mọi phần đã xong → màn "Test submitted". (e) Trong lúc chờ chấm, phiếu của kỳ hiện từng phần với trạng thái "Đang chấm" (Writing do AI/giáo viên, Speaking do giáo viên chấm từ bản ghi) cho tới khi giáo viên trả kết quả ở thẻ "Trả kết quả" của trang kỳ thi (G09).
- **FR-08-044 (lượt chấm trong thi thử):** Speaking của mock test được giao do giáo viên chấm từ bản ghi → **không gọi AI, không trừ lượt**, không hiện câu về lượt trong hộp nộp. Writing của mock test được giao và đề tự chọn có Writing/Speaking: trừ lượt theo quy tắc `charge_plan` của G04 (lớp → lượt kèm mã; online → lượt khoá); gói này không tự quyết ai bị trừ, chỉ gọi đúng hàm của G04 và hiện đúng số. Số lượt của đề tự chọn (00 mục 2 điểm 22): full test Speaking mô phỏng (3 câu Part 1, 1 bài Part 2, 2 câu Part 3) = 3 lượt, mỗi Part một lượt; full test Writing = 2 lượt, mỗi task một lượt (đã xác nhận — 00 mục 2 điểm 23); Reading và Listening không tốn lượt.
- **FR-08-045 (nguồn "bài có giờ" cho G04):** Mọi bài có đồng hồ đếm ngược của gói này đọc được ở máy chủ bằng một hàm cho `services/timed_work.py` của G04: lượt Reading/Listening test đang `in_progress` còn trong giờ; lượt Speaking full test đang chạy; section của sitting mock test (live và self_paced) đang chạy; bài Writing có giờ. Trả `title` (tên đề, không mã nội bộ) và số phút còn lại theo đồng hồ máy chủ. Bài luyện không giờ không phải "bài có giờ".
- **FR-08-046 (Writing tự luyện):** Bài Writing tự luyện (không phải bài giao của lớp) tạo `writing_essays` với `review_mode` từ `credits.resolve_review_mode` rồi gọi `essay_service.reserve_writing_credit` **trước** `schedule_grading_job` (G04 mục 5.6); bị từ chối → không để lại bài đang chờ chấm, hiện FR-08-034. Bài giao của lớp giữ đường `submit_my_assignment` (G04-T08 đã móc).

## 5. Hợp đồng kỹ thuật

### 5.1 Nơi đặt file

| Thứ | Đường dẫn mới | Ghi chú |
|---|---|---|
| Khung và thành phần con | `frontend/components/exam-room/` (`exam-room-shell.tsx`, `split-pane.tsx`, `question-navigator.tsx`, `submit-dialog.tsx`, `exit-dialog.tsx`, `connection-banner.tsx`, `session-expired-dialog.tsx`, `exam-timer.tsx`, `save-status.tsx`, `other-tab-notice.tsx`, `exam-room.module.css`) | Dựng trên nút, hộp thoại, dải báo của G03 trong `frontend/components/ui/`; không tạo bản sao nút riêng. |
| Dạng câu hỏi | `frontend/components/exam-room/questions/` (một file mỗi dạng ở FR-08-021, FR-08-023) | Nhận `mode`, `strings`, `value`, `onChange`, `disabled`, `result?`. |
| Trình phát audio | `frontend/components/exam-room/audio-player.tsx` | Một component, prop `policy: 'practice' | 'test' | 'once'`. |
| Highlight/Note | `frontend/components/exam-room/annotation-layer.tsx` | Dùng lại cách CSS Highlight API của Reading (L1137–1162) và thêm Note. |
| Logic thuần, không React | `frontend/lib/exam-room/` (`strings-en.mjs`, `strings-vi.mjs`, `navigator-model.mjs`, `split-ratio.mjs`, `submit-guard.mjs`, `connection-state.mjs`, `tab-guard.mjs`, `flags.mjs`) | Test bằng `node --test` theo hành vi (đầu vào → đầu ra), không đọc mã nguồn. |
| Test React | `frontend/tests/react/exam-room-*.test.tsx` | `vitest.config.mts` chỉ nhận `tests/react/**/*.test.tsx`. |

### 5.2 Props của `ExamRoomShell`

```ts
type ExamRoomMode = 'test' | 'practice';
type ExamRoomSurface = 'reading' | 'listening' | 'mock' | 'writing' | 'speaking' | 'drill';
interface ExamRoomSection { id: string; kind: 'passage' | 'part' | 'task'; index: number; firstQ: number; lastQ: number }
interface ExamRoomQuestion { q: number; sectionId: string; answered: boolean; flagged: boolean; saveState?: 'pending' | 'retrying' | 'failed' }
type ExamRoomSaveStatus =
  | { state: 'idle' } | { state: 'saving'; lastSavedAt?: Date }
  | { state: 'saved'; lastSavedAt: Date } | { state: 'retrying'; lastSavedAt?: Date; unsaved: number }
  | { state: 'failed'; lastSavedAt?: Date; unsaved: number; onRetry(): void };
interface ExamRoomShellProps {
  mode: ExamRoomMode;
  surface: ExamRoomSurface;
  embedded?: boolean;                 // true khi mock_embed=1: ẩn thanh trên, đồng hồ, nộp, thoát
  isFullTest?: boolean;               // true: bọc ExamEntryGate của GOI-11 (chặn dưới ngưỡng), ép data-theme="light"; mini test và luyện: false
  attemptKey: string;                 // attempt_id / sitting_id / assignment_id — khoá tỉ lệ cột, cờ tab, ghi chú
  title: string; subtitle?: string;   // đã lấy từ bộ chuỗi đúng chế độ
  timer?: { kind: 'countdown'; remainingSeconds: number; onExpire(): void }
        | { kind: 'elapsed'; elapsedSeconds: number; maxSeconds?: number } | null;
  saveStatus: ExamRoomSaveStatus;
  sections?: ExamRoomSection[]; questions?: ExamRoomQuestion[]; currentQ?: number;
  onJump?(q: number): void; onToggleFlag?(q: number): void; flagsReady?: boolean;
  layout: { kind: 'split'; left: ReactNode; right: ReactNode; leftLabel: string; rightLabel: string }
        | { kind: 'single'; body: ReactNode };
  submit?: { label: string; onSubmit(): Promise<void>; disabledReason?: string; costNote?: string;
             extraWarning?: ReactNode };   // không có => không hiện nút nộp (embedded, admin preview)
  exit: { href: string; flush(): Promise<{ unsaved: number }>; losesWork(): boolean;
          abandon?: { onAbandon(): Promise<void> } };   // chỉ đề tự chọn (FR-08-041); mock test được giao không truyền
  onSessionExpired?: { saveLocalCopy(): void; returnUrl: string };   // hộp đăng nhập lại ngay trong phòng thi (FR-08-014)
  onSessionConflict?(kind: 'displaced' | 'not_current'): void;         // 401 session_displaced / 409 session_not_current → màn 8a–8c của G05-T20
  timeUpChoice?: { onSend(): Promise<void>; onDiscard(): Promise<void>; costNote?: string };  // FR-08-042, Writing/Speaking tự chọn
}
```

- Shell **không** gọi API. Mỗi trình giữ nguyên hàm lưu/nộp hiện có (`saveAnswer`, `submit`, `submitFromModal`, `_completeSpeakingSession`…) và đưa vào qua props. Đây là cách giữ hợp đồng backend.
- `submit.onSubmit` chỉ được gọi từ nút xác nhận trong hộp nộp hoặc từ `timer.onExpire`. Shell khoá nút trong lúc `onSubmit` đang chạy (chống bấm hai lần).
- Shell bắt lỗi 401 bằng cách trình truyền `{ noRedirect: true }` cho mọi lời gọi `window.api.*` trong phòng thi và báo lỗi 401 lên qua `onSessionExpired` — vì `public/js/api.js` L261 sẽ tự chuyển sang `/login` nếu thiếu cờ này.

### 5.3 Bộ chuỗi tối thiểu

| Khoá | `strings-en` (test) | `strings-vi` (practice) |
|---|---|---|
| exit | ‹ Leave test (không còn "Save and exit") | ‹ Thoát |
| exitTitle / exitBody | Leave the test? / Your answers so far are saved. The timer keeps running while you are away. | Thoát bài này? / (chỉ hiện khi thoát sẽ mất bài) |
| exitStay / exitLeave | Continue test / Leave test | Ở lại làm tiếp / Thoát |
| abandon / abandonTitle / abandonBody / abandonKeep (chỉ đề tự chọn) | Abandon test / Abandon this test? / Your answers will not be marked and this attempt will not appear in your results. / Keep working | (chế độ luyện không dùng) |
| timeUpChoiceTitle / send / discard (Writing, Speaking tự chọn) | Time is up / Send for marking / Discard this attempt | — |
| sectionDone / nextUp (mock `self_paced`) | Section submitted / Next: {section} | — |
| selfPacedNotice (màn vào bài, mock `self_paced`) | Once you start, the sections run back to back. You cannot pause between sections. | Đã bắt đầu thì các phần chạy liền nhau, không dừng giữa các phần. (dòng phụ ở màn ngoài bài thi) |
| markingInProgress (phiếu của kỳ, tiếng Việt) | — | Đang chấm |
| timeRemaining / fiveLeft / timeUp | Time remaining / 5 minutes left / Time is up | Còn lại / Còn 5 phút / Hết giờ |
| saving / savedAt / notSaved / retry | Saving… / Saved at {t} / Not saved. Retrying… / Retry | Đang lưu… / Đã lưu lúc {t} / Chưa lưu được, đang thử lại / Thử lưu lại |
| answered | Answered {n} of {total} | Đã làm {n} trên {total} câu |
| flag / flagged | Flag for review / flagged | Đánh dấu xem lại / đánh dấu |
| qLabel | Question {n}, {answered\|not answered}{, flagged for review}{, current} | Câu {n}, {đã trả lời\|chưa trả lời}… |
| sectionCollapsed | Passage {i}: {a} of {b} answered, {f} flagged. Show questions {x}–{y} | Phần {i}: … |
| submit / submitTitle | Submit test / Submit test? | Nộp bài / Nộp bài? |
| submitBlankTitle / submitBlankBody | Warning · Submit with {n} unanswered questions? / Questions {list} are blank. You cannot change your answers after submitting. | Cảnh báo · Nộp bài khi còn {n} câu chưa trả lời? / Câu {list} đang để trống. Nộp rồi thì không sửa được nữa. |
| returnToTest | Return to test | Quay lại làm tiếp |
| waitingConnection | Waiting for connection | Chờ kết nối |
| offline / online | Connection lost. Your work was saved up to {t}. You can keep working; it will be saved again when you are back online. / Back online. Your work has been saved. | Mất kết nối mạng. Bài của bạn đã lưu tới {t}. Bạn vẫn có thể làm tiếp; bài sẽ được lưu lại khi có mạng. / Đã kết nối lại. Bài của bạn đã được lưu. |
| sessionExpired | Your session has expired / Sign in again to continue. You will return to this page. Your work was saved up to {t}. / Sign in again | Phiên đăng nhập đã hết hạn / Hãy đăng nhập lại để tiếp tục. Bạn sẽ quay lại đúng trang này. Nếu đang làm bài, bài đã lưu tới {t}. / Đăng nhập lại |
| otherTab | This test is open in another tab. / Use this tab | Bài này đang mở ở tab khác. / Dùng tab này |

Câu chữ theo các tờ thiết kế là chuẩn; bảng này để hai phiên thực thi làm khung và làm trình dùng cùng khoá. Không có chuỗi nào chứa mã lỗi HTTP, tên tham số, `attempt_id`.

### 5.4 Cờ bật theo trình

- Giá trị: danh sách bề mặt bật khung mới, ví dụ `["reading","writing"]`. Mặc định rỗng (mọi trình chạy giao diện hiện tại).
- Đọc qua một hàm duy nhất `examRoomEnabled(surface)` trong `frontend/lib/exam-room/flags.mjs`. Mỗi trình rẽ nhánh đúng một chỗ ở component gốc: `examRoomEnabled('reading') ? <ReadingExamRoom …/> : <hiện tại>`.
- Nguồn giá trị (chờ anh Andy chọn, mục 10 câu 1): **A (mặc định tạm)** — `window.__AVER_RUNTIME_CONFIG__.examRoomSurfaces` sinh từ biến môi trường `AVER_EXAM_ROOM_SURFACES` trong `generate-runtime-config.mjs`; quay lui = đổi biến trên Vercel rồi redeploy, hoặc Instant Rollback. **B** — thêm trường chỉ-đọc `exam_room_surfaces` vào `GET /auth/me` đọc từ bảng `runtime_flags` (khoá `exam_room.reading`…); quay lui trong 15 giây không cần deploy; cần sinh lại `types/api.d.ts`.
- Ghi đè để thử trên staging: tham số `?exam_room=on|off` đọc trực tiếp trên trang phòng thi, **bị bỏ qua khi `environment === 'production'`**. Không thêm `exam_room` vào `allowed_query` của `core-player-affinity.mjs` (sẽ đổi hợp đồng affinity và vỡ `frontend/tests/core-player-affinity.test.mjs`).
- Đổi cờ giữa chừng một lượt: lần tải sau dùng giao diện theo cờ mới; vì cả hai giao diện cùng là renderer `next` và cùng đọc trạng thái server, không mất câu trả lời. Trạng thái chỉ có ở giao diện mới (tỉ lệ cột, ghi chú) không bắt buộc chuyển sang giao diện cũ.

### 5.5 Lưu tại trình duyệt (chỉ phần giao diện)

| Khoá | Nội dung | Xoá khi |
|---|---|---|
| `exam-room:split:{attemptKey}` | tỉ lệ 30–70 | nộp xong hoặc quá 7 ngày |
| `exam-room:marks:{surface}:{attemptKey}` | highlight/note (nếu chọn lưu máy, mục 10 câu 4) | nộp xong + 30 ngày |
| `exam-room:local-copy:{surface}:{attemptKey}` | bản sao câu trả lời/bài viết khi 401 hoặc mất mạng | server xác nhận lưu |
| BroadcastChannel `aver-exam-room` | `{attemptKey, tabId, claimedAt}` | — |

Mọi đọc/ghi bọc `try/catch`; bộ nhớ không dùng được thì khung vẫn chạy (không có tính năng phụ), không chặn làm bài.

### 5.6 Sự kiện ghi log

Gửi qua `POST /api/analytics/events` hiện có (Writing đã dùng, `writing-behavior.tsx` L476): `exam_room_submit_dialog_opened` `{surface, unanswered}`, `exam_room_submit_confirmed`, `exam_room_exit_confirmed` `{unsaved}`, `exam_room_offline` `{duration_s}`, `exam_room_session_expired`, `exam_room_other_tab`. Không gửi nội dung câu trả lời. CHƯA KIỂM: endpoint có giới hạn tên sự kiện không — người thực thi kiểm `grep -n "analytics/events" backend/routers/analytics.py` trước khi dùng; nếu có danh sách cho phép thì đây là đổi backend, bỏ log trong gói này và ghi vào PR.

## 6. Nhiệm vụ (theo thứ tự phụ thuộc)

### G08-T01 — Soạn spec S0 khung chung, mở PR spec, DỪNG
- Mục đích: có thư mục spec high-risk được duyệt trước khi viết mã khung.
- Đầu vào: file này (mục 1–5, 7, 9, 10); `specs/_templates/*`; `specs/README.md`; `specs/_meta/constitution.md`; `specs/0008-mock-attempt-integrity/`, `specs/0010-learner-draft-preservation/` (mẫu viết); tờ `PhongThi`, `TrangLoi`, `ThanhPhan`, `ThanhPhanKhungTrang`, `ThanhPhanHocTap`.
- Việc làm: 1) Lấy số `NNNN` theo mục 1. 2) Tạo `specs/NNNN-exam-room-shell/` gồm `spec.md` (frontmatter `id: EXAMROOM-NNNN`, `status: draft`, `risk: high`, `owner: product`; FR-08-001…026 và 040 đánh lại thành FR-001…; kịch bản 1–9 ở mục 9; ca biên mục 7; câu hỏi mở = mục 10), `plan.md` (mục 5), `tasks.md` (T02–T05 dạng checkbox), `verification.md` (bảng `| FR-001 | <bằng chứng> | PENDING |`), `rollout.md` (mục 5.4 + mục 9 phần quay lui), `ui-states.md` (bảng trạng thái: loading, prestart, inprogress, saving, offline, session-expired, other-tab, submitting, time-up, error). 3) Thêm một dòng vào bảng "Active index" của `specs/README.md`. 4) `python backend/scripts/validate_specs.py`, `git diff --check`. 5) PR lớp `high-risk`, `Spec: EXAMROOM-NNNN`.
- Đầu ra: một PR chỉ có file trong `specs/`.
- Nghiệm thu: validator xanh; PR không chứa file ngoài `specs/`; mọi FR có dòng trong `verification.md`.
- Không làm: không viết mã; không tự đổi `status` sang `approved`.
- Vướng mắc → cách gỡ: validator báo "section must contain meaningful content" → mục nào trong template cũng phải có nội dung thật, không để dòng mẫu. Validator báo id sai → id phải `PREFIX-NNNN` và NNNN trùng số thư mục. Số trùng với PR khác đang mở → đổi sang số kế tiếp, ghi lý do trong PR.
- Ước lượng: 1 phiên · độ khó 2.

### G08-T02 — Bộ chuỗi, mô hình dải câu, tỉ lệ cột, chặn nộp, cờ bật (lib thuần)
- Mục đích: logic không phụ thuộc React để mọi trình dùng chung và test được bằng đầu vào/đầu ra.
- Đầu vào: spec S0 đã duyệt; `frontend/lib/reading-exam-controller.mjs` (`readingDisplayQuestionRuns`), `frontend/lib/listening-test-controller.mjs` (`listeningQuestions`) để biết dữ liệu phần/câu thật; `frontend/tooling/generate-runtime-config.mjs`.
- Việc làm: 1) Tạo các file `frontend/lib/exam-room/*.mjs` ở mục 5.1. 2) `navigator-model.mjs`: từ danh sách phần + trạng thái câu + câu hiện tại → mô hình hiển thị (phần bung, phần gọn, nhãn đọc, chế độ hẹp theo bề rộng). 3) `split-ratio.mjs`: kẹp 30–70, tối thiểu 360px, bước 5, đọc/ghi theo `attemptKey`. 4) `submit-guard.mjs`: danh sách câu trống, chuỗi "Q7, Q12 and 3 more", lý do khoá nút (offline, đang lưu, đang nộp). 5) `connection-state.mjs`: máy trạng thái online/offline/back-online 5 giây. 6) `tab-guard.mjs` (BroadcastChannel, có phương án không hỗ trợ: bỏ qua). 7) `flags.mjs` + trường `examRoomSurfaces` trong `generate-runtime-config.mjs` (phương án A); trả `frontend/public/js/runtime-config.js` về bản chưa cấu hình trước khi commit. 8) Test `frontend/tests/exam-room-*.test.mjs`.
- Đầu ra: PR thư viện + test; không trình nào dùng tới.
- Nghiệm thu: `node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/exam-room-*.test.mjs` xanh; có ca: 40 câu 13/13/14, Listening 10×4, đề 3 Passage không đều, câu hiện tại ở phần cuối, phần gọn có cờ; tỉ lệ 80 → 70, cửa sổ 700px → chế độ thẻ; `examRoomEnabled` trả false khi cấu hình null; ghi đè `?exam_room=on` bị bỏ khi production. Bộ hợp đồng frontend đầy đủ vẫn xanh.
- Không làm: không đọc file mã nguồn trong test; không sửa `core-player-affinity.mjs`.
- Vướng mắc → cách gỡ: `git diff` có `public/js/runtime-config.js` đã cấu hình → `git checkout -- frontend/public/js/runtime-config.js`. Test chạy dưới Node không có `BroadcastChannel`/`localStorage` → hàm nhận đối tượng lưu trữ qua tham số, test truyền bản giả.
- Ước lượng: 1 phiên · độ khó 2.

### G08-T03 — `ExamRoomShell` và thành phần con
- Mục đích: dựng khung theo tờ `PhongThi`, chưa lắp vào trình nào.
- Đầu vào: T02; tờ `PhongThi`, `ThanhPhanKhungTrang` mục 6, `ThanhPhan` (hộp hỏi lại, cảnh báo), `TrangLoi` mục 7–9, `ThanhPhanHocTap` mục 4 (đồng hồ); component G03 trong `frontend/components/ui/`; `frontend/lib/use-dialog-focus`.
- Việc làm: 1) Tạo các file `frontend/components/exam-room/*.tsx` ở mục 5.1 theo props mục 5.2. 2) CSS module dùng token `--av2-` của G03; không thêm stylesheet vào `pageStylesheets` của layout hiện có. 3) Test React: kéo tay nắm (pointer giả), phím mũi tên/Home/End/Enter, bấm đúp; dải câu ở 1280/1100/768/390 (giả bề rộng); bốn trạng thái ô và nhãn đọc; hộp nộp có/không câu trống, Esc, tiêu điểm; hộp thoát flush xong mới điều hướng; dải mất mạng; hộp 401; thông báo tab khác; đồng hồ mốc 5 phút và 0.
- Đầu ra: PR component + `frontend/tests/react/exam-room-shell.test.tsx` và các test con.
- Nghiệm thu: `npm --prefix frontend run test:react` xanh; `cd frontend && npx tsc --noEmit && npm run build` xanh; ảnh chụp 1280px và 390px của một trang thử chỉ có trong test (không thêm route) đính vào PR, đối chiếu tờ `PhongThi`.
- Không làm: không thêm route mới để trưng bày; không sửa `components/authed-shell.tsx` (thứ tự cascade CSS bị cấm đổi).
- Vướng mắc → cách gỡ: CSS của trang thi cũ (`reading-exam.css`, `exam-chrome` trên `body`) đè lên khung mới khi lắp vào → khung dùng CSS module có tiền tố riêng và đặt gốc `data-exam-room`; không dựa vào selector toàn cục. G03 chưa có Dialog/Banner → dừng nhiệm vụ, báo, làm T05 phần không cần (logic audio) trong lúc chờ.
- Ước lượng: 2 phiên · độ khó 4.

### G08-T04 — Dạng câu hỏi dùng chung
- Mục đích: sáu dạng khách quan + dạng riêng Reading/Listening theo FR-08-021…023.
- Đầu vào: T03; tờ `BaiTapKhachQuan`, `BaiTapReading`, `BaiTapListening`; các hàm hiển thị hiện có `QuestionControl`, `InlineGap`, `MatchingMatrixRun`, `GroupedMcqRun`, `FlowingCompletionRun`, `DiagramImageRun` trong `reading-exam-session.tsx` (L153–612) và `noteTemplateTree`, `listeningTableCellLines` của Listening.
- Việc làm: 1) Tách dạng hiển thị thành component thuần trong `frontend/components/exam-room/questions/`, nhận `value` dạng chuỗi giống hệt `user_answer` hiện gửi lên server (không đổi định dạng đáp án: ví dụ chọn nhiều vẫn nối như hiện tại). 2) Bản sau khi chấm (prop `result`). 3) Test React từng dạng: nhập, đổi, xoá, bàn phím, nhãn đọc, chế độ test chuỗi Anh.
- Đầu ra: PR component dạng câu.
- Nghiệm thu: với dữ liệu mẫu trong `frontend/tooling/write-flows/fixtures/reading-exam.json`, chuỗi đáp án sinh ra cho từng dạng trùng chuỗi trình hiện tại sinh (test so hai hàm, không so mã nguồn); `test:react` xanh.
- Không làm: không đổi `reading-exam-session.tsx` trong PR này.
- Vướng mắc → cách gỡ: định dạng `user_answer` cho chọn nhiều/nối khác nhau giữa Reading và Listening → đọc `answersFromRows`, `listeningAnswersFromRows`, `listeningKeepChangeAnswer` và giữ một bộ chuyển đổi riêng cho từng bề mặt, không "chuẩn hoá" chung. `<select>` gốc khó thao tác bằng công cụ thử → dùng listbox của G03 nhưng giữ được thao tác bàn phím.
- Ước lượng: 2 phiên · độ khó 3.

### G08-T05 — Trình phát audio và Highlight/Note
- Mục đích: FR-08-024…026.
- Đầu vào: T03; `frontend/components/listening-question-audio.tsx` (`pauseOtherListeningAudio`), `listening-source-audio.tsx`, `frontend/lib/listening-programme-once-playback.mjs`, `listening-programme-replay.mjs`, `listening-drill-playback`; tờ `ThanhPhanHocTap` mục 2, `BaiTapListening` mục 1, 5; `BaiTapReading` mục 4.
- Việc làm: 1) `audio-player.tsx` một trạng thái dùng chung cho bản đầy đủ/thu gọn/điện thoại; `policy` quyết nút nào có; A–B chỉ khi `practice`. 2) Bản `once` nhận hàm `onPlaybackStart` từ trình (để trình gọi `POST .../playback-started` như hiện tại) và hàm lấy vị trí tiếp tục. 3) `annotation-layer.tsx`: Highlight (CSS Highlight API, có phương án dự phòng bằng `<mark>` khi trình duyệt không hỗ trợ), Note, Clear; lưu theo mục 5.5. 4) Test React: A–B quay về A khi chạm B; policy `test` không có tua/tốc độ/A–B; `once` không có tạm dừng; phím cách không phát khi tiêu điểm trong ô nhập.
- Đầu ra: PR hai component.
- Nghiệm thu: `test:react` xanh; ghi rõ trong PR các trình duyệt không hỗ trợ CSS Highlight API dùng phương án nào.
- Không làm: không gọi API trong component.
- Vướng mắc → cách gỡ: chế độ nghe một lần hiện cho phép "Tạm dừng" (`onceState` có `'paused'`, `programme-form-runner.tsx` L75) — bỏ tạm dừng là đổi hành vi học viên; ghi vào spec S3 dưới dạng FR có chủ ý, không lén đổi ở T05. Audio không tự phát được do chính sách trình duyệt → nút "Play" bắt buộc có thao tác người dùng như `listening-test-session.tsx` đang làm ("Audio could not start…").
- Ước lượng: 2 phiên · độ khó 3.

### G08-T06 — Soạn spec S1 Reading, PR spec, DỪNG
- Đầu vào: file này (FR-08-030, 031 + các FR khung áp cho Reading), mục 2.1 dòng Reading, `specs/0008-mock-attempt-integrity`, `specs/0016-mock-content-remediation` (cờ xem lại khi tiếp tục).
- Việc làm: như T01 cho `NNNN-exam-room-reading`; `rollout.md` ghi: bật cờ `reading` trên staging → nghiệm thu mục 9 → anh Andy cho bật production → giữ trình cũ (nhánh cờ tắt) tới khi anh nghiệm thu; quay lui = bỏ `reading` khỏi cờ.
- Nghiệm thu/Không làm/Vướng mắc: như T01.
- Ước lượng: 1 phiên · độ khó 2.

### G08-T07 — Reading dùng khung sau cờ
- Mục đích: S1. Chọn Reading đầu tiên vì: trình đã có gần đủ hành vi đích (tay nắm 30–70, palette theo Part, cờ xem lại lưu server, hộp nộp trong trang, tự nộp khi hết giờ, flush khi `pagehide`); một file React duy nhất; đã có bộ Playwright riêng `frontend/tests/reading-native/*.spec.js` và write-flow `reading-exam-*.mjs` để bắt hồi quy lưu/nộp; nhãn đã tiếng Anh.
- Đầu vào: T02–T05; `reading-exam-session.tsx`; `frontend/tests/reading-exam-native-controller.test.mjs`, `reading-completion-flowing-fix.test.mjs`, `exam-native-save-deadline.test.mjs`, `core-operation-integration.test.mjs`, `mock-exam-next-model.test.mjs`, `mock-exam-next-behavior.test.mjs` (các test này đọc chuỗi trong file nguồn).
- Việc làm: 1) Tạo `reading-exam-room.tsx` cạnh `reading-exam-session.tsx`, nhận toàn bộ state và hàm (`saveAnswer`, `submit`, `toggleFlag`, `jumpToQuestion`, `bootWithRecovery`…) từ `ReadingExamSession`; không nhân bản logic boot/lưu/nộp. 2) Trong `ReadingExamSession` rẽ nhánh render theo `examRoomEnabled('reading')` ở đúng một chỗ, sau khi các hook đã chạy (không gọi hook có điều kiện). 3) Bỏ email khỏi thanh trên ở nhánh mới; nhánh cũ giữ nguyên. 4) Gắn hộp thoát (FR-08-011), trạng thái lưu (lấy từ `saveStates` + giờ lần ack cuối), dải mất mạng, 401 (`noRedirect: true` cho `patchWith`/`postWith` trong nhánh mới), tab khác. 5) Thay `window.confirm` ở L1247 bằng hộp trong trang ở nhánh mới. 6) Chế độ `mock_embed`, `admin_preview`, share giữ như FR-08-020/030. 7) Playwright: thêm `frontend/tests/reading-native/exam-room.spec.js` chạy với ghi đè `?exam_room=on`: kéo tay nắm, tải lại giữ tỉ lệ, nộp có câu trống, offline → online, hết giờ khi đang gõ (dùng `page.clock`), hai tab.
- Đầu ra: PR mã + test.
- Nghiệm thu: `npx playwright test -c frontend/playwright.reading-native.config.js` xanh cả bộ cũ (cờ tắt) và bộ mới; `node frontend/tooling/verify-write-flows.mjs` xanh với luồng `reading-exam-*`; bộ hợp đồng frontend, `test:react`, `tsc`, `build` xanh; ảnh 1280/768/390 đối chiếu `PhongThi`; bước tay trên staging (bật cờ staging): làm đề AVR-READ-001 bằng tài khoản QA tới khi nộp, kiểm kết quả trùng với cùng câu trả lời ở nhánh cũ.
- Không làm: không đổi request, thứ tự gọi API, body; không đổi `readingPlayerQuery`; không đụng `public/js/reading-exam.js`.
- Vướng mắc → cách gỡ: `reading-exam-native-controller.test.mjs` L321–327 khẳng định chuỗi như `export function ReadingExamSession`, `useState<ExamPhase>`, mẫu URL boot — giữ các chuỗi đó trong `reading-exam-session.tsx` (logic ở lại file cũ, chỉ phần vẽ sang file mới) thì test không vỡ; test nào vẫn vỡ do thay đổi có chủ ý thì sửa trong cùng PR và liệt kê. Quá 30 test vỡ → dừng, báo danh sách (quy ước 7). Bộ `reading-native` khởi động `npm run start` với `test_id=RD-NATIVE-1` qua `reading-native-harness.js` — bật cờ cho test bằng ghi đè URL, không sửa runtime-config. Mock nhúng Reading qua iframe: chạy `node frontend/tooling/verify-mock-exam-flow.mjs` để chứng minh `mock-flush` vẫn được trả lời.
- Ước lượng: 3 phiên · độ khó 4.

### G08-T08 — Soạn spec S2 Writing, PR spec, DỪNG
- Đầu vào: FR-08-032…034 + FR khung; `specs/0010-learner-draft-preservation`, `specs/0027-writing-draft-assignment-delete-guard`, `specs/0050-writing-band-save-consistency`; tờ `BaiTapWriting`.
- Ghi rõ trong spec: chế độ luyện (bài giao) không có đồng hồ thì không dùng thanh tập trung kiểu thi; bài giao có `timer.is_timed` thì dùng thanh tập trung chế độ luyện (tiếng Việt). Writing full test thuộc S5.
- Ước lượng: 1 phiên · độ khó 2.

### G08-T09 — Writing bài giao dùng khung sau cờ
- Mục đích: S2. Thứ hai vì: không có đồng hồ ở đa số bài, không nhúng Mock, chỉ một API nộp; nhưng mã là DOM mệnh lệnh nên rủi ro test cao hơn Reading.
- Đầu vào: `writing-behavior.tsx` (L1022 đếm từ, L1064 lưu nháp, L1095 đồng hồ, L1245 `submitFromModal`, L1417–1502 mở bài), `page-shell.tsx`, `public/js/writing-submit-receipt.js`; 12 test đọc nguồn `writing-behavior.tsx` (ví dụ `writing-dashboard-redesign.test.mjs` ghim id `loading`, `error`, `content`, `greeting-name`…); `frontend/tooling/write-flows/writing-submit.mjs`.
- Việc làm: 1) Nhánh cờ tắt giữ nguyên. 2) Nhánh cờ bật: thay hai `confirm()` bằng hộp trong trang theo FR-08-032 (ngưỡng theo Task); hộp hỏi lại luôn hiện; nộp do hết giờ (`force=true`) không hỏi. 3) Bộ đếm và cảnh báo thiếu từ theo tờ (viền `--mark`, nhãn "Cảnh báo"). 4) Khôi phục nháp so bản máy/bản server (FR-08-033) dựa trên `WritingSubmitReceipt` và `draft.draft_text`. 5) Đổi "em" thành "bạn" ở các chuỗi của trình soạn trong nhánh mới. 6) Thêm bước `clickIfPresent: '[data-exam-room-submit-confirm]'` vào `write-flows/writing-submit.mjs` để luồng chạy được cả hai nhánh (cơ chế `clickIfPresent` đã có ở `verify-write-flows.mjs` L83).
- Nghiệm thu: `node frontend/tooling/verify-writing-admission-flow.mjs <base>` và `verify-write-flows.mjs` xanh ở cả hai nhánh; journey bắt sự kiện `dialog` của Playwright ở nhánh mới ghi nhận 0 hộp thoại gốc; thử tay trên staging với bài "QA TEST Task 2 – do not use": gõ, mất mạng (DevTools offline), có mạng lại, đóng X, mở lại, nộp với 182 từ.
- Không làm: không đổi `POST /submit` body (`essay_text`, `request_id`), không đổi `PATCH /draft`, không đổi phân loại dán (`paste-log`).
- Vướng mắc → cách gỡ: `verify-write-flows.mjs` tự bấm Đồng ý mọi hộp thoại gốc (L253–262), nên nhánh mới không có hộp gốc sẽ thiếu request `/submit` nếu luồng không bấm nút xác nhận mới → dùng `clickIfPresent` như trên. Trình soạn là overlay DOM ghim id → giữ nguyên các id `modal-essay-textarea`, `modal-btn-submit`, `modal-btn-save` trong nhánh mới; hộp mới gắn `data-` riêng.
- Ước lượng: 2 phiên · độ khó 4.

### G08-T10 — Soạn spec S3 Listening luyện, PR spec, DỪNG
- Đầu vào: FR-08-035, FR-08-024/025 + FR khung; `specs/0005-listening-content-programmes`, `0006-listening-guided-feedback`, `0009-listening-80-days`; báo cáo 09a mục programme form.
- Ghi vào câu hỏi mở của spec: bỏ "Tạm dừng" ở bài nghe một lần; tạo lượt khi mở trang (cần backend nên không làm ở đây).
- Ước lượng: 1 phiên · độ khó 2.

### G08-T11 — Listening luyện dùng khung sau cờ
- Mục đích: S3. Chỉ sửa frontend (`programme-form-runner.tsx`, `source-day.tsx`), không đụng `listening.py`, nên không phải chờ G10.
- Đầu vào: `programme-form-runner.tsx` (`submit` L308), `lib/listening-programme-answer-queue.mjs`, `lib/listening-programme-once-playback.mjs`; `frontend/tests/listening-programmes-next-behavior.test.mjs` (đọc nguồn); React test `listening-programme-form-scope.test.tsx`, `listening-programme-replay-stop.test.tsx`; journey `verify-listening-programme-context-flow.mjs` (chạy trong CI), `verify-listening-programme-guided-flow.mjs` (có file nhưng **không** nằm trong `next-native-browser.yml`).
- Việc làm: 1) Nhánh cờ bật: nút hoàn thành mở hộp nộp tiếng Việt (FR-08-035); trạng thái lưu ở thanh trên; dải câu dùng `navigator-model` thay chip "Đường nghe"; trình phát dùng `audio-player` policy `practice` (A–B) hoặc `once`. 2) Bản nhúng trong trang 80 ngày (`embedded`) chỉ đổi phần thân, không thêm thanh trên thứ hai. 3) Chạy được `verify-listening-programme-guided-flow.mjs` tại máy và ghi kết quả vào PR.
- Nghiệm thu: hai journey trên xanh ở cả hai nhánh; React test cũ xanh; thử tay trên staging Day 52 và một bài General "Vận dụng": nộp khi còn câu trống thì hiện hộp liệt kê câu trống; Esc quay lại không nộp.
- Không làm: không đổi `POST .../submit` (body rỗng), `PATCH .../answers`, `reveal`, `playback-started`.
- Vướng mắc → cách gỡ: một trang 80 ngày có thể chứa nhiều `ProgrammeFormRunner` (mỗi Part một cái, prop `active`) → hộp nộp và dải mất mạng gắn theo runner đang `active`, không gắn toàn cục; BroadcastChannel khoá theo `attemptId` từng runner. `submit()` thoát sớm khi còn `revealPromises` → hộp nộp phải chờ hoặc báo "Đang đối chiếu, chờ một chút", không nuốt lần bấm.
- Ước lượng: 2 phiên · độ khó 3.

### G08-T12 — Soạn spec S4 Listening full test, PR spec, DỪNG
- Đầu vào: FR-08-036 + FR khung; `specs/0008`, `0016`, `0054-listening-skill-drill-homework` (drill dùng cùng trình test).
- Ước lượng: 1 phiên · độ khó 2.

### G08-T13 — Chuẩn bị dữ liệu thử Listening test trên staging (chỉ đọc + fixture)
- Mục đích: staging không có đề Listening test/mini test nào (báo cáo 09a: `/listening/tests` rỗng), nên không có cách nghiệm thu thật.
- Việc làm: 1) Kiểm bằng `GET /api/listening/tests` trên staging với tài khoản QA. 2) Nếu rỗng: dùng fixture có sẵn của `verify-listening-test-session-flow.mjs` và `verify-listening-player-overflow-flow.mjs` cho nghiệm thu tự động; nhập đề thử lên staging thuộc quy trình nội dung, chỉ làm khi anh Andy cho (mục 10 câu 6).
- Đầu ra: ghi chú trong PR spec S4 (không mã), hoặc PR `content` nếu được cho nhập.
- Ước lượng: 1 phiên · độ khó 2.

### G08-T14 — Listening full test dùng khung sau cờ (sau G10)
- Đầu vào: `listening-test-session.tsx`, `lib/listening-test-controller.mjs`; test đọc nguồn `listening-test-native-controller.test.mjs`, `core-operation-integration.test.mjs`, `mock-exam-next-*.test.mjs`; journey `verify-listening-test-session-flow.mjs`, `verify-listening-player-overflow-flow.mjs`, `verify-listening-tests-flow.mjs`, `verify-listening-mini-test-flow.mjs`, `verify-listening-skills-flow.mjs`, `write-flows/listening-test-class-item.mjs`.
- Việc làm: như T07 cho Listening: `listening-test-room.tsx`, rẽ nhánh một chỗ, giữ `submitBlocked` khi còn câu chưa lưu, trình phát policy `test`, bỏ email khỏi thanh trên, `mock_embed` theo FR-08-020, `noRedirect` ở nhánh mới.
- Nghiệm thu: toàn bộ journey trên xanh ở hai nhánh; Playwright thêm cho hết giờ, tải lại giữa Part 3 (thời điểm audio tiếp tục từ `listeningResumeOffsetSeconds`), offline lúc nộp.
- Vướng mắc → cách gỡ: sau G10, import từ `routers/listening.py` có thể đổi sang gói `routers/listening/` → test backend không bị ảnh hưởng vì gói này không sửa backend; chỉ cần rebase. Audio test có cue `section_start` tự đổi Part (L875–881) → dải câu phải theo `activeSection` của trình, không tự quản.
- Ước lượng: 3 phiên · độ khó 4.

### G08-T15 — Soạn spec S5 Mock, PR spec, DỪNG
- Đầu vào: FR-08-037 + FR khung; `specs/0006-admin-mock-test-operations`, `0008-mock-attempt-integrity`, `0016-mock-content-remediation`, `0037-mock-paper-updated-at-and-hide-warning`.
- Ghi trong spec: runner là chủ đồng hồ và nút nộp; trang con nhúng không có. Thứ tự `mock-flush` → `flush-ack` → `submit` không đổi. Spec S5 (`EXAMMOCK-0071`) gồm cả FR-08-043, 044 (phía học viên của kỳ thi được giao, T22): cổng đọc `mock_exam_audiences`, `live`/`self_paced` (các phần chạy liền nhau theo hợp đồng đồng hồ ở GOI-09 mục 5.5), kỳ thiếu kỹ năng, một lần; ghi quan hệ với MOCKORG-0086 của G09.
- Ước lượng: 1 phiên · độ khó 2.

### G08-T16 — Mock dùng khung sau cờ (sau T07, T14)
- Đầu vào: `mock-exam-runner.tsx` (`WritingWorkspace` L269, `ConnectionState` L43, iframe L1220, `postMessage` L938), `lib/mock-exam-model.mjs`; journey `verify-mock-exam-flow.mjs` (691 dòng, trong CI), `verify-mock-ui-remediation-flow.mjs` (không trong CI), `write-flows/reading-exam-mock-sitting.mjs`.
- Việc làm: thanh trên runner dùng `ExamRoomShell` (không có `layout` split ở runner; thân là iframe); Writing Mock dùng trình soạn chế độ test; giữ bản sao `localStorage` của Writing Mock (`localDraftKey`) và `chooseWritingDraft`.
- Nghiệm thu: `verify-mock-exam-flow.mjs` xanh hai nhánh; chạy tay `verify-mock-ui-remediation-flow.mjs`; thử tay staging chỉ khi admin mở được một kỳ thi thử cho tài khoản QA (mục 10 câu 6).
- Vướng mắc → cách gỡ: iframe Reading/Listening đọc cờ riêng → khi Mock bật mà Reading chưa bật, trang con vẫn dùng giao diện cũ trong iframe; spec S5 quy định Mock chỉ bật khi `reading` và `listening` đã bật. Nút thoát của runner: "Leave test" theo FR-08-011, không có "Abandon test". `document.body.inert = true` khi flush (Reading L1081) → khung con không được đặt tiêu điểm vào nút sau khi inert.
- Ước lượng: 2 phiên · độ khó 4.

### G08-T17 — Soạn spec S6 Speaking, PR spec, DỪNG
- Đầu vào: FR-08-038 + FR khung; `specs/0010` (nháp chuẩn bị Speaking); tờ `BaiTapSpeaking`, `ThanhPhanKhungTrang` mục 6 (thanh tập trung khi ghi âm).
- Ước lượng: 1 phiên · độ khó 2.

### G08-T18 — Speaking: micro và ghi âm sau cờ
- Mục đích: S6 phần 1. Làm sau vì `practice.js` 6.036 dòng mệnh lệnh, giao diện vẽ qua `_updateNativeView` vào các cầu nối `practice-recorder-bridge.tsx`, `practice-player-bridge.tsx`, `practice-submission-bridge.tsx`; có 15 test đọc nguồn `js/practice.js` (ví dụ `speaking-length-gate.test.mjs`, `practice-recorder-mime-lane.test.mjs`, `core-player-affinity.test.mjs`).
- Việc làm: 1) Trạng thái micro bốn ca (FR-08-038) dựa trên kết quả `getUserMedia`/`navigator.permissions` mà `practice.js` đã nhận; hiện bằng React trong cầu nối. 2) Trạng thái ghi âm, im lặng, quá ngắn. 3) Thanh tập trung chế độ luyện có "‹ Thoát" + đồng hồ đếm lên.
- Nghiệm thu: `node frontend/tooling/verify-speaking-flow.mjs`, `write-flows/speaking-*.mjs`, bộ `npx playwright test -c frontend/playwright.speaking-regression.config.js` xanh; thử tay trên staging bằng trình duyệt có micro giả (`--use-fake-device-for-media-stream`), không ghi âm trên production.
- Không làm: không đổi `MIN_RECORD_SEC`, MIME, định dạng tải lên `POST /sessions/{id}/responses`.
- Vướng mắc → cách gỡ: logic quyết định trong `practice.js` mà test đọc nguồn ghim chuỗi → thêm sự kiện trạng thái mới phát ra từ `practice.js` (một dòng `_updateNativeView('mic', …)`) thay vì chuyển logic; chuỗi tiếng Việt trong `practice.js` giữ cho nhánh cũ. Hộp xin quyền gốc của trình duyệt nằm ngoài trang → trạng thái "Đang chờ trình duyệt" phải hiện ngay khi gọi `getUserMedia`, không đợi kết quả.
- Ước lượng: 2 phiên · độ khó 5.

### G08-T19 — Speaking: rời bài và nộp bằng hộp trong trang
- Việc làm: thay `window.confirm` ở `_canLeave` (L272–277) và L5264 bằng hộp trong trang khi cờ bật (giữ nhánh `typeof window.confirm !== 'function'` hiện có cho trình cũ); hộp nộp theo FR-08-034.
- Nghiệm thu: journey bắt `dialog` ghi 0 hộp gốc ở nhánh mới; `write-flows/speaking-record-submit.mjs` thêm `clickIfPresent` cho nút xác nhận mới và xanh hai nhánh.
- Vướng mắc → cách gỡ: `_canLeave` được gọi đồng bộ từ điều hướng → hộp trong trang là bất đồng bộ; chặn điều hướng trước (huỷ sự kiện), mở hộp, rồi điều hướng lại bằng mã khi người dùng chọn "Bỏ đoạn ghi và thoát".
- Ước lượng: 1 phiên · độ khó 4.

### G08-T20 — Spec S7 và Quick Check/flashcard theo khung (hai PR: spec rồi mã)
- Đầu vào: `(authed-quiz-player)`, `(flashcard-study)`; journey `verify-quiz-flow.mjs`, `verify-grammar-managed-quiz-flow.mjs`, `verify-grammar-quiz-history-flow.mjs`; tờ `BaiTapTuVungNguPhap`.
- Việc làm: spec như T01 (PR riêng, dừng); sau duyệt: dạng câu từ T04 chế độ luyện, flashcard vừa màn hình, nút chấm sau khi lật (FR-08-039).
- Nghiệm thu: các journey trên xanh hai nhánh; ảnh 1280×800 và 390×844 cho thấy nút lật/chấm không cần cuộn.
- Ước lượng: 2 phiên (1 spec + 1 mã) · độ khó 3. Đếm là 2 PR.

### G08-T21 — Gỡ nhánh cờ tắt của từng trình sau nghiệm thu (mỗi trình một PR)
- Mục đích: sau khi anh Andy nghiệm thu một trình trên production, xoá nhánh giao diện cũ trong file React (không xoá `frontend/pages/*.html` và `public/js/*.js` — việc của G10).
- Điều kiện bắt đầu: anh Andy ghi rõ "nghiệm thu <trình>"; trình đã bật trên production ít nhất 7 ngày không có lỗi mới trong log `exam_room_*` và `/admin/error-logs`.
- Nghiệm thu: journey của trình xanh; test đọc nguồn vỡ do xoá nhánh cũ được sửa trong cùng PR và liệt kê.
- Ước lượng: 0,5 phiên mỗi trình (7 trình ≈ 4 phiên, tính 1 PR mỗi trình nhưng chỉ tính một dòng trong bảng) · độ khó 2.

### G08-T22 — (mới) Mock test được giao phía học viên: người dự thi, `live`/`self_paced`, từng phần (high-risk; 2 PR)
- Mục đích: FR-08-043, 044; điểm "GOI-08" trong bảng "chỗ gói khác phải khớp" của GOI-09 mục 7.
- Đầu vào: GOI-09 mục 5.5 (mô hình người dự thi, `exam_mode_v2`, cờ `mock_exam_audiences_learner`), G09-T31, T33; `backend/routers/mock_exams.py` (dòng ~153 tạo sitting, ~205 đọc `exam_mode` mặc định `sequential`), `services/mock_exam_service.py`; tờ `ThiThu`, `ThiThuTruocGio`, `PhongThi`; spec S5 đã duyệt.
- Việc làm: PR 1 (backend): cổng vào phòng và API danh sách kỳ thi của học viên đọc `mock_exam_audiences` khi cờ `mock_exam_audiences_learner` bật (cờ tắt → đường cũ `cohort_id`/`mock_exam_assignments` y nguyên); đọc `exam_mode_v2`; kỳ thiếu kỹ năng; `self_paced` theo hợp đồng 8 điểm của GOI-09 mục 5.5 và dùng chung hàm thuần `services/mock_exam_modes.py::self_paced_timeline(sitting, exam, now)` của G09-T31 (không viết công thức đồng hồ lần hai): (i) bắt đầu chỉ trong khoảng mở của người đó, ghi mốc phần đầu; (ii) khi một phần được nộp hoặc hết giờ, **máy chủ** ghi mốc `<phần kế>_started_at` ngay (cộng `MOCK_SELF_PACED_GAP_SECONDS`), không chờ người học bấm; (iii) phần hết giờ chưa nộp → tự nộp phần đã làm; job `reap_expired_retake_sittings` (`services/mock_exam_service.py`, dòng ~3565 theo GOI-09 — `CHƯA KIỂM` lại số dòng: `grep -n "def reap_expired_retake_sittings\|def retake_active_section" backend/services/mock_exam_service.py`) đi hết chuỗi phần còn lại; (iv) `retake_active_section` (dòng ~656–700) với sitting `self_paced` tạo sau khi cờ bật không còn trả `not_started` giữa hai phần: chỉ trả phần đang chạy hoặc `done`; sitting `retake` cũ đang dở giữ cách cũ tới khi xong; (v) một sitting `main` mỗi người mỗi kỳ; (vi) trả trạng thái từng phần (`not_started`, `in_progress`, `submitted`, `marking`, `released`) kèm `started_at`, `ends_at` theo máy chủ và `expected_end_at` của cả bài; người không trong danh sách → 404. PR 2 (frontend): runner dựng theo danh sách phần và tự chuyển sang phần kế theo mốc máy chủ (bỏ màn chọn phần và hai nút "Start next section", "Continue later"); màn vào bài của kỳ `self_paced` có tổng thời lượng và câu `selfPacedNotice`; phòng chờ `live`; phiếu của kỳ có "Đang chấm" từng phần. Tờ `thiet-ke/MockTestDuocGiao.dc.html` là tờ của phía học viên; chỗ nào tờ còn cho nghỉ giữa các phần thì 00 mục 2 điểm 23 thắng, ghi khác biệt trong PR.
- Nghiệm thu: pytest: học viên lớp thứ hai trong danh sách vào được kỳ live, người ngoài danh sách 404; kỳ `self_paced` ba phần (đồng hồ giả): nộp phần 1 ở phút 10 → `<phần 2>_started_at` bằng đúng lúc nộp, không cần lời gọi "bắt đầu phần" nào; không nộp phần 2 → hết giờ thì phần 2 ở trạng thái `submitted` với phần đã làm và phần 3 đã có mốc bắt đầu; chạy job quét một lần sau khi cả ba phần quá giờ → cả ba `submitted`; giữa chừng `retake_active_section` không bao giờ trả `not_started`; bắt đầu sau `open_until` → 409; đã bắt đầu trước `open_until` thì nộp được phần 3 sau `open_until`; không tạo được sitting thứ hai; test React: DOM của runner `self_paced` không có chuỗi "Continue later" và "Start next section"; cờ tắt → mọi test mock hiện có xanh không sửa. `verify-mock-exam-flow.mjs` xanh hai nhánh. Staging: kỳ QA do G09 tạo cho hai lớp thử.
- Lượt chấm (thêm 18/11 theo rà soát): mock test được giao không trừ lượt, cả Writing lẫn Speaking (GOI-04 5.6, `metered=False, reason='mock'`) (mặc định tạm 18/11, chờ anh Andy xác nhận); không hiện dòng lượt ở trang kỳ thi và phòng thi; tờ MockTestDuocGiao, ThiThu ghi khác thì gói thắng.
- Không làm: không đổi API admin (G09); không đổi cách chấm; không cho làm lại (thi bù do admin cấp ở G09); không dựng danh sách kỳ thi ở `/tests` (G07-T16).
- Vướng mắc → cách gỡ: G09-T31 chưa merge → dừng (không tự tạo bảng người dự thi). Tờ `MockTestDuocGiao` đã sửa theo điểm 23 (đã bắt đầu thì các phần chạy liền nhau, không nghỉ; đối chiếu 18/11 tối) → dựng theo tờ; chỗ thiếu dựng từ tờ ThiThu, ThiThuTruocGio và thành phần G03, ghi khác biệt với tờ trong PR. Sau khi merge và bật cờ: báo G09 để `schedule` thôi trả 422 `learner_gate_not_ready`.
- Ước lượng: 3 phiên · độ khó 5.

### G08-T23 — (mới) "Abandon test" và màn hết giờ với bài dở của đề tự chọn (high-risk)
- Mục đích: FR-08-041, 042.
- Đầu vào: tờ `ThiThu` (ghi chú "Hết giờ"), `PhongThi`, `PhongThiNgheViet`, `PhongThiSpeaking`; route đóng lượt của từng trình (`reading_student.py`, router Listening test, `sessions.py`); G04 mục 5.6 (giữ chỗ/chốt/hoàn lượt).
- Việc làm: 1) CHƯA KIỂM từng trình đã có trạng thái "bỏ" cho lượt chưa (`grep -n "abandon\|discard\|cancel" backend/routers/reading_student.py backend/routers/sessions.py | head`); chưa có → thêm trạng thái/route đóng lượt không chấm trong spec của trình đó (migration trong dải 460–469 nếu cần cột). 2) Nút và hai hộp theo FR-08-041. 3) Writing/Speaking tự chọn: màn "Time is up" hai lựa chọn; "Send for marking" mới gọi giữ lượt của G04; "Discard" không gọi. 4) Lượt đã bỏ không xuất hiện ở bảng kết quả `/tests` và Tiến độ.
- Nghiệm thu: pytest: bỏ bài → lượt đóng, không có dòng `credit_ledger`, làm lại tạo lượt mới; Writing hết giờ 80 từ → chưa có dòng `reserve` cho tới khi chọn chấm; mock test được giao không có route bỏ. Journey bắt `dialog` = 0.
- Không làm: không thêm "Abandon test" cho mock test được giao; không đổi ân hạn 5 phút.
- Vướng mắc → cách gỡ: tờ chưa vẽ nút bỏ bài và màn hết giờ ở Reading, Speaking (04-VIEC-DE-LAI mục C) → dựng từ hộp chung của khung, ghi trong PR; thời hạn chờ chọn chưa chốt → cấu hình (mục 10 câu 12).
- Ước lượng: 2 phiên · độ khó 4.

### G08-T24 — (mới) Đăng nhập lại trong phòng thi; phiên bị chiếm; nguồn "bài có giờ" cho G04 (high-risk: auth)
- Mục đích: FR-08-014, 014a, 045.
- Đầu vào: GOI-04 mục 5.13 (`services/timed_work.py::active_timed_work`, các nguồn (c), (d) G04 ghi CHƯA KIỂM), G04-T09; GOI-05 mục 5.2b, G05-T19 (component đăng nhập), G05-T20 (màn 8a–8c); `backend/migrations/087_reading_test_attempts.sql`, `068_listening_test_attempts.sql`, `routers/sessions.py` (full test Speaking).
- Việc làm: 1) Hàm `backend/services/exam_timed_sources.py::timed_attempts_for_user(user_id) -> list[TimedWork]` gom các lượt có giờ của gói (FR-08-045); nối vào `timed_work.active_timed_work` của G04 (sửa đúng chỗ G04 để sẵn cho nguồn (c), (d); G04-T09 chưa merge thì để hàm sẵn và nối sau). 2) Hộp đăng nhập lại trong phòng thi (Google hoặc mã 6 số) dùng component G05-T19; không rời URL; đồng hồ không dừng. 3) Xử lý 401 `session_displaced` và 409 `session_not_current` qua `onSessionConflict`.
- Nghiệm thu: pytest: lượt Reading `in_progress` còn giờ → `active_timed_work` khác None; lượt đã hết giờ hoặc đã nộp → None; lỗi đọc → ném lỗi (G04 coi như có bài có giờ). Kịch bản E10b của GOI-04 chạy với một lượt Reading test thật trên staging: thiết bị 2 không chiếm được phiên. Journey: 401 giữa bài → đăng nhập lại bằng mã → về đúng câu, bản sao máy được lưu.
- Không làm: không sửa `session_gate.py`; không tự suy "đang làm bài có giờ" ở trình duyệt.
- Ước lượng: 1 phiên · độ khó 4.

### G08-T25 — (mới) Writing tự luyện giữ lượt; Speaking thi thử không trừ lượt (high-risk: AI trả phí)
- Mục đích: FR-08-044, 046; khớp GOI-04 mục 5.6, 5.7, G04-T08.
- Đầu vào: `backend/routers/writing_student.py` (`get_current_student` dòng 127, `submit_my_assignment` dòng 1790), `services/essay_service.py` (`create_essay_row_only`, `schedule_grading_job`, `reserve_writing_credit` sau G04-T08), `credits.resolve_review_mode`, `credits.charge_plan`; GOI-04 mục 7 dòng "Người đăng ký chưa có hồ sơ `students`".
- Việc làm: 1) Route Writing tự luyện cho người có quyền khoá (không đòi bài giao): tạo bài bằng `create_essay_row_only` với `review_mode`, gọi `reserve_writing_credit`, rồi `schedule_grading_job`; `CreditRefused` → 402/403, xoá hoặc không tạo bài mồ côi. 2) Hồ sơ `students` cho người đăng ký online: route tự luyện không đòi `students` (dùng `user_id`); nếu mã hiện tại buộc phải có thì dừng và hỏi (mục 10 câu 14). 3) Speaking của mock test được giao: bảo đảm đường nộp không tạo tác vụ chấm AI và không gọi RPC lượt (test đếm lời gọi). 4) Hộp nộp và khối "Hết lượt chấm" theo FR-08-034.
- Nghiệm thu: pytest (grader giả): còn 1 lượt → nộp hai bài tự luyện đồng thời → một chấm, một 402 `credit_source=online`; chấm lỗi → hoàn lượt; Speaking mock → 0 lời gọi `fn_credit_reserve`, 0 lời gọi provider. Không gọi AI trả phí trong test.
- Không làm: không đặt trừ lượt ở tầng provider; không đổi luồng duyệt của bài lớp; không viết lại `reserve_writing_credit`.
- Vướng mắc → cách gỡ: G04-T08 chưa merge → dừng. Trình soạn Writing hiện chỉ mở từ bài giao → trang đề tự luyện (Thư viện G06, hub Writing G07) trỏ tới trình soạn với tham số đề; ghi rõ đường vào trong spec S2.
- Ước lượng: 2 phiên · độ khó 5.


### G08-T26 — (mới 18/11 tối) Khung mới cho các trang luyện kỹ năng, Sách bài tập, ngữ pháp, từ vựng, phát âm của học viên
- Mục đích: dựng lại giao diện theo bộ thiết kế cho các trang học viên đã có tờ nhưng chưa có nhiệm vụ (rà soát độ phủ 18/11, P-05).
- Đầu vào: tờ `ChuongTrinhKyNang` (lịch 80 ngày, `/listening/ielts/80-days`, `/listening/general`, `/listening/skills`, `/reading/skill*`), `SachBaiTap` (`/listening/exercise-book/*`), `NguPhapHocVien` (Grammar Check-up và bài ngữ pháp được giao), `TuVungHocVien` (hub từ vựng), `BaiTapPhatAm` (bài phát âm khoá); bảng trang ở `02-BANG-PHU-THIET-KE.md`; khung và component G03; đường dẫn mới của G07 (T08, T09).
- Việc làm: mỗi nhóm một PR sau cờ của trang (cây cũ giữ khi tắt): (1) ChuongTrinhKyNang; (2) SachBaiTap; (3) NguPhapHocVien; (4) TuVungHocVien; (5) BaiTapPhatAm. Chỉ đổi giao diện, giữ API và cách chấm. Bài phát âm Course 1 (Azure): không trừ lượt lớp ở đợt này (mặc định tạm 18/11, chờ anh Andy xác nhận); `01` mục 7.3 câu 44.
- Đầu ra: 5 PR.
- Nghiệm thu: mỗi PR: test React của trang theo trạng thái rỗng, đang tải, lỗi; ảnh chụp 1280px và 390px so với ảnh mốc của G10(a); test cũ của trang qua không sửa (hoặc sửa có lý do ghi trong PR).
- Không làm: không đổi URL (việc của G07); không đổi backend chấm; không đụng dây chuyền Hermes.
- Vướng mắc → cách gỡ: trang dùng chung CSS cũ với trang khác → tách bằng tiền tố `--av2-` như G03, kiểm ảnh trang kia không đổi.
- Ước lượng: 5 phiên · độ khó 3.


### Bảng tổng ước lượng

| Nhiệm vụ | PR | Phiên | Độ khó |
|---|---|---|---|
| T01 spec S0 | 1 | 1 | 2 |
| T02 lib | 1 | 1 | 2 |
| T03 khung | 1 | 2 | 4 |
| T04 dạng câu | 1 | 2 | 3 |
| T05 audio, highlight | 1 | 2 | 3 |
| T06 spec S1 | 1 | 1 | 2 |
| T07 Reading | 1 | 3 | 4 |
| T08 spec S2 | 1 | 1 | 2 |
| T09 Writing | 1 | 2 | 4 |
| T10 spec S3 | 1 | 1 | 2 |
| T11 Listening luyện | 1 | 2 | 3 |
| T12 spec S4 | 1 | 1 | 2 |
| T13 dữ liệu thử Listening | 0–1 | 1 | 2 |
| T14 Listening test | 1 | 3 | 4 |
| T15 spec S5 | 1 | 1 | 2 |
| T16 Mock | 1 | 2 | 4 |
| T17 spec S6 | 1 | 1 | 2 |
| T18 Speaking micro/ghi | 1 | 2 | 5 |
| T19 Speaking nộp/rời | 1 | 1 | 4 |
| T20 spec+mã S7 | 2 | 2 | 3 |
| T21 gỡ nhánh cũ | 7 | 4 | 2 |
| T22 mock test được giao phía học viên (mới) | 2 | 3 | 5 |
| T23 Abandon test, hết giờ bài dở (mới) | 1 | 2 | 4 |
| T24 đăng nhập lại, bài có giờ (mới) | 1 | 1 | 4 |
| T25 Writing tự luyện giữ lượt, Speaking mock (mới) | 1 | 2 | 5 |
| T26 khung mới năm nhóm trang học viên (mới 18/11 tối) | 5 | 5 | 3 |
| **Tổng (26 nhiệm vụ)** | **38–39** | **49** | |

## 7. Vướng mắc chung của gói và cách tháo gỡ

| Tình huống | Dấu hiệu nhận biết | Cách gỡ | Khi nào dừng và hỏi |
|---|---|---|---|
| Test đọc mã nguồn vỡ | `assert.match(page, /…/)` đỏ trong `reading-exam-native-controller.test.mjs`, `writing-dashboard-redesign.test.mjs`, `listening-programmes-next-behavior.test.mjs`, test có `readFileSync` | Giữ logic và các chuỗi bị ghim ở file cũ, chỉ chuyển phần vẽ sang file mới; test vỡ do đổi có chủ ý thì sửa cùng PR, liệt kê từng test và lý do; không thêm test mới kiểu đọc nguồn | Hơn 30 test vỡ ngoài dự kiến |
| Đổi renderer làm backend từ chối | `invalid-reading-renderer-affinity`, 409 ở `renderer-affinity` | Nhánh mới vẫn gửi `renderer_affinity: 'next'`; không thêm giá trị | Thấy cần giá trị renderer mới |
| 401 đá sang `/login` giữa bài | Trang đổi URL sang `/login` khi token hết hạn | Nhánh mới truyền `{ noRedirect: true }` cho mọi lời gọi trong phòng thi; xử lý 401 bằng hộp phiên hết hạn | Một lời gọi đi qua hàm không nhận `opts` (ví dụ `window.api.get` một tham số) — đổi sang biến thể `getWith`; nếu không có biến thể, hỏi |
| CSS cũ đè khung mới | Layout dùng `bodyClass="exam-chrome …"` và nạp `reading-exam.css`, `listening-test-ui.css` | CSS module có gốc `[data-exam-room]`, độ ưu tiên đủ; không sửa thứ tự trong `authed-shell.tsx`; không gỡ stylesheet cũ khỏi layout (nhánh cũ còn dùng) | Phải đổi `pageStylesheets` hoặc cascade |
| Mock nhúng trộn hai giao diện | Runner mới, iframe cũ hoặc ngược lại | Bật Mock chỉ sau khi `reading` và `listening` bật; chế độ nhúng chỉ đổi thân | — |
| Nộp hai lần | Hai request `/submit` cùng lượt | Khoá nút khi `onSubmit` chạy; giữ các khoá sẵn có (`submitLock`, `autoSubmittedRef`, phase `submitting`); backend Reading đã trả biên nhận "sealed" cho lần lặp | Thấy hai bản ghi điểm cho một lượt |
| Cờ bị kẹt bật trên production | Không tắt được nhanh khi lỗi | Phương án A: Vercel Instant Rollback về bản trước khi bật; phương án B: tắt khoá trong `/admin/runtime-flags` | — |
| Đồng hồ máy học viên lệch | Còn giờ trên màn nhưng server báo hết | Thời gian còn lại luôn tính từ `started_at` của server như `readingRemainingSeconds`; không thêm đồng hồ thứ hai | — |
| Ghi đè `?exam_room=on` bị mất sau `/core-player/launch` | Redirect 307 bỏ tham số lạ hoặc trả 400 | Chỉ dùng ghi đè trên URL trình đích (`/reading/exam/session?...&exam_room=on`), không đi qua `launch` | — |
| Journey không nằm trong CI | `verify-listening-programme-guided-flow.mjs`, `verify-mock-ui-remediation-flow.mjs` không có trong `next-native-browser.yml` | Chạy tay, dán lệnh + kết quả vào PR; thêm vào workflow là việc riêng (không đổi tên job bắt buộc) | Muốn thêm job CI mới |
| Staging thiếu dữ liệu | `/listening/tests`, `/reading/mini-test`, `/full-test` rỗng | Nghiệm thu bằng fixture của journey; ghi "chưa kiểm trên staging thật" | Cần nhập đề hoặc mở kỳ thi |
| `runtime-config.js` bị commit đã cấu hình | `git diff` thấy origin staging trong `frontend/public/js/runtime-config.js` | `git checkout -- frontend/public/js/runtime-config.js` | — |

## 8. Ràng buộc riêng của gói

1. Trong T01–T21 không đổi bất kỳ request nào (method, path, body, header, thứ tự) của 7 trình. Bằng chứng: journey có danh sách `writes` (write-flows) xanh ở cả hai nhánh cờ. T22–T25 có đổi backend, mỗi cái sau cờ riêng và có spec high-risk; cờ tắt thì request y như cũ.
2. Không sửa `frontend/pages/*.html`, `frontend/public/js/reading-exam.js`, `listening-*.js`, `mock-exam-runner.js` (đường quay lui affinity). Ngoại lệ: `practice.js` chỉ thêm phát sự kiện trạng thái (T18, T19), không đổi logic ghi/tải.
3. Mỗi PR mã chỉ một trình. Không bật cờ production trong PR; bật production chỉ khi anh Andy nói rõ cho trình đó.
4. Nhánh cờ tắt phải giống hệt hiện tại: không đổi id DOM, chuỗi, class.
5. Không in email/tên/mã học viên trong phòng thi; ảnh chụp đính PR dùng tài khoản QA và che email.
6. Không ghi âm, nộp bài, hay làm đề trên production. Mọi thử tay ở staging với tài khoản QA.
7. Bài làm thử trên staging ghi rõ trong PR (đề nào, lượt nào) để admin dọn được.
8. (18/11 chiều) Bài làm xem được tới 45 ngày sau khi quyền khoá cuối cùng hết hạn (GOI-04 mục 5.14, cờ `retention_by_entitlement`). Trang xem lại bài và phiếu của gói này nhận 410 `content_expired` từ API thì hiện màn "Bài này đã hết thời hạn xem." của G07 (FR-07-060b), không hiện màn lỗi chung và không thử lại. Bản ghi âm vẫn tối đa 60 ngày kể từ lúc ghi.
9. (18/11 chiều) Kỳ `self_paced`: không thêm bất kỳ nút, màn hay tham số nào cho phép người học hoãn phần kế. Đồng hồ chỉ có một nguồn là máy chủ (`self_paced_timeline` của G09-T31).

## 9. Kiểm thử và bằng chứng hoàn tất của cả gói

### 9.1 Journey có sẵn: phủ trình nào, cái nào phải cập nhật

| Journey / bộ test | Phủ | Trong CI? | Việc trong gói |
|---|---|---|---|
| `frontend/tests/reading-native/*.spec.js` (job `reading-native-layout`, không bắt buộc) | Reading exam: boot, rehydrate timer, autosave, submit, share, pagehide flush | có | T07 thêm `exam-room.spec.js`; bộ cũ phải xanh khi cờ tắt |
| `write-flows/reading-exam-submit.mjs`, `-save-on-submit`, `-nothing-saved`, `-share`, `-mock-sitting` (qua `verify-write-flows.mjs`) | 4 đường ghi của Reading | có | T07: thêm `clickIfPresent` nếu nút nộp đổi |
| `verify-reading-test-flow.mjs`, `verify-reading-mini-test-flow.mjs` | Trang danh sách đề, không vào phòng thi | có | Không cần đổi |
| `verify-writing-admission-flow.mjs`, `-dashboard-layout-flow`, `-dashboard-tab-scroll-flow`, `-content-history-flow`; `write-flows/writing-submit.mjs` | Writing mở bài, lưu nháp, nộp (tự bấm Đồng ý hộp gốc) | có | T09: thêm `clickIfPresent` |
| `verify-listening-programme-context-flow.mjs` | Programme form → result | có | T11 chạy hai nhánh |
| `verify-listening-programme-guided-flow.mjs` | Đối chiếu từng câu | **không** | T11 chạy tay |
| `verify-listening-test-session-flow.mjs`, `-player-overflow-flow`, `-tests-flow`, `-mini-test-flow`, `-skills-flow`; `write-flows/listening-test-class-item.mjs` | Listening full test | có | T14 |
| `verify-mock-exam-flow.mjs` | Runner Mock | có | T16 |
| `verify-mock-ui-remediation-flow.mjs` | Giao diện Mock sau sửa | **không** | T16 chạy tay |
| `verify-speaking-flow.mjs` (chỉ tạo phiên ở `/speaking`), `write-flows/speaking-*.mjs`, `playwright.speaking-regression.config.js` | Speaking | có / có / CHƯA KIỂM job | T18, T19 |
| `verify-quiz-flow.mjs`, `verify-grammar-managed-quiz-flow.mjs`, `verify-grammar-quiz-history-flow.mjs` | Quick Check | có | T20 |
| `verify-next-responsive-flow.mjs`, `verify-mobile-layout-flow.mjs` | Bố cục chung desktop/điện thoại | có | Chạy lại sau T07, T09 |

### 9.2 Kịch bản đầu–cuối (dùng cho `spec.md` từng spec)

1. **Nộp còn câu trống (mọi trình có nộp).** Given học viên đã trả lời 37/40 câu Reading test, When bấm "Submit test", Then hiện hộp Warning liệt kê "Q7, Q12, Q13", nút chính "Submit test" đỏ mận và "Return to test"; When bấm "Return to test", Then không có request `/submit`, tiêu điểm về nút "Submit test".
2. **Listening luyện trước đây nộp ngay.** Given Day 52 còn 5/6 câu trống, When bấm "Hoàn thành và xem lại", Then hiện hộp "Cảnh báo · Nộp bài khi còn 5 câu chưa trả lời?"; chỉ khi bấm "Nộp bài" mới có `POST .../submit`.
3. **Kéo tỉ lệ và tải lại.** Given Reading test đang ở 50/50, When kéo tay nắm tới 64% rồi tải lại trang, Then trở lại đúng lượt, đúng câu trả lời, 64%, cùng Passage; When bắt đầu lượt mới, Then 50/50.
4. **Hết giờ khi đang gõ.** Given còn 2 giây và học viên đang gõ "dozen pie", When đồng hồ về 0, Then ô khoá, body `/submit` chứa "dozen pie", hiện "Time is up"; không có hộp hỏi.
5. **Mở hai tab.** Given lượt đang mở ở tab A, When mở cùng URL ở tab B, Then tab B báo "This test is open in another tab." và không gửi `PATCH`; When bấm "Use this tab" ở B, Then A chuyển chỉ-đọc, B ghi được.
6. **Mất mạng lúc nộp.** Given DevTools Offline, When bấm "Submit test", Then nút ghi "Waiting for connection" và bị khoá, dải "Connection lost…" hiện giờ lưu cuối; When bật mạng lại, Then phần chưa lưu được lưu, dải "Back online…" 5 giây, nút nộp mở lại; không có màn lỗi toàn trang.
7. **Phiên hết hạn.** Given token đã hết hạn (giả 401 từ `PATCH /answers`), When học viên gõ câu tiếp, Then không chuyển trang, hiện hộp "Your session has expired" một nút; When đăng nhập lại, Then quay về đúng URL phòng thi, câu vừa gõ còn (từ bản sao máy) và được lưu.
8. **Bài nghe.** Given Listening full test (chế độ thi), When đang phát, Then không có nút tạm dừng, tua, tốc độ. Given bài luyện "Vận dụng" nghe một lần, When bấm bắt đầu, Then có hộp hỏi lại trước; có nút tạm dừng, không tua lùi; khi mất mạng giữa chừng, Then báo phút dừng và nút tiếp tục từ đúng phút đó.
9. **Cờ tắt.** Given `examRoomSurfaces` rỗng, When chạy toàn bộ journey ở 9.1, Then tất cả xanh như trước gói này.
10. **Writing thiếu từ.** Given bài Task 2 có 182 từ, When bấm nộp, Then hộp "Cảnh báo · Nộp chấm khi bài mới có 182 từ?" với "Viết tiếp" là nút chính; When "Vẫn nộp chấm", Then hộp "Nộp chấm bài này?" hiện; Playwright ghi 0 sự kiện `dialog`.
11. **Speaking bị chặn micro.** Given trình duyệt từ chối micro, When bấm "Bắt đầu ghi", Then hiện "Trình duyệt đang chặn micro" với ba bước và "Thử lại"; không có nút "Bắt đầu ghi âm" thứ hai im lặng.
12. **Thoát full test.** Given đang làm Reading full test tự chọn, When bấm lối thoát, Then hộp có "Continue test", "Leave test", "Abandon test" và câu "The timer keeps running while you are away."; không có chữ "Save and exit". When "Abandon test" rồi xác nhận, Then lượt đóng, không có kết quả, không trừ lượt. Given mock test được giao, Then không có "Abandon test".
13. **Điện thoại.** Given vùng nhìn 390×844, When mở Reading full test, Then màn chặn tiếng Anh có một dòng phụ tiếng Việt, không có request tạo lượt; When mở một mini test, Then vào làm được.
14. **Luôn sáng.** Given người dùng chọn giao diện Tối, When vào phòng thi full test, Then phòng thi sáng; thoát ra trang thường thì tối lại.
15. **Mock test được giao.** Given kỳ QA `self_paced` có Listening, Reading, Writing giao cho tài khoản A, không giao cho B. Then B không thấy kỳ và mở URL nhận 404; A bấm bắt đầu, làm Listening xong thấy "Section submitted. Next: Reading" rồi vào thẳng Reading với đồng hồ đã chạy (không có nút hoãn, không có màn chọn phần); A đóng trình duyệt giữa phần Reading rồi mở lại → vẫn ở Reading, thời gian còn lại đã trừ lúc vắng mặt; không mở lại được Listening, phiếu của kỳ hiện Writing "Đang chấm", không có Overall.
16. **Chiếm phiên.** Given A đang làm Reading test có giờ ở máy 1, When A đăng nhập ở máy 2, Then máy 2 thấy màn 8b không có nút chiếm phiên; máy 1 nộp bài bình thường.
17. **Hết lượt.** Given tài khoản online còn 0 lượt, When nộp Writing tự luyện, Then 402, bài còn nguyên, khối "Hết lượt chấm" có nút "Đăng ký lại".

### 9.3 Dữ liệu và môi trường

- Local: fixture trong `frontend/tooling/write-flows/fixtures/`, `next-native-fixture-api.mjs`, `reading-native-harness.js`.
- Staging: tài khoản QA (lấy theo hướng dẫn trong `docs/AGENT_WORKFLOW.md`; không in secret), đề AVR-READ-001, bài Writing "QA TEST Task 2 – do not use", Listening Day 52/54 và bài General lesson 3.
- Production: chỉ xem, không mở phòng thi bằng tài khoản thật để tránh tạo lượt.

### 9.4 Quay lui

- Mức 1: bỏ trình khỏi `examRoomSurfaces` (A: redeploy hoặc Instant Rollback; B: tắt khoá runtime flag). Lượt đang làm tải lại sẽ về giao diện cũ, cùng dữ liệu server.
- Mức 2: revert PR của trình đó trên `staging` rồi theo quy trình phát hành thường.
- Không có dữ liệu server cần sửa vì gói không đổi ghi; chỉ có khoá `localStorage` `exam-room:*` bị bỏ lại (vô hại).

### 9.5 Bằng chứng hoàn tất của gói

Với mỗi trình: PR spec đã duyệt; PR mã merged vào `staging`; journey bảng 9.1 xanh ở SHA đầu nhánh; ảnh 1280/768/390 đối chiếu tờ (full test: ảnh 390 là màn chặn; mini test và chế độ luyện: ảnh 390 của bài); bước tay trên staging có ghi lại; anh Andy nghiệm thu rồi mới bật production; báo cáo theo mẫu mục 8 quy ước, phân biệt "có ở nhánh / merged staging / bật production / anh nghiệm thu".

## 10. Cần anh Andy quyết

1. **Nguồn cờ bật.** A: biến môi trường Vercel qua `runtime-config.js` (không đổi backend; tắt cần redeploy hoặc Instant Rollback, vài phút). B: bảng `runtime_flags` trả qua `GET /auth/me` (tắt trong 15 giây, nhưng thêm một trường vào API auth và phải sinh lại kiểu). Đề nghị: **B** cho production vì phòng thi là chỗ cần tắt nhanh nhất. Mặc định tạm: **A** (không đổi backend) cho tới khi anh trả lời.
2. **Tay nắm hai cột.** Tờ `PhongThi` ghi "Cách hiểu, cần anh xác nhận" vì ghi chú gốc bị cắt. Đề nghị: giữ cách hiểu trong tờ (kéo 30–70%, dưới 900px chuyển thẻ). Mặc định tạm: làm theo tờ.
3. **ĐÃ TRẢ LỜI 18/11 (00 mục 2 điểm 22):** full test không có "Save and exit", thoát ra đồng hồ vẫn chạy; đề tự chọn có "Abandon test" (FR-08-011, 041). Nội dung câu hỏi cũ: Backend Reading tính giờ liên tục từ `started_at` (60 phút, ân hạn 5 phút) và gói này không được đổi. Câu trong tờ "You can come back and continue this test later" dễ hiểu là giờ được dừng. Đề nghị: thêm câu "The timer keeps running while you are away." Mặc định tạm: thêm câu đó.
4. **Nơi lưu Highlight/Note.** Tờ yêu cầu "mở lại vẫn còn". Lưu trên máy (`localStorage` theo lượt) thì không cần backend nhưng mất khi đổi máy; lưu server cần bảng mới (ngoài gói). Đề nghị: lưu máy trong gói này, lưu server làm spec sau nếu cần. Mặc định tạm: lưu máy.
5. **ĐÃ TRẢ LỜI 18/11 (00 mục 2 điểm 22):** chế độ thi không có nút tạm dừng bài nghe; luyện từng phần thì có — bài "Vận dụng" ở chế độ luyện giữ tạm dừng (FR-08-024, 025). Nội dung câu hỏi cũ: Hiện cho tạm dừng; tờ ghi "không tạm dừng được". Đây là đổi hành vi học viên. Đề nghị: bỏ tạm dừng theo tờ. Mặc định tạm: giữ tạm dừng, ghi trong spec S3 là câu hỏi mở.
6. **Dữ liệu thử trên staging.** Không có đề Listening test/mini test và không có kỳ thi thử mở cho tài khoản QA. Đề nghị: cho nhập một đề Listening thử và mở một kỳ Mock thử trên staging cho tài khoản QA. Mặc định tạm: nghiệm thu S4, S5 bằng fixture, ghi "chưa kiểm trên staging thật".
7. **Các trình chưa đưa vào gói** (Dictation session, gist/MCQ/TF, sách bài tập Black Eye, Grammar Check-up, `/exam`). Đề nghị: làm đợt sau, dùng lại khung khi đã ổn định. Mặc định tạm: ngoài phạm vi.
8. **Thứ tự chuyển trình.** Đề nghị: Reading → Writing → Listening luyện → Quick Check/flashcard → Listening test (sau G10) → Mock → Speaking (lý do ở T07, T09, T11, T14, T16, T18). Mặc định tạm: thứ tự này.
9. **Số giây tối thiểu của bản ghi Speaking** hiện là Part 1: 15 s, Part 2: 80 s, Part 3: 25 s (`practice.js` L18); tờ để `XXX`. Đề nghị: giữ số hiện có, lấy từ phản hồi backend. Mặc định tạm: giữ.
10. **Ngưỡng chặn full test** 768px là đề xuất, chưa chốt (00 mục 2 điểm 13; GOI-11 mục 10 câu 10). Mặc định tạm: 768, cấu hình.
11. **"Abandon test" có giới hạn số lần không**, và bỏ bài có giờ làm lại ngay được không? Đề nghị: không giới hạn, làm lại ngay. Mặc định tạm: như đề nghị.
12. **Hết giờ với bài Writing/Speaking tự chọn chưa đạt mức tối thiểu:** học viên có bao lâu để chọn chấm hay bỏ; không chọn thì sao? Đề nghị: 24 giờ, không chọn thì bỏ (không trừ lượt). Mặc định tạm: `SELF_TEST_TIMEUP_CHOICE_HOURS=24`, hết hạn thì bỏ.
13. **ĐÃ TRẢ LỜI 18/11 chiều (00 mục 2 điểm 23):** mock test tự làm KHÔNG được nghỉ giữa các phần; đã bắt đầu thì làm liền các phần (FR-08-043, T22). Còn mở, dùng chung câu Q31 của GOI-09: (a) mất mạng hoặc đóng trình duyệt thì đồng hồ có dừng không; (b) có khoảng chuyển phần cố định không; (c) bắt đầu gần cuối khoảng mở thì được làm hết hay bị cắt; (d) nộp sớm thì phần kế bắt đầu ngay hay chờ. Mặc định tạm: (a) không dừng, phần hết giờ tự nộp; (b) 0 giây (`MOCK_SELF_PACED_GAP_SECONDS`); (c) làm hết, màn vào bài cảnh báo; (d) bắt đầu ngay.
14. **Writing tự luyện của người đăng ký online chưa có hồ sơ `students`:** route tự luyện chạy theo `user_id`, hay xác nhận đơn tạo hồ sơ `students` tối thiểu (GOI-04 mục 7 để G08 quyết, cần anh xác nhận nếu phải tạo hồ sơ)? Đề nghị: chạy theo `user_id`, không tạo hồ sơ. Mặc định tạm: như đề nghị; mã buộc phải có `students` thì dừng hỏi.
15. **ĐÃ TRẢ LỜI 18/11 (00 mục 2 điểm 22):** full test Speaking mô phỏng gồm 3 câu Part 1, 1 bài Part 2, 2 câu Part 3 = **3 lượt chấm** (mỗi Part một lượt; Part 3 tính như Part 1). Hộp nộp ghi "sẽ dùng 3 lượt chấm AI".
16. **ĐÃ TRẢ LỜI 18/11 chiều (00 mục 2 điểm 23):** full test Writing tự chọn tốn 2 lượt, mỗi task một lượt. Hộp nộp ghi rõ.
