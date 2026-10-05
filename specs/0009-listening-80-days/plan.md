# Implementation plan

## Architecture impact

Use a dedicated source-book collection importer and collection/day wrapper;
project eligible forms into existing programme package/lesson/test/exercise
persistence. Keep the generic immutable-package validator unchanged. Namespace
the collection separately from the General/IELTS packages. Reuse save/reveal,
attempt acquisition, report-only result and private asset signing.

Hybrid question presentation uses inspected source block images for faithful
tables/maps/pictures, curated instructions/accessibility text and response
controls. Authentic Part/Section grouping keeps forms within the current item
limit without truncating source mock papers. Resource-only days use zero-form
lessons with curated metadata. Missing audio never starts an empty attempt.

## Data and contracts

Add only required forward allowlist/timing/provenance compatibility changes to
existing package and reveal contracts. Existing lesson metadata holds day
resources and release references. Dedicated import validation binds private
images/audio, question metadata, explanation/audit artifacts and item counts.
No absent alignment is invented. Per-item authored evaluation/source state
protects all unconfirmed keys from objective checking.

## UI and interaction

Add collection navigation inside IELTS Practice, a group/day view and safe
asset readiness presentation. Extend the eligible player/result only for
source numbering, faithful images, explanation structure and authored review
states. Read the owning App Router guides before route implementation.

## Work decomposition

- Root owns specification, release coordination and consolidation.
- Content agent owns source normalization and immutable release construction.
- Web agent owns importer/API/runtime contracts after approval lands.
- Reviewer independently checks every content batch and the consolidated code.
- Declare file ownership before parallel edits; serialize generated types,
  shared routers, migrations and release-index mutations.

## Rollout and rollback

Land this approved spec first. Import the reviewed package as unpublished on
staging, verify all source states and exact release SHA, then publish. Apply
required forward production schema under the existing migration runner before
promotion. Archive only the source package to stop new starts without deleting
attempts or changing existing programme packages.

## Verification strategy

Validate full manifest hashes, all 80 days, 1,676 positions, source/exercise IDs,
crop boundaries, source asset mappings and complete item-review coverage. Test
dry-run purity, idempotency, protected-data stripping, grading exclusions,
reveal authorization, local/source numbering, reload and archive behavior.
Run relevant complete backend/frontend suites and build before one consolidated
push, followed by exact-SHA staging and production journey checks.
