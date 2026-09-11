# Cambridge IELTS 13–21 correction readiness — 2026-09-10

## Decision status

Implementation is isolated on `codex/cambridge-mock-correction-v1` in a dedicated
worktree rebased onto Gate F. Migrations 245, 246 and 257 and the content import
have been applied only to the staging/internal-QA database. No production write,
public-practice flag, explanation release, deploy, or push has been performed.

Migration `245_cambridge_mock_correction_foundation.sql` deliberately follows
Gate F migrations 240–244. Migration 257 adds the durable per-item event state
machine and upgrades already-migrated environments to the explicit unbound QA
inventory state.

## Source and spec audit

- Source: `/Users/trantrongvinh/Downloads/_FINAL_BY_TEST`
- Spec: `/Users/trantrongvinh/Downloads/spec`
- Scope: Cambridge books 13–21, four tests per book, Reading + Listening,
  40 questions per paper.
- Validated: 72 paper-object files and 2,880 unique objects.
- Structural result: IDs, skill/test/question identity, required explanations,
  audit verdict, telemetry vocabulary, provenance files, and taxonomy mappings
  pass the deterministic importer.
- Question types: 18 canonical types.
- Import remains dry-run by default and refuses in-place drift for an existing
  content version.

The source package marks every object as pending rights/editorial review and
allows only internal planning/QA. Those gates are intentionally preserved. The
application cannot expose the new objects until all 2,880 objects pass both
global gates and the selected paper passes its item-level gate.

## Item adjudication

Nine source items required an explicit release decision:

- Eight matcher variants now have a versioned human-adjudication override and
  can be auto-scored: C13 T1 L Q03; C15 T3 L Q05; C15 T4 R Q07;
  C19 T2 L Q05; C19 T3 L Q03; C21 T2 L Q01/Q06; C21 T3 L Q03.
- C15 T4 Reading Q07 is a two-sub-blank item under one question number. The
  repair requires both `leaves` and `bark`, accepts either order, and rejects
  either word alone. Migration 246 also repairs the flattened table and the
  misleading explanation in the canonical Reading row.
- C19 T2 Listening Q11 is answerable from the supplied MP3. The earlier blocker
  mixed Section 2 relative timestamps with full-test timestamps. The cue aligns
  at Section 2 82.28–91.62s / full test 564.19–573.53s and supports answer A.

No paper remains blocked by these two item findings. Existing historical
attempt rows are not deleted or rewritten.

## Product behavior implemented in the isolated worktree

- Cambridge papers remain an admin warehouse by default.
- Admin may distribute a paper through the existing mock structure, to a whole
  class, to a subset/individual learner, or explicitly enable public practice.
- `exam_only` is bypassed only by an exact user → class item → assignment →
  skill/test capability, not by a broad learner flag.
- Practice may show Reading/Listening result after post-test confidence capture.
  Mock results stay sealed until the existing admin result-release boundary.
- Web explanation objects are attached server-side only when admin policy,
  content version, rights, editorial, item-serving, and confidence-capture gates
  all pass. A partial paper approval exposes zero objects.
- Confidence 1–5 is collected for all 40 questions before reveal. Blank/low-
  confidence items may include at most two controlled self-attribution codes.
- The mock runner performs that capture before it marks a Reading/Listening
  section collected, avoiding a post-submit deadlock.
- Native Reading/Listening review pages render the new object only when attached
  by the backend. The learner moves through evidence attempt → source location →
  decisive clue → full explanation/repair direction. The canonical answer is
  hidden in the UI until the full-explanation stage, and legacy explanation
  sections are suppressed whenever the staged object is present.
- Every learner reveal/correction action is persisted idempotently in an
  append-only event ledger. The database RPC validates ownership, submitted
  attempt status, item binding, payload shape and transition order, then returns
  canonical correction state for reload recovery.
- Admin release actions are audited. Changing into admin-release mode or changing
  content version clears stale release timestamps and requires fresh approval.
- Item evidence records first/final answer, revisions, correctness, confidence,
  high-confidence errors, and controlled self-attribution. An admin endpoint can
  aggregate these signals by learner, skill, class assignment, or mock exam.
- The native admin correction dashboard adds content-health gates, accuracy,
  confidence, high-confidence wrong items, revision rate, wrong-item correction
  completion, correction funnel, per-item state and event timeline.

## Internal-QA import status

- Content version: `cambridge-web-explanations/2026-09-10-v1`.
- Imported/current: 2,880 / 2,880 objects.
- Canonical Cambridge parents present in QA: 0 Reading and 0 Listening papers.
- Therefore all 2,880 rows are `UNBOUND_INTERNAL_QA`, have zero test FK links,
  and use serving status `INTERNAL_QA_UNBOUND`.
- Rights remain `BLOCKED_PENDING_RIGHTS_REVIEW`; editorial remains
  `GENERATED_REQUIRES_EDITORIAL_REVIEW`.
- Approval rejects any version containing an unbound object. Direct anon/auth
  table privileges are revoked and deny-all RLS remains enabled.

## Verification completed

- Importer dry-run and QA import: 72 files, 2,880 objects, 18 question types and
  9 adjudications.
- Backend selected regression: passed, including release gates, event
  persistence, result reconciliation and core-attempt evidence.
- Frontend full Node regression: passed (9,230 tests).
- TypeScript typecheck: passed.
- Next.js production build: passed; 137 pages generated, including
  `/admin/mock-exams/corrections`.
- Migration SQL executed successfully on internal QA; repeat execution of 257
  confirmed its upgrade path is idempotent.
- `git diff --check`: passed.

## Required decisions before production

1. Seed the 72 canonical Cambridge Reading/Listening paper rows into an isolated
   QA scope, then rerun the importer to replace `UNBOUND_INTERNAL_QA` with real
   test FK bindings. Do not synthesize placeholder parent papers.
2. Deploy the backend/frontend branch to an internal environment before UI/event
   end-to-end testing; the current operation intentionally migrated/imported data
   only and did not deploy application code.
3. Provide explicit rights approval and editorial approval before any learner-
   visible web explanation release. The current source metadata is not evidence
   of either approval.
4. When the canonical C15 T4 Reading parent is seeded, rerun migration 246 (or its
   scoped repair) so Q07 requires both words. Q11 needs no audio replacement; its
   release override records the corrected timebase adjudication.
