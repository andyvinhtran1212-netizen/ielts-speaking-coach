# Gate E preflight — 2026-08-09

**Trạng thái:** NOT READY. Tài liệu này là inventory và remediation order, không
phải waiver hay tuyên bố Gate E đã pass.

**Nguồn chuẩn:** `docs/FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md` §16,
`docs/ROUTE_LEDGER.md`, cấu hình/test hiện có và code runtime tại SHA của branch.
Gate E chỉ được đổi sang PASS khi reviewer độc lập có thể kiểm lại từng evidence
link, version, run và threshold.

## Kết luận

App Router đã sở hữu 29 route và hard-navigation debt của nhóm đó đã về 0/29,
nhưng đây là bằng chứng Gate D behavior migration, không chứng minh core-flow
ready. Các player ghi dữ liệu và resume-sensitive quan trọng vẫn là legacy;
core suite vẫn chỉ chạy Chromium dù browser seam đã có WebKit synthetic; chưa có
hồ sơ 20 critical-suite runs liên tiếp; active-session affinity mới có foundation
  và local drill, chưa có live core-player drill. Speaking đã có stable hybrid
  Next player route nhưng chưa native renderer/browser evidence. Vì vậy canonical core cutover vẫn
bị chặn bởi Gate E.

## Ma trận tiêu chí Gate E

| Tiêu chí master plan | Trạng thái | Bằng chứng hiện có | Khoảng trống bắt buộc |
|---|---|---|---|
| Versioned Safari/iOS/Chromium device matrix xanh | **PARTIAL** | Matrix v1 chạy core suite trên Chromium và browser seam trên Chromium desktop + WebKit desktop/iPhone emulation; artifact ghi exact Playwright/browser revision/SHA/outcome | Chưa có real-device Safari 15.6/iOS 15.8.5 evidence và matrix spec chưa bao phủ core players. WebKit/static scan không thay thế thiết bị thật. |
| Reload/resume, ambiguous commit, partial persistence và bidirectional cross-version tests xanh | **PARTIAL** | Speaking có full-test chain + `test_part` resume regressions; Spike 4 pin grading fault/ambiguous-response semantics | Chưa có một versioned matrix bao phủ toàn bộ core speaking/reading/listening/writing flows theo cả legacy→Next và Next→legacy. |
| Sticky active-session hoặc drain strategy đã drill | **PARTIAL** | Stable-player-URL admission policy và executable local cutover/rollback drill giữ legacy-start ở legacy, Next-start ở Next; target chưa ready fail closed | Chưa có live staging artifact trên player Next thật; mỗi cluster còn phải pin rollback floor SHA, drill tab cũ/reload/tab mới và chứng minh canonical backend state. |
| Full-stack staging E2E đạt threshold, đủ failure injection, ≥20 consecutive clean critical-suite executions; retry reset streak | **PARTIAL** | Critical-suite v1 freeze 33 tests bằng hashes/counts; ledger reset trên fail/skip/flake/rerun/history gap/release drift; artifact bind cùng frontend/backend SHA | Chưa có qualifying 20-run artifact và failure-injection matrix còn thiếu bốn nhóm core-player. Cơ chế đếm không thay thế các lần chạy thật. |

## Findings và remediation tối thiểu

### GE-1 — Runtime device matrix chưa đạt Gate E

- **Root cause:** cấu hình staging ban đầu chỉ có Chromium. Matrix v1 đã thêm
  Chromium/WebKit desktop + WebKit/iPhone emulation và artifact versioned; phần
  còn thiếu là Safari/iOS thật cùng core-player coverage.
- **Severity:** Critical — đây là tiêu chí Gate E bắt buộc và core players phụ
  thuộc MediaRecorder, audio, storage, sticky layout và browser lifecycle.
- **Impacted files/functions:** `frontend/playwright.staging.config.js` phần
  `projects`; `.github/workflows/staging-e2e.yml` bước cài browser/chạy suite;
  `frontend/playwright.spike.config.js` chỉ là spike evidence.
- **Suggested minimal fix còn lại:** thu real-device Safari/iOS evidence theo
  `docs/GATE_E_DEVICE_MATRIX_2026-08-09.md`, rồi mở rộng matrix spec bằng core
  flow của từng migration cluster; không gọi WebKit là Safari thật.
- **Verification:** workflow chạy đủ project + upload JSON evidence; Safari/iOS
  real-device artifact khớp frozen matrix và SHA trước khi đổi tiêu chí sang PASS.

### GE-2 — Resume evidence vẫn rời rạc

- **Root cause:** Spike 3 trước đây ghi sai rằng full-test chain và
  `_pendingTestAnswers` bị mất. Tài liệu đã được sửa theo runtime hiện tại, nhưng
  evidence vẫn chỉ chứng minh `ielts_ft_session_ids` trong cùng origin/cùng tab;
  backend chưa sở hữu chain cho fresh client hoặc thiết bị khác.
- **Severity:** Critical — tài liệu stale có thể dẫn tới quyết định cutover sai,
  hoặc che khuất giới hạn thật: sessionStorage chỉ sống cùng origin/cùng tab.
- **Impacted files/functions:** `docs/SPIKE_3_CROSS_STACK_RESUME_2026-07-14.md`;
  `frontend/public/js/practice.js` `_saveFtChain`, `_loadFtChain`, init resume;
  `frontend/tests/full-test-chain.test.mjs`, `test-part-eager.test.mjs` và hai
  browser specs tương ứng.
