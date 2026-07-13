# ADR-004 — Rendering: Server Component mặc định

**Status:** ACCEPTED 2026-07-13 · Plan v3 §4.2, B10, B25

## Quyết định
1. Server Component là mặc định; `"use client"` ở boundary nhỏ nhất (state/effect/browser API/audio/recording/forms/client cache). Không đặt ở root layout.
2. Public Grammar fetch từ FastAPI ở server qua module `public-server-api` (`server-only`, allowlist public GET, không cookie/Authorization); cache semantics khai báo tường minh theo ADR-008 — không dựa default.
3. Authenticated data: fetch client-side trực tiếp FastAPI qua `authenticated-browser-api` (`client-only`); luôn `no-store` ở mọi shared/server layer; FastAPI private responses trả `Cache-Control: private, no-store`.
4. Upload/audio/FormData đi thẳng browser → FastAPI (tránh Vercel body/runtime limits).
5. HTML từ Markdown chỉ render qua MỘT sanitized renderer (B17); fail-closed khi sanitizer lỗi.
6. Next 16: dùng `proxy.ts` (không phải middleware.ts) nếu cần interception; không dùng global auth middleware trong coexistence.

## Guard
Bundle analyzer + per-route JS budget (tăng >20% baseline cần justification); lint import boundary server-only/client-only; review checklist B10.
