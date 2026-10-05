# Tasks

Tasks are dependency ordered. Spec-base approval and local implementation evidence
are separate from the pending requirement, canonical publication and release gates.
No [P] overlap is assumed until root declares non-overlapping ownership.

- [x] T001 Independently audit68 core+42 optional, four articles and real parser wire
  preservation; measure13 engine mismatches/five actual morphology credit cases.
  `owns: external academic/parser/engine evidence only`
- [x] T002 Review50 text questions across six F01/four R03, record44 exact candidates
  and six legacy; receive root bounded academic decisions and optional five exact
  candidates. `owns: external source-scope proposal; not approved authored bytes`
- [x] T003 Draft high-risk0015 and explicit0014 amendment proposal outside repo.
  `owns: evidence/grammar-exact-form-spec-draft`
- [x] T004 Independently review specification, caps/admission/schema/RPC compatibility
  decisions; approve/land0015 plus0014 amendments on base before feature code.
  `depends: T003; owns: root spec-only branch/index; no self-approval in implementation`
- [x] T005 Author only bounded academic wording/maps, preserve source invariants and
  independently approve final12-code source/qid/map/raw hash manifest.
  `depends: T003; owns: selected bank/article Markdown only; publication blocked by T004/T006+`
- [x] T006 Implement real META map parsing/duplicate/alias/ownership/type/cap validation,
  preview errors and canonical wire tests. `depends: T004,T005; owns: quiz_import`
- [x] T007 Add concrete typed ACK/managed-state/session schemas/generated wire types;
  preserve absence/timer/retake consumers. `depends: T004; owns: quiz facade/models/API generation`
- [x] T008 Additive DB allowlist/admission/context/RPC compatibility/grants safeguards;
  prove actual PG N-1/default/direct no-ACK fences and concurrent cutover/start.
  `depends: T006,T007; owns: migration and existing Grammar transaction owner`
- [x] T009 Implement approved metadata exception/copy/readback/fingerprint and immutable
  map/receipt rules; actual PG rollback/lost-ACK/import/child-write races.
  `depends: T005,T008; owns: bounded revision source/service`
- [x] T010 Implement exact before all fuzzy branches in both real engine copies, keep
  normalizeText and credit/mastery formulas; gold/legacy/probe tests.
  `depends: T006,T007; owns: frontend js/public engine`
- [x] T011 Native map/state/revision validation, capability ACK, lifecycle/outbox guards
  and both history/review write contracts. `depends: T009,T010; owns: native quiz/model/outbox`
- [x] T012 Actual production-Next delivered-fixture journeys, request/ACK/persisted
  attempt assertions, reload/Back/Forward/failed-start/no-write history, UI matrix.
  `depends: T011; owns: browser runner/tests; synthetic/intercepted traffic only locally`
- [x] T013 Run affected full Node/React/backend/PG/type/build/spec checks and independent
  complete-contract review; consolidate findings before root push/CI.
  `depends: T012; owns: each declared domain; root review/commit`
- [ ] T014 Stage additive migration before code; record exact backend/frontend SHAs,
  integrated CI/live staging and twelve-bank footprint/preflight/backup evidence.
  `depends: T013; owns: root release`
- [ ] T015 Perform explicitly authorized per-code source/hash cutover after review;
  reconcile receipts, new map/revision and unchanged original/history fingerprints.
  `depends: T014; owns: root authorized admin operation`
- [ ] T016 Promote exact verified staging SHA, production readback/old-new continuation
  and new-start-disable rollback drill; mark verified only after every required gate.
  `depends: T015; owns: root release; no speculative completion`

Current state: T004 landed separately at47fbb311; current integrated implementation
base is0d9b886c. Final18 academic/source bytes and the bounded backend/engine/
Native/Admin/History changes have independent source review. Local component and
combined gates are recorded in verification.md:10089backend/38documentedSKIP,
10591Node/0SKIP,286React,both types/build,311Native/64scenarios,134History/9scenarios,
25Admin,24computed Admin snapshots and9shared quiz checks. The local implementation
checkboxes do not close any of the22PENDING feature rows. Spec governance validates17features and its88contract tests pass; final status
prose peer review is pending. Staging read-only inventory retains five historical
ledger-name mismatches (160/263 SQL provenance UNKNOWN),306 unapplied and twelve
missing canonical codes. T014–T016/T021, manual/live/exact-SHA, fresh extras/backup,
cutover and release remain open; no live publication or historical regrade.

- [x] T017 Under T006, prove raw multiple META/valid-first-missing-last/duplicate and
  canonical delivered META precedence before mutation; legacy unmanaged/helper controls.
  `depends: T004,T005; owns: existing quiz parser/shared runtime validator`
- [x] T018 Under T007/T011, concrete grammar.bank_id frozen echo and typed start
  identity; pure preflight versus ACK activation; terminal stored NULL/nonNULL omission.
  `depends: T007,T010; owns: existing models/facade/native client`
- [x] T019 Under T008, implement approved0014 current reset set-once marker and
  unmarked run|continuation group proof; actual PG attacks/races/legacy fence controls.
  `depends: T004,T008; owns: existing reset/admission transaction owner; no new platform`
- [x] T020 Under T012, commit-start/lost-ACK one-POST/unavailable/no-live-writes and
  explicit reopen canonical create+carryover; no same-session/UUID recovery claim.
  `depends: T011; owns: native fixture journey/controller`
- [ ] T021 Under T005/T009/T014, one final12 bundle and actual per-bank prior-cutover/
  canonical why_wrong extras read-only academic review before source allowlist/use.
  `depends: T005,T009; owns: root/content actual read-only preflight; no auto-extra edits`

- [x] Prove explicit current reset succeeds with prior open/lost-start-ACK rows,
      marks every prior admission once without terminal/history rewriting, and does
      not retain an “any open row” fallback.
- [x] Guard marked progress with typed409 error_code=grammar_reset_stale before attempts/stats/completion/
      KP/telemetry and applicable direct writes; keep reset-delete/erasure exceptions.
- [x] Prove marked owned-open history-only end and exact repeated end, with unchanged
      frozen IDs/bank/revision/markers/answers and no mastery/KP/eligibility effect.
- [x] Exercise real lost-start-ACK→reopen→finish→reset and delayed marked-progress/end
      races; verify oldtab stale/reopen/no automatic progress retry or optimistic save.
