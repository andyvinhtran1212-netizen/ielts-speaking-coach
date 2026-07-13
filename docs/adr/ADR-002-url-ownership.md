# ADR-002 — URL ownership và compatibility

**Status:** ACCEPTED 2026-07-13 · Plan v3 §8.2, §8.5, B3/B6 · Route ledger: docs/ROUTE_LEDGER.md

## Quyết định
1. Canonical URLs hiện tại (kể cả dạng `.html`) được GIỮ NGUYÊN qua migration; clean-URL đổi SAU khi flow ổn định, từng route một. Không đổi hàng loạt.
2. Khi Next scaffold vào (Phase 1): same-application rewrites chuyển dần từ `frontend/vercel.json` sang `next.config` — `next.config` là source of truth; mỗi rule ghi rõ phase `beforeFiles`/`afterFiles`/`fallback`.
3. Compiled route-ownership graph (app routes + public/ files + rewrites + redirects + aliases + headers) build-fail khi collision; deployed-Preview probe là bằng chứng cuối, không phải config source.
4. Query/hash contract per-route ghi trong ROUTE_LEDGER (`session_id`, `test_id`, `attempt_id`, anchors); redirect phải preserve query; hash chứng minh bằng browser test.
5. Cutover một route = atomic ownership change (thêm app route + gỡ legacy rewrite trong CÙNG change) — ví dụ chuẩn: `/grammar/:category/:slug`.

## Hiện trạng đã kiểm chứng
vercel.json còn 10 rewrites + 18 redirects + 4 header rules (external rewrite public-stats đã xóa — PR #730). 408 hardcoded navigation refs → route helper `RouteLink` đọc ownership manifest (Phase 1 deliverable).
