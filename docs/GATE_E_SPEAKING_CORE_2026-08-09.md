# Gate E Speaking core — native recorder foundation — 2026-08-09

**Trạng thái:** NATIVE BOOTSTRAP + RECORDER; LEGACY ORCHESTRATION; ADMISSION
LEGACY. `/practice/session` đã là stable App Router URL; React sở hữu auth,
session/question bootstrap và vòng đời MediaRecorder. Upload/grading/player
state machine vẫn ở `practice.js`. Route chưa ready và không nhận attempt mới.

## Finding

- **Root cause:** recorder bị cài hai lần trong IIFE (luồng thường và Part 2),
  giữ stream/MediaRecorder/AudioContext/timer ở biến module và chỉ nhả chắc chắn
  trong `finishSession()`. Test-mode completion hoặc React unmount có thể để
  microphone/timer sống; permission promise resolve muộn có thể dựng zombie
  stream sau khi route đã rời. Bootstrap đã native ở batch trước.
- **Severity:** Critical — response audio chỉ an toàn sau khi endpoint upload
  xác nhận; reload/renderer flip trước đó có thể làm mất bản thu duy nhất.
- **Impacted files/functions:** `frontend/public/pages/practice.html`,
  `frontend/public/js/practice.js`,
  `frontend/lib/speaking-recorder-controller.mjs`, `PracticeRecorderBridge`,
  `_uploadAndGrade()`, `_saveFtChain()`, `_finishTestAndShowResults()` và
  recorder/Part 2/sheet state machines của `/practice/session`.
- **Minimal fix trong batch:** `PracticeRecorderBridge` sở hữu một
  `SpeakingRecorderController`; controller coalesce concurrent start, chặn
  late-async sau unmount, gom MIME/chunk/timer/analyser, reuse stream và có
  `reset()/destroy()` idempotent. Funnel, Part 2, sheet và terminal completion
  dùng controller trên route Next; legacy URL vẫn dùng MediaRecorder cũ.
  Admission và `route_ready` vẫn Legacy/false.
- **Verification:** controller tests chạy thật với fake MediaRecorder/stream để
  pin hard cap, blob, permission error, stream reuse, duplicate start, stale
  callback và late-unmount cleanup; source contracts pin bridge/integration;
  build/typecheck/full frontend suite kiểm integration.

## Ranh giới bằng chứng

Parity pair hiện chỉ mở hai URL không có query và so nhánh **THIẾU session_id**.
Nó chứng minh route, chrome, CSS, boot và error state cùng tồn tại; nó không
chứng minh recorder, upload, grading, full-test chain hoặc resume. Vì tài khoản
probe không có một session fixture ổn định, không được dùng cặp này để gọi player
ready.

Shell được trích từ repository HTML tại build time và từ chối mọi `<script>`;
scripts được layout nạp rõ thứ tự. Native bootstrap và recorder đã bỏ auth/data
loading cùng tài nguyên microphone khỏi quyền sở hữu của IIFE trên route Next,
nhưng đây vẫn là hybrid hữu hạn. Migration tiếp theo phải chuyển upload,
grading, full-test chain và player state/effect ownership ra khỏi IIFE.

## Exit còn lại trước khi `route_ready: true`

1. Port upload/grading và state orchestration sang client modules; cleanup các
   timer Part 2, blob URLs, TTS và document listeners còn lại.
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
