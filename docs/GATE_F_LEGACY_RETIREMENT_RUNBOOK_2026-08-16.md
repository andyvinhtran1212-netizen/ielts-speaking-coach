# Gate F — Legacy HTML retirement runbook — 2026-08-16

**Trạng thái:** OBSERVATION STARTED; RETIREMENT NO-GO. Cửa sổ bắt đầu tại
`2026-08-17T00:15:22Z` trên production release
`05e2cc54499fb6fc8d8f980567632e39fc9fe808`; evidence versioned nằm tại
`GATE_F_OBSERVATION_START_EVIDENCE_2026-08-17.md`. Không được tính thời gian
trước mốc này và mốc 14 ngày không tự cho phép retirement.

## Root cause và phạm vi

- 121 HTML rollback vẫn render trực tiếp, nhưng trước batch này chỉ 12 trang có
  `analytics-beacon.js`. Vì vậy số 0 trên dashboard không phân biệt được “không
  ai mở fallback” với “trang đó chưa bao giờ gửi telemetry”.
- `public/js/legacy-retirement-beacon.js` nay gửi event riêng
  `legacy_retirement_page_view` cho mọi HTML rollback renderable. Event này
  không tham gia foot traffic/error-rate denominator, chạy ngay khi defer script
  được thực thi và không bao giờ gửi query string/referrer.
- Bốn client redirect stub được đánh dấu `aver-legacy-artifact=redirect-stub`
  và loại khỏi tập renderable; chúng chuyển trang trước khi một beacon deferred
  có thể chạy nên không được phép tạo false-zero cho Gate F.
- `node tooling/next-migration-status.mjs --json` là bằng chứng tĩnh. Chỉ khi
  `gateFObservationReady=true` trên đúng release production mới ghi
  `coverage_started_at`.

## Bắt đầu cửa sổ

1. Merge + deploy release có beacon lên production.
2. Xác minh runtime marker `/js/runtime-config.js` trùng SHA đã deploy.
3. Chạy `node tooling/next-migration-status.mjs --json`; lưu artifact với
   `gateFObservationReady=true`, `telemetryMissingPaths=[]` và SHA release.
4. Ghi UTC của bước 2–3 làm `coverage_started_at`. Không backdate.

Các bước trên đã hoàn tất cho release ghi ở đầu tài liệu. Mốc 14 ngày sớm nhất
là `2026-08-31T00:15:22Z`; full business/revisit cycle, Gate E, cutover drain và
các điều kiện bên dưới vẫn có thể đẩy quyết định retirement muộn hơn.

## Chuỗi release bắt buộc trước core cutover

Gate E phải chứng minh đúng bản remediation cuối cùng, không phải một ancestor
thiếu các sửa lỗi runtime/schema rồi mới ghép chúng vào commit cutover:

1. **Remediation floor:** gồm toàn bộ thay đổi backend, frontend runtime và
   migration 224 cần cho cutover; bốn surface Speaking, Reading exam, Listening
   test và Listening Dictation vẫn giữ `admit_new=legacy` (Writing đã là Next).
   Apply/verify migration 224 trên staging trước lượt sạch đầu tiên của floor.
2. **Freeze floor:** frontend release và backend release phải cùng đúng SHA của
   floor. Tích lũy 20/20 lượt sạch trên SHA đó; ledger tự khởi động lại ở 1 nếu
   một trong hai release đổi.
3. **Cutover descendant tối thiểu:** chỉ sau 20/20 mới tạo commit hậu duệ đổi
   bốn giá trị `admit_new` sang `next`, cùng assertion/route-ledger tương ứng.
   Commit này không được chứa runtime, API, schema, migration hay cleanup khác.
4. **Handoff:** xác minh floor là ancestor của cutover, cả năm surface nhận
   session mới vào Next, session đã claim vẫn giữ renderer, rồi mới ghi chính
   xác `cutover_at` cho Gate F drain.

Trước khi deploy descendant, chạy verifier fail-closed bằng hai commit SHA:

```bash
node frontend/tooling/verify-core-cutover-diff.mjs <floor-sha> <cutover-sha>
```

Kết quả phải có `verified=true`; verifier từ chối backend, migration, App
Router runtime hoặc tài liệu ngoài evidence/route ledger trong commit cutover.

Bất kỳ thay đổi runtime/backend/schema nào sau khi đạt ngưỡng đều tạo một
remediation floor mới và phải tích lũy lại 20 lượt. Permanent redirects và xóa
artifact Legacy là release sau Gate F, không thuộc commit admission cutover.

## Migration 224 — staging preflight 2026-08-20

Read-only preflight trên staging trước khi apply cho thấy ledger 213–223 đều
đã hiện diện, hai bảng pronunciation của 222–223 tồn tại, chỉ 224 còn thiếu và
không có row nào thiếu canonical timestamp anchor:

| Bảng | Tổng row | Open | Anchor NULL | Open còn trong 24h |
|---|---:|---:|---:|---:|
| `sessions` | 112 | 47 | 0 | 0 |
| `reading_test_attempts` | 11 | 3 | 0 | 0 |
| `listening_test_attempts` | 7 | 4 | 0 | 0 |
| `dictation_attempts` | 4 | 4 | 0 | 0 |
| `writing_assignments` | 6 | 6 | 0 | 0 |

