# Verification — Listening v1.1 release status

## Current readback — 2026-09-26

Listening v1.1 is published in staging and production for both programmes.
This status was checked read-only against the migration ledger, package rows and
start-drain gate rows in each database. The v1.0 packages are archived and
their package-specific start-drain gates are `true`. The published v1.1
manifest SHA-256 values are the same as the real local candidate recorded below:
General `275f9fbbf6becb83bfc83428b1b8ed824f64fb29f246d4fe3280e89a87fa32be`
and IELTS `2a261931ab6fcce2629d8002b782fc07255345f874b8aa656b4ed850c2c245c9`.
Migration 303 is recorded as applied in staging at 2026-09-25 04:19 UTC and
production at 2026-09-25 06:31 UTC.

The release used staging SHA `8323f57256a4fbfa599bba389d7b7608fb16a0ac`
and promotion PR [#1517](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1517),
merged as `3c252fa8486da41fe58eca23e12b81327d804eb9`. All seven push
workflows for each SHA completed successfully. At that readback, the production runtime
marker reported `e72967d90743f0706d4fe731276184dbbb28c8f4`, which contains
that promotion commit. The production package readback showed one active
General v1.1 attempt; no active v1.0 attempt appeared in either database at
the time of this check. These counts are a point-in-time observation.

The historical checklist below has not been reconciled item by item with the
release. In particular, the repository does not yet contain direct evidence
for the deliberately failed-publish rollback rehearsal in T008 or a complete
authenticated mobile and screen-reader sign-off in FR-009. Publication and
those outstanding evidence items must be reported separately; do not mark the
whole spec `verified` from the package status alone.

## Historical local candidate — 2026-09-25

This is local evidence, not evidence of a staging or production release. The
owner delegated editorial validation and release but did not personally read
the 1,001 remaining question translations. See
[DELEGATED-RELEASE-DECISION.md](DELEGATED-RELEASE-DECISION.md).

## Requirement coverage

The following results are the historical local-candidate snapshot, not the
current publication readback above.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=report; ref=specs/0007-listening-editorial-revision/DELEGATED-RELEASE-DECISION.md | PASS |
| FR-002 | kind=report; ref=specs/0007-listening-editorial-revision/DELEGATED-RELEASE-DECISION.md | PASS |
| FR-003 | kind=assertion; ref=specs/0007-listening-editorial-revision/lesson-metadata-draft.json | PASS |
| FR-004 | kind=report; ref=specs/0007-listening-editorial-revision/TRANSCRIPT-REVIEW-LEDGER.md | PASS |
| FR-005 | Exact-SHA staging form switch/reload journey not yet run | PENDING |
| FR-006 | kind=report; ref=specs/0007-listening-editorial-revision/DELEGATED-RELEASE-DECISION.md | PASS |
| FR-007 | Staging import and production promotion not yet run | PENDING |
| FR-008 | Active-attempt drain migration and live query not yet run | PENDING |
| FR-009 | Authenticated mobile/theme/screen-reader check not yet run | PENDING |

## Local boundary evidence

| Boundary | Evidence | State |
| --- | --- | --- |
| Source identity | v1.0 release-index SHA and both manifest SHA locks match; 1,045/1,045 IDs, prompts and options source-bind with zero missing or duplicates | PASS locally |
| Editorial state | 44 direct-owner items, 1,001 delegated items, two delegated SVGs; 65/9/5 metadata directly approved | PASS locally |
| Text/answers | All 1,001 delegated items had assistant transcript/protected-key pre-review; translated choice collision/negation/number screens passed | PASS with stated AI-review limits |
| Audio/timing | 390 WAV and 1,474 timing segments pass package/signal checks; offline English ASR median 97.22%, minimum 75%, none below 75% versus controlled transcript | PASS as an automated screen, not human listening |
| Revision | Real v1.1 package build and v1.0 invariance comparison passed: General 56 lessons/143 forms/911 items, IELTS 10 lessons/16 forms/134 items; protected metadata packet is manifest-bound | PASS locally |
| Import | Dry-run passed for both real v1.1 packages, including approved metadata/visual inventory binding, with zero DB/Storage mutations | PASS locally |
| Code tests | Backend editorial/import 111 passed; affected Listening/admin suite 719 passed (22 PostgreSQL-dependent skips); the latter migration suites then passed 22/22 against disposable PostgreSQL 16; affected frontend suite passed 81/81 | PASS locally |
| Live experience | Authenticated form, Vietnamese/English map, mobile, keyboard/screen reader, light/dark, saved-answer/resume journeys on exact staging SHA | PENDING |
| Cutover | Owner chose block new v1.0 starts and wait for active attempts to finish/expire; migration and live drain query not applied/verified | PENDING |
| Release | Staging PR/checks, unpublished import, exact-SHA E2E, production migration/promotion/marker | PENDING |

The real local candidate was built outside Git. Its General and IELTS
manifest SHA-256 values are
`275f9fbbf6becb83bfc83428b1b8ed824f64fb29f246d4fe3280e89a87fa32be` and
`2a261931ab6fcce2629d8002b782fc07255345f874b8aa656b4ed850c2c245c9`.
The separately marked synthetic DO-NOT-PUBLISH candidate must never be
imported.

This historical local-candidate section did not claim staging or production
publication. Use the current readback above for release state and retain the
per-gate evidence limits stated there.
