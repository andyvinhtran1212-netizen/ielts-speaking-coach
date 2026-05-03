# Sprint 4 Migration 032 — Accelerated Apply Checklist

**Migration:** `backend/migrations/032_add_recommended_anchor_to_grammar_recommendations.sql`
**Rollback:** `backend/migrations/032_rollback.sql`
**Strategy:** Apply to staging + production immediately, before PR merge (Andy aggressive path).

## Why aggressive path is safe here

| Risk dimension | Status |
|---|---|
| Schema change profile | **ADD COLUMN nullable TEXT** — safest possible change |
| Idempotency | `IF NOT EXISTS` — safe to re-run |
| Lock impact | Postgres ≥11 metadata-only ALTER → negligible |
| App compatibility | Backward compatible — pre-Sprint-4 code ignores the new column; post-Sprint-4 code writes it but tolerates NULL on read |
| Rollback safety | `DROP COLUMN IF EXISTS` reversible — but warning: don't roll back while Sprint 4 app code is live in prod (INSERT will fail) |
| Data loss risk | None — adds column, doesn't touch existing rows |

App code consuming the new column (commit `7e65d72`) is **not yet on main** — will land via PR merge after this branch is reviewed. Until then, the column sits unused on both environments. After PR merge + deploy, grading calls start populating it.

---

## Apply sequence (Andy executes via Supabase dashboard SQL editor)

### Staging

- [ ] **Backup** — Supabase dashboard → Database → Backups → manual snapshot tagged `pre-032-staging-2026-05-03`
- [ ] **Apply** — copy contents of `backend/migrations/032_add_recommended_anchor_to_grammar_recommendations.sql` into Supabase SQL editor → Run
- [ ] **Verify column exists**
   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name = 'grammar_recommendations'
     AND column_name = 'recommended_anchor';
   ```
   Expected: 1 row, `text`, `YES`
- [ ] **5-min smoke test** — confirm existing endpoints don't break:
   - Hit any practice grading endpoint (or run `pytest backend/tests/test_grammar_smoke.py` against staging if applicable)
   - Confirm an existing `SELECT * FROM grammar_recommendations LIMIT 1` returns the new column with `NULL` for old rows
   - No app deploy needed in this step — existing code ignores the new column

### Production

- [ ] **Backup** — Supabase dashboard → Database → Backups → manual snapshot tagged `pre-032-prod-2026-05-03`
- [ ] **Apply** — same SQL via prod Supabase SQL editor → Run
- [ ] **Verify column exists** — same `information_schema.columns` query against prod
- [ ] **5-min smoke test** — same as staging:
   - One end-to-end practice grading call (production user, low traffic if possible)
   - Confirm response shape unchanged (existing fields all present)
   - Confirm no error logs in app server

---

## After both environments verified

- [ ] Reply to Code with: **"Migration applied to staging + production, both verified. Proceed Phase 6."**
- Code resumes: Phase 6 (endpoint integration confirmation — pure verification, no further code changes; the application write path was already updated in commit `7e65d72`)
- Phase 7: CI workflow (`backend-tests.yml`)
- Phase 8: smoke tests + execution report

---

## After PR merge + production deploy of Sprint 4 app code

- [ ] Verify a fresh practice grading call writes `recommended_anchor` for issues that resolve to a mapped anchor
   ```sql
   SELECT recommended_slug, recommended_anchor, grammar_issue
   FROM grammar_recommendations
   WHERE recommended_anchor IS NOT NULL
   ORDER BY created_at DESC
   LIMIT 5;
   ```
   Expected: at least one recent row populates the new column once a user with a mapped grammar issue completes a practice session

---

## Rollback procedure (only if Sprint 4 broken in production)

**Critical sequence:**
1. Revert application deploy to pre-Sprint-4 commit (rolls back `7e65d72` consumption of the new column)
2. Then apply `backend/migrations/032_rollback.sql` via Supabase SQL editor
3. Confirm column dropped via `information_schema.columns` query

Reversing this order will cause INSERT failures on `grammar_recommendations` while the app code still references `recommended_anchor`.
