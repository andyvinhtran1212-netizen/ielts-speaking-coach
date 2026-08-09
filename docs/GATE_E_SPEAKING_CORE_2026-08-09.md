# Gate E Speaking core — native Full Test state — 2026-08-09

**Trạng thái:** NATIVE BOOTSTRAP + RECORDER + SUBMISSION + FULL-TEST STATE +
PLAYER LIFECYCLE + NATIVE JSX SHELL; LEGACY DYNAMIC RENDERERS; ADMISSION LEGACY. `/practice/session` đã là
stable App Router URL; React sở hữu auth, session/question bootstrap, vòng đời
MediaRecorder, transport upload/grading, chain/retry/resume/finalize của Full
Test, top-level state activation và registry cleanup cho timer/countdown,
listener, speech cùng object URL. React dựng trực tiếp toàn bộ static player DOM,
event handler và SVG, đồng thời render view-model cho header, loading/error,
test progress, Part 1/3 prep, recording và processing. `practice.js` vẫn dựng
Part 2, assignment sheet, feedback/pronunciation, completion và test results qua
các ID tương thích. Route chưa ready và không nhận attempt mới.

## Finding

- **Root cause:** Full Test fire-and-forget từng audio rồi chuyển câu ngay; màn
  completion hiện trước khi các mutation settle và finalize được gọi dù queue có
  câu lỗi. Blob lỗi chỉ còn trong closure đã mất, reload `test_full` quay lại câu
  đầu, chain không gắn account, finalize network/malformed chỉ log. Sealed mock
  còn giấu toàn bộ `responses`, khiến readback không thể xác nhận một commit thật.
- **Severity:** Critical — response audio chỉ an toàn sau khi endpoint upload
  xác nhận; reload/renderer flip trước đó có thể làm mất bản thu duy nhất.
- **Impacted files/functions:** `frontend/public/js/practice.js`,
  `frontend/lib/speaking-full-test-controller.mjs`, `PracticeFullTestBridge`,
  `_submitGradingEager()`, `_fireAndForgetFullTestGrading()`, Full Test init/resume
  và `GET /sessions/{id}` trong `backend/routers/sessions.py`.
- **Minimal fix trong batch:** App Router sở hữu
  `SpeakingFullTestController`: owner-scoped chain + confirmed-question ledger,
  coalesced pending map, retry queue giữ blob thật, unload guard, finalize barrier
  và canonical status reconciliation. Reload tiếp tục ở câu chưa confirm; Part 3
  đã đủ câu tự retry finalize. Completion ẩn navigation cho tới khi backend trả
  accepted/reconcile. Sealed session trả receipt tối thiểu `{id, question_id}`
  nhưng vẫn giấu transcript, feedback và band; bootstrap fail closed nếu lookup
  receipt hỏng. Upload/finalize có settle deadline nhưng không abort mutation;
  blob thật vẫn ở retry queue. Backend chỉ nhận chain ba session đúng part/cùng
  sitting, bộ câu hỏi đúng 9/1/5, và đối chiếu chấm theo từng `question_id` thay
  vì đếm response. Legacy URL giữ orchestration cũ.
  Admission và `route_ready` vẫn Legacy/false.
- **Verification:** controller tests pin owner isolation, restore/truncate,
  canonical receipts, pending/retry blob identity, finalize barrier, ambiguous
  reconciliation và destroy semantics; backend test pin sealed redaction; source
  contracts pin bridge/UI; question/finalize tests pin 9/1/5 và exact response
  coverage; build/typecheck/full suites kiểm integration.

## Ranh giới bằng chứng

Parity pair hiện chỉ mở hai URL không có query và so nhánh **THIẾU session_id**.
Nó chứng minh route, chrome, CSS, boot và error state cùng tồn tại; nó không
chứng minh recorder, upload, grading, full-test chain hoặc resume. Vì tài khoản
probe không có một session fixture ổn định, không được dùng cặp này để gọi player
ready.

