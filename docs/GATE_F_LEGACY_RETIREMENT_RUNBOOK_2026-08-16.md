# Gate F — Legacy HTML retirement runbook — 2026-08-16

**Trạng thái:** TELEMETRY PREPARED; OBSERVATION NOT STARTED. Không được tính thời
gian trước deployment đầu tiên mà `next-migration-status.mjs` xác nhận mọi HTML
rollback trực tiếp đều có beacon Gate F.

## Root cause và phạm vi

- 125 HTML rollback vẫn render trực tiếp, nhưng trước batch này chỉ 12 trang có
  `analytics-beacon.js`. Vì vậy số 0 trên dashboard không phân biệt được “không
  ai mở fallback” với “trang đó chưa bao giờ gửi telemetry”.
- `public/js/legacy-retirement-beacon.js` nay là lớp coverage fail-soft cho mọi
  HTML rollback. Nó chờ beacon chuẩn chạy trước, chỉ gửi `page_view` khi trang
  chưa gửi, và không bao giờ gửi query string/referrer.
- `node tooling/next-migration-status.mjs --json` là bằng chứng tĩnh. Chỉ khi
  `gateFObservationReady=true` trên đúng release production mới ghi
  `coverage_started_at`.

## Bắt đầu cửa sổ

1. Merge + deploy release có beacon lên production.
2. Xác minh runtime marker `/js/runtime-config.js` trùng SHA đã deploy.
3. Chạy `node tooling/next-migration-status.mjs --json`; lưu artifact với
   `gateFObservationReady=true`, `telemetryMissingPaths=[]` và SHA release.
4. Ghi UTC của bước 2–3 làm `coverage_started_at`. Không backdate.

## Điều kiện retirement

- Với từng path trong `legacyHtml.renderablePaths`, dùng endpoint admin
  `/admin/error-logs/rollback-metrics?route=<encoded-path>&window_minutes=20160`
  và kiểm implementation `legacy` trong đúng cửa sổ kể từ
  `coverage_started_at`.
- Cửa sổ phải đạt
  `max(14 ngày, full business/revisit cycle, maximum active-session TTL)`.
  Core player còn active phải có zero-active query hoặc exception có owner;
  thời gian trôi một mình không đủ.
- Mọi phép đọc phải `window_clamped=false`, exposure `exact=true`, không có
  Sev1/2 và không có persistence invariant violation.
- Permanent redirects, replacement invariant/test mapping và deletion
  checklist phải được review trước khi xóa HTML/JS.

## Verification hiện tại

- `node --test tests/legacy-retirement-beacon.test.mjs tests/next-migration-status.test.mjs`
- `node tooling/next-migration-status.mjs --json`
- Full frontend contract suite, typecheck và production build.

Batch này chỉ làm cho Gate F **đo được**. Nó không tuyên bố 14 ngày đã trôi và
không cho phép xóa rollback target trước Gate E.
