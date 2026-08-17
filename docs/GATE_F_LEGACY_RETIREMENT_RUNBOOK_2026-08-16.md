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

## Điều kiện retirement

- Với từng path trong `legacyHtml.renderablePaths`, dùng endpoint admin
  `/admin/error-logs/rollback-metrics?route=<encoded-path>&window_minutes=20160`
  và đọc `legacy_retirement_exposure.legacy_views` trong đúng cửa sổ kể từ
  `coverage_started_at`. Bắt buộc `legacy_retirement_exposure.exact=true`;
  trường `implementations.*.page_views` là product traffic và không phải bằng
  chứng retirement.
- Cửa sổ phải đạt
  `max(14 ngày, full business/revisit cycle, maximum active-session TTL)`.
  Core player còn active phải có zero-active query hoặc exception có owner;
  thời gian trôi một mình không đủ.
- Sau khi admission đã chuyển sang Next, gọi admin endpoint
  `/admin/error-logs/legacy-active-session-drain?cutover_at=<UTC-ISO>` bằng
  exact timestamp của release cutover đã lưu trong evidence. Chỉ
  `exact=true`, `stateful_legacy_drain_zero=true` và
  `legacy_blocking_total=0` mới đóng được phần stateful drain. Speaking,
  Reading exam và Listening test đọc đúng ba bảng canonical; row
  `started_at=NULL` bị tính là blocker. Dictation không có in-progress row nên
  vẫn dùng zero-beacon window và coexistence evidence, không được biến thành
  một số 0 giả trong endpoint này.
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
- Static replacement inventory hiện fail closed với blocker
  `legacy-next-replacement-missing`: 120/121 HTML renderable có App Router owner;
  `/pages/mock-exam.html` chưa có replacement route. `/pages/exam.html` và
  `/pages/listening-practice-run.html` đã có native owner, nhưng vẫn là
  rollback/parity artifact cho tới Gate F. Không được tạo redirect giả sang một
  page gần giống hoặc gọi artifact còn thiếu là rollback-only trước khi behavior
  tương ứng được migrate và verify.

## Verification hiện tại

- `node --test tests/legacy-retirement-beacon.test.mjs tests/next-migration-status.test.mjs`
- `node tooling/next-migration-status.mjs --json`
- Full frontend contract suite, typecheck và production build.

Batch này chỉ làm cho Gate F **đo được**. Nó không tuyên bố 14 ngày đã trôi và
không cho phép xóa rollback target trước Gate E.
