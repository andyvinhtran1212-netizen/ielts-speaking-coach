# Implementation plan

## Architecture impact

Use existing L1/L2 detail and library owners, current Reading student/import
contracts and Markdown renderer. Keep practice support modules separate from the
timed exam and shared full-test review. No new provider, table, worker or platform.

## Data and contracts

Author reviewed content units/phrase maps in passage metadata; expose only bounded
validated optional fields. Bind mappings to source/translation revisions. Keep
evidence after-check only. Correct question prompts/options in place with canonical
ID/revision checks; never use delete/reinsert import for explanatory-only changes.
Current published data snapshots are read-only inputs outside the repository.

## UI and interaction

Original text with inline selected translation, semantic phrase highlights and
word lookup; full translation fallback and visible source precision. Reuse design
tokens and existing focus/draft boundaries. Maintain URL filters/search/batches.

## Work decomposition

Single agent; isolated `aver-reading-practice-20261014` worktree. Vocabulary keeps
its own checkout and PR. Land this spec separately before feature/grading code.
First complete safe navigation/rendering repairs, then support contracts/content,
then complete interactions and checks. Reconcile all original findings together.

## Rollout and rollback

Prepare local repair package and review concrete diffs before asking for API writes.
After permission, stage code/content through the existing release flow, verify the
exact staging SHA and data, then request/perform any separately approved production
promotion. Roll back scoped content fields from read-before values under fresh
revision checks; preserve IDs/history and other editors' changes.

## Verification strategy

Backend tests use isolated fixtures and no providers/real database. Frontend tests
exercise real controls with representative authored content. Verify a native local
build using fixtures and network fencing, then permitted live staging. Include
Full Test regression and source/translation drift. No paid evaluation is needed.
