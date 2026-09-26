---
name: api-route
description: Add or extend an Aver Learning FastAPI endpoint with the existing domain authorization, data access and OpenAPI contract.
---

Read root `AGENTS.md` and the closest existing route/service for this domain.
Implement the requested endpoint without changing unrelated API architecture.

- Use the established authentication helper
  `routers.auth.get_supabase_user(authorization)` for protected routes and the
  domain's existing admin guard for admin operations. Never trust a browser
  user ID or role claim as ownership proof.
- Inspect the actual data boundary. Existing domains use RLS-scoped clients,
  explicitly authorized service-role queries, and some SQLAlchemy/RPC paths.
  Follow the domain contract; service-role clients bypass RLS and therefore
  require explicit ownership/entitlement checks for every accessed resource.
- Validate request and response shapes, null/empty semantics, pagination and
  error states together with the frontend consumer. Reuse Pydantic models.
- Preserve HTTP errors from auth/validation; do not wrap them into generic 500s.
  Log diagnostic context safely and return a stable user-safe error. Do not
  expose exception strings, credentials, transcripts or internal traces.
- Verify every referenced table/column against migrations. Multi-row atomicity
  and race-sensitive authorization belong in the established transaction/RPC
  boundary, not an optimistic sequence of independent writes.
- Mount a new router in `backend/main.py`; document intentionally public routes.
  Regenerate the OpenAPI snapshot/types using the commands in
  `.github/workflows/typecheck.yml` when the public schema changes.
- Test success, authentication, ownership denial and relevant failure paths.
  Follow `docs/AGENT_WORKFLOW.md` and the approved spec before pushing to a PR
  targeting `staging`.