Vì toàn bộ open row hiện tại đã cũ hơn 24 giờ, backfill sẽ giữ nguyên dữ liệu
nhưng làm chúng hết quyền resume ngay khi 224 được apply. Đây là tác động dự
kiến của hard TTL, không phải quyền xóa/abandon row. Năm Writing row
`in_progress` (Legacy 2, Next 3) nhận lease đã hết hạn; một row `pending + NULL`
vẫn unclaimed theo đúng migration. Gate E floor chỉ bắt đầu đếm sau khi apply +
postcondition verifier xanh và fixture tạo attempt mới; streak 3/20 trên SHA cũ
không được kế thừa.

## Điều kiện retirement

- Với từng path trong `legacyHtml.renderablePaths`, dùng endpoint admin
  `/admin/error-logs/rollback-metrics?route=<encoded-path>&window_minutes=20160`
  và đọc `legacy_retirement_exposure.legacy_views` trong đúng cửa sổ kể từ
  `coverage_started_at`. Bắt buộc `legacy_retirement_exposure.exact=true`;
  trường `implementations.*.page_views` là product traffic và không phải bằng
  chứng retirement.
- Cửa sổ phải đạt
  `max(14 ngày, full business/revisit cycle, maximum active-session TTL)`.
  Migration 224 đặt maximum active-player TTL là **24 giờ** cho Speaking,
  Reading exam, Listening test và Listening Dictation; hết TTL chỉ khóa
  resume/mutation, không xóa row/answer/response. Guard nằm cả ở router và DB
  child-write/RPC và parent-status trigger để instance N−1 không đi vòng được;
  Writing chỉ chặn learner-finalizer gắn `essay_id`, nên admin status override
  không bịa essay vẫn hoạt động sau khi lease hết;
  completion report Dictation còn bị guard trước DB finalizer. Admin regrade
  trên dữ liệu terminal vẫn hợp lệ. Các finalizer hiện hành gắn điều kiện
  expiry vào terminal mutation, còn parent trigger chặn cả finalizer N−1, nên
  request bắt đầu trước hạn nhưng ghi sau hạn cũng không thể vượt ranh giới.
  Retention chuyển session Speaking quá TTL sang `abandoned` trước
  khi scrub. Writing giữ assignment + draft nhưng lease renderer hết sau 24 giờ
  và có thể được player hiện hành claim lại. Core player còn active phải có
  exact zero query hoặc exception có
  owner; thời gian trôi một mình không đủ.
- Sau khi admission đã chuyển sang Next, gọi admin endpoint
  `/admin/error-logs/legacy-active-session-drain?cutover_at=<UTC-ISO>` bằng
  exact timestamp của release cutover đã lưu trong evidence. Chỉ
  `exact=true`, `stateful_legacy_drain_zero=true` và
  `legacy_blocking_total=0` mới đóng được phần stateful drain. Speaking,
  Reading exam, Listening test và Listening Dictation đọc bốn bảng attempt
  canonical. Endpoint schema v4 đếm Legacy/NULL chỉ khi
  `resume_expires_at > observed_at`; thiếu expiry vẫn là blocker fail-closed,
  còn row `in_progress` đã hết TTL được báo riêng là `expired_audit_rows` và
  không bị giả làm dependency còn sống. Writing đọc affinity + lease canonical
  trên `writing_assignments` và tính cả `pending` lẫn `in_progress` đã pin
  Legacy trong lease, nên claim thành công nhưng `/start` gián đoạn không thành
  số 0 giả. Row Writing `in_progress` nhưng affinity `NULL` từ client N−1 chỉ
  block trong lease; autosave N−1 đầu tiên tự tạo đúng một lease tương thích 24
  giờ mà không bịa affinity. `pending + NULL` không phải bằng chứng bài đã được
  mở và không bị tính; nếu autosave cũ chuyển nó sang `in_progress`, endpoint sẽ
  tính lease đó. Thiếu lease trên một row lẽ ra đã claim vẫn fail closed.
  Dictation đọc
  `dictation_attempts` từ migration 220; query/count lỗi phải fail closed, không
  được biến thành một số 0 giả trong endpoint này.
- Kết quả endpoint không tự cho phép retirement: trường
  `retirement_decision=pending-additional-gate-f-evidence` cố ý giữ 14 ngày,
  full business/revisit cycle, health invariants và deletion audit là các cổng
  riêng. Nếu `legacy_blocking_total>0`, phải chờ drain hoặc ghi exception có
  owner/resource scope; không được sửa hoặc abandon dữ liệu người học chỉ để
  đạt số 0.
- Mọi phép đọc phải `window_clamped=false`, exposure `exact=true`, không có
  Sev1/2 và không có persistence invariant violation.
- Permanent redirects, replacement invariant/test mapping và deletion
  checklist phải được review trước khi xóa HTML/JS.
- Static replacement inventory hiện đạt 121/121 HTML renderable có App Router
  owner; blocker `legacy-next-replacement-missing` phải bằng 0. Các trang
  `/pages/exam.html`, `/pages/listening-practice-run.html` và
  `/pages/mock-exam.html` vẫn là rollback/parity artifact cho tới Gate F; route
  ownership đầy đủ không tự cho phép redirect hoặc xóa legacy trước khi Gate E,
  drain và soak hoàn tất.

## Verification hiện tại

- `node --test tests/legacy-retirement-beacon.test.mjs tests/next-migration-status.test.mjs`
- `node tooling/next-migration-status.mjs --json`
- Full frontend contract suite, typecheck và production build.

Batch này chỉ làm cho Gate F **đo được**. Nó không tuyên bố 14 ngày đã trôi và
không cho phép xóa rollback target trước Gate E.
