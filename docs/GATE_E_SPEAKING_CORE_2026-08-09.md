# Gate E Speaking core — native submission transport — 2026-08-09

**Trạng thái:** NATIVE BOOTSTRAP + RECORDER + SUBMISSION; LEGACY STATE; ADMISSION
LEGACY. `/practice/session` đã là stable App Router URL; React sở hữu auth,
session/question bootstrap, vòng đời MediaRecorder và transport upload/grading.
Player state machine, full-test finalize và UI feedback vẫn ở `practice.js`.
Route chưa ready và không nhận attempt mới.

## Finding

- **Root cause:** upload từng được dựng ở hai hàm trong IIFE và mọi lỗi chung bị
  quy về thất bại ở client. Network/5xx/malformed 2xx có thể xảy ra sau khi dòng
  response đã persist; Full Test khi ấy báo mất câu dù canonical backend đã có.
  Chiều ngược lại, practice có thể dựng feedback `_stub` rồi đi tiếp dù response
  chưa có `response_id`. Hai lần bấm gửi sát nhau cũng tạo hai request độc lập.
- **Severity:** Critical — response audio chỉ an toàn sau khi endpoint upload
  xác nhận; reload/renderer flip trước đó có thể làm mất bản thu duy nhất.
- **Impacted files/functions:** `frontend/public/js/practice.js`,
  `frontend/lib/speaking-submission-controller.mjs`,
  `PracticeSubmissionBridge`, `_uploadAndGrade()`, `_submitGradingEager()` và
  response readback của `GET /sessions/{id}`.
- **Minimal fix trong batch:** App Router sở hữu một
  `SpeakingSubmissionController`. Controller dựng đúng multipart contract,
  coalesce theo session/question, phân biệt 422 ngắn và persist-failure rõ ràng,
  còn network/5xx/malformed success thì đọc lại canonical session. Chỉ response
  đúng `question_id` có `id` mới được coi là recovered; đọc không thấy vẫn là
  ambiguous. Một row đã tồn tại trước lượt ghi lại không được dùng làm bằng
  chứng cho commit mới. Funnel, Part 2 và assignment sheet giữ blob để retry;
  Legacy URL giữ transport cũ.
  Admission và `route_ready` vẫn Legacy/false.
- **Verification:** controller tests chạy transport thật với fake FormData/API để
  pin multipart, encoding, coalescing, error taxonomy, positive reconciliation,
  absence/readback failure và destroy semantics; source contracts pin bridge;
  build/typecheck/full frontend suite kiểm integration.

## Ranh giới bằng chứng

Parity pair hiện chỉ mở hai URL không có query và so nhánh **THIẾU session_id**.
Nó chứng minh route, chrome, CSS, boot và error state cùng tồn tại; nó không
chứng minh recorder, upload, grading, full-test chain hoặc resume. Vì tài khoản
probe không có một session fixture ổn định, không được dùng cặp này để gọi player
ready.

Shell được trích từ repository HTML tại build time và từ chối mọi `<script>`;
scripts được layout nạp rõ thứ tự. Native bootstrap, recorder và submission đã
bỏ auth/data loading, tài nguyên microphone và multipart/error reconciliation
khỏi quyền sở hữu của IIFE trên route Next, nhưng đây vẫn là hybrid hữu hạn.
Migration tiếp theo phải chuyển full-test chain và player state/effect ownership
ra khỏi IIFE.

## Exit còn lại trước khi `route_ready: true`

1. Port state orchestration sang client modules; cleanup các timer Part 2, blob
   URLs, TTS và document listeners còn lại.
2. Chạy browser tests với fixture cho practice, `test_part`, `test_full`, Part 2,
   assignment sheet và mock sitting.
3. Chứng minh reload/resume ở câu đã persist; thêm retry queue cho eager Full
   Test (funnel/Part 2/sheet đã giữ blob); finalize không mất full-test chain.
4. Chạy Chromium/WebKit/iPhone emulation và real Safari/iOS evidence theo device
   matrix; kiểm microphone permission denied/retry/background-tab lifecycle.
5. Pin coexistence rollback floor SHA, rồi drill tab Legacy cũ, tab Next mới,
   reload/copy URL/admission rollback với canonical backend assertions.
6. Chỉ sau các bước trên mới đổi `next.route_ready` và `admit_new`; Legacy URL
   tiếp tục sống đến Gate F.
