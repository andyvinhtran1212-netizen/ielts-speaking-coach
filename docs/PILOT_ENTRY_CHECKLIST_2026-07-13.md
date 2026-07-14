# Pilot Entry checklist — 2026-07-13

Checklist per-pilot theo plan v3 §Phase 2. **Kỷ luật phạm vi:** checklist này
chỉ cho phép đúng BỐN bounded pilots — nó không phải quyền scale và không thay
Gate C. Mỗi pilot phải re-verify sheet của mình NGAY TRƯỚC cutover (trạng thái
dưới đây là snapshot 2026-07-13; mục nào có ⏳ phải xanh tại thời điểm cutover).

## 1. Điều kiện chung (mọi pilot)

| Điều kiện | Trạng thái | Bằng chứng |
|---|---|---|
| Gate A pass | ✅ | `docs/ENV_CERTIFICATION_STAGING_2026-07-13.md`; staging suite 9/9 (run 29235013135) → nay 19/19 |
| Gate B pass | ✅ (điều kiện đã đóng) | `docs/GATE_B_EVIDENCE_2026-07-13.md` — Instant Rollback ≤12s, restore ≤5s, auto-promote ~19s hậu-fix pin |
| ADR-012 đóng: telemetry tags | ✅ (PR này) | error-reporter + analytics-beacon mang `implementation`/`release`/`environment`; `X-Request-ID` browser→FastAPI qua api.js |
| ADR-012 đóng: dashboard so sánh theo implementation/release | ✅ (PR này) | Admin Báo lỗi → panel "Migration (ADR-012)" (`GET /admin/error-logs/migration-stats`, paginated chống 1000-cap) |
| ADR-012: redaction + correlation | ✅ | B29 đã cấu hình (Playwright artifacts 7 ngày, error message cap); X-Request-ID middleware backend có từ Sprint 12.3 |
| Provenance production-candidate/rollback | ✅ | runtime-config per-deployment (`release`/`environment`, ADR-006); rollback drill trọn vòng |
| Rollback-pin drift monitor | ✅ (PR này) | Nightly job `production-release-drift` fail khi production ≠ main HEAD |
| Rollback trigger FREEZE | ✅ (mục 4 dưới) | Số đông cứng — đổi phải sửa file này |
| 20 nightly sạch liên tiếp (frozen matrix) | ✅ **20/20** (2026-07-14) | 20 run frozen-suite liên tiếp từ mốc nightly 2026-07-13T21:26Z, tất cả success (dispatch bù); verify độc lập qua gh api |
| Traffic baseline đo lại sát cutover | ⏳ | `backend/scripts/traffic_baseline.sh` — chạy trong vòng 72h trước mỗi cutover (B36) |
| Quantitative register freeze | ✅ (mục 5 dưới) | Frozen estimate + số đo per-pilot |

## 2. Điều kiện bổ sung — authenticated pilot (pilot 3, 4)

