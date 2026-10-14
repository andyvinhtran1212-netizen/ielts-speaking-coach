# Verification

## Requirement coverage

The table records source/local and prepared-content coverage. The bounded live staging acceptance below verifies the deployed Reading behavior; production promotion/live acceptance remain in progress under the user approval recorded below.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_reading_practice_support.py; 75 newly authored matching statements across 20 passages; distinct stems, preserved keys/IDs, source quotes embedded in `backend/content/reading-practice/20261014-repairs.json` | PASS |
| FR-002 | kind=journey; ref=frontend/tooling/verify-reading-detail-flow.mjs; `frontend/tooling/verify-reading-detail-flow.mjs`; Native Commons/Colour/Battery/Art controls; complete-set grading, duplicates/missing/extra rejection; table/flow sanitisation; retain text input for matching-information without an option bank | PASS |
| FR-003 | kind=journey; ref=frontend/tooling/verify-reading-detail-flow.mjs; `frontend/tooling/verify-reading-detail-flow.mjs`; 58 manually translated units across four core articles; original remains visible; previous/next/close; other articles explicitly offer full translation | PASS |
| FR-004 | kind=test; ref=frontend/tests/react/reading-practice-support.test.tsx; `frontend/tooling/verify-reading-detail-flow.mjs`; 133 authored phrase pairs; exact source spans through emphasis/glossary, bidirectional controls, selection guard and glossary priority | PASS |
| FR-005 | kind=test; ref=backend/tests/test_reading_practice_support.py; `backend/tests/test_reading_practice_support.py`; Bounded OpenAPI models and consumer validation; source/translation drift rejected; optional source revision rejects stale checks with 409; legacy requests remain accepted | PASS |
| FR-006 | kind=test; ref=backend/tests/test_reading_practice_support.py; `backend/content/reading-practice/20261014-repairs.json`; Glossary authored for all 23 upgraded articles; actual forms verified in source; Commons depleted/conflated/norms/sanctions aliases | PASS |
| FR-007 | kind=test; ref=frontend/tests/react/reading-draft-preservation.test.tsx; `frontend/tooling/verify-reading-detail-flow.mjs`; GET withholds keys, explanation and evidence; check returns only submitted question evidence; exact quote/return controls; source/account/resource/answer guards and preserved drafts | PASS |
| FR-008 | kind=journey; ref=frontend/tooling/verify-reading-detail-flow.mjs; `frontend/tooling/verify-reading-detail-flow.mjs`; 11 authored SVGs, appropriate captions/alt and zoom; one scene before check, focused evidence figures after check; image failure keeps text usable | PASS |
| FR-009 | kind=journey; ref=frontend/tooling/verify-reading-skill-flow.mjs; `frontend/tooling/verify-reading-skill-flow.mjs`; Search reaches the canonical list query; Skill/Vocab URL context, batch replay and return; scope-labelled counts; body-derived word count; `/reading` redirect with ledger ownership | PASS |
| FR-010 | kind=test; ref=frontend/tests/react/reading-review-numbered-context.test.tsx; `frontend/tests/react/reading-review-numbered-context.test.tsx`; Canonical lesson ordering/groups and secondary IDs; actual duration range; exact Mini quote navigation only for canonical `test_type=mini` in submitted/authorised preview review | PASS |
| FR-011 | kind=journey; ref=frontend/tooling/verify-reading-detail-flow.mjs; `frontend/tooling/verify-reading-detail-flow.mjs`; Retry/access/empty/stale states; browser journey at 320/390/1280px in both themes; glossary and image focus/Escape; keyboard sentence/phrase actions; selection preserves copy; new navigation uses instant scroll | PASS |
| FR-012 | kind=query; ref=https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1665; PR #1665 exact merged SHA and approved-read query; Separate Reading worktree; spec PR #1665 merged after Vocabulary promotion #1663; approved external reads, spec and feature PR writes, staging content/QA writes; translations/SVGs authored directly | PASS |

Original R01–R10 map to these rows as defined in `spec.md`. None is claimed
closed on production yet. The initial audit's narrower sample was expanded to
all 75 generic feature/ending prompts in the published practice snapshot.

The replacement review used passage evidence and option banks. Answer keys were
visible for preservation, so this is not a blind independent audit of old keys.
Three Battery explanation references were also corrected without changing keys.
There is no claim that all 1151 historic questions have been semantically audited.

## Checks

