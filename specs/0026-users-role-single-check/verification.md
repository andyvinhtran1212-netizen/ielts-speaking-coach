# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | reviewer=Codex; environment=staging; date=2026-10-29; observed=admin promotion 200, success banner and immediate/reloaded instructor role; instructor access 200 then 403 after demotion; report=docs/verification/2026-10-29-admin-t007-0026-0028-staging.md | MANUAL |
| FR-002 | reviewer=Codex; environment=staging; date=2026-10-29; observed=wrong-email grant rejected 403 before consumption; intended email activation 200 with persisted instructor role and both audit actions; report=docs/verification/2026-10-29-admin-t007-0026-0028-staging.md | MANUAL |
| FR-003 | kind=test; ref=backend/tests/test_migration_323_users_role_single_check.py plus catalog query research.md §2.1 (AC-1, AC-11) | PASS |
| FR-004 | reviewer=Codex; environment=staging; date=2026-10-29; observed=four direct REST escalations denied 403/42501; trigger enabled and all four privilege categories returned zero violations; report=docs/verification/2026-10-29-admin-t007-0026-0028-staging.md | MANUAL |
| FR-005 | reviewer=Codex; environment=staging; date=2026-10-29; observed=no migration data write; non-fixture roles reconciled; self-demotion 400 and legacy-user me/profile 200; report=docs/verification/2026-10-29-admin-t007-0026-0028-staging.md | MANUAL |

2026-10-29 staging evidence for the requirements above: [T007 results, limitations and cleanup](../../docs/verification/2026-10-29-admin-t007-0026-0028-staging.md). The existing apply state and current journeys are evidenced separately.

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
  governance and Legacy guard on 2026-10-27. T007 staging apply-state
  reconciliation and acceptance were recorded separately on 2026-10-29 in
  the linked evidence above; the current shell-runner attempt could not connect
  and no migration was replayed.
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
distribution unchanged). The production record alone does not cover the FR tests
and staging journeys; their current results come from the separate 2026-10-29
T007 record above.

Not yet run on production:

- One real instructor promotion of an account Vinh names (FR-001,
  `rollout.md` Production). **Pending — owner account decision (not yet run).**
- Authenticated instructor-code activation. Not attempted, because it would
  write production data.
