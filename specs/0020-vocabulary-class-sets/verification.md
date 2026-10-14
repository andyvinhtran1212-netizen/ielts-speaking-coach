# Verification

## Requirement coverage

The initial release is verified on staging at `92019185b79675e2e4d44f1535685b1fedfeec3d`; environment-specific evidence is recorded below. Promotion review found two additional retry cases, now repaired locally; their staged acceptance and production promotion are pending.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=check; ref=node tooling/verify-vocabulary-class-sets-flow.mjs http://127.0.0.1:3017; observed=`verify-vocabulary-class-sets-flow.mjs`: persistent links, Exercises redirect and set/player return; `vocabulary-legacy-return.test.mjs`: topic/exam return identity | PASS |
| FR-002 | kind=check; ref=node tooling/verify-vocabulary-class-sets-flow.mjs http://127.0.0.1:3017; observed=Admin-only HTTP route test; native editor selects/orders/adds canonical cards; browser save/publication/reload; PostgreSQL CAS replay | PASS |
| FR-003 | kind=check; ref=python -m pytest tests/test_vocabulary_sets.py tests/test_vocabulary_sets_postgres.py -q; observed=PostgreSQL eligible/inactive/legacy-pointer/removed-member matrix; service audience uses canonical active memberships; React course filter includes class-only and common-library sets | PASS |
| FR-004 | kind=check; ref=python -m pytest tests/test_vocabulary_sets.py tests/test_vocabulary_sets_postgres.py -q; observed=Actual PostgreSQL two-account isolation, receipt replay and simultaneous-session CAS; shared state never reads legacy wallet marks | PASS |
| FR-005 | kind=check; ref=python -m pytest tests/test_vocabulary_sets.py tests/test_vocabulary_sets_postgres.py -q; observed=Mode selection stays within selected canonical IDs; exact cloze context; backend D1 grading reuse; HTTP payload withholds unanswered Test keys | PASS |
| FR-006 | kind=check; ref=python -m pytest tests/test_vocabulary_sets.py tests/test_vocabulary_sets_postgres.py -q; observed=Real SQL frozen revision survives republish/archive; replay conflicts and atomic rollback; HTTP receipt reconciliation after scope revocation; React lost ACK, cross-tab conflict refetch and Test draft restore; Next reload same session and accepted result | PASS |
| FR-007 | kind=check; ref=node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/*.test.mjs frontend/tests/*.test.js; observed=Legacy personal/quiz/D1 APIs and tables unchanged; full affected regression suites; owning links remain; unaffiliated old public localStorage keys are retained without attributing them to an account | PASS |
| FR-008 | kind=check; ref=node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/*.test.mjs frontend/tests/*.test.js; observed=Saved words and Quick Check outcomes use separate canonical fields; shared self-rating and recall counters tested separately; unfinished recall is labelled not yet summarized | PASS |
| FR-009 | kind=check; ref=node tooling/verify-vocabulary-class-sets-flow.mjs http://127.0.0.1:3017; observed=Auth-keyed unmount/abort, visible loading/empty/error/retry/denied states; actual Next 320/400/1280px, both themes, reduced motion, Enter-operated flashcard controls, no horizontal overflow/runtime errors | PASS |
| FR-010 | kind=check; ref=node tooling/verify-vocabulary-class-sets-flow.mjs http://127.0.0.1:3017; observed=Admin reads current publication audience separately from draft fields; no-work outcomes state; canonical version ACK drives publish; immediate/reload browser reconciliation | PASS |

## Contract and data evidence

- New FastAPI endpoints have concrete Pydantic contracts; generated `types/api.d.ts` comes from the current in-process OpenAPI.
- Both TypeScript boundaries pass. Existing personal/quiz/D1 API shapes are unchanged.
- `test_vocabulary_sets.py` and `test_vocabulary_sets_postgres.py`: 26 checks pass, including exact owned receipt replay after scope revocation, no receipt/new write denial, conflicting payload/foreign owner denial and explicit receipt lookup failure, HTTP ownership/private headers, deny-direct-client RLS/grants, snapshot preservation, admin lost-ACK replay, learner replay and simultaneous writes. PostgreSQL tests ran against a task-owned loopback database; they were not skipped in this run.
- Migration 317 applies twice on disposable schemas. It adds five tables and service-only routines, with no content seed, personal ownership transfer or historical rewrite.
- Full backend suite: 10172 passed, 800 skipped. The skips concern unrelated credential-dependent suites and are not claimed as passing hosted integration.
- Full frontend contract suite and React suite are checked locally; production Next build and typed boundaries pass. No paid providers were enabled.

## UI evidence

The built Next fixture journey runs hub -> set -> all four study modes -> reload -> accepted result; admin save/publish -> reload; legacy Exercises -> Review. Unknown requests are denied by the fixture, so it cannot silently read or write a hosted account. The same journey is registered in Next-native browser CI.

Desktop and 400px rendered screens were visually inspected. The learning CTA precedes cumulative metrics; navigation remains visible. Browser checks additionally cover 320px and dark theme containment.

## Release evidence

- Approved spec-only PR: #1661, merged staging commit `b21c2201ca0aa6bad11e8cfd52d1622fe0081179`; PR checks passed.
- Implementation checkout: `/Volumes/Kingston SSD/Code/aver-vocabulary-class-sets-20261014`.
- Implementation branch: `codex/vocabulary-class-learning-20261014`.
- Implementation PR: #1662. The product owner explicitly authorized code push, PR merge and staging migration/acceptance on 2026-10-14.
- Migration 317 is applied on Supabase staging: SHA256 `5b73bc3e3e703990aca10df74534175813edb4ecb179144fd04c86708331878e`; ledger verified, five tables have RLS and deny direct client reads, four routines deny authenticated execution and allow only service-role execution.
- PR CI caught a macOS-specific screenshot directory; the portable `os.tmpdir()` repair passes the same localhost journey. Initial PR review also found delayed-auth public playback and stale start-intent reuse. The consolidated repair waits for auth for public stacks, preserves confirmed guest access, keeps invalid links visible, and replaces start intents when mode/review selection changes. Twelve focused React checks and the full 557-check React suite pass. The existing Admin Vocabulary browser verifier now checks the new set console first while retaining all prior consoles; its full 98-check journey passes. Schema is unchanged.
- Initial merged staging `92019185b79675e2e4d44f1535685b1fedfeec3d`: frontend/backend runtime markers match, all seven integrated workflows pass, Staging release smoke attempt 2 reports 37 passed and 1 skipped. Actual synthetic admin add/preview/order/publish/reload, all four learner modes, partial and completed session reload, Test draft restore, account/scope isolation, revision freezing, replay/conflict, membership revocation and archive/history passed; actual 320/400/1280px light/dark/keyboard checks passed. The demo is limited to its synthetic course. Initial smoke Writing/Grammar delays during concurrent Vocabulary authoring were rechecked with the original tests and then a successful full smoke run; no gate was reduced.
- Production authorization on 2026-10-14: the owner explicitly requested migration 317 and promotion from staging to main. Promotion PR #1663 is open, not merged. Production dry-run confirms only 317 would apply; the approved SQL bytes are unchanged. No production migration/content/learner writes have been applied yet.
- Promotion review identified two Medium issues: Retry resubmitted a stale index after another tab answered, and scope denial prevented replaying an accepted receipt after archive/membership changes. The consolidated follow-up uses a canonical session GET on conflict and exact owner/session/payload receipt reconciliation in the API read path. New writes remain denied; no schema, RLS, RPC or migration changes are required. The entire affected persistence/player diff was reread before the consolidated revision.
- Follow-up branch: `codex/vocabulary-retry-reconciliation-20261014`. Local checks: 18 backend API/service checks and 8 actual loopback PostgreSQL transaction/RLS checks pass; 13037 frontend contracts, 562 React interactions, both TypeScript boundaries and production build pass. The native built-Next four-mode/admin/resume/theme/320/400/1280px journey passes with the standard CI fixture configuration. Final full backend pre-push results and staged acceptance are recorded in the follow-up PR.
