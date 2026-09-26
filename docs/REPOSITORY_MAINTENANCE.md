# Repository maintenance and scale

## Baseline: 2026-09-26

Measured at production `27b80a4625fe2d99def6730a7c19dc6d4e35000d`, before
the hygiene patch. Counts are a dated baseline, not enforced limits.

| Measure | Baseline |
| --- | ---: |
| Tracked entries | 7,210 (7,195 regular files, 15 symlinks) |
| Tracked regular-file bytes | 461.1 MiB |
| Application source lines | Approximately 252,934 physical lines, excluding tests, tooling, scripts, content, vendor and declarations |
| Backend router / service Python files | 60 / 147 |
| HTTP/WebSocket route decorators | 588 (not a count of unique public endpoints) |
| Next pages / route handlers | 144 / 2 |
| SQL migrations | 303 |
| Backend test Python files / frontend test code files | 510 / 587 (including fixtures/helpers) |
| Canonical feature specs | 11 |
| Files under docs / Markdown under docs | 417 / 363 |
| Public asset bytes | 374.1 MiB, about 81% of tracked bytes |

Local virtualenvs, `node_modules`, `.next`, Git objects and recovery backups add
several GiB. They are distinct from tracked product size. An ignored directory
is not automatically disposable: backups and local environment configuration
need an explicit retention decision.

## Routine maintenance

1. Inventory worktrees, dirty files, stashes, local/remote heads, open PRs and
   available task ownership before changing them. A sleeping task or old branch
   name is insufficient evidence that its work is abandoned.
2. Preserve local-only commits and stashes in an independent backup, including
   a ref-to-SHA manifest. Verify backup objects before deleting any refs.
3. Remove a topic branch only with integration evidence: ancestry, its exact
   merged PR head, or an ancestor of that merged head. Preserve tips changed
   after their PR and closed-but-unmerged work for explicit comparison.
4. Re-read remote heads immediately before cleanup. Use expected-SHA leases
   for remote deletion and compare-and-delete for local refs. Exclude protected
   branches and every worktree-owned branch. Record actual deleted/retained refs.
5. Keep a retained-work ledger with source SHA, related PR/spec, unresolved
   difference, next action and recovery instructions. Domain ownership must be
   confirmed when work resumes; do not invent a named assignee.
6. Reconcile [spec acceptance](../specs/IMPLEMENTATION_STATUS.md), run applicable
   checks, and follow the [release flow](STAGING_FIRST_RELEASE_FLOW.md).

Dependency directories are checkout-local and ignored. Install the isolated
CSS toolchain using the root README; absolute `node_modules` symlinks must not
be tracked. Remove generated caches only when no active process needs them.
Keep recovery backups until retained work has been adjudicated.

## Media follow-up: preserve URL compatibility

Advanced Vocabulary media accounts for roughly 373.6 MiB across 3,100 files.
The audit found 1,481 identical-content groups across public assets, with about
189.3 MiB of additional copies. This is a storage opportunity, not proof that
any URL is unused. `backend/services/advanced_vocab_service.py` supports both
legacy and immutable version paths; assignments and manifests can depend on
either form.

The next authorized media task should be owned jointly by the Vocabulary
runtime/content maintainer and deployment maintainer:

1. Export path, SHA-256 and size for every tracked media file; group identical
   bytes without changing files.
2. Audit persisted assignment snapshots, bank payloads, source manifests and
   active version URLs in each environment. Record all references and consumers.
3. Propose storage delivery or build-time deduplication that keeps existing URLs
   and immutable checksums working. Measure clone/deploy savings and rollback.
4. Verify old and new assignments, audio fetches, range/cache behavior, manifest
   validation and rollback before any deletion or URL migration.

Do not rewrite Git history, migrate to LFS, delete version directories or alter
public media URLs as routine cleanup. Those operations need their own scoped
decision and compatibility evidence.

## Module follow-up: extract at the next domain change

Large modules at the baseline include `backend/routers/listening.py` (8,078
lines), `backend/services/quiz_service.py` (6,789), `backend/routers/admin.py`
(5,689), `backend/services/mock_exam_service.py` (4,618) and compatibility
`frontend/public/js/practice.js` (5,958).

When a feature requires changes in one of these modules, its domain maintainer
should identify a cohesive boundary, preserve route/response contracts, and
extract only that boundary after behavior tests exist. Useful candidates are
Listening import versus learner orchestration, quiz assignment policy, admin
domain routers and Mock attempt lifecycle. Measure the resulting dependency
surface and run the affected backend/frontend contracts. Line count alone does
not justify a repository-wide refactor or deleting compatibility code.

## Documentation maintenance

Use [the documentation map](README.md) for current entry points. Index or label
historical material before moving it; preserve working links. Keep application
release state separate from feature acceptance and content activation state.
