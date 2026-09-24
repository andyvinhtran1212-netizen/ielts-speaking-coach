# LISTENING-0007 safety amendment — owner review

Status: **draft**. PR #1501 approved FR-001–FR-007 and packet 01 on staging.
This amendment proposes FR-008/FR-009 and related release/UI gates. It does
not change runtime, database schema, package status or published content.
Nothing here grants permission to publish v1.1.

## Root-cause evidence

- Migration 295 defines
  `uq_listening_content_packages_published_programme`, allowing only one
  `published` package per programme. An old/new status transition cannot keep
  both revisions published.
- `fn_acquire_listening_programme_attempt` rejects a test that is not
  `published` before it looks for a resumable attempt. The current guided
  question-by-question context also requires published test, package and
  exercise rows. Archiving v1.0 would therefore break active v1.0 resume and
  guided review; a submitted-history read path is not proof of active access.
- The two General museum-map learner SVGs contain English visible text and
  English accessible `title`/`desc`. Translating the nine question prompts
  alone would misrepresent those two forms as fully bilingual.

## Proposed safeguards

- FR-008 makes the active-attempt policy explicit before publish, with saved
  answers/resume and an interruption window verified. The owner still needs to
  choose between (A) a controlled drain with a real new-start gate and wait
  through the last 24-hour resume window, or (B) a narrowly scoped old-attempt
  continuation path on archived rows. Choice B requires additional route/DB
  design and regression tests; neither option is implemented by this PR.
- FR-009 allows a map form's language switch only when the map labels and
  accessible alternative are reviewed in the same language, preserving
  geometry, answer-letter anchors and protected-answer boundaries. Two
  Vietnamese SVG variants exist only in the local draft queue; they are not
  approved or in this PR.
- The rollout plan explicitly records the archive/publish availability gap,
  rollback to the attested v1.0 package and separate checks for active versus
  submitted attempts. It does not claim two independent status calls are
  atomic.

## Decision required before approval

Choose A or B for in-progress v1.0 attempts. Then review FR-008/FR-009 and
the matching plan, UI states, rollout and tasks. Merge this amendment to
`staging` as a spec-only PR before any runtime or importer implementation that
depends on these requirements. The 44 approved question translations remain
approved; the other 1,001 candidates require separate editorial review.
