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
- Immediate state versus full reload: after a role change, reloading
  `/admin/users` shows the stored role.

## UI evidence

- Viewports/themes/input methods: unchanged surface; one desktop check of the
  role select success banner on staging.

## Release evidence

- Staging SHA and checks: pending T007.
- Production verification: pending T008.
