# Gate E Speaking core — native Full Test state — 2026-08-09

**Trạng thái:** NATIVE BOOTSTRAP + RECORDER + SUBMISSION + FULL-TEST STATE +
PLAYER LIFECYCLE + NATIVE JSX/FEEDBACK/PRONUNCIATION RENDERERS + NATIVE SESSION/FULL-TEST RESULTS; PERSISTED-AFFINITY FLOOR, GATE E PENDING. `/practice/session` đã là
stable App Router URL; React sở hữu auth, session/question bootstrap, vòng đời
MediaRecorder, transport upload/grading, chain/retry/resume/finalize của Full
Test, top-level state activation và registry cleanup cho timer/countdown,
listener, speech cùng object URL. React dựng trực tiếp toàn bộ static player DOM,
event handler và SVG, đồng thời render view-model cho header, loading/error,
test progress, Part 1/3 prep, recording, processing, Part 2, assignment sheet,
Full Test completion, feedback/pronunciation và inline test results. `practice.js`
chỉ phát structured view-model trên route Next; đường DOM/`innerHTML` cũ còn
nguyên vẹn cho URL legacy rollback. Dark route đã `route_ready=true`; branch
staging giữ `admit_new=legacy` trong khi deploy atomic first-player claim. Cutover
chỉ được mở ở PR hậu duệ sau khi floor mới đã deploy và được verify.

## Finding

- **Root cause:** Full Test fire-and-forget từng audio rồi chuyển câu ngay; màn
  completion hiện trước khi các mutation settle và finalize được gọi dù queue có
  câu lỗi. Blob lỗi chỉ còn trong closure đã mất, reload `test_full` quay lại câu
  đầu, chain không gắn account, finalize network/malformed chỉ log. Sealed mock
  còn giấu toàn bộ `responses`, khiến readback không thể xác nhận một commit thật.
- **Severity:** Critical — response audio chỉ an toàn sau khi endpoint upload
  xác nhận; reload/renderer flip trước đó có thể làm mất bản thu duy nhất.
- **Impacted files/functions:** `frontend/public/js/practice.js`,
  `frontend/public/js/speaking-full-test-controller.mjs`,
  `PracticeFullTestBridge`,
  `_submitGradingEager()`, `_fireAndForgetFullTestGrading()`, Full Test init/resume
  và `GET /sessions/{id}` trong `backend/routers/sessions.py`.
- **Minimal fix trong batch:** App Router sở hữu
  `SpeakingFullTestController`: owner-scoped chain + confirmed-question ledger,
  coalesced pending map, retry queue giữ blob thật, unload guard, finalize barrier
  và canonical status reconciliation. Cả Legacy lẫn Next import đúng hai
  controller public này; Legacy chỉ thêm runtime bridge, không fork transport
  hoặc resume logic. Reload/handoff tiếp tục ở câu chưa confirm; Part 3
  đã đủ câu tự retry finalize. Completion ẩn navigation cho tới khi backend trả
  accepted/reconcile. Sealed session trả receipt tối thiểu `{id, question_id}`
  nhưng vẫn giấu transcript, feedback và band; bootstrap fail closed nếu lookup
  receipt hỏng. Upload/finalize có settle deadline nhưng không abort mutation;
  blob thật vẫn ở retry queue. Backend chỉ nhận chain ba session đúng part/cùng
  sitting, bộ câu hỏi đúng 9/1/5, và đối chiếu chấm theo từng `question_id` thay
  vì đếm response. Legacy URL giữ orchestration cũ.
  Rollback floor giữ Legacy; review cutover phát hiện reopen session cần affinity
  canonical, nên release này thêm persisted claim trước và chưa đổi admission.
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
vẫn ghi chain qua controller captured trước khi ngừng render. Feedback, transcript
highlight, grammar recommendation, pronunciation drill-down và test cards đều
được React dựng từ dữ liệu có cấu trúc, không dùng `dangerouslySetInnerHTML`;
điểm thiếu vẫn là dấu gạch chứ không được suy diễn. Browser fixture, mutation,
cross-version và synthetic device matrix cho phép xác lập dark-route floor;
chúng vẫn chưa đủ để đổi admission hoặc tuyên bố Gate E PASS.

