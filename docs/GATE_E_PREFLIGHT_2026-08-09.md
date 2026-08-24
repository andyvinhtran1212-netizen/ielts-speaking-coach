# Gate E preflight — 2026-08-09 (cập nhật 2026-08-24)

**Trạng thái:** NOT READY. Tài liệu này là inventory và remediation order, không
phải waiver hay tuyên bố Gate E đã pass.

> **Amendment 2026-08-19:** mọi nhắc tới real-device "Safari 15.6/iOS 15.8.5"
> trong bảng dưới là snapshot tại baseline 09/08. Hai hàng real-device đã được
> re-pin sang `safari-desktop` (MacBook Pro Mac14,9 · macOS 26.5.2 · Safari
> 26.5.2) và `ios-safari` (iPhone 17 Pro · iOS 26.6) — xem
> `docs/GATE_E_REAL_DEVICE_REPIN_2026-08-19.md`. **Cập nhật cùng ngày:** hai
> artifact real-device ĐÃ THU và pair verification PASS (safari-desktop
> `32225845849`, ios-safari `32226876978`, pair `32227093444`, staging
> `3dce244f`) — xem `docs/GATE_E_REAL_DEVICE_EVIDENCE_2026-08-19.md`. Mọi câu
> "chưa có thiết bị thật" còn lại trong snapshot dưới là lịch sử 09/08.

> **Amendment 2026-08-24:** staging đã reconcile tại
> `38f05dfc5a27cdd54c12f7d5c878b82c8216a9e5`; migrations 225–229 đã apply và
> verify. Canary `32727069070` pass live suite, Speaking, Writing và provenance,
> nhưng fail-closed vì Reading còn assert DOM kết quả cũ và Listening chưa xác
> nhận modal audio trước khi submit. Frozen contract được bump thành v12; streak
> vẫn **0/20** và không carry forward evidence v11.

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
ghi đủ project counts/version/outcome. Critical-suite v12 freeze 34 tests (33
pass + 1 intentional skip). Trusted run `32136607306` trên staging SHA
`37e9b882b192a5abb068e01abd98feeb39c8f9f2` đã pass live suite, toàn bộ failure
matrix/verifier và matching frontend/backend provenance, nhưng thuộc frozen
manifest cũ nên không được carry forward. Safari/iOS thiết bị thật đã COMPLETE
2026-08-19 (xem amendment đầu tài liệu); chuỗi bắt buộc đếm lại từ
critical-suite v12 và hiện là **0/20**. Canary v8 `32232288966` đã reset đúng về
0 sau khi 32 test pass, 1 intentional skip và assertion launcher gặp race khi
đọc lại response body sau điều hướng; v9 chỉ sửa cách assertion thu evidence,
không đổi contract sản phẩm. Canary v9 `32243889759` tiếp tục fail-closed vì
Vercel inject toolbar trên custom Preview alias: trace ghi 938 lần tải feedback
script trên Chromium và script giữ `load` trên WebKit dù trang đã render đúng
release. v10 cô lập đúng namespace toolbar, không đổi app traffic. Active-session affinity đã có
runtime foundation, unit contract
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
Listening cũng có native core player; frozen run hiện có 27 failure-matrix case
bao gồm Listening test và Dictation. Coexistence
floor `32084645112` attempt 2 và cutover `32093601359` attempt 2 đã pass trên
matching frontend/backend staging provenance. Forward rollback `32095451591`
attempt 1 cũng đã pass trên `f60df75f8ff68ffd49d68da00e73a8ff5c1bbb54`;
Listening test đã đủ three-phase và staging admission hiện trở về Legacy.
Listening Dictation cũng đã đủ three-phase qua floor `32103908150` attempt 2,
cutover `32106478117` attempt 2 và forward rollback `32108579377` attempt 1;
staging admission hiện trở về Legacy và prior Next attempt vẫn sticky Next.
Writing có matrix 12 case cùng idempotent submit/readback và đã hoàn tất live
three-phase: floor `32121670793` attempt 3 trên
`fe9000fdfa4e6c5d801ce8c13b7f1723a23455a4`, rollback `32126575888` attempt 2
trên `c800dfedf4c2f5faa921b8230aadfd60d98059b7`, restore `32128868942` attempt 2
trên `b07e8325edc3854e1dbd0f2702f32e4108577839`; cả ba phase có matching
frontend/backend staging provenance.
Thiết bị Safari/iOS thật đã hoàn tất 2026-08-19; qualifying streak đếm lại từ
critical-suite v12 nên chưa có run nào tích lũy. Vì vậy canonical core cutover
vẫn bị chặn bởi Gate E.

