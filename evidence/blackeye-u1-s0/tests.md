# S0 real local test receipt

Task: aver-web/t_a7881371. Branch: blackeye-u1-s0.
Baseline: 7243b3364cfd637dc1bd0cd464c810380e27d10e.
Final exact commit is recorded outside its own contents in the card handoff.

- Interpreter: `3.12.14` (`/opt/homebrew/opt/python@3.12/bin/python3.12`).
- Start (UTC+7): 2026-11-10T13:10:14.081566+07:00
- End (UTC+7): 2026-11-10T13:10:14.713552+07:00
- Working directory: `/Volumes/Kingston SSD/Code/AVER-WEB-TEAM/worktrees/blackeye-u1`
- Command: `/opt/homebrew/opt/python@3.12/bin/python3.12 -B -m unittest discover -s evidence/blackeye-u1-s0 -p 'test_*.py' -v`
- Exit code: **0**
- Expected: all S0 source-characterization tests pass; existing refusals remain
  400 (admin programme give), 422 (assigned programme start/guided/save q>40),
  409 (non-submitted review), 503 (missing source identity/frozen mismatch).
  Synthetic Black Eye is NOT recognized by 80-days-only source guard.
- Observed: actual complete runner output below; test success characterizes
  those existing boundaries/gaps, **not Black Eye feature readiness**.

```text
test_a13_save_41_and_48_reject_before_answer_rpc (test_s0_characterization.S0Characterization.test_a13_save_41_and_48_reject_before_answer_rpc) ... ok
test_admin_programme_assignment_missing_rejects_400_before_writer (test_s0_characterization.S0Characterization.test_admin_programme_assignment_missing_rejects_400_before_writer) ... ok
test_composite_candidate_json_string_is_lossless_not_delimiter_encoded (test_s0_characterization.S0Characterization.test_composite_candidate_json_string_is_lossless_not_delimiter_encoded) ... ok
test_generic_importer_cap_stays_40_and_composite_type_absent (test_s0_characterization.S0Characterization.test_generic_importer_cap_stays_40_and_composite_type_absent) ... ok
test_guided_assigned_and_sitting_reject_before_protected_reads (test_s0_characterization.S0Characterization.test_guided_assigned_and_sitting_reject_before_protected_reads) ... ok
test_guided_submitted_rejects_409_before_protected_reads (test_s0_characterization.S0Characterization.test_guided_submitted_rejects_409_before_protected_reads) ... ok
test_mv1_missing_test_identity_fails_503 (test_s0_characterization.S0Characterization.test_mv1_missing_test_identity_fails_503) ... ok
test_mv1_source_required_is_80_days_only_not_blackeye (test_s0_characterization.S0Characterization.test_mv1_source_required_is_80_days_only_not_blackeye) ... ok
test_programme_assigned_start_missing_rejects_422_before_assignment_validation (test_s0_characterization.S0Characterization.test_programme_assigned_start_missing_rejects_422_before_assignment_validation) ... ok
test_review_cross_owner_fails_before_assembly (test_s0_characterization.S0Characterization.test_review_cross_owner_fails_before_assembly) ... ok
test_review_non_submitted_blocks_assembly (test_s0_characterization.S0Characterization.test_review_non_submitted_blocks_assembly) ... ok
test_review_snapshot_rejects_wrong_revision_and_returns_frozen_copy (test_s0_characterization.S0Characterization.test_review_snapshot_rejects_wrong_revision_and_returns_frozen_copy) ... ok
test_revisionless_attempt_does_not_reuse_mock_snapshot (test_s0_characterization.S0Characterization.test_revisionless_attempt_does_not_reuse_mock_snapshot) ... ok
test_start_rejects_standalone_assigned_context_swap (test_s0_characterization.S0Characterization.test_start_rejects_standalone_assigned_context_swap) ... ok
test_submitted_assigned_owner_reaches_generic_assembly_not_blackeye_authorization (test_s0_characterization.S0Characterization.test_submitted_assigned_owner_reaches_generic_assembly_not_blackeye_authorization) ... ok

----------------------------------------------------------------------
Ran 15 tests in 0.467s

OK
```

## Method and isolation

Stdlib only. Selected original function bodies are parsed from this checkout
and executed with injected fake collaborators. Decorators, module imports,
annotation evaluation, actual FastAPI routing, auth/DB and review assembly are
NOT exercised. Unexpected socket connect fails. Composite test is JSON-string
round-trip feasibility, not a database/Pydantic/UI codec test. No book content,
.env reads, app launch, cluster, migrations, install or live/paid requests.

First exploratory execution used host `python3` 3.9.6 and passed the earlier
13-test version (0.540s, exit 0); this receipt supersedes it with the final full
S0 suite on project-compatible Python 3.12. No failed test output is hidden.
Type-inference diagnostics during test authoring were corrected with explicit
Callable/Any annotations; they were not product failures or waived tests.

## NOT RUN / OPEN

- MV1 Black Eye identity/protected projection and MV2 assigned persisted review
  end-to-end. Existing generic submitted review is present, new boundaries absent.
- Full backend pytest, real FastAPI/Pydantic/OpenAPI and existing full Listening/
  80-days/dictation suites; no backend dependency lock discovered, no install or
  dependency re-resolution under lockfile-only scope.
- Postgres/Supabase/RLS/integration/concurrency/migration tests: no cluster/schema
  provisioned; even local migrations forbidden; local Supabase absent by card.
- Frontend typechecks/build/React/OpenAPI drift/browser/E2E: no frontend changed
  or launched. Proposed DTO/codec/cap behavior is not implemented.
- New generic-40/Black-Eye-48 positive validator/save/finalize/review tests, leakage,
  teacher/cohort negatives, stale/unavailable catalog retry and frozen revisions.
- All AC01–AC12 specialist acceptance, CI, served staging/production and real
  content/media/academic/rights verification. No source SHA presented as deploy proof.

See handoffs/LISTENING-BLACKEYE-V5-UNIT1-S0-FINDINGS-20261110.md for detailed
baseline routes, candidate DTOs, missing endpoints and conditional reuse.
