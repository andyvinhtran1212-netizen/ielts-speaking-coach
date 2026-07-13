# ADR-008 — Public content caching (Grammar SSR)

**Status:** ACCEPTED 2026-07-13 · Plan v3 Phase 3, B12 · Baseline traffic: docs/TRAFFIC_BASELINE_2026-07-13.md

## Quyết định
1. Mô hình đầu tiên: **request-time SSR + cache**, KHÔNG pre-generate toàn bộ (grammar ~1 view/ngày — pre-gen 150 bài là tối ưu sớm). Next 16 Cache Components: `'use cache'` + `cacheLife` TTL; invalidation bằng `cacheTag`/`updateTag` khi cần.
2. TTL mặc định: 1 giờ cho article body; editor-facing stale window = 1 giờ, ghi rõ cho người biên tập. Nếu cần invalidation nhanh: signed internal revalidation Route Handler (control-plane exception ADR-001) — không business logic.
3. Node runtime (không Edge); Vercel function region đặt GẦN RAILWAY backend — region Railway phải capture vào Vercel settings inventory Phase 1 trước khi chốt.
4. Server fetch: abort timeout 5s; lỗi/timeout → serve stale nếu có, fail-closed sang plain fallback nếu không (B17); build KHÔNG phụ thuộc Railway uptime (B12 — không fetch at build).
5. `generateMetadata` + page body dùng CÙNG memoized loader.
6. Freshness SLO: p95 nội dung không cũ hơn TTL+5 phút; cache-hit ratio và uncached p50/p95 vào dashboard ADR-012.