Shell không còn được trích từ `practice.html` hoặc chèn bằng
`dangerouslySetInnerHTML`: `PracticePageShell` là JSX client component, giữ đúng
tập ID của legacy và gọi `PracticeApp` qua handler React. Icon được nhúng SVG để
không đua hydration với Lucide; scripts vẫn được layout nạp rõ thứ tự. Native
bootstrap, recorder, submission, Full
Test state và player controller đã bỏ auth/data loading, microphone, multipart,
retry/resume/finalize, top-level state switching và resource cleanup khỏi IIFE
trên route Next. Keyed effects được thay thế atomically và teardown khi unmount;
async callbacks dùng generation guard, còn mutation tạo Part đã được server nhận
vẫn ghi chain qua controller captured trước khi ngừng render. Đây vẫn là hybrid
hữu hạn vì Part 2, assignment sheet, feedback/pronunciation, completion và test
results còn được `practice.js` ghi thẳng vào DOM; JSX ownership không được dùng
để tuyên bố native behavior.

## Exit còn lại trước khi `route_ready: true`

1. Port Part 2, assignment sheet, feedback/pronunciation, completion và test
   results sang React state/client components. Static shell, header, Part 1/3
   prep, recording, processing và event handler đã là JSX/view-model; state activation,
   Part 2 countdown, timer, blob URL, TTS và document-listener lifecycle đã thuộc
   `SpeakingPlayerController`; không gọi phần này là native renderer.
2. Chạy browser tests với fixture cho practice, `test_part`, `test_full`, Part 2,
   assignment sheet và mock sitting.
3. Chạy browser fixture chứng minh native reload/resume + retry/finalize vừa được
   unit-test; gồm sealed mock và network-after-commit, không chỉ source sentinel.
4. Chạy Chromium/WebKit/iPhone emulation và real Safari/iOS evidence theo device
   matrix; kiểm microphone permission denied/retry/background-tab lifecycle.
5. Pin coexistence rollback floor SHA, rồi drill tab Legacy cũ, tab Next mới,
   reload/copy URL/admission rollback với canonical backend assertions.
6. Chỉ sau các bước trên mới đổi `next.route_ready` và `admit_new`; Legacy URL
   tiếp tục sống đến Gate F.

## Batch player lifecycle

- `PracticePlayerBridge` cài một controller theo vòng đời route trước khi boot;
  `PracticeApp.destroy()` giải phóng recorder/audio/reference legacy rồi registry
  xóa toàn bộ effect/object URL và speech còn lại.
- Trên App Router, `SpeakingPlayerController` phát snapshot state qua subscription
  và `PracticePageShell` dựng duy nhất lớp `.active` bằng
  `useSyncExternalStore`; controller chỉ còn mutate class ở đường legacy mặc
  định. Bridge tạo controller mới cho mỗi effect setup để StrictMode replay
  không tái sử dụng instance đã dispose; boot failure cũng đi qua cùng
  `showState('error')` thay vì dựng một state song song ngoài React.
- Controller cũng phát immutable section view snapshots. Header/test progress,
  loading/error, Part 1/3 prep/listen-only/reveal, recording playback/length gate
  và processing copy được `PracticePageShell` render; `practice.js` chỉ cập nhật
  model ở route Next và giữ DOM fallback cho URL legacy.
- Part 2 prep/speaking dùng countdown state có snapshot; timer copy, lỗi, PDF,
  TTS sequence và grammar flash dùng key nên lần mới thay thế lần cũ.
- Listener sheet/grammar/interaction/voices dùng named handler và bị tháo khi
  unmount; không còn gán `speechSynthesis.onvoiceschanged` toàn cục.
- Permission prompt, TTS fetch, sheet review/submit, pronunciation fetch và tạo
  Part kế tiếp đều generation-gated; callback cũ không được render hoặc redirect
  vào route mới.
- Object URL của recording, feedback, Part 2 retry, TTS và PDF có owner key; URL
  ký của server không bị revoke nhầm.
- Bằng chứng hiện tại là unit/source contract và full build/suite; browser/live
  drill vẫn là exit riêng, nên `route_ready=false` giữ nguyên.

Verification trực tiếp của batch:

- `node --test frontend/tests/speaking-player-controller.test.mjs`
- focused Speaking controller/sheet/chain suites
- full frontend contract suite và `next build`
