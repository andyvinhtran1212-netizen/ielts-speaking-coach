# Gate E Speaking core — native bootstrap foundation — 2026-08-09

**Trạng thái:** NATIVE BOOTSTRAP; LEGACY PLAYER; ADMISSION LEGACY.
`/practice/session` đã là stable App Router URL; React sở hữu auth và tải
session/câu hỏi, nhưng recorder/grading/state machine vẫn ở `practice.js`.
Route chưa ready và không nhận attempt mới.

## Finding

- **Root cause:** dark route trước đây chỉ gọi `PracticeApp.init()` nên legacy
  IIFE vẫn tự kiểm auth, đọc query, tải session và có thể POST tạo câu hỏi. Next
  không sở hữu được contract khởi động; StrictMode port ngây thơ còn có thể tạo
  câu hỏi hai lần. Phần player còn lại vẫn là một IIFE 3.848 dòng, giữ
  MediaRecorder blob, timer, full-test chain và nhiều trạng thái trong bộ nhớ.
- **Severity:** Critical — response audio chỉ an toàn sau khi endpoint upload
  xác nhận; reload/renderer flip trước đó có thể làm mất bản thu duy nhất.
- **Impacted files/functions:** `frontend/public/pages/practice.html`,
  `frontend/public/js/practice.js`, `_uploadAndGrade()`, `_saveFtChain()`,
  `_finishTestAndShowResults()`, recorder/Part 2/sheet state machines và future
  `/practice/session`.
- **Minimal fix trong batch:** `PracticeSessionBoot` dùng `useAuth()`, đọc
  `session_id`, gọi loader contract có kiểm tra shape, tải/generate đúng một lần
  qua promise giữ qua StrictMode replay, rồi handoff payload đã xác thực cho
  `PracticeApp.init(bootstrap)`. Legacy URL gọi `init()` không tham số nên giữ
  nguyên bootstrap cũ. Account đổi trong cùng tab hard-reload thay vì tái dùng
  payload của owner cũ. Admission và `route_ready` vẫn Legacy/false.
- **Verification:** unit tests pin URL encoding, phase progression, generate
  fallback một lần và fail-closed payload; source contracts pin Next handoff và
  legacy fallback; build/typecheck/full frontend suite kiểm integration.

## Ranh giới bằng chứng

Parity pair hiện chỉ mở hai URL không có query và so nhánh **THIẾU session_id**.
Nó chứng minh route, chrome, CSS, boot và error state cùng tồn tại; nó không
chứng minh recorder, upload, grading, full-test chain hoặc resume. Vì tài khoản
probe không có một session fixture ổn định, không được dùng cặp này để gọi player
ready.

Shell được trích từ repository HTML tại build time và từ chối mọi `<script>`;
scripts được layout nạp rõ thứ tự. Native bootstrap đã bỏ lần kiểm Supabase và
hai lần đọc session/question khỏi IIFE trên route Next, nhưng đây vẫn là bridge
hữu hạn chứ chưa phải đích kiến trúc. Migration tiếp theo phải chuyển
state/effect ownership, recorder và grading ra khỏi IIFE, đồng thời cung cấp
cleanup khi soft navigation/unmount.

## Exit còn lại trước khi `route_ready: true`

1. Port recorder sang client module có cleanup cho stream, MediaRecorder,
   AudioContext, timers, blob URLs, TTS và document listeners.
2. Chạy browser tests với fixture cho practice, `test_part`, `test_full`, Part 2,
   assignment sheet và mock sitting.
3. Chứng minh reload/resume ở câu đã persist; failed/ambiguous upload giữ blob
   và cho retry; finalize không mất full-test chain.
4. Chạy Chromium/WebKit/iPhone emulation và real Safari/iOS evidence theo device
   matrix; kiểm microphone permission denied/retry/background-tab lifecycle.
5. Pin coexistence rollback floor SHA, rồi drill tab Legacy cũ, tab Next mới,
   reload/copy URL/admission rollback với canonical backend assertions.
6. Chỉ sau các bước trên mới đổi `next.route_ready` và `admit_new`; Legacy URL
   tiếp tục sống đến Gate F.