Browser baseline đã có fixture cô lập chạy trên chính route Next đã hydrate:
practice, `test_part`, `test_full`, Part 2, assignment sheet và sealed mock đều
đã chứng minh state React, canonical bootstrap và request count. Đây mới là exit
1; chưa thay thế bằng chứng mutation/reload, device matrix hoặc rollback drill.

### Browser exit 2 finding

- **Root cause:** `SpeakingFullTestController` giữ raw `window.setTimeout` và
  `window.clearTimeout`, rồi gọi chúng qua thuộc tính của controller. Chrome gắn
  sai receiver và ném `Illegal invocation` ngay khi upload/finalize đi vào settle
  wrapper; Node unit tests không mô phỏng Web IDL receiver nên đã bỏ lọt.
- **Severity:** Critical — browser không thể xác nhận upload, retry hoặc finalize;
  bản ghi duy nhất có thể bị kẹt ở trạng thái chưa xác nhận.
- **Impacted file/function:**
  `frontend/public/js/speaking-full-test-controller.mjs`, constructor và
  `#settleWithin()`.
- **Minimal fix:** bind hai timer mặc định về `globalThis`; giữ nguyên injected
  timer cho unit tests.
- **Verification:** browser gửi multipart thật, mô phỏng response bị mất sau
  commit, reconcile sealed receipt, reload vào câu kế tiếp, retry đúng blob,
  retry finalize và reconcile finalize đã commit mà không POST lần hai.

## Dark-route readiness và exit còn lại trước khi đổi admission

1. ✅ Browser fixture baseline: practice, `test_part`, `test_full`, Part 2,
   assignment sheet và sealed mock — 6/6 trên hydrated `/practice/session`,
   backend/Supabase/CDN đều fixture và không chạm dữ liệu thật. CI chạy cùng
   workflow E2E advisory qua `npm run test:e2e:gate-e`.
2. ✅ Browser mutation/recovery: sealed upload network-after-commit + reload,
   partial core-row được giữ là đáp án đã lưu, canonical empty readback thu hồi
   stale local confirmation, lỗi lookup trên URL Legacy giữ nguyên ledger và
   dừng trước khi tải câu hỏi, exact-blob retry + finalize barrier,
   failed-finalize retry, finalize network-after-commit reconcile không POST
   trùng, và một hành trình cùng tab Legacy lưu câu 1 → Next resume câu 2 →
   Next lưu câu 2 → Legacy resume câu 3 từ canonical response ledger. Đây là
   runtime evidence, không phải source sentinel; full-stack
   staging failure-injection vẫn được theo dõi riêng trong critical suite.
3. 🟡 Automated device/microphone matrix đã được version ở
   `frontend/tooling/gate-e-speaking-device-matrix.json`: mỗi project chạy thêm
   flow coexistence Legacy → Next → Legacy; Chromium desktop có 16 flow, còn
   Playwright WebKit desktop/iPhone có 15 flow mỗi project. Manifest vẫn khai
   báo 4 lớp evidence dùng chung; Chromium thêm 4 lớp microphone (8 lớp tổng),
   còn mỗi project WebKit thêm 1 capability guard (5 lớp tổng). CI luôn tải JSON
   result artifact. Hai project WebKit synthetic chỉ chạy shared flows và
   capability guard; trên Linux CI guard xác nhận không có `MediaRecorder`, còn
   môi trường khác ghi đúng capability quan sát được. Cả hai luôn loại mic
   lifecycle vì không phải bằng chứng Safari/iOS thật. Spec Chromium kiểm copy
   permission denied, retry ngay state
   hiện tại, audio bytes từ engine-owned track, multi-tab pressure, responsive
   overflow và Next soft-navigation thực sự gọi `track.stop()`. Headless tab
   không phát một `visibilityState=hidden` đáng tin, Playwright WebKit không phải
   Safari shipping, nên đây không phải bằng chứng background/microphone thật.
   Safari/iOS thật vẫn PENDING và phải chạy đúng `real_device_requirements` trong
   manifest trước khi đóng mục 3. Schema/validator/workflow manual đã có tại
   `docs/GATE_E_SPEAKING_REAL_DEVICE_RUNBOOK_2026-08-11.md`, nhưng runner-ready
   không được tính thay hai artifact thật.
4. ✅ `next.route_ready=true` ở release riêng trong khi `admit_new=legacy`; floor
   run `32019415351` đã pin rollback SHA
   `a7462ab291f029bb2979e3a41216fa41d8f72e52`, session Legacy thật và matching
   frontend/backend staging provenance.
