# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_324_writing_drafts_fk.py (delete with draft raises 23503) plus catalog query research.md §7 P1 on staging (AC-1) | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_writing_assignment_delete_guard.py (23503 maps to 409) plus staging journeys research.md §8 AC-3 to AC-6 | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_324_writing_drafts_fk.py (single-statement student delete) plus AC-8 E2E cleanup | PENDING |
| FR-004 | kind=query; ref=research.md §2.2 counts before and after apply (AC-2) and re-apply no-op test | PENDING |

## Contract evidence

- OpenAPI/type drift: none; status codes and detail strings are those of #1732.
- Backward compatibility: backend works with or without 324 applied.

## Data evidence

- Migration/schema query: `research.md` §7 P1/P2 on staging after apply.
  Production P1–P5 before apply and P1–P3 after apply are recorded under
  Release evidence.
- Immediate state versus full reload: draft text re-read after a refused delete.

## UI evidence

- Viewports/themes/input methods: no UI surface.

## Release evidence

- Staging SHA and checks: the promoted staging SHA
  `c028ed21c910f469d36abfa0907e3fd71d363709` passed Staging release smoke
  (run 40481428210) plus Tests, Next-native, Typecheck, Build checks, Spec
  governance and Legacy guard on 2026-10-27. The staging apply and AC run of
  T007 are not in that record and stay pending.
- Production verification: done (T006, T008). Details below.

### Production — 2026-10-27

Released with promotion PR #1763 (`staging` → `main`), merge commit `c9d564dfeac2df42611dcd308aaad1a2e970c580`, merged 2026-10-27 17:09 UTC+7.
Vinh authorized the apply on 2026-10-27 16:32–16:33 UTC+7. Every check below
is a read-only catalog or count query (no PII). The results come from the
operator's release log for #1763.

| Step | Time (UTC+7) | Observed |
| --- | --- | --- |
| P1–P5 before apply | 17:07 | P1: the only FK into `writing_assignments` is `writing_drafts_assignment_id_fkey` (`confdeltype` `c`, validated). P2: 0 orphan drafts. P3: 572 assignments, 4 drafts. By status: pending 24/0, delivered 11/0, submitted 527/0, in_progress 10 with 4 drafts. P4: `trg_guard_writing_draft_mutation` and `update_writing_drafts_updated_at` enabled (`O`). P5: 324 not in the ledger; 323 already applied. |
| Apply 324 | 17:07:56 | Locked runner. Lock released; ledger `applied_at` 2026-10-27 10:07:58 UTC. |
| After apply | 17:08 | FK `confdeltype` `a` (NO ACTION), validated; 0 CASCADE children into `writing_assignments`. P2/P3 unchanged: 0 orphans, 572/4, same by-status split. 324 is in the ledger; lock not held. |
| End of release | 17:09 | Ledger from 321 onward = 323, 324, 325, 326; FK still `a`/validated with 0 cascading children. |
| Deploy and smoke | 17:10–21:18 | Railway backend and Vercel frontend serve `c9d564dfe`. Railway HTTP logs from 10:05 to 14:17 UTC show 0 × 5xx. `main` CI on `c9d564dfe` is green, and Production release drift run 40519770482 passed. |

These are the production counterparts of AC-1 (catalog) and AC-2 (counts
unchanged). The FR rows above stay `PENDING` because they cite CI tests and
staging journeys that this record does not cover.

Not run on production: the delete-with-draft → 409 journey (optional in the
release plan). It would write production data.