## Ma trận tiêu chí Gate E

| Tiêu chí master plan | Trạng thái | Bằng chứng hiện có | Khoảng trống bắt buộc |
|---|---|---|---|
| Versioned Safari/iOS/Chromium device matrix xanh | **PASS** (2026-08-19) | Run `31348712238` trên SHA `bff32975`: core Chromium 26 pass + 1 intentional skip; Chromium desktop, WebKit desktop và WebKit/iPhone 13 emulation đều 2/2 pass, 0 skip; cả Speaking, Reading, Listening và Writing có production-build synthetic matrix, exact browser pins và semantic evidence verifier; real-device COMPLETE: safari-desktop `32225845849` + ios-safari `32226876978`, pair `32227093444` (`docs/GATE_E_REAL_DEVICE_EVIDENCE_2026-08-19.md`) | Không còn cho hàng này — WebKit/static scan vẫn không được tính thay thiết bị thật ở các lần thu lại sau. |
| Reload/resume, ambiguous commit, partial persistence và bidirectional cross-version tests xanh | **PASS** | Bốn domain đều có automated four-path matrix; trusted run `32136607306` pass Speaking 46, Reading 12, Listening 27 và Writing 12 case, kèm semantic verifier; Speaking, Reading, Listening test, Listening Dictation và Writing đều đã đủ live three-phase trên matching frontend/backend staging SHA | Không còn khoảng trống cho tiêu chí automated/cross-version này; real-device requirement được theo dõi ở hàng riêng. |
| Sticky active-session hoặc drain strategy đã drill | **PASS** | Stable-player-URL admission mechanism đã chọn; launcher dùng runtime endpoint no-store. Speaking, Reading, Listening test, Listening Dictation và Writing đều đã đủ three-phase trên matching provenance. Writing floor `32121670793` attempt 3, rollback `32126575888` attempt 2 và restore `32128868942` attempt 2 đều pass. | Không còn khoảng trống affinity/drain cho năm surface; giữ regression evidence cho tới Gate F. |
| Full-stack staging E2E đạt frozen clean-pass/flake thresholds trên versioned matrix, đủ failure-injection matrix và tối thiểu 20 consecutive clean critical-suite executions; retry reset streak | **PARTIAL** | Trusted run `32136607306` pass 33 + 1 intentional skip live-staging tests, Speaking 46, Reading 12, Listening 27 và Writing 12 case; provenance frontend/backend đều đúng `37e9b882…`; `failure_matrix_complete=true`, nhưng run thuộc frozen manifest trước v12 và không được tính vào streak hiện tại. Canary `32727069070` trên `38f05dfc…` pass live suite, Speaking, Writing và provenance nhưng reset vì Reading result contract và Listening audio-prompt contract chưa đồng bộ. | Ledger hiện **0/20**; còn thiếu 20 consecutive clean run thật trên critical-suite v12. Cơ chế đếm không thay thế các lần chạy thật. |

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
- **Suggested minimal fix còn lại:** ~~thu real-device Safari/iOS evidence~~ —
  ĐÃ XONG 2026-08-19 theo `docs/GATE_E_DEVICE_MATRIX_2026-08-09.md` (evidence
  `docs/GATE_E_REAL_DEVICE_EVIDENCE_2026-08-19.md`); còn mở rộng matrix spec
  bằng core flow của từng migration cluster; không gọi WebKit là Safari thật.
- **Verification:** workflow chạy đủ project + upload JSON evidence; Safari/iOS
  real-device artifact khớp frozen matrix và SHA trước khi đổi tiêu chí sang PASS.

### GE-2 — Resume và cross-version evidence đã đóng

- **Root cause lịch sử:** preflight ban đầu chỉ có refresh coverage trong legacy
  player và tài liệu Spike 3 chưa phản ánh persistence remediation; chưa có
  canonical server-state assertion sau handoff Legacy↔Next.
- **Severity lịch sử:** Critical — thiếu bằng chứng này có thể che mất chain,
  timer, draft hoặc câu trả lời khi renderer đổi giữa attempt.
- **Impacted files/functions:** các canonical player controllers, frozen
  `frontend/tests/gate-e/`, `frontend/tests/gate-e-reading/`,
  `frontend/tests/gate-e-listening/`, `frontend/tests/gate-e-writing/` failure
  matrices và năm coexistence workflows.
