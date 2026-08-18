# Gate E preflight — 2026-08-09

**Trạng thái:** NOT READY. Tài liệu này là inventory và remediation order, không
phải waiver hay tuyên bố Gate E đã pass.

**Nguồn chuẩn:** `docs/FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md` §16,
`docs/ROUTE_LEDGER.md`, cấu hình/test hiện có và code runtime tại baseline
`main@d292de38919fa5b79854142d4b5053241642cbcd`. Gate E chỉ được đổi sang PASS
khi reviewer độc lập có thể kiểm lại từng evidence link, version, run và
threshold. Các số route là snapshot tại baseline này; từng hàng Gate E được cập
nhật qua các PR nối tiếp nhưng không tự trở thành bằng chứng PASS.

## Kết luận

Compiled ownership graph có 33 App Router route, gồm runtime admission endpoint;
trong đó cohort 29 route của
Gate D behavior migration đã đưa hard-navigation debt về 0/29. Hai mẫu số này
khác nhau theo thiết kế và không được dùng lẫn nhau. Đây vẫn chỉ là bằng chứng
Gate D behavior migration, không chứng minh core-flow ready. Matrix v1 mới cấu
hình core suite trên Chromium và một browser seam giới hạn trên Chromium/WebKit
emulation. Automated run `31348712238` đã xanh trên SHA `bff32975` và artifact
ghi đủ project counts/version/outcome. Critical-suite v5 và ledger đã được
định nghĩa, nhưng chưa có qualifying 20-run artifact; vẫn chưa có Safari/iOS
thiết bị thật. Active-session affinity đã có runtime foundation, unit contract
và persisted-affinity floor run `32043317793` trên SHA `e96c2cd`: session Legacy
thật cùng dark Next claim `null → next`; hai stable URL đều reload/copy được với
frontend/backend staging đồng nhất. cutover run `32045284608` trên SHA
`1398c50e` đã giữ session Legacy cũ, tạo session Next canonical và pass
reload/copy với matching staging provenance. Forward rollback run `32047774312`
trên SHA `28b23569` giữ session Next cũ, tạo session Legacy mới và pass
reload/copy với `rollback_mode=forward-revert`, matching provenance `ok:true`.
Ba phase live của Speaking đã hoàn tất. Floor version
cả create contract: client N−1 hoặc backend N−1 nhận database default `legacy`,
còn client hiện tại gửi `claim-v1` và dùng RPC v3 để tạo row NULL atomically cho
stable player đầu tiên claim. Migration 217 sửa mọi row NULL
có thể lọt vào khoảng commit riêng giữa backfill 215 và default 216 trước khi
backend affinity-aware được deploy.
Speaking đã có stable hybrid Next player route với native bootstrap,
recorder, submission, Full Test state, player lifecycle và dark-route readiness;
admission vẫn Legacy. Reading đã có native player cùng failure matrix versioned
12 case trên Chromium/WebKit desktop và WebKit/iPhone emulation. Reading
coexistence floor run `32060549833` attempt 3 tại
`7a6bdb9cafdc405226f1d85ffbaf366ff5841adb` đã pass với matching
frontend/backend staging provenance. Cutover run `32072244886` attempt 2 tại
`0599a8f33340593452a3372c755eb27931939645` cũng đã pass; staging admission hiện
trở về Legacy và forward rollback run `32076013600` attempt 2 tại
`14e3855501e31037a84eec6118ac7e45f75a0d26` đã pass với matching provenance.
Listening cũng có native core player và matrix 12 case tương ứng. Coexistence
floor `32084645112` attempt 2 và cutover `32093601359` attempt 2 đã pass trên
matching frontend/backend staging provenance. Forward rollback `32095451591`
attempt 1 cũng đã pass trên `f60df75f8ff68ffd49d68da00e73a8ff5c1bbb54`;
Listening test đã đủ three-phase và staging admission hiện trở về Legacy.
Listening Dictation cũng đã đủ three-phase qua floor `32103908150` attempt 2,
cutover `32106478117` attempt 2 và forward rollback `32108579377` attempt 1;
staging admission hiện trở về Legacy và prior Next attempt vẫn sticky Next.
Writing cũng đã có matrix 12 case cùng idempotent submit/readback; đây vẫn là
synthetic evidence. Live-staging failure-injection journey và trusted verifier
đã được tích hợp nhưng chưa có artifact từ release đã merge; thiết bị
Safari/iOS thật, live coexistence/rollback drill của Writing và qualifying
streak chưa hoàn tất; Speaking three-phase live drill đã pass. Vì vậy canonical
core cutover vẫn bị chặn bởi Gate E.

