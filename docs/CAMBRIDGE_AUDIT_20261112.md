# Cambridge audit repair, 12 November 2026

## Batch 1: bounded canonical content corrections

Current authorization (14 November 2026): prepare fixes and draft PRs into
staging, **no production deployment or mutation**. This supersedes the earlier
release request. This offline package proposes changes to five existing
content rows, not the global marker or the UI. Creating or merging the PR
does not execute SQL or change hosted content.
It never updates learner answers, attempts, scores or protected snapshots.
All originals and revised papers retain their IDs, status and visibility.

| Production paper | Item | Correction |
| --- | --- | --- |
| B20 Listening T4 REV02 | Q8 | Add `2:30`, retaining `2.30` and `two thirty` |
| B18 Reading T1 REV01 | Q2 | Add `1000 kg`, retaining `1,000 kg` |
| B17 Listening T2 REV01 | Q31 | Add `321000`, retaining `321,000` |
| B16 Reading T4 REV01 | Q13 | Add `the harbor`, retaining the existing shorthand |
| B20 Listening T2 REV02 | Q11-16 | Restore matching kind, six activity labels and source instruction; remove the erroneous choose-two limit |

The production prefix is `MOCK0016-PROD-20261006-ILR-`, followed by the skill
(`LIS` or `RDG`) and `-CAM-` plus the identifier above.

## Evidence and root cause

Four learner audit attempts rejected a source-equivalent form. The legacy
marker intentionally does not infer numeric/time equivalence without reviewed
item metadata. The correction adds exactly one documented alternative to each
affected item. This avoids converting decimals into grouped integers, losing
units, accepting extra words, or widening unrelated questions.

Cam20 Listening T2's revised payload incorrectly declares `mcq_multi`,
`metadata.choose=2` and repeats the shared instruction as each prompt. The
existing Next matching renderer and backend per-slot grader support the intended
contract. No component or runtime grader change is required.

The owner-provided local **Cambridge IELTS 20 Academic.pdf**, SHA-256
`a818cf2a0132c37e04c810d30932733f872da0b9122ce13561001887f79fbb0e`,
printed p41 (PDF page 43), was visually inspected. It explicitly lists all six
activities and says to choose six answers, A-I. Staging's original paper also
independently retains those six labels and the matching kind.

## Staging mapping and limitation

Staging does not contain these production REV copies. Rehearsal maps each paper
to its original `ILR-...` code, with original row UUIDs recorded in the local
before snapshot. Staging B16 Q13 stores `(the) harbour` plus `harbor`, whereas
production stores `(the) harbour / harbor`. Staging B20 T4 Q8 lacks the existing
production `two thirty` alternative. The plan preserves each environment's own
forms. Staging B20 T2 is already correct and is not changed.

The earlier four-row staging transaction (12 November, original commit
`dd2af2f320455274c0732aa17c29e3b10a1f03f9`) completed with readback assertions and
`ROLLBACK`; a subsequent read confirmed the original values and timestamps.
This proves a mapped schema/content rehearsal, not identical deployed REV UI.

## Guarded persistence and rollback

`backend/content_mock_correction/cambridge_audit_20261112.py` is a pure plan and
SQL builder. Before snapshots and generated SQL stay in the task's untracked
`output/cambridge-audit` directory. The generated transaction:

- obtains the canonical paper advisory locks;
- checks exact paper identity, status and visibility;
- checks row UUID, parent association, full prior JSON and `updated_at`;
- requires exactly one row per update and exact after-JSON readback;
- commits all five updates atomically, or rolls back on any conflict.

The existing source trigger increments `mock_content_revision`, as intended.
Do not suppress triggers or restore an older revision number. A post-commit
rollback must use a fresh snapshot/CAS and the saved prior content, producing
another revision. Never blindly replay an old SQL file after an uncertain call.

Existing attempt snapshots and grades remain unchanged. A learner recheck must
start a fresh attempt; resuming the original diagnostic draft will intentionally
retain its original contract.

The 14 November refresh preserves the original commit on a backup branch and
rebases this isolated patch onto staging `14276c24b7f6e80b92736928ac5f963dcc5b3b02`.
Additional fail-closed guards pin all production/staging row UUIDs, parent
UUIDs, table/field pairs and original status/visibility; duplicate answer slots
and changed matching keys/options are rejected. The separate staging reference
must contain exactly one complete six-row group with its own original payload
shape. Generated SQL rejects its reserved
delimiter. Future execution requires a fresh baseline review and separate
authorization; the historical staging rehearsal does not certify new SQL bytes.

## Validation status

- Refreshed focused tests: 186 passed (four variants, strict negative cases,
  immutable inputs, idempotency, matching complete/partial/swapped scoring,
  exact option-bank/row identity guards and complete staging reference checks).
- Listening Node contracts: 194 passed. Selected native React suites: 8 passed,
  including all six matching rows still editable after two selections and all
  six answers independently selectable. The rendered fixture is checked against
  the transformation output. TypeScript passed. No API writes in that fixture.
- Spec governance: 55 specs validated; diff whitespace check passed.
- Full backend suite and independent review are tracked in the PR/checkpoint.
- Production persistence and learner verification are not claimed by this
  document until a dated release receipt is added.

## Deferred work

Teaching/explanation corrections, audio fidelity/cues, and remaining layouts are
separate batches. Cam20 Reading T3 has now been compared with source pages by an
independent reviewer, but those restorations are not part of this five-row batch.
No content-only repair authorizes promotion of unrelated staging code to main.