- **Suggested minimal fix còn lại:** không còn remediation riêng cho automated
  resume/cross-version; giữ matrix, semantic verifier và live three-phase
  artifacts trong frozen regression set. Không dùng WebKit emulation để tuyên
  bố real-device PASS.
- **Verification:** trusted run `32136607306` pass Speaking 46, Reading 12,
  Listening 27 và Writing 12 case với zero unexpected/flake; cả năm core
  surfaces có live three-phase matching frontend/backend provenance.

### GE-3 — Có cơ chế ledger, chưa có qualifying 20-run evidence

- **Root cause:** workflow nightly ban đầu không có frozen critical manifest,
  provenance hay ledger. Batch streak đã thêm cơ chế fail-closed; Speaking
  failure matrix nay chạy trong cùng workflow và làm reset streak khi đỏ. Ledger
  reset trên fail/unexpected skip/flake/rerun, history gap hoặc release drift.
  Frozen manifest đã đổi sang v12 sau khi canary v11 xác nhận renderer mới
  nhưng phát hiện assertions kết quả/audio-prompt còn bám DOM cũ;
  v10 trước đó đã cô lập Vercel Toolbar injection giữ load state của browser
  matrix. Candidate thuộc manifest
  trước không được carry forward. Chưa có qualifying run nào sau lần reset bắt
  buộc; ledger hiện là **0/20**.
- **Severity:** Critical — thiếu trực tiếp exit evidence của Gate E.
- **Impacted files/functions:** `.github/workflows/staging-e2e.yml` job
  `staging-e2e`; `frontend/playwright.staging.config.js`; toàn bộ
  thư mục `frontend/tests/staging-e2e/`.
- **Suggested minimal fix còn lại:** giữ frozen manifest v12 ổn định, chạy một
  canary có matching frontend/backend provenance rồi để nightly workflow tích
  lũy đủ 20 clean run. Không backfill run trước
  khi ledger/provenance tồn tại và không tính run có retry/history gap.
- **Verification:** auditor tái dựng đúng 20 run IDs liên tiếp từ artifacts,
  cùng frozen matrix/suite/releases, zero retry/unexpected skip và failure
  matrix complete.

### GE-4 — Writing affinity và live drill đã đóng

- **Root cause lịch sử:** runtime admission từng chỉ quyết định renderer cho
  một navigation và không persist renderer theo session/attempt. Remediation
  đã thêm atomic first-player claim; Speaking, Reading, Listening test và
  Listening Dictation nay giữ affinity canonical qua launcher, reload và
  forward rollback. Writing hiện đã có surface trong affinity policy/launcher,
  canonical first-player claim, synthetic cross-version matrix và live runner
  contract. Ba phase staging hiện đã pass với matching provenance.
- **Severity:** Critical — core exam/grading có thể mất chain, timer hoặc câu trả
  lời nếu user bị chuyển stack giữa attempt.
- **Impacted files/functions:** `frontend/lib/core-player-affinity.mjs`,
  `frontend/app/core-player/launch/route.ts`, canonical attempt/session tables
  và từng Gate E coexistence workflow.
- **Suggested minimal fix còn lại:** không còn remediation riêng cho Writing;
  giữ artifacts và migration 221 trong regression set, không đổi production
  admission trước khi Gate E toàn cục pass.
- **Verification:** Writing floor `32121670793` attempt 3, rollback
  `32126575888` attempt 2 và restore `32128868942` attempt 2 chứng minh fresh
  admission đổi đúng, prior assignment giữ renderer, reload/copy URL pass và
  canonical draft/affinity không vi phạm invariant.

## Core-flow inventory còn phải đóng

| Domain | Core legacy surfaces | State/risk bắt buộc test trước canonical cutover |
|---|---|---|
| Speaking | `/practice`, `/result`, `/full-test-result` | MediaRecorder blob, awaited grade, full-test chain, finalize ambiguity, result aggregation |
| Reading | `/reading/exam`, `/reading/skill/:exercise_id`, `/reading/vocab/:passage_id`, `/reading/review` | timer, answers, in-progress attempt, submit/reconcile, review truth |
| Listening | `/listening/mcq`, `/listening/gist`, `/listening/tf`, `/listening/dictation`, `/listening/test-dictation`, `/listening/review` | audio lifecycle, answer persistence, attempt section, submit/review aggregation |
| Writing | `/writing/dashboard` (Next đã cutover; legacy stable URL vẫn sống), `/writing/result`, `/admin/writing/grade` | automated modal/autosave/submit matrix và three-phase live artifacts đã đủ; tiếp tục giữ canonical submission/regrade agreement trong regression set |

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