## Ma trận tiêu chí Gate E

| Tiêu chí master plan | Trạng thái | Bằng chứng hiện có | Khoảng trống bắt buộc |
|---|---|---|---|
| Versioned Safari/iOS/Chromium device matrix xanh | **PARTIAL** | Run `31348712238` trên SHA `bff32975`: core Chromium 26 pass + 1 intentional skip; Chromium desktop, WebKit desktop và WebKit/iPhone 13 emulation đều 2/2 pass, 0 skip; cả Speaking, Reading, Listening và Writing có production-build synthetic matrix, exact browser pins và semantic evidence verifier | Chưa có real-device Safari 15.6/iOS 15.8.5 evidence. WebKit/static scan không thay thế thiết bị thật. |
| Reload/resume, ambiguous commit, partial persistence và bidirectional cross-version tests xanh | **PARTIAL** | Bốn domain đều có automated four-path matrix; Reading/Listening/Writing mỗi slice 12 case trên Chromium/WebKit desktop/WebKit-iPhone; live Speaking journey đã ghim commit-then-reset → canonical reconcile/no replay; Reading, Listening test và Listening Dictation đã đủ live three-phase trên matching frontend/backend staging SHA | Writing chưa có successful live three-phase journey artifact. Source/tooling không được tính thay lần chạy thật. |
| Sticky active-session hoặc drain strategy đã drill | **PARTIAL** | Stable-player-URL admission mechanism đã chọn; launcher dùng runtime endpoint no-store. Speaking, Reading, Listening test và Listening Dictation đều đã đủ three-phase trên matching provenance. Dictation rollback `32108579377` attempt 1 verify fresh Legacy attempt `e93f1e94…` và sticky prior Next attempt `4beb8dfd…`, `rollback_mode=forward-revert`. | Writing còn thiếu coexistence rollback floor + live staging drill; Safari/iOS thật vẫn thiếu nên hàng cross-core này còn PARTIAL. |
| Full-stack staging E2E đạt frozen clean-pass/flake thresholds trên versioned matrix, đủ failure-injection matrix và tối thiểu 20 consecutive clean critical-suite executions; retry reset streak | **PARTIAL** | Critical-suite v5 freeze 34 tests live-staging, gồm live failure injection; cùng workflow chạy Speaking 46 case và Reading/Listening/Writing 12 case mỗi domain trên production build; ledger reset trên fail/unexpected skip/flake/rerun/history gap/release drift hoặc fail semantic verifier | Chưa có qualifying 20-run artifact và chưa có successful live-staging artifact từ release v5. Cơ chế đếm không thay thế các lần chạy thật. |

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

- **Root cause:** trước batch này,
  `docs/SPIKE_3_CROSS_STACK_RESUME_2026-07-14.md` vẫn ghi full-test chain và
  `_pendingTestAnswers` bị mất dù Spike 2 remediation đã persist chain vào
  `ielts_ft_session_ids` và xóa queue blob để await từng upload. Bằng chứng hiện
  có chỉ test refresh trong legacy player, chưa test browser handoff
  legacy↔Next; backend cũng chưa sở hữu chain cho fresh client hoặc thiết bị
  khác.
- **Severity:** Critical — tài liệu stale có thể dẫn tới quyết định cutover sai,
  hoặc che khuất giới hạn thật: sessionStorage chỉ sống cùng origin/cùng tab.
- **Impacted files/functions:** `docs/SPIKE_3_CROSS_STACK_RESUME_2026-07-14.md`;
  `frontend/public/js/practice.js` `_saveFtChain`, `_loadFtChain`, init resume;
  `frontend/tests/full-test-chain.test.mjs`,
  `frontend/tests/test-part-eager.test.mjs`,
  `frontend/tests/e2e/full_test_chain_persistence.spec.js` và
  `frontend/tests/e2e/test_part_resume.spec.js`.
- **Suggested minimal fix:** đồng bộ Spike 3 với runtime, nói rõ boundary
  same-origin/same-tab; batch test kế tiếp phải lập matrix reload/resume,
  ambiguous commit, partial persistence và legacy↔Next cho từng core flow.