5. Đang dựng floor hậu duệ có `sessions.renderer_affinity` + atomic claim và
   reopen stable URL. Sau khi floor deploy/verify mới mở staging-only cutover để
   thu tab Legacy cũ, tab Next mới, reload/copy URL và canonical backend
   assertions; sau đó forward-revert về Legacy. Safari/iOS thật và đủ ba artifact
   vẫn chặn Gate E/production cutover; Legacy URL tiếp tục sống đến Gate F.

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
- Part 2 cue/retry/countdown và assignment-sheet slots/meter/submit truth cũng
  đi qua view-model. Nút React gọi public action trực tiếp; listener delegation
  chỉ còn ở URL legacy để một click không bị xử lý hai lần.
- Completion pending/error/accepted copy, retry action và CTA visibility được
  React render từ canonical Full Test controller snapshot; navigation chỉ hiện
  sau khi máy chủ xác nhận finalize.
- Feedback, transcript span, grammar card, pronunciation/phoneme accordion và
  inline test-result fallback được React render từ immutable structured model.
  Review audio dùng URL đúng câu; review thiếu audio không rơi xuống blob câu mới
  nhất. Text AI/transcript đi qua React escaping mặc định.
- Part 2 prep/speaking dùng countdown state có snapshot; timer copy, lỗi, PDF,
  TTS sequence và grammar flash dùng key nên lần mới thay thế lần cũ.
- Listener sheet/grammar/interaction/voices dùng named handler và bị tháo khi
  unmount; không còn gán `speechSynthesis.onvoiceschanged` toàn cục.
- Permission prompt, TTS fetch, sheet review/submit, pronunciation fetch và tạo
  Part kế tiếp đều generation-gated; callback cũ không được render hoặc redirect
  vào route mới.
- Object URL của recording, feedback, Part 2 retry, TTS và PDF có owner key; URL
  ký của server không bị revoke nhầm.
- `/result` native đọc một snapshot canonical từ `GET /sessions/{id}` (không
  gọi lại questions), fail-visible khi `response_lookup_failed=true`, giữ kết
  quả sealed mock khỏi bị diễn giải thành “chưa trả lời”, và abort read/audio
  lifecycle khi đổi account/query hoặc unmount. Legacy player vẫn đi
  `/pages/result.html`; chỉ player Next và history Next đi `/result`, nên target
  rollback không bị đổi. “Luyện lại” dùng client-minted UUID qua
  `fn_create_session_daily_capped_v2`; network-after-commit và double-click trả
  cùng một session thay vì tạo trùng/ăn thêm daily quota.
- `/full-test-result` native đọc một snapshot canonical cho cả ba Part. Part 1
  được trigger gắn `full_test_attempt_id`; Part 2/3 chỉ gửi session liền trước để
  backend kế thừa identity, còn unique index chặn hai session cùng Part. Endpoint tự resolve
  chuỗi từ Part 1, kiểm ownership/mode/part/9-1-5 và chỉ trả band khi cả ba
  session đã có aggregate canonical. Mock đang sealed, analysis_failed và pending
  là ba state riêng, không bao giờ rơi xuống điểm tạm từ response feedback.
  Phát âm đọc các cột Azure đã persist; mở trang không gọi lại provider. Legacy
  URL vẫn nhận `p1/p2/p3` và giữ renderer cũ làm rollback.
- Bằng chứng hiện tại gồm unit/source contract, full build/suite, browser
  baseline sáu shape, bảy mutation/recovery flow, một cross-version
  coexistence flow và automated
  device/microphone matrix. Vì vậy `route_ready=true` chỉ xác nhận dark route;
  Real Safari/iOS cùng rollback live drill vẫn là exit riêng. `admit_new=legacy`
  giữ nguyên trong floor này; cutover Next phải là release hậu duệ riêng.

Verification trực tiếp của batch:

- `npm run test:e2e:gate-e` (16 Chromium + 15 WebKit desktop +
  15 WebKit/iPhone; mic lifecycle chỉ tính ở Chromium)
- `node --test frontend/tests/speaking-player-controller.test.mjs`
- `node --test frontend/tests/speaking-feedback-native-view.test.mjs`
- focused Speaking controller/sheet/chain suites
- full frontend contract suite và `next build`
