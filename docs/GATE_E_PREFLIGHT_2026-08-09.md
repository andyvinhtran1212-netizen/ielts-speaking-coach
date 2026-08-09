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
staging E2E chỉ chạy Chromium; chưa có hồ sơ 20 critical-suite runs liên tiếp;
và chưa có drill active-session sticky/drain. Vì vậy canonical core cutover vẫn
bị chặn bởi Gate E.

## Ma trận tiêu chí Gate E

| Tiêu chí master plan | Trạng thái | Bằng chứng hiện có | Khoảng trống bắt buộc |
|---|---|---|---|
| Versioned Safari/iOS/Chromium device matrix xanh | **PENDING** | `package.json` khai báo sàn Safari/iOS 15; static browser-floor scan kiểm syntax/polyfill; spike config có Chromium + WebKit | `playwright.staging.config.js` và workflow staging chỉ chạy Chromium. Chưa có versioned real-device Safari/iOS evidence. Static scan không thay thế runtime matrix. |
| Reload/resume, ambiguous commit, partial persistence và bidirectional cross-version tests xanh | **PARTIAL** | Speaking có full-test chain + `test_part` resume regressions; Spike 4 pin grading fault/ambiguous-response semantics | Chưa có một versioned matrix bao phủ toàn bộ core speaking/reading/listening/writing flows theo cả legacy→Next và Next→legacy. |
| Sticky active-session hoặc drain strategy đã drill | **MISSING** | Có state contract và rollback/coexistence drills ở Gate B | Chưa có drill artifact chứng minh active attempt tiếp tục ở release cũ hoặc được drain an toàn qua cutover/rollback. |
| Full-stack staging E2E đạt threshold, đủ failure injection, ≥20 consecutive clean critical-suite executions; retry reset streak | **MISSING** | Staging suite chạy shared environment với `workers: 1`, `retries: 0`; workflow queue không cancel run | Không tìm thấy frozen Gate E threshold/register, versioned critical-suite manifest hay run ledger chứng minh 20 lần liên tiếp. Nightly hiện tại không tự biến GitHub run history thành auditable streak. |

## Findings và remediation tối thiểu

### GE-1 — Runtime device matrix chưa đạt Gate E

- **Root cause:** cấu hình staging chỉ định duy nhất project `chromium`, workflow
  chỉ cài Chromium. WebKit hiện chỉ nằm trong risk-spike local config; Safari/iOS
  thật chưa có versioned run artifact.
- **Severity:** Critical — đây là tiêu chí Gate E bắt buộc và core players phụ
  thuộc MediaRecorder, audio, storage, sticky layout và browser lifecycle.
- **Impacted files/functions:** `frontend/playwright.staging.config.js` phần
  `projects`; `.github/workflows/staging-e2e.yml` bước cài browser/chạy suite;
  `frontend/playwright.spike.config.js` chỉ là spike evidence.
- **Suggested minimal fix:** tạo PR riêng thêm versioned Chromium + WebKit
  staging projects, tách test nào cần capability thật, và thêm manual real-device
  Safari/iOS runbook/evidence schema thay vì gọi WebKit là Safari thật.
- **Verification:** workflow chạy đủ từng project; report ghi browser/OS/version,
  SHA và test manifest; Safari/iOS real-device evidence khớp frozen matrix.

### GE-2 — Resume evidence đang rời rạc và từng mô tả sai hiện trạng

- **Root cause:** `SPIKE_3_CROSS_STACK_RESUME_2026-07-14.md` vẫn ghi full-test
  chain và `_pendingTestAnswers` bị mất dù Spike 2 remediation đã persist chain
  vào `ielts_ft_session_ids` và xóa queue blob để await từng upload.
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

### GE-3 — Không có auditable 20-run critical streak

- **Root cause:** workflow nightly chạy suite staging nhưng không có frozen
  critical manifest, threshold register hoặc ledger xác thực chuỗi. `retries: 0`
  đúng contract reset-on-retry, nhưng một thuộc tính config không chứng minh đã
  có 20 lần chạy sạch.
- **Severity:** Critical — thiếu trực tiếp exit evidence của Gate E.
- **Impacted files/functions:** `.github/workflows/staging-e2e.yml` job
  `staging-e2e`; `frontend/playwright.staging.config.js`; toàn bộ
  `frontend/tests/staging-e2e/*.spec.js`.
- **Suggested minimal fix:** PR riêng freeze critical-suite manifest + thresholds,
  xuất machine-readable run evidence và streak ledger keyed theo matrix version,
  suite version, environment release và backend release. Fail/cancel/skip hoặc
  thay matrix phải reset streak; retry vẫn bằng 0.
- **Verification:** auditor tái dựng đúng 20 run IDs liên tiếp, cùng frozen
  matrix/manifest, zero retry/skip và đủ failure-injection cases.

### GE-4 — Chưa drill active-session cutover policy

- **Root cause:** coexistence/rollback drill chứng minh deployment recovery,
  nhưng chưa chọn và drill cách xử lý attempt đang làm dở khi route ownership
  đổi release.
- **Severity:** Critical — core exam/grading có thể mất chain, timer hoặc câu trả
  lời nếu user bị chuyển stack giữa attempt.
- **Impacted files/functions:** chưa có canonical Gate E runbook; các core route
  và state keys được liệt kê dưới đây.
- **Suggested minimal fix:** chọn một strategy có owner: sticky release theo
  active-attempt/session, hoặc drain không mở attempt mới và chờ TTL. Drill cả
  cutover lẫn rollback, gồm tab cũ, reload, tab mới và session hết hạn.
- **Verification:** run artifact ghi release trước/sau, session/attempt ID,
  persisted answers, canonical final state, TTL và recovery time; không có data
  invariant violation.

## Core-flow inventory còn phải đóng

| Domain | Core legacy surfaces | State/risk bắt buộc test trước canonical cutover |
|---|---|---|
| Speaking | `/practice`, `/result`, `/full-test-result` | MediaRecorder blob, awaited grade, full-test chain, finalize ambiguity, result aggregation |
| Reading | `/reading/exam`, `/reading/skill/:exercise_id`, `/reading/vocab/:passage_id`, `/reading/review` | timer, answers, in-progress attempt, submit/reconcile, review truth |
| Listening | `/listening/mcq`, `/listening/gist`, `/listening/tf`, `/listening/dictation`, `/listening/test-dictation`, `/listening/review` | audio lifecycle, answer persistence, attempt section, submit/review aggregation |
| Writing | `/writing/result`, `/admin/writing/grade` | canonical submission/regrade state, partial persistence, admin/student reload agreement |

Route ownership hoặc React launcher không được dùng thay bằng chứng player flow.
Legacy retirement thuộc Gate F; không xóa rollback target trong Gate E.

## Thứ tự PR sau preflight

1. **Device matrix foundation:** Chromium + WebKit staging projects, versioned
   matrix artifact và Safari/iOS manual evidence contract.
2. **Critical-suite/streak ledger:** frozen manifest/thresholds, failure
   injection coverage và auditable 20-run streak.
3. **Active-session drill:** chọn sticky hoặc drain, chạy cutover + rollback.
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
