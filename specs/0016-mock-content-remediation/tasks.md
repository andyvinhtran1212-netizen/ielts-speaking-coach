# Tasks

- [x] T001 Record direct owner approval of the concrete intent, set lifecycle only
  through the reviewed spec-only change and land it on staging before runtime
  implementation. `owns: specs/0016-mock-content-remediation, specs/README.md`
  Direct owner approval is recorded in `approval-decision.md`; the spec-only
  PR #1565 landed on staging at `ae71cdc51435f7c5e54758651bdd79d58bb19a0c`.
- [x] T002 Build complete route/writer/purpose and lifecycle inventory, validate
  source/main/staging distinctions and derive typed API/error contracts and
  synthetic fixtures. `depends: T001; owns: new policy models, contract inventory`
  Done in [#1574](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1574) (merge `cf2be7354da609dc2445ef62a6cc3fb20873f03d`):
  `services/mock_paper_policy.py`, `models/mock_review_context.py`,
  `models/mock_attempt_flags.py` and generated `frontend/types/api.d.ts`.
- [x] T003 Implement shared transactional eligibility/public-overlap/restore
  invariant and complete policy audit across all legacy/current writers;
  preserve safe historical review. `depends: T002; owns: policy/mock/class
  services, relevant admin routes, additive migration(s)`
  Done: migration 306 ([#1574](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1574)), 310/311 ([#1597](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1597), merge
  `845c66db86e278ed45459e30fb096aa6b441a1de`), 315 ([#1633](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1633), merge
  `602bdda0129c8e0267f39a923f0920e5890b36dd`) and 316 ([#1637](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1637), merge
  `c9acb2e8bf00c10146b16276b865213c75211e59`). All are applied on staging and
  production; see the release record in `verification.md`.
- [x] T004 Implement atomically purpose-bound start/resume and protect delivery
  vs transcript/dictation/review/correction/media, retaining spec0008 collection
  recovery and legitimate continuation. `depends: T003; owns: Reading/Listening
  domain routers, mock attempt admission, purpose tests`
  Done in [#1574](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1574): `routers/listening.py`, `routers/reading_student.py` and
  `services/mock_player_context.py`. Opt-in activation migration 308 is
  applied on staging (2026-10-03) and production (2026-10-06).
- [x] T005 Add reviewed typed matcher/item-version contracts and positive/negative
  gold cases; pin new policies without changing submitted/legacy active work.
  `depends: T002; owns: domain graders, protected content metadata/import validators`
  Done in [#1574](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1574) (FR-009/FR-010): `services/mock_response_policy.py`, the
  Reading and Listening graders and the content importers.
- [x] T006 Persist canonical atomic owner/question flags and complete immutable
  submission context snapshots, with legacy provenance and private media paths.
  Sequence domain-router/migration edits with T003/T004 owner. `depends: T004,T005;
  owns: attempt persistence/routes, snapshot/flag tests`
  Done in [#1574](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1574) (FR-012/FR-014/FR-015): migration 307,
  `services/mock_attempt_flags.py` and `services/mock_review_context.py`.
- [ ] T007 Update native/compatible clients for typed receipts, durable mutation
  notices, flag reconciliation, blank states, original context and truthful
  support/fallback states. `depends: T002,T006; owns: affected player/review/admin
  UI, generated frontend types, native browser tests`
  Partial. Typed receipts, notices, flags and frozen context shipped in [#1574](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1574).
  Progress (PC-J46, 2026-10-29): the FR-013 blank-state renderer part is done
  for the native Reading and Listening review pages: cards, palette, a "Bỏ
  trống" filter beside the default "Cần xem lại" (incorrect + blank) and a
  sai/bỏ trống/đúng total, all derived from the persisted grade and answer
  ([#1886](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1886), squash `2eb54b5c5`).
  Legacy unknown provenance stays open (the backend returns `user_answer: ""`
  for both blank and unknown history), as do the other T007 items.
- [ ] T008 [P] Validate all 368 findings/80 paper identities; prepare reviewed
  source-grounded content revisions/accepted alternatives and distinguish audio
  listening acceptance from clock tests. Do not publish pending revisions.
  `depends: T002; owns: content revision packages, traceability receipts`
  Not started. `traceability.json` is still `draft_not_acceptance` with
  `verified_fixed_findings: 0`. FR-016/FR-017 are not part of [#1574](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1574); this is
  content work with no code job.
- [ ] T009 Execute PostgreSQL contention/rollback/privilege matrix, full affected
  backend/contract/React/types/build suites and native viewport/theme journeys;
  verify saved answer/grade/policy invariants. `depends: T003,T004,T005,T006,T007`
  Partial. PostgreSQL and contract tests landed with [#1574](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1574), [#1597](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1597) and
  [#1637](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1637). Every FR row in `verification.md` is still PENDING, and T007
  is open (FR-013 legacy unknown provenance remains after PC-J46).
- [ ] T010 Independent agent reviews full final diff against FR001–019 and every
  mapped finding, records exact head SHA and resolves consolidated findings
  within repository convergence limits. `depends: T008,T009; owns: acceptance evidence`
  Blocked on T008 and T009.
- [ ] T011 Apply staging migration(s) and deploy approved runtime/content scope;
  run exact-SHA integrated/live staging gates and old/new clients without other
  active-chat conflicts. `depends: T010; owns: coordinator release evidence`
  Partial. Runtime migrations 306/307/308/310/311/315/316 are applied on staging
  and the code is deployed there ([#1633](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1633) records final staging release
  `dc9dfad605b92f5b9f1c87dc989c56a40a1d8d5c`). No content revision is deployed.
- [ ] T012 With required production authorization, apply additive migration(s)
  using advisory-locked runner and promote staging→main. Verify both runtime
  SHAs, owner journeys, unchanged historical samples and actual revision markers.
  `depends: T011; owns: coordinator production verification`
  Partial. Runtime reached main through promotions
  [#1586](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1586) (`96e6b698e3810ba3ce510569fe0c9462396449c1`),
  [#1599](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1599) (`1237dc8c7c623e5e4e0e2592a4ab0982f8c99ca0`) and
  [#1636](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1636) (`db7ad80730907722d0fb16bd76919008d2ab1e9f`), and the same
  migrations are applied on production. No content revision is promoted.
- [ ] T013 Reconcile every requirement/finding/paper gate, keep unresolved source/
  audio/restore evidence explicit, and send a truthful final report to the report
  author chat identified by the user as `dot`. `depends: T012; owns: final handoff`
  Blocked on T012.