- **Suggested minimal fix:** đồng bộ Spike 3 với runtime, nói rõ boundary
  same-origin/same-tab; batch test kế tiếp phải lập matrix reload/resume,
  ambiguous commit, partial persistence và legacy↔Next cho từng core flow.
- **Verification:** source pins + browser regressions speaking xanh; mỗi flow mới
  có canonical server-state assertion sau reload và sau đổi stack.

### GE-3 — Có cơ chế ledger, chưa có qualifying 20-run evidence

- **Root cause:** workflow nightly ban đầu không có frozen critical manifest,
  provenance hay ledger. Batch streak đã thêm cơ chế fail-closed; phần còn thiếu
  là 20 executions thật và bốn failure-injection groups của core players.
- **Severity:** Critical — thiếu trực tiếp exit evidence của Gate E.
- **Impacted files/functions:** `.github/workflows/staging-e2e.yml` job
  `staging-e2e`; `frontend/playwright.staging.config.js`; toàn bộ
  `frontend/tests/staging-e2e/*.spec.js`.
- **Suggested minimal fix còn lại:** sync Vercel + Railway staging cùng SHA,
  bắt đầu candidate streak, đồng thời bổ sung failure injection theo từng core
  migration cluster. Không backfill run trước khi ledger/provenance tồn tại.
- **Verification:** auditor tái dựng đúng 20 run IDs liên tiếp từ artifacts,
  cùng frozen matrix/suite/releases, zero retry/skip và failure matrix complete.

### GE-4 — Có affinity mechanism, chưa có live core drill

- **Root cause:** trước batch affinity, coexistence/rollback drill chỉ chứng minh
  deployment recovery, chưa chọn cách xử lý attempt đang làm dở khi ownership
  đổi release. Batch đã chọn stable implementation-specific URL + admission
  switch và chạy local state drill; Speaking đã có `/practice/session` với native
  bootstrap/recorder/submission/full-test/player lifecycle, nhưng chưa có live
  drill và các core domain còn lại chưa đủ player Next để drill.
- **Severity:** Critical — core exam/grading có thể mất chain, timer hoặc câu trả
  lời nếu user bị chuyển stack giữa attempt.
- **Impacted files/functions:** chưa có canonical Gate E runbook; các core route
  và state keys được liệt kê dưới đây.
- **Suggested minimal fix còn lại:** mỗi core cluster phải tạo stable Next player
  route, pin coexistence rollback floor SHA rồi drill staging cả cutover lẫn
  rollback, gồm tab cũ, reload, tab mới và canonical state sau handoff.
- **Verification:** run artifact ghi release trước/sau, session/attempt ID,
  persisted answers, canonical final state, TTL và recovery time; không có data
  invariant violation.

## Core-flow inventory còn phải đóng

| Domain | Core legacy surfaces | State/risk bắt buộc test trước canonical cutover |
|---|---|---|
| Speaking | `/practice`, `/result`, `/full-test-result` | MediaRecorder blob, awaited grade, full-test chain, finalize ambiguity, result aggregation |
| Reading | `/reading/exam`, `/reading/skill/:exercise_id`, `/reading/vocab/:passage_id`, `/reading/review` | timer, answers, in-progress attempt, submit/reconcile, review truth |
| Listening | `/listening/mcq`, `/listening/gist`, `/listening/tf`, `/listening/dictation`, `/listening/test-dictation`, `/listening/review` | audio lifecycle, answer persistence, attempt section, submit/review aggregation |
| Writing | `/writing/dashboard` (Next đã cutover; legacy stable URL vẫn sống), `/writing/result`, `/admin/writing/grade` | active modal/autosave, canonical submission/regrade state, partial persistence, admin/student reload agreement, rollback không thấp hơn coexistence floor |

Route ownership hoặc React launcher không được dùng thay bằng chứng player flow.
Legacy retirement thuộc Gate F; không xóa rollback target trong Gate E.

## Thứ tự PR sau preflight

1. **Device matrix foundation:** Chromium + WebKit staging projects, versioned
   matrix artifact và Safari/iOS manual evidence contract.
2. **Critical-suite/streak ledger:** frozen manifest/thresholds, failure
   injection coverage và auditable 20-run streak.
3. **Active-session affinity:** foundation/local drill đã có; live drill chạy
   trong từng core cluster trên stable player route thật.
4. **Core migration clusters:** Speaking → Reading → Listening → Writing; mỗi
   cluster giữ backend canonical truth và có bidirectional cross-version tests.
5. **Gate E decision:** chỉ PASS khi mọi ô trên có direct evidence. Sau đó mới
   mở Gate F observation/retirement window.

## Verification cho preflight batch này

- `node --test frontend/tests/gate-e-preflight-contract.test.mjs`
- `node --test frontend/tests/full-test-chain.test.mjs frontend/tests/test-part-eager.test.mjs`
- Chạy full frontend contract suite để đảm bảo doc contract không làm lệch gate
  hiện có.
- Reviewer kiểm tay rằng mọi path/test được dẫn đều tồn tại và status vẫn là
  NOT READY cho tới khi bằng chứng tương ứng được commit.
