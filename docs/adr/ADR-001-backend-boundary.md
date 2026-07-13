# ADR-001 — FastAPI là business backend duy nhất

**Status:** ACCEPTED 2026-07-13 · Plan v3 §4.1, B18

## Quyết định
FastAPI/Railway giữ TOÀN BỘ: authentication verification, authorization truth, grading, session finalization, persistence, admin permissions, content authoring, AI calls/rate-limit/cost control, business validation, database writes. Next.js chỉ sở hữu routing/layout/metadata, server-render public content, React UI state, error boundaries, analytics adapter.

## Cấm tuyệt đối trong migration
- Next API route duplicate FastAPI endpoint.
- Server Actions cho grading/admin mutations.
- Client-side role hoặc Next route guard làm security boundary.
- Vercel KV/DB thay dữ liệu canonical.
- Service-role key trong bất kỳ code Next nào.

## Ngoại lệ được phép (có kiểm soát)
- `server-only` public GET client cho Grammar SSR (ADR-008), không cookie/Authorization.
- Signed internal revalidation Route Handler (control-plane exception, ADR-008) — không chứa business logic.
- Backend enabling changes theo plan §14.2 (fixtures, CORS, telemetry, idempotency, seed) — additive, backward-compatible.

## Enforcement
Lint/review rule khi scaffold Next (Phase 1): import boundary `server-only`/`client-only`; PR checklist mục 14. Vi phạm = block merge.
