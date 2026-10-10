---
id: GRAMMARAUDIT-0019
title: Close the October Grammar audit while preserving every learner revision
status: approved
risk: high
owner: product
---

# Grammar audit remediation

## Problem

The original DOCX/XLSX audit of 1–2 October contains 589 finding groups across
137 lessons and an incorrectly published administrative README. It includes
77 rejected valid answers, 24 contextual/unconfirmed cases and six malformed
answer controls. Several old findings are already corrected. The current
immutable publication owner permits only twelve codes and one cutover each;
this prevents safe publication of the remaining corrections, including one
follow-up correction for Long Sentence Untangling already revised on staging.

## Scope

The exact source files, qids and changed fields in source-scope.json: 131 article
corrections, 79 bank sources with 134 changed questions and three Grammar label
files. Existing twelve reviewed sources remain supported as immutable historical
identities; the union is ninety canonical codes, not permission to edit ninety
arbitrary banks. The entire audit remains tracked by its original GA IDs,
including already corrected and context-dependent conclusions.

This technical intent was independently approved on 10 October; the source bundle
was independently reviewed and the concrete corrections integrated. This spec-only
change includes no expanded publication implementation or live database mutation.
It must land on staging before the separately scoped high-risk implementation.

## Non-goals

Historical regrading, score/mastery transfer, assignment creation or return,
learner history modification, a general revision editor, automatic startup
publication, an unbounded revision graph, all-question re-audit outside the
original findings, or declaring a Grammar30/UI release proof of content closure.
No new matching algorithm, global strict mode, fuzzy threshold or scoring formula.

## Users and journeys

New Grammar work uses the approved corrected question and explanation. A learner
reopening stored work sees its original bank, question, key, answer and result.
An admin previews the bounded source and current footprint, publishes through
a guarded transaction, and verifies canonical readback and historical integrity.

## Requirements

- **FR-001:** Reconcile every original GA ID with current production content, a specific source correction or reasoned adjusted/already-fixed conclusion, and separate local, staging and production evidence. Unconfirmed and contextual proposals are not automatically mandatory defects. Completion requires an explicit disposition and acceptance evidence for every finding.
- **FR-002:** The corrected authored questions accept the vetted equivalent answers or state an unambiguous form/meaning target. Correctly composed answers pass the real engine and receive the existing credit; each of the six malformed-control defects has a valid current-frame negative control. An old answer which becomes well-formed after a frame repair is not falsely required to fail. Preserve qid, item_key, order, counts, skill, points and mastery contract; only the exact named eight input/type conversions in source-scope.json are permitted.
- **FR-003:** Correct theory, explanations, meaning distinctions, paraphrase and Task 1 claims in all related parts of each affected lesson. No invented data or causes, categorical contextual rules or automatic band guarantees. Apply the official IELTS criteria to the whole response; preserve correct qualified examples and explain context when appropriate. README remains excluded from the public Grammar catalog.
- **FR-004:** Publication accepts only the independently reviewed raw source hashes and per-qid field changes in the exact candidate bundle. Retain all existing twelve historical hashes, receipts and policy maps as valid frozen identities; approval of new bytes does not invalidate old work. Read all current question extras, including why_wrong; a conflict needs an explicit source/extras decision, never silent deletion. Only the named singular-vs-plural words_count correction from five to four is allowed; all other canonical metadata extras are preserved.
- **FR-005:** Use the existing immutable revision, preview/CAS, admission, ownership and receipt owners for the exact eligible codes. Before each mutation, read the actual complete bounded footprint and back up bank/questions plus history fingerprints. Retain original bank and question IDs, all sessions, attempts, answers, results, points, mastery and assignments unchanged. Missing, partial, ambiguous or over-limit evidence blocks that bank without blocking independent authorized work. Retain 0014/0015 row/byte caps, provenance checks, direct-write/erasure/reset locks and existing old-client behavior. No generic replace import against used banks or managed revisions.
- **FR-006:** A missing staging bank may be seeded only from a separately reviewed, complete production bank/question snapshot with verified article/topic identity and retained extras; no learner data is copied. The production predecessor must exist and match the read snapshot. Missing data is never interpreted as zero history or permission to manufacture a production predecessor.
- **FR-007:** Permit one explicitly reviewed follow-up publication only for G-grammar-for-reading-long-sentence-untangling and only the GA-129-Q05 lsu_strip_i2 prompt/accept/explain delta. At most three banks may exist for this code, with exactly one canonical current bank. Preserve both prior source identities, receipts and frozen history. Owned unfinished work in either retired version continues under its original policy and canonical proof; completed/reset/readonly/unknown work cannot gain new legacy eligibility. For an unrevised production predecessor, the final reviewed source may be published in its first cutover; no intermediate obsolete version is required. No other second cutover is permitted.
- **FR-008:** Keep concrete admin OpenAPI/generated/runtime validation, frozen bank/revision capability acknowledgement, truthful current/legacy availability, conflict/error/retry and history read behavior for every newly eligible code. Existing non-Grammar and unmanaged absent-policy behavior remains compatible. Readonly acceptance does not start/progress/end/reset real learner work. Grammar result labels describe practice counts, not unsupported weakness diagnoses; the article CTA describes the true concept count rather than a promised question count.
- **FR-009:** Run meaningful source/real-engine regressions, affected full local suites and actual PostgreSQL preservation/race/receipt tests before pushing implementation. Apply additive schema changes through the advisory-locked migration ledger, staging first. Require exact merged staging SHA CI and Live Staging E2E, promotion from staging to main, exact frontend/backend production SHA and affected live acceptance. Report skips and unavailable evidence explicitly; do not update old hash gates without source approval or claim code deployment published bank data.

## Acceptance scenarios

A vetted answer rejected in the audit either succeeds under the unchanged task
with an expanded accepted set, or the corrected task explicitly states its target
and the corresponding answer succeeds. Current-frame malformed answers earn no
credit. A retired learner attempt retains its UUIDs, prompt, key, submitted answer,
result and points through cutover and reload. An admin retry with the same UUID
and payload returns its original receipt, while a conflicting payload fails before
writes. A pre-existing LSU revised session remains readable and, if proven
unfinished, continuable after the one approved follow-up. The live catalog has
137 lessons and administrative README detail returns 404.

## Edge cases

Concurrent start/progress/reset/erasure; lost admin/start acknowledgement; key versus
retained explanation conflict; stale source/footprint; malformed or missing policy;
unknown predecessor/cohort; frozen retired revision; duplicate current mappings;
permitted account erasure; missing staging content; production/staging identity
mismatch. Fail closed within the existing bounds and continue unaffected work.

## Success criteria

Every GA ID has a defensible current disposition and environment-specific evidence.
All accepted fixes are deployed and exercised on production, all relevant historical
fingerprints/UUIDs/points remain intact, and no unauthorized learner mutation occurs.

## Open questions

No user permission question remains. The user approved the two independent reviews
and the three database-variable reads on 10 October; inherited backend/database
authorization remains in force. A fresh repeatable-read, read-only production
snapshot contains all 148 physical Grammar banks/questions and bounded history
fingerprints. No question has nonempty why_wrong extras. Technical review approved
the bounded design. Final source hashes and environment-specific CAS/footprints
remain executable release evidence, rather than additional permission checkpoints.
