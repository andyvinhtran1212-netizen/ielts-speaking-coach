# Gate E Speaking core — native Full Test state — 2026-08-09

**Trạng thái:** NATIVE BOOTSTRAP + RECORDER + SUBMISSION + FULL-TEST STATE;
LEGACY PLAYER UI; ADMISSION
LEGACY. `/practice/session` đã là stable App Router URL; React sở hữu auth,
session/question bootstrap, vòng đời MediaRecorder, transport upload/grading và
chain/retry/resume/finalize của Full Test. Player UI, Part 2 timers, TTS và
feedback rendering vẫn ở `practice.js`. Route chưa ready và không nhận attempt
mới.

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

Shell được trích từ repository HTML tại build time và từ chối mọi `<script>`;
scripts được layout nạp rõ thứ tự. Native bootstrap, recorder, submission và
Full Test state đã bỏ auth/data loading, microphone, multipart, retry/resume và
finalize ownership khỏi IIFE trên route Next. Đây vẫn là hybrid hữu hạn vì DOM
state/effects và feedback player còn ở `practice.js`.

## Exit còn lại trước khi `route_ready: true`

1. Port DOM/player state orchestration sang client modules; cleanup các timer
   Part 2, blob URLs, TTS và document listeners còn lại.
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
