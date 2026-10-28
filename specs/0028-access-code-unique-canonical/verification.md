# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_325_access_codes_unique.py (index codified, re-apply no-op, invalid index aborts) plus catalog AC-1 on staging | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_325_access_codes_unique.py (lower-case or padded insert raises 23514) | PENDING |
| FR-003 | kind=query; ref=research.md §2.1 counts before and after apply (AC-2) and precheck abort test | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_access_code_generation.py (instructor mint retries on 23505) plus AC-4 on staging | PENDING |
| FR-005 | kind=journey; ref=research.md §9 AC-5, AC-6 (normalized input and class code activation) on staging | PENDING |

## Contract evidence

- OpenAPI/type drift: none; mint responses keep their shape.
- Backward compatibility: legacy 8-character codes remain canonical and active.

## Data evidence

- Migration/schema query: `research.md` §8 P1–P4 on staging after apply.
  Production P1–P6 before apply and P1–P4 after apply are recorded under
  Release evidence.
- Immediate state versus full reload: minted codes listed after reload.

## UI evidence

- Viewports/themes/input methods: no UI change.

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
| P1–P6 before apply | 17:08 | P1: `access_codes_code_key` UNIQUE (`code`) already present (contype `u`, validated; index unique and valid), so it predates 325. `chk_access_codes_code_canonical` absent. P2–P4: total 110; dup_exact, dup_lower and dup_norm groups 0; untrimmed 0; not_upper 0; empty 0; null 0. P5 was not needed because there are no duplicates. P6: 325 not in the ledger; 323 and 324 already applied. |
| Apply 325a | 17:08:13 | Lock, ledger re-check, step-1 precheck, unlock. No writes; lock released. |
| Apply 325b | 17:08:17 | Ran the lone `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS access_codes_code_key …`. Result `[]`: a no-op, because the index already existed. |
| Apply 325c | 17:08:22 | Rest of the file. Lock released; ledger `applied_at` 2026-10-27 10:08:24 UTC. |
| After apply | 17:08 | `access_codes_code_key` unique and valid, untouched. `chk_access_codes_code_canonical` (`code = upper(btrim(code)) AND code <> ''`) present and validated. All counters still 0; total 110. Ledger from 321 onward = 323, 324, 325; lock not held. |
| End of release | 17:09 | Ledger from 321 onward = 323, 324, 325, 326; unique index valid; canonical CHECK present. |
| Deploy and smoke | 17:10–21:18 | Railway backend and Vercel frontend serve `c9d564dfe`. Railway HTTP logs from 10:05 to 14:17 UTC show 0 × 5xx. `main` CI on `c9d564dfe` is green, and Production release drift run 40519770482 passed. Anonymous `POST /auth/activate` returns 401/422, never 500. |

These are the production counterparts of AC-1 (catalog) and AC-2 (counts
unchanged, 0 duplicates). The FR rows above stay `PENDING` because they cite
CI tests and staging journeys that this record does not cover.
`access_codes_code_key` predates 325 on production and must never be dropped.

Not run on production: instructor mint (201, optional in the release plan) and
a real code activation. Both would write production data.
