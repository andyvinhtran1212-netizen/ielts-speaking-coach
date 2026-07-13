# ADR-012 — Observability contract

**Status:** ACCEPTED 2026-07-13 — dashboard là điều kiện Pilot Entry · Plan v3 B27, B29, §12.3

## Quyết định
1. Tag bắt buộc trên mọi telemetry/API call: `environment` (production/staging/preview), `release` (SHA), `implementation` (legacy|next), canonical route, flow/session type, request id. Nguồn environment/release phía client: `window.__AVER_RUNTIME_CONFIG__` (đã ship — release + gitRef có sẵn).
2. Correlation: `X-Request-ID` xuyên browser → (Next server nếu có) → FastAPI (header đã nằm trong CORS allowlist). Nó là correlation id, KHÔNG phải idempotency key (B23).
3. Đường ống hiện có làm nền: bảng `error_logs` + admin "Báo lỗi" (frontend error reporter), `grading_events` (orchestrator audit), `analytics_events`. Trước pilot: thêm `implementation` + `release` vào error reporter payload — additive enabling change.
4. Denominator: dashboard cutover đếm MỌI eligible attempt, tách success/fail/abandon (§12.3); exposure floors theo docs/TRAFFIC_BASELINE_2026-07-13.md.
5. Redaction (B29): telemetry scrub bearer/access code/signed URL/query fragment/transcript/essay; Playwright artifacts chỉ synthetic + retention 7 ngày (đã cấu hình trong staging-e2e.yml); error_logs message cap đã có (2000 chars).
6. SLO khởi điểm: route đã migrate không vượt error-rate delta so baseline legacy (đo cùng tag scheme); alert = so sánh theo `implementation` tag.

## Điều kiện mở
Dashboard (so sánh theo implementation/release) phải tồn tại trước pilot đầu — mục Pilot Entry checklist.
