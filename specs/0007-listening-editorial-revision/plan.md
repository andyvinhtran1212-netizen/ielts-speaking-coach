# Implementation plan (pending spec and batch approval)

## Architecture impact

- The two v1.0 packages and current player remain untouched during review.
- Editorial data should become part of a new immutable package revision, not
  another expanding frontend-only translation map. The package builder,
  validator/importer and player form payload are the likely affected owners.
- Choose the narrowest localization projection that can bind both prompts and
  options to source IDs; do not add a separate answer or attempt store.

## Data and contracts

- Preserve source package IDs/hashes, lesson/item IDs, answer keys, option keys,
  score policy, media, timing and attempt history. New package IDs/manifest
  hashes are mandatory for changed content.
- Inspect whether the existing JSONB exercise payload can carry the reviewed
  language pair without a database migration. If a shape change is needed,
  publish an explicit backend/OpenAPI contract and generated frontend types.
- Validate per-item source prompt and exact option mapping before projection;
  reject unreviewed or conflicting translations and protected-field leakage.

## UI and interaction

- Reuse the current English/Vietnamese control, but offer it only for forms with
  complete reviewed text. Preserve the answer-save/reveal/resume state machine.
- Review choice labels, textual-answer guidance, keyboard focus, mobile width
  and light/dark contrast in both navigation modes.

## Work decomposition

1. Finish all editorial batches and owner review ledger. Owns only this spec's
   content drafts; no runtime or live package mutation.
2. Obtain approval of this spec on `staging` before implementation.
3. Implement source-bound package/validator/importer contract and tests.
4. Implement player language consumption and UI regression tests.
5. Build new unpublished packages, dry-run, verify staging, then request owner
   publish approval.

## Rollout and rollback

- Release each new package independently after exact-SHA staging checks.
- Archive only the new revision if rollback is needed; retain v1.0 rows and
  all historical learner attempts.

## Verification strategy

- Compare new/old inventory, keys, option IDs, source audio/timing hashes and
  transcript boundary, then run full package validation and import dry-run.
- Exercise complete/incomplete form translation, immediate/reloaded guided
  feedback, themes and mobile/desktop states on staging.
