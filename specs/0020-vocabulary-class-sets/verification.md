# Verification

## Requirement coverage

All PASS results below are local implementation evidence. Live staging acceptance is pending.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=check; ref=node tooling/verify-vocabulary-class-sets-flow.mjs http://127.0.0.1:3017; observed=`verify-vocabulary-class-sets-flow.mjs`: persistent links, Exercises redirect and set/player return; `vocabulary-legacy-return.test.mjs`: topic/exam return identity | PASS |
| FR-002 | kind=check; ref=node tooling/verify-vocabulary-class-sets-flow.mjs http://127.0.0.1:3017; observed=Admin-only HTTP route test; native editor selects/orders/adds canonical cards; browser save/publication/reload; PostgreSQL CAS replay | PASS |
| FR-003 | kind=check; ref=python -m pytest tests/test_vocabulary_sets.py tests/test_vocabulary_sets_postgres.py -q; observed=PostgreSQL eligible/inactive/legacy-pointer/removed-member matrix; service audience uses canonical active memberships; React course filter includes class-only and common-library sets | PASS |
| FR-004 | kind=check; ref=python -m pytest tests/test_vocabulary_sets.py tests/test_vocabulary_sets_postgres.py -q; observed=Actual PostgreSQL two-account isolation, receipt replay and simultaneous-session CAS; shared state never reads legacy wallet marks | PASS |
| FR-005 | kind=check; ref=python -m pytest tests/test_vocabulary_sets.py tests/test_vocabulary_sets_postgres.py -q; observed=Mode selection stays within selected canonical IDs; exact cloze context; backend D1 grading reuse; HTTP payload withholds unanswered Test keys | PASS |
| FR-006 | kind=check; ref=python -m pytest tests/test_vocabulary_sets.py tests/test_vocabulary_sets_postgres.py -q; observed=Real SQL frozen revision survives republish/archive; replay conflicts and atomic rollback; React lost ACK and Test draft restore; Next reload same session and accepted result | PASS |
| FR-007 | kind=check; ref=node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/*.test.mjs frontend/tests/*.test.js; observed=Legacy personal/quiz/D1 APIs and tables unchanged; full affected regression suites; owning links remain; unaffiliated old public localStorage keys are retained without attributing them to an account | PASS |
| FR-008 | kind=check; ref=node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/*.test.mjs frontend/tests/*.test.js; observed=Saved words and Quick Check outcomes use separate canonical fields; shared self-rating and recall counters tested separately; unfinished recall is labelled not yet summarized | PASS |
| FR-009 | kind=check; ref=node tooling/verify-vocabulary-class-sets-flow.mjs http://127.0.0.1:3017; observed=Auth-keyed unmount/abort, visible loading/empty/error/retry/denied states; actual Next 320/400/1280px, both themes, reduced motion, Enter-operated flashcard controls, no horizontal overflow/runtime errors | PASS |
| FR-010 | kind=check; ref=node tooling/verify-vocabulary-class-sets-flow.mjs http://127.0.0.1:3017; observed=Admin reads current publication audience separately from draft fields; no-work outcomes state; canonical version ACK drives publish; immediate/reload browser reconciliation | PASS |

## Contract and data evidence

- New FastAPI endpoints have concrete Pydantic contracts; generated `types/api.d.ts` comes from the current in-process OpenAPI.
- Both TypeScript boundaries pass. Existing personal/quiz/D1 API shapes are unchanged.
- `test_vocabulary_sets.py` and `test_vocabulary_sets_postgres.py`: 25 checks pass, including HTTP ownership/private headers, deny-direct-client RLS/grants, snapshot preservation, admin lost-ACK replay, learner replay and simultaneous writes. PostgreSQL tests ran against a task-owned loopback database; they were not skipped in this run.
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
- Implementation PR and staging migration/deployment: pending separate authorization for the code and additive staging schema. Local fixtures are not live staging acceptance.
- Production: not changed. Production migrations and promotion require separate explicit authorization.