- **Verification:** source pins + browser regressions refresh speaking xanh;
  không gọi đó là cross-stack evidence. Mỗi flow mới phải có canonical
  server-state assertion sau reload và sau đổi stack.

### GE-3 — Có cơ chế ledger, chưa có qualifying 20-run evidence

- **Root cause:** workflow nightly ban đầu không có frozen critical manifest,
  provenance hay ledger. Batch streak đã thêm cơ chế fail-closed; Speaking
  failure matrix nay chạy trong cùng workflow và làm reset streak khi đỏ. Phần
  còn thiếu là 20 executions thật cùng một successful artifact từ live-staging
  failure-injection journey đã tích hợp.
- **Severity:** Critical — thiếu trực tiếp exit evidence của Gate E.
- **Impacted files/functions:** `.github/workflows/staging-e2e.yml` job
  `staging-e2e`; `frontend/playwright.staging.config.js`; toàn bộ
  thư mục `frontend/tests/staging-e2e/`.
- **Suggested minimal fix còn lại:** sync Vercel + Railway staging cùng SHA,
  chạy v5 để thu live artifact đầu tiên rồi bắt đầu candidate streak. Không
  backfill run trước khi ledger/provenance tồn tại.
- **Verification:** auditor tái dựng đúng 20 run IDs liên tiếp từ artifacts,
  cùng frozen matrix/suite/releases, zero retry/unexpected skip và failure
  matrix complete.

### GE-4 — Persisted affinity đã drill; Writing còn thiếu ba phase live

- **Root cause lịch sử:** runtime admission từng chỉ quyết định renderer cho
  một navigation và không persist renderer theo session/attempt. Remediation
  đã thêm atomic first-player claim; Speaking, Reading, Listening test và
  Listening Dictation nay giữ affinity canonical qua launcher, reload và
  forward rollback. Writing vẫn chưa có live three-phase artifact tương ứng.
- **Severity:** Critical — core exam/grading có thể mất chain, timer hoặc câu trả
  lời nếu user bị chuyển stack giữa attempt.
- **Impacted files/functions:** `frontend/lib/core-player-affinity.mjs`,
  `frontend/app/core-player/launch/route.ts`, canonical attempt/session tables
  và từng Gate E coexistence workflow.
- **Suggested minimal fix còn lại:** triển khai cùng contract cho Writing, pin
  floor rồi drill staging cutover + forward rollback với exact frontend/backend
  provenance; không mở rộng admission production trong batch này.
- **Verification:** Dictation floor `32103908150` attempt 2, cutover
  `32106478117` attempt 2 và rollback `32108579377` attempt 1 chứng minh fresh
  admission đổi đúng, prior Legacy/Next attempt giữ renderer, reload/copy URL
  pass và không có data invariant violation. Writing phải cung cấp cùng loại
  artifact trước khi GE-4 có thể PASS toàn cục.

## Core-flow inventory còn phải đóng

| Domain | Core legacy surfaces | State/risk bắt buộc test trước canonical cutover |
|---|---|---|
| Speaking | `/practice`, `/result`, `/full-test-result` | MediaRecorder blob, awaited grade, full-test chain, finalize ambiguity, result aggregation |
| Reading | `/reading/exam`, `/reading/skill/:exercise_id`, `/reading/vocab/:passage_id`, `/reading/review` | timer, answers, in-progress attempt, submit/reconcile, review truth |
| Listening | `/listening/mcq`, `/listening/gist`, `/listening/tf`, `/listening/dictation`, `/listening/test-dictation`, `/listening/review` | audio lifecycle, answer persistence, attempt section, submit/review aggregation |
| Writing | `/writing/dashboard` (Next đã cutover; legacy stable URL vẫn sống), `/writing/result`, `/admin/writing/grade` | automated modal/autosave/submit matrix đã có; còn live-staging canonical submission/regrade agreement và rollback drill không thấp hơn coexistence floor |

Route ownership hoặc React launcher không được dùng thay bằng chứng player flow.
Legacy retirement thuộc Gate F; không xóa rollback target trong Gate E.

## Thứ tự PR sau preflight

1. **Device matrix foundation:** Chromium + WebKit staging projects, versioned
   matrix artifact và Safari/iOS manual evidence contract.
2. **Critical-suite/streak ledger:** frozen manifest/thresholds, failure
   injection coverage và auditable 20-run streak.
3. **Active-session affinity:** foundation/unit contract đã có; live drill chạy
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