- Backend full suite and focused practice route/metadata/grading contracts.
- Frontend full Node contract suite: 13039 passed; strict TypeScript/legacy boundary.
- Final full React run with two workers: 572 passed. An earlier concurrent run hit a 5s timeout in the unchanged Listening display case; it passed in isolation and in the bounded full run. Focused sentence/draft/Mini review cases, including a forged
  `from=mini` on a Full Test payload.
- Native Next browser journeys: Reading detail 39/39, Skill 18/18, Vocab 14/14,
  Mini library 12/12 and existing Full Test library 15/15.
- Production build uses cached font assets and a localhost fixture backend for
  local verification; no external font/provider request is required.
- OpenAPI types regenerated from the local app with the database client mocked.
- Spec validation and `git diff --check`.

Backend final full suite: 10197 passed, 808 skipped. Skipped integrations are not live acceptance evidence.

## Content transaction evidence

PostgreSQL 16 on an isolated local socket:

- The production update applies 23 passage-support changes and 78 question changes
  (75 missing stems + 3 explanation corrections). All 1151 snapshot question
  identities, keys, tags and order numbers remain unchanged.
- A concurrent question edit aborts and rolls back all passage/support updates.
- Staging-only copies insert 23 articles/133 questions atomically. A repeated or
  colliding seed aborts without overwriting existing content.
- Only synthetic learner-history sentinels were used; no real history was read.

The permitted staging read found none of these 23 slugs published there. Hence
`20261014-staging-copies.sql` is separate from `20261014-apply.sql`. The approved staging-only package has now inserted 23 articles/133 questions; every seeded field matches the package on readback. A separately approved synthetic Mini fixture added one test/one passage/two questions for live acceptance. No schema migration occurred. The separately approved production update is recorded below.

## Release evidence

The separate approved spec landed in PR #1665 at
`176373d898a2b872b0ecba32bd9169f7c4a73a89`. User approval then authorized feature
commit `af7ceae8334284a02126cf69248389a8b3221fbf`, staging merge/deployment,
23 article copies/133 questions and live synthetic QA. PR #1666 passed exact-head
checks and automatic review with no inline findings, then merged to staging at
`a5681908d9c5b5e467c5946a80b1038f42e4a5c0` on 2026-10-14.

Both live frontend and backend markers match that staging SHA. The Reading QA
namespace is `reading-20261014`, separate from shared smoke and real students.
41 distinct live checks passed: all 23 protected detail responses; complete-set
multi-answer grading and stale-source 409; sentence/phrase highlighting both
ways; preserved selections, scoped quote/diagram/return and zoom; 320/390/1280px
in both themes; full translation retaining source; real Colour/Battery/Art
controls; search/return; inflected Commons and authored Skill glossary; canonical
Mini label/duration, active-review 409, post-submit exact quote/return; unchanged
Full Test player/review support even with forged `from=mini`; no uncaught JS errors.

The initial Mini label assertion expected a literal space while the DOM contained
line breaks. The normalized text assertion passed without changing product code.
The extra Mini seed initially used an invalid question-type name; its transaction
rolled back in full, then the corrected `sentence_completion` seed committed.

Live result and screenshots are retained outside the repository under
`/Volumes/Kingston SSD/Code/reading-audit-20261014/implementation/` (the
`staging-live-results.json` and `staging-screenshots/` files). No credentials are
recorded here. All code/data translations and SVGs were authored directly.

All seven exact-SHA staging workflows completed successfully: Tests `38559285125`, native browser `38559285098`,
release smoke `38559285048`, build `38559284923`, type/OpenAPI `38559284992`,
spec `38559284874`, legacy guard `38559285008`. The user separately approved production on 2026-10-14: exact functional release
`a5681908d9c5b5e467c5946a80b1038f42e4a5c0`, guarded content SQL, promotion
staging→main, and two task-owned synthetic QA accounts with cleanup. The
`20261014-apply.sql` bytes match that approved release. Its transaction committed
23 article updates/78 question changes on production, then readback matched every
expected field across 23 articles/133 question rows; IDs, keys, tags and order
were preserved. The bounded before-state and readback proof are retained under
the same private implementation evidence directory. Staging copies and the
synthetic Mini fixture were not imported to production.

Promotion PR #1667 is open. Its exact-SHA staging promotion gate passed, and the
automatic review identified stale release-ledger text in this spec. This
follow-up changes only `tasks.md`/`verification.md` to reconcile the actual state;
no implementation or content-package bytes change. The production content step
is complete; promotion merge/deployment, live production QA and QA cleanup are
still genuinely outstanding. T009 stays unchecked until those steps finish.

Other 196 practice articles retain their existing full translation fallback;
sentence/phrase alignment is currently authored for four.
