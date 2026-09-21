# Implementation plan

## Architecture impact

- Keep FastAPI, Supabase PostgreSQL, private Supabase Storage, the current
  `listening_tests` attempt/player path, and existing full/mini/drill/practice
  libraries as owners of runtime behavior.
- Add one package-release record and one lesson/group record rather than encoding
  package and lesson identity only in `metadata` JSON.
- Treat each package form as the attempt unit represented by a
  `listening_tests` row with `test_type='practice'`; imported programme and
  scoring columns distinguish it from existing diagnostic practice.
- Reuse the current one-section practice player by deterministically assembling
  the form's one to 15 source stimuli into one derived audio timeline. Do not
  expand the Cambridge four-section contract merely to fit content packages.
- Add an operator script and service for local-directory dry-run/commit. A future
  browser upload UI should use resumable upload to a private staging bucket, but
  it is outside this implementation.
- Add local Listening components for page header, back link, state panel,
  programme card, lesson card, and status badges. Do not create another global
  design system or refactor exam-paper skins.

## Data and contracts

### Additive persistence

- Add `listening_content_packages` with package ID, programme ID, manifest hash,
  source date, counts, validation summary, status, transform version, imported
  by/at, published at, and archived at. Package ID plus manifest hash is immutable.
- Add `listening_lessons` with package FK, programme ID, source lesson ID, title,
  instructions, outcomes, sequence, status, and bounded metadata. Enforce one
  active source lesson per package.
- Add nullable package/lesson/source fields to `listening_tests`, plus non-null
  backward-compatible defaults for `programme_id='ielts'` and
  `scoring_policy='diagnostic'`. Imported rows use `scoring_policy='report_only'`.
- Preserve `test_id` as the existing external identity and generate a stable,
  bounded imported value from package/form identity. Add an active unique index
  over package plus source form ID.
- Store source response type, conservative `evaluation_mode`, source stimulus
  identity, derived audio window, form purpose, replay policy, support policy,
  and claim policy in validated exercise/test payload fields.
- Do not add a pending-human-review state in v1. Textual/rubric responses are
  persisted as submitted answers and presented for self-review without a numeric
  score.

### Media mapping

- Read only declared source artifacts from a package that has passed validation.
- For each form, use protected form `stimulus_ids` when present; otherwise use
  stable first occurrence in `item_ids` and fail if coverage is ambiguous.
- Assemble source PCM16 mono 24 kHz WAV files deterministically with a versioned
  gap policy, then encode the web asset with pinned settings. Record every source
  hash, offset, derived hash, duration, codec, and transform version.
- Shift segment start/end times by the recorded offsets. Word-level timings remain
  controlled-access and retain their `estimated` truth; no forced alignment is
  claimed.
- Store new objects at an immutable path such as
  `packages/{package_id}/{manifest_sha256}/forms/{source_form_key}/...`; never
  upsert an existing object path.

### Import transaction and recovery

- Dry run validates and produces a compatibility report only.
- Commit uploads missing immutable objects first, verifies returned hashes/size,
  then writes package, lesson, content, exercise, and test rows as draft/non-public.
- Database writes are transactionally finalized through one RPC or equivalent
  advisory-locked operation. A failed finalization leaves no public rows.
- Retry reuses verified immutable objects and source identities. A reconciliation
  command reports orphan staged objects and incomplete draft rows before cleanup.
- Publish and archive are package-scoped backend operations that refetch canonical
  state; they never hard-delete attempts.

### API shapes

- Extend `GET /api/listening/overview` with typed `programmes`, `resume`, and
  bounded `recent` fields while retaining current `tests`, `practice_groups`,
  `content`, and `exercise_modes` fields for one compatibility window.
- Add `GET /api/listening/programmes/{programme_id}/lessons` with pagination and
  canonical progress per lesson.
- Add `GET /api/listening/lessons/{lesson_id}` returning public forms and progress.
- Extend test/form detail and result schemas with programme, lesson, form purpose,
  scoring policy, checked/unscored counts, replay/support policy, and claim labels.
- Add `programme_id` filtering to `GET /api/listening/tests` without changing the
  existing omitted-`test_type` behavior.
- Generate frontend wire types from OpenAPI and validate unexpected payloads at
  the boundary; do not duplicate hand-written response interfaces.

### Scoring and analytics

- Conservative v1 evaluation mapping:
  - `single_choice`, `multiple_choice`, and `map_label` -> objective report-only;
  - `short_answer`, `written`, and `open_rubric` -> persisted unscored self-review.
- Submit stores completion and per-item state. `band_estimate` remains null for
  imported forms even when all items are objective.
