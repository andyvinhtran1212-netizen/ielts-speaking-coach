# Rollout and rollback

## Preconditions

- Independently approved specification lands on staging before implementation.
- Source release has immutable manifest/provenance, all-day coverage, accepted
  question blocks and complete independent explanation/source-limitation review.
- Required backward-compatible programme/timing/runtime guards are covered by
  focused tests; generic package validation and existing attempts stay valid.
- Import has an unpublished dry-run/commit boundary and scoped reconciliation.

## Staging

- Apply required forward migration using the normal ledger/runner. Validate
  schema against existing package rows and source collection fixtures.
- Import one reviewed immutable release as unpublished; verify complete asset
  hashes, 80 lessons, eligible forms, protected payloads and resource-only days.
- Run full applicable local gates before pushing one consolidated implementation
  PR. Merge only after independent code review and PR checks pass.
- Bind integrated CI, Vercel/Railway markers and source-collection journeys to
  the actual merged staging SHA. Cover Days 1, 28/29, 51, 60, 61, 75, 76, 77,
  79/80 and one joined audio file without treating this pilot as full content QA.
- Publish only after full content attestation and the staged player/result,
  reveal/reload, source-readiness and package-coexistence journeys pass.

## Production

- The owner's current continue-to-completion instruction delegates this scoped
  release after independent review and all technical gates. It does not
  authorize modifying unrelated published packages or live learner attempts.
- Apply required forward schema under the advisory-locked production runner,
  import the same manifest as unpublished and verify readback before promotion.
- Promote staging to main through the exact-SHA promotion gate, then verify
  frontend/backend deployment markers and the affected authenticated journey.
- Publish the verified source package and check actual collection/day/media
  access, source special states, result/reload and existing programme coexistence.

## Rollback and repair

- Failed uploads remain unpublished and retriable. Verify existing immutable
  assets by hash; resume missing uploads without overwriting conflicting bytes.
  The row projection atomically commits a complete package or reports failure.
- Import/publish reconciliation must name missing assets/rows; never manually
  set a publish flag to bypass failed attestation. Conflicting bytes require a
  new package revision and leave earlier attempt dependencies intact.
- Archive only this collection package to stop new starts. Preserve submitted
  reviews and existing attempts; account for active source attempts using the
  existing archive/start boundaries and verify their usable resume/review state.
- Code repair uses a scoped staging PR and gated promotion; the additive schema
  remains compatible with the previous deployed consumers.

## Observability

- Record package ID, manifest hash, lesson/form/item/media counts, upload
  reuse/failure totals, importer transform version and publish/rollback actor.
- Monitor collection lookup/signing failures, save/reveal errors and authored
  source-state versus technical-error counts. Investigate any leaked protected
  field, missing referenced asset, changed immutable hash or unexpected
  correctness for a non-confirmed item before further publication.
- Root owns release consolidation; content reviewer owns batch acceptance.
  Reports after each batch state coverage, accepted/rejected changes, tests and
  remaining gates without adding background jobs or duplicate state stores.
