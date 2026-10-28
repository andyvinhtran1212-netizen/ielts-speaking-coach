# Implementation plan

## Architecture impact

- Operator tooling only: `backend/scripts/bind_revision_web_explanations.py`
  gains marking-equivalent comparison, group handling, accepted-forms sync and
  two reviewer lists. No route, migration, job or frontend change.
- It imports `normalize_answer` and `_expected_letters` from
  `services/listening_test_grader.py` and `policy_answer_matches` from
  `services/mock_response_policy.py`, so the comparison cannot drift from
  marking.
- Runtime marking is untouched. `apply_scoring_overrides` already overlays an
  adjudicated copy's `accepted_forms`; that is how FR-005's union takes effect.

## Data and contracts

- `load_inputs` additionally returns, for Listening, each question's
  `mcq_multi` exercise slots (from `listening_exercises.payload.template_kind`).
- Copied rows keep `object_id`, `content_version`, `source_hash` and pending
  rights/editorial statuses as in 0022. Only `payload.item.answer.accepted_forms`
  and `payload.audit.revision_answer_sync` may differ from the source payload,
  and only for listed questions.
- Plan: per-question `classification` (`identical`, `equivalent`, `group`,
  `synced`, `policy`, `grading_change`), `reviewed_answer_sync`,
  `approved_grading_changes`; all inside the SHA-256.

## UI and interaction

- None.

## Work decomposition

1. Land this spec (owner approval) on staging.
2. Binder change and tests in one `high-risk` PR citing REVEXPLAIN-0023.
3. Staging rehearsal on the unbound `QA-CAM19-20261024` C19 T2/T3/T4 Listening
   and T2 Reading copies (override union, superset sync, shorthand).
4. Production dry run of the 35 refused papers; owner review page; commit the
   approved ones with read-back; evidence PR.

## Rollout and rollback

- See [rollout.md](rollout.md).

## Verification strategy

- Unit: new cases in `backend/tests/test_bind_revision_web_explanations.py`
  for each FR and edge case, plus all existing 0022 cases unchanged.
- Marker parity: for every synced or grading-change question, the test asserts
  `answer_matches` accepts each form in the copy and the runtime key built by
  `apply_scoring_overrides`.
- Staging: rehearsal binding, read-back, and an override-overlaid key check.
- Production: per-paper read-back and an attempts-unchanged check.