- Analytics joins canonical test scoring policy. Diagnostic accuracy and
  `weakest_mode` use diagnostic rows only; report-only rows contribute activity,
  duration, completion, and review-needed counts.
- Existing rows backfill/default to `programme_id='ielts'` and
  `scoring_policy='diagnostic'`, preserving current results.

## UI and interaction

### `/listening`

- Header: eyebrow `Listening`, title `Luyện nghe`, and one short description
  explaining General versus IELTS without promising level progression.
- First block: one eligible resume card, or one deterministic next action when no
  active attempt exists.
- Primary choice: General Listening and IELTS Listening programme cards with
  canonical published counts and progress.
- Secondary blocks: at most three recent activities, compact progress summary,
  and links to Browse/Analytics. Current mode cards move under the IELTS hub.

### `/listening/general`

- One card per lesson/group, not one card per form.
- Filters: all, new, in progress, completed. Do not expose inferred CEFR stage.
- Lesson detail shows purpose, item count, estimated duration, replay/support
  policy, checked versus self-review mix, and one primary start/continue action.
- Result wording uses `Đã hoàn thành`, `Kết quả luyện tập`, `Đã kiểm tra`, and
  `Tự đối chiếu`; it never uses band, mastery, pass/fail, or weakest-skill claims.

### `/listening/ielts`

- Order choices by commitment: imported IELTS Practice, Quick Practice, Skills,
  Mini Test, Full Test.
- Explain result contract on each card: practice feedback for imported forms,
  existing scoring/band behavior only for eligible exam content.
- Preserve `/listening/practice`, `/listening/skills`,
  `/listening/mini-test`, `/listening/tests`, `/listening/browse`, and
  `/listening/analytics` deep links.

### Design-system synchronization

- Remove the Listening hub's `vocab-*` presentation ownership and add narrowly
  scoped `listening-*` classes/components.
- Restore canonical `.shell` spacing using design tokens; do not override it with
  `28px 32px 96px`.
- Standardize the six library/analytics back links and headers through local
  components; shorten long uppercase eyebrows to at most three words.
- Reuse `av-card`, `av-button`, `av-badge`, semantic surfaces, mono numerics,
  canonical focus shadow, and existing `aver-chrome` where appropriate.
- Keep existing exam-player typography and paper fidelity as intentional
  exceptions.
- Add no new hex/RGBA/legacy `--ds-*` values. Verify both themes, 375/768/1440px,
  keyboard, screen reader names, 44px targets, and reduced motion.

## Work decomposition

1. Repair the stale analytics regression-test fixture path and re-establish a
   fully green targeted Listening baseline.
2. Repair or formally archive the broken working-source references and rerun both
   official validators; this is content-governance work, not application code.
3. Approve this specification on the staging branch before implementation.
4. Add additive schema, RPCs, OpenAPI models, and compatibility tests.
5. Implement package validation, dry run, deterministic media assembly, commit,
   reconcile, publish, and archive operations.
6. Extend learner read/result/analytics contracts and preserve existing consumers.
7. Build the new hub and programme pages plus shared Listening-local UI patterns.
8. Synchronize existing library headers/back links without altering their business
   behavior.
9. Import both packages as non-public on staging, run full static and runtime
   verification, then publish IELTS and General as separate package operations.

## Rollout and rollback

- Apply the additive migration to staging before backend code.
- Deploy one exact candidate SHA; dry-run both packages, then import both as
  non-public.
- Run automated walkthrough of all rows and representative journeys covering every
  response type, one/three/four/ten/fifteen-stimulus forms, both replay policies,
  both support policies, transcript gating, mixed checked/unscored results, resume,
  and rollback.
- Publish IELTS first, observe, then publish General. This order limits the first
  public batch while still ending with both complete packages.
- Roll back by archiving one package's public rows and invalidating/removing its
  derived private assets only when access must be cut off. Retain source package
  records and attempts for audit.

## Verification strategy

- Run the official publish-package validator and broader Content Hub validator;
  record the known working-hub link state separately from publish-package truth.
- Unit-test archive safety, hash/inventory rejection, conservative response mapping,
  media offsets, retry/idempotency, transcript withholding, scoring-policy joins,
  and backward-compatible defaults.
- Contract-test overview/programme/result OpenAPI shapes and old consumer fields.
- Run current Listening overview, list, full-test, mini-test, practice, resume,
  renderer, answer-leak, grading, analytics, dictation, and mock regression suites.
- Use staging database queries to reconcile exact source and persisted counts and
  prove imported attempts have null band estimates.
- Record light/dark screenshots and keyboard journeys at 375, 768, and 1440px for
  hub, both programmes, form player, mixed result, empty, error, and partial-data
  states.
