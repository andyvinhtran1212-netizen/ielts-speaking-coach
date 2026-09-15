# Post-migration ledger closure — 2026-09-15

## Conclusion

The frontend migration remains complete. The last migration-adjacent database
ambiguity is closed by separating active product migrations, pending feature
migrations and retired Gate F evidence migrations in a fail-closed forward
policy.

## Findings and remediation

| Severity | Root cause | Impacted files / state | Minimal remediation |
|---|---|---|---|
| Medium | The forward runner treated every numbered SQL file as active even after Gate F evidence/admission was waived and retired. | `backend/scripts/apply_migrations.sh`; repository migrations `240–244`, `247–256` | Add an exact-file policy. Normal runs skip retired migrations; the two runtime flags remain default-off. |
| Medium | Curated Vocabulary was a staging-first feature but the generic production runner had no explicit release boundary for `234–239`. | `backend/migrations/234_*` through `239_*` | Keep the files as `pending_feature:curated_vocab`; production requires `MIGRATION_FEATURES=curated_vocab`. |
| Medium | A staging schema rebuild clones production, where Curated Vocabulary is intentionally absent. The new default policy would otherwise leave rebuilt staging without `234–239`. | `backend/scripts/staging_clone_schema_from_prod.sh` | After baselining the production clone, apply `curated_vocab` normally and fail the rebuild unless six ledger rows and its core tables exist. |
| Medium | Active Mock/correction schema existed on staging outside its ledger. Replaying `245/246/257/259/260` could repeat data DML or obsolete function revisions. | Staging `_schema_migrations` | Compare eight final function and seven table fingerprints with production, verify RLS/ACL and Q06/Q07 content postconditions, then record only the five exact filenames under advisory lock `(173204, 1)`. |
| Medium | Production recovery `233` had completed but was absent from the ledger. | Production `_schema_migrations`; two scoped `class_assignment_items` | Verify both exact IDs reached their expected attempt number/timestamp and later `graded` state, then record only `233` under the shared lock. |
| Medium | The canonical Cambridge importer reintroduced a shorter Q07 tip and removed `trap_analysis` after migration 246. | `backend/scripts/import_cambridge_canonical_qa.py`; Cambridge 15 Test 4 Reading Q06/Q07 | Make importer payload canonical and add idempotent migration 262; do not touch historical attempts. |

## Hosted verification record

- Staging and production matched for all eight final Mock/explanation function
  fingerprints and all seven table-column fingerprints.
- Staging reported no missing RLS or leaked client function privilege in the
  audited Mock/correction scope.
- Staging ledger reconciliation inserted exactly five rows; production inserted
  exactly one row. Neither operation replayed a migration body.
- After reconciliation, forward dry-run lists only migration 262 as active on
  each environment. Production separately reports `234–239` as the pending
  Curated Vocabulary feature group; Gate F-only files report `retired`.

## Final verification

1. Focused importer, policy and migration tests pass.
2. `bash -n backend/scripts/apply_migrations.sh` passes.
3. Apply migration 262 to staging, verify the structured Q07 payload, then run
   staging release smoke.
4. Promote the exact staging tree, apply migration 262 to production, and verify
   both forward dry-runs report zero active pending migrations.
5. Keep permanent Next-native browser, legacy-freeze, staging smoke, promotion
   and production-drift workflows. They are release controls, not migration
   work left open.
