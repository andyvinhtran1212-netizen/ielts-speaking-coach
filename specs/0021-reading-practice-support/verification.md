# Verification

## Requirement coverage

All results in this table are source/local or prepared-content results.

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
| FR-012 | kind=query; ref=https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1665; PR #1665 exact merged SHA and approved-read query; Separate Reading worktree; spec PR #1665 merged after Vocabulary promotion #1663; only permitted external reads and spec GitHub writes; translations/SVGs authored directly | PASS |

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
`20261014-staging-copies.sql` is separate from `20261014-apply.sql`. No Supabase
write, schema migration or feature release has occurred.

## Release evidence

Approved intent is on staging at `176373d898a2b872b0ecba32bd9169f7c4a73a89`
(PR #1665). Implementation and content remain local. Staging/deployment/live
acceptance and user acceptance are pending the respective external-write approval.
