# ADR-006 — Runtime environment provenance

**Status:** ACCEPTED — ĐÃ SHIP LÕI 2026-07-13 (PR #730) · Plan v3 §7.1, B1, B25

## Quyết định (đã hiện thực)
1. MỘT generated public config `frontend/js/runtime-config.js` (generator `tooling/generate-runtime-config.mjs`) dùng chung legacy + Next: environment, apiBase, supabaseUrl, supabaseAnonKey, release SHA, gitRef. Chỉ public values.
2. Bản commit = UNCONFIGURED (null) → mọi context không-Vercel giữ hành vi cũ; Vercel build generate theo VERCEL_ENV (production → prod origins; mọi preview → STAGING origins).
3. FAIL-CLOSED: build non-production resolve ra production origin → generator abort build.
4. Consumers: api.js `_API_BASE` + `initSupabase` ưu tiên config; perf-hints Supabase preconnect theo config; public-stats external rewrite đã xóa; sweep test chặn trang mới quên include.
5. Egress evidence: staging-e2e chạy đêm assert ZERO request tới production origins từ browser (platform.spec) — bằng chứng Gate A lớp browser. Các lớp còn lại (compiled rewrites scan, server outbound trace, production access-log assertion) là artifact Gate A khi có Next server-side fetch.

## Secret boundary
Không secret nào trong config/generator (anon keys là publishable). Service-role chỉ ở backend env. Bypass token + E2E password chỉ ở GitHub secrets.
