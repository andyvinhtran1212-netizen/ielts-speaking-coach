# Verification — 2026-09-25 local release candidate

This is local evidence, not evidence of a staging or production release. The
owner delegated editorial validation and release but did not personally read
the 1,001 remaining question translations. See
[DELEGATED-RELEASE-DECISION.md](DELEGATED-RELEASE-DECISION.md).

| Boundary | Evidence | State |
| --- | --- | --- |
| Source identity | v1.0 release-index SHA and both manifest SHA locks match; 1,045/1,045 IDs, prompts and options source-bind with zero missing or duplicates | PASS locally |
| Editorial state | 44 direct-owner items, 1,001 delegated items, two delegated SVGs; 65/9/5 metadata directly approved | PASS locally |
| Text/answers | All 1,001 delegated items had assistant transcript/protected-key pre-review; translated choice collision/negation/number screens passed | PASS with stated AI-review limits |
| Audio/timing | 390 WAV and 1,474 timing segments pass package/signal checks; offline English ASR median 97.22%, minimum 75%, none below 75% versus controlled transcript | PASS as an automated screen, not human listening |
| Revision | Real v1.1 package build and v1.0 invariance comparison passed: General 56 lessons/143 forms/911 items, IELTS 10 lessons/16 forms/134 items | PASS locally |
| Import | Dry-run passed for both real v1.1 packages, with zero DB/Storage mutations | PASS locally |
| Code tests | Backend editorial/import tests 105 passed; expanded backend regression 169 passed; frontend language-switch tests 7 passed | PASS locally |
| Live experience | Authenticated form, Vietnamese/English map, mobile, keyboard/screen reader, light/dark, saved-answer/resume journeys on exact staging SHA | PENDING |
| Cutover | Owner chose block new v1.0 starts and wait for active attempts to finish/expire; migration and live drain query not applied/verified | PENDING |
| Release | Staging PR/checks, unpublished import, exact-SHA E2E, production migration/promotion/marker | PENDING |

The real local candidate was built outside Git. Its General and IELTS
manifest SHA-256 values are
`a76bc73c65079626e3dd416a2ac35a73c3f974b10c1de4f0511b5462d399693e` and
`063e310d633ea80ed542f35c19e812cbedb3bcc255506d5df500677babbf67d2`.
The separately marked synthetic DO-NOT-PUBLISH candidate must never be
imported.

No staging or production publication is claimed here. Stop on a failed gate;
do not substitute this local report for exact-SHA live evidence.