| Điều kiện | Trạng thái | Bằng chứng |
|---|---|---|
| ADR-011 đóng | ✅ | AuthProvider state machine + fail-closed; merged #742 |
| Private responses `Cache-Control: private, no-store` | ✅ | GET /auth/me + /auth/profile (#742), PATCH /auth/profile (#743); E2E assert header trên staging |
| Logout → back/forward/reload không phục hồi dữ liệu cũ | ✅ | `pilot-3-profile.spec.js` live 3/3 (isolation matrix + bfcache pageshow re-validation) |
| Login A → Login B không lộ dữ liệu A | ✅ | Cùng spec: token A không xuất hiện ở phase B, DOM sạch A; same-status switch (review #742) cũng pass live |

## 3. Điều kiện bổ sung — mutation pilot (pilot 4)

| Điều kiện | Trạng thái | Bằng chứng |
|---|---|---|
| Idempotency hoặc retry-off | ✅ | PATCH /auth/profile set-semantics; idempotent-replay pin (backend test + staging E2E contract) |
| Canonical reconcile GET | ✅ | Save LUÔN refetch GET /auth/profile (kể cả ambiguous timeout-after-commit); drill local + staging |
| DB invariant checks | ✅ | Server clamp/whitelist (`weekly_goal` 1–14, `self_level` whitelist, `display_name` 100 chars); 400 pin trên staging |
| Kill switch + drill đo thật | ✅ | `require_flag("profile_update")` (ADR-010); drill staging: off→503 **545 ms**, on→200 **759 ms** (≪ TTL 15s); flag name trong mutation ledger = `profile_update` |
| Repair dry-run | ✅ (quyết định) | Mutation là field-set REVERSIBLE — "repair" = re-PATCH giá trị đúng qua chính endpoint (E2E revert chứng minh mỗi đêm). Không cần công cụ repair riêng cho pilot này; mutation phức tạp hơn (grading/writing) PHẢI có repair dry-run riêng |
| N/N−1 consumer test | ⏳ **GAP** | ADR-009: hình thức hóa TRƯỚC CUTOVER pilot 4 (không chặn pilot 1–3). Bằng chứng tự nhiên đã có: cửa sổ rollback-pin ~5h chạy frontend N−6 + backend N với **0 lỗi** (backward-compat thực chiến) |
| Backend-deploy/frontend-rollback drill | ✅ | Chính cửa sổ pin + re-drill 2026-07-13: backend mới (error_code, no-store, require_flag) phục vụ frontend Phase-1 nhiều giờ, zero errors; rollback drill ≤12s |

## 4. Rollback trigger — FREEZE (đổi = sửa file này qua PR)

Cơ chế: **Instant Rollback** (≤12s đo thật) → điều tra → **Undo Rollback DUY NHẤT** khi khắc phục (bài học re-drill — không bao giờ Instant-Rollback "forward"). Sau mọi rollback: banner phải biến mất + merge kế tiếp auto-promote + nightly drift job xanh.

| Trigger (bất kỳ) | Ngưỡng | Nguồn đo |
|---|---|---|
| Error-rate delta trên route đã cutover | > 2× baseline legacy cùng route, cửa sổ 30 phút | Dashboard ADR-012 (so theo `implementation` tag) |
| P1 flow break (không load / trắng trang / auth loop) | 1 báo cáo XÁC NHẬN được | Error-logs + tái hiện tay |
| Private data leak / cache sai người dùng | NGAY LẬP TỨC, không cần xác nhận thứ hai | Bất kỳ nguồn nào |
| Mutation sai/mất dữ liệu (pilot 4) | NGAY LẬP TỨC + flip `profile_update` OFF trước, điều tra sau | Kill switch 503 trong ≤15s |
| Web Vitals thoái hóa | LCP p75 route > 1.5× baseline trong 24h | Đo tại cutover sheet (mục 5) |

Verification sau mọi flip: browser thật hoặc polling ≥15s; `x-vercel-mitigated: challenge` = firewall, KHÔNG phải app state.

## 5. Quantitative register — FREEZE

Frozen estimate (investment gate §Phase 2: >2× ở ≥2 pilot → steering review):

| Pilot | Route cutover | Estimate frozen (giờ kỹ sư, gồm cutover+soak) | Đã tiêu (build, đo từ PR) |
|---|---|---|---|
| 1 landing | `/` | 6h | ~1h (#740) |
| 2 grammar | `/grammar/:category/:slug` | 8h | ~1.5h (#741) |
| 3 profile read | `/pages/profile.html` → route mới | 8h | ~2h (#742) |
| 4 profile mutation | (cùng trang pilot 3) | 8h | ~2.5h (#743 + #744) |

Số đo bắt buộc TẠI cutover (phương pháp freeze): client JS gzip per route (build output + `du`), Lighthouse (mobile, 3 lần lấy median, cùng máy), Web Vitals thực (per `implementation` tag), API request count per pageload (DevTools/HAR so legacy vs Next), diff size (`git diff --stat` PR cutover), test replacement ratio (ledger), visual parity (screenshot diff), error rate 7 ngày trước/sau (dashboard ADR-012).

Exposure floor (theo `docs/TRAFFIC_BASELINE_2026-07-13.md`): pilot 1 root = floor chuẩn (traffic cao nhất site); pilot 2 grammar = **low-traffic profile bắt buộc** (21 ngày + ≥20 interactions + synthetic crawl); pilot 3–4 profile = đo lại baseline sát cutover rồi chốt floor.

## 6. Cutover sheet per-pilot (điền + re-verify ngay trước cutover)

Mẫu chung — cutover là ATOMIC: route flip + gỡ rewrite legacy trong CÙNG commit (route-ownership check cưỡng chế); verify browser-based; rollback trigger ở mục 4; mutation pilot ghi tên flag.

1. **Pilot 1 — landing:** move `app/(marketing)/landing-preview/page.tsx` → `app/(marketing)/page.tsx` + gỡ rewrite `/` → `/index.html`; quyết định số phận `/index.html` (redirect?); OAuth-redirect recovery script BẮT BUỘC giữ (Supabase OAuth đáp về `/`).
2. **Pilot 2 — grammar article:** move `[category]/[slug]` vào route canonical + gỡ rewrite `/grammar/:category/:slug` cùng commit; giữ nguyên contract cacheLife (ADR-008); soak theo low-traffic profile.
3. **Pilot 3 — profile read:** quyết định URL canonical (`/profile` mới + redirect từ `/pages/profile.html`, hoặc giữ path cũ); cập nhật mọi link nội bộ (chrome user pill); private no-store re-verify.
4. **Pilot 4 — profile mutation:** chỉ sau pilot 3 cutover ổn định; N/N−1 consumer test phải xanh trước; flag `profile_update` ghi vào cutover sheet; double-submit/timeout-after-commit E2E là điều kiện xanh của đêm trước cutover.

## 7. Gaps còn mở (owner: dev; chặn cutover tương ứng)

| Gap | Chặn | Kế hoạch |
|---|---|---|
| 20 nightly sạch | ✅ ĐẠT 20/20 (2026-07-14) | — (bất kỳ run đỏ sau này reset; re-verify sát cutover) |
| N/N−1 consumer test hình thức hóa (ADR-009) | Cutover pilot 4 | Viết khi chuẩn bị cutover pilot 4 |
| Traffic baseline re-run | Từng cutover | Chạy script trong 72h trước cutover |
| Lighthouse/Web Vitals/API-count baseline per route | Từng cutover | Đo theo phương pháp freeze ở mục 5, ghi vào cutover sheet |
