# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=journey; ref=research.md §8 AC-3, AC-4, AC-5 (admin promotes, instructor opens /instructor, demote to student) on staging | PENDING |
| FR-002 | kind=journey; ref=research.md §8 AC-6, AC-7 (instructor code activation, wrong email 403) on staging | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_323_users_role_single_check.py plus catalog query research.md §2.1 (AC-1, AC-11) | PENDING |
| FR-004 | kind=journey; ref=research.md §8 AC-8, AC-9, AC-10 (PostgREST self-escalation refused, 320 trigger enabled) | PENDING |
| FR-005 | kind=query; ref=research.md §5.1 Q1/Q2 before and after apply (AC-2) plus AC-12, AC-13 | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected; no route or schema change.
- Backward compatibility: existing `user`/`admin` rows satisfy the remaining
  constraint; no code depends on `users_role_check`.

## Data evidence

- Migration/schema query: `research.md` §2.1 catalog query; staging and
  production pre-checks recorded in §5.1 and §5.2 (production: no drift).
  Production re-check before apply and the post-apply catalog are recorded
  under Release evidence.
- Immediate state versus full reload: after a role change, reloading
  `/admin/users` shows the stored role.

## UI evidence

- Viewports/themes/input methods: unchanged surface; one desktop check of the
  role select success banner on staging.

## Release evidence

- Staging SHA and checks: the promoted staging SHA
  `c028ed21c910f469d36abfa0907e3fd71d363709` passed Staging release smoke
  (run 40481428210) plus Tests, Next-native, Typecheck, Build checks, Spec
  governance and Legacy guard on 2026-10-27. The staging apply and AC run of
  T007 are not in that record and stay pending.
- Production verification: migration done, journey pending (T008). Details below.

### Production — 2026-10-27

Released with promotion PR #1763 (`staging` → `main`), merge commit `c9d564dfeac2df42611dcd308aaad1a2e970c580`, merged 2026-10-27 17:09 UTC+7.
Vinh authorized the apply on 2026-10-27 16:32–16:33 UTC+7. Every check below
is a read-only catalog or count query (no PII). The results come from the
operator's release log for #1763.

| Step | Time (UTC+7) | Observed |
| --- | --- | --- |
| Global pre-check | 17:07 | Ledger top `320_client_write_privilege_lockdown.sql`, nothing from 321 onward; migration lock not held; no transaction > 60 s; PostgreSQL 17.6; `trg_users_guard_privileged_columns` enabled (`O`). |
| P1–P6 before apply | 17:07 | P1: two validated CHECKs, `chk_users_role` (user, student, instructor, admin) and `users_role_check` (user, admin). P2: `role` text, nullable, default `'user'`. P3: user 125, admin 1. P4: violates_new_set 0, role_null 0, non_canonical 0, total 126. P5: trigger 320 enabled `O`. P6: 323 not in the ledger. These match the 07:19 read in `research.md` §5.2. |
| Apply 323 | 17:07:40 | Locked runner. Lock released; ledger `applied_at` 2026-10-27 10:07:42 UTC. |
| P1/P3 after apply | 17:07 | Only `chk_users_role` remains (validated). Roles unchanged: user 125, admin 1. Lock not held; trigger 320 still `O`. |
| End of release | 17:09 | Ledger from 321 onward = 323, 324, 325, 326; still one CHECK; roles 125/1. |
| Deploy and smoke | 17:10–21:18 | Railway backend and Vercel frontend serve `c9d564dfe`. Railway HTTP logs from 10:05 to 14:17 UTC show 0 × 5xx. `main` CI on `c9d564dfe` is green, and Production release drift run 40519770482 passed. Anonymous `POST /auth/activate` returns 401 (missing or bogus token) and 422 (no `access_code`), never 500. |

These are the production counterparts of AC-1 (catalog) and AC-2 (role
distribution unchanged). The FR rows above stay `PENDING` because they cite
staging journeys and CI tests that this record does not cover.

Not yet run on production:

- One real instructor promotion of an account Vinh names (FR-001,
  `rollout.md` Production). **Pending — owner account decision (not yet run).**
- Authenticated instructor-code activation. Not attempted, because it would
  write production data.
