# Tasks

- [ ] T001 Record direct owner approval of the concrete intent, set lifecycle only
  through the reviewed spec-only change and land it on staging before runtime
  implementation. `owns: specs/0016-mock-content-remediation, specs/README.md`
  Direct owner approval is recorded in `approval-decision.md`; T001 remains
  unchecked until this spec-only PR has actually landed on staging.
- [ ] T002 Build complete route/writer/purpose and lifecycle inventory, validate
  source/main/staging distinctions and derive typed API/error contracts and
  synthetic fixtures. `depends: T001; owns: new policy models, contract inventory`
- [ ] T003 Implement shared transactional eligibility/public-overlap/restore
  invariant and complete policy audit across all legacy/current writers;
  preserve safe historical review. `depends: T002; owns: policy/mock/class
  services, relevant admin routes, additive migration(s)`
- [ ] T004 Implement atomically purpose-bound start/resume and protect delivery
  vs transcript/dictation/review/correction/media, retaining spec0008 collection
  recovery and legitimate continuation. `depends: T003; owns: Reading/Listening
  domain routers, mock attempt admission, purpose tests`
- [ ] T005 Add reviewed typed matcher/item-version contracts and positive/negative
  gold cases; pin new policies without changing submitted/legacy active work.
  `depends: T002; owns: domain graders, protected content metadata/import validators`
- [ ] T006 Persist canonical atomic owner/question flags and complete immutable
  submission context snapshots, with legacy provenance and private media paths.
  Sequence domain-router/migration edits with T003/T004 owner. `depends: T004,T005;
  owns: attempt persistence/routes, snapshot/flag tests`
- [ ] T007 Update native/compatible clients for typed receipts, durable mutation
  notices, flag reconciliation, blank states, original context and truthful
  support/fallback states. `depends: T002,T006; owns: affected player/review/admin
  UI, generated frontend types, native browser tests`
- [ ] T008 [P] Validate all 368 findings/80 paper identities; prepare reviewed
  source-grounded content revisions/accepted alternatives and distinguish audio
  listening acceptance from clock tests. Do not publish pending revisions.
  `depends: T002; owns: content revision packages, traceability receipts`
- [ ] T009 Execute PostgreSQL contention/rollback/privilege matrix, full affected
  backend/contract/React/types/build suites and native viewport/theme journeys;
  verify saved answer/grade/policy invariants. `depends: T003,T004,T005,T006,T007`
- [ ] T010 Independent agent reviews full final diff against FR001–019 and every
  mapped finding, records exact head SHA and resolves consolidated findings
  within repository convergence limits. `depends: T008,T009; owns: acceptance evidence`
- [ ] T011 Apply staging migration(s) and deploy approved runtime/content scope;
  run exact-SHA integrated/live staging gates and old/new clients without other
  active-chat conflicts. `depends: T010; owns: coordinator release evidence`
- [ ] T012 With required production authorization, apply additive migration(s)
  using advisory-locked runner and promote staging→main. Verify both runtime
  SHAs, owner journeys, unchanged historical samples and actual revision markers.
  `depends: T011; owns: coordinator production verification`
- [ ] T013 Reconcile every requirement/finding/paper gate, keep unresolved source/
  audio/restore evidence explicit, and send a truthful final report to the report
  author chat identified by the user as `dot`. `depends: T012; owns: final handoff`
