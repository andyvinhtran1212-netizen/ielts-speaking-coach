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

## Bổ sung 2026-07-31 — xuất xứ của phép đo (DEBT-2026-07-30-N)

Điều 3 ở trên nói "thêm `implementation` + `release` vào payload", và cả hợp
đồng này dựa vào `release` để quy kết một-biến. Cửa sổ quan sát pilot 2 phơi ra
lỗ hổng của giả định đó: **`release` đọc từ `/js/runtime-config.js` — một file
RỜI**, nên client chạy bản cache cũ sẽ báo release cũ. Hai mẫu vitals ngày
30/07 mang release của 13 ngày trước, và hồ sơ **không phân xử được** giữa hai
giả thuyết: asset rời bị cache cũ, hay tab mở lâu rồi mới gửi beacon.

Ba trường bổ sung (additive, không đổi schema — vẫn nằm trong `event_data` /
`extra`):

| Trường | Nguồn | Dùng để |
|---|---|---|
| `doc_release` | thuộc tính `data-release` trên `<html>`, **nướng vào chính tài liệu** lúc build (`app/layout.tsx`) | so với `release`: khác nhau ⇒ **asset rời bị cache cũ**, không phải deployment cũ |
| `loaded_at` | `Date.now()` lúc script chạy | mốc tải trang |
| `age_ms` | `Date.now() - loaded_at` lúc gửi | lớn bất thường ⇒ **tab sống lâu**, mẫu LCP của nó không đại diện cho lần tải mới |

Có mặt ở cả hai luồng: `rum-vitals.js` (web_vitals) và `error-reporter.js`
(error_logs). Trang legacy không có `data-release` ⇒ `doc_release = null`; đó là
giá trị hợp lệ, không phải lỗi.

**Hệ quả cho gate:** risk acceptance của pilot 2 ghi rằng từ pilot 3+4 trở đi,
nếu cửa sổ quan sát có bất kỳ lỗi nào trên route thì phải đóng DEBT-N trước khi
tuyên PASS. Ba trường này đóng phần *đo được*; phần *kết luận nguyên nhân* cho
hai mẫu cũ vẫn để mở, vì dữ liệu cũ không có chúng.
