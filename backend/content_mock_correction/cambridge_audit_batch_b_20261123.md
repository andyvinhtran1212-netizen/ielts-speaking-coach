# Cambridge audit batch B: offline data package

Builder only. It never connects to a database, writes nothing, needs no migration and regrades nothing.
Creating or merging this package grants no staging or production read or execution rights.
Previous attempts, snapshots, scores and notifications are untouched.

## Origin and scope

Closed PR #2311 (head `638b60b1cf036fda1667192e4a15884d2b6e35ee`, `docs/CAMBRIDGE_AUDIT_20261112.md`)
prepared five corrections. Batch A (`cambridge_audit_20261116.*`, #2322 and #2323) took the
Cam20 Listening T4 Q8 time item. This package ports #2311's pure builder and tests for the
other four items onto current staging. Each item's logic is unchanged from #2311.

| Production paper (`MOCK0016-PROD-20261006-ILR-…`) | Item | Correction | Table.field |
| --- | --- | --- | --- |
| `RDG-CAM-B18-T1-REV01` | Q2 | Add `1000 kg`, keep `1,000 kg` | `reading_questions.answer` |
| `LIS-CAM-B17-T2-REV01` | Q31 | Add `321000`, keep `321,000` | `listening_exercises.payload` (`answers[q_num=31]`) |
| `RDG-CAM-B16-T4-REV01` | Q13 | Add `the harbor`, keep `(the) harbour / harbor` | `reading_questions.answer` |
| `LIS-CAM-B20-T2-REV02` | Q11–16 | `mcq_multi` (choose 2) → `matching`, six activity labels, "Choose SIX answers … A-I", drop `metadata.choose`; keys D/I/H/E/A/B, options A–I, solutions and audio windows unchanged | `listening_exercises.payload` |

The Cam20 T2 labels and instruction come from the owner's Cambridge IELTS 20 Academic PDF:
SHA-256 `a818cf2a…bb0e`, printed p41 / PDF p43, visually verified for #2311.

**Why Q31 matters now:** batch A's V2b changed the production Cam17 Q31 explanation to say that
`321,000` and `321000` are both accepted (`accepted_forms`, `answer_summary`, `marking_note`).
Until this batch updates the Q31 key, the explanation promises something the marker rejects.

**Staging mapping** (rehearsal only, from #2311):
- Staging has the original papers, not the production REV copies.
- B16 Q13 on staging stores `(the) harbour` + `["harbor"]`. It keeps its own forms, and the rehearsal adds `the harbor`.
- Staging B20 T2 is already a correct matching group. It is required once as a reference and is never changed.
- So the rehearsal is three updates and one reference check, while production is four updates.

## Guarded transaction (unchanged from #2311)

`transaction_sql()` emits one transaction. It defaults to `ROLLBACK` and only commits with `rollback=False`. It:
- calls `fn_lock_mock_paper` per paper;
- checks the paper identity, status and visibility;
- compare-and-sets every row on its full prior JSON, `updated_at` and parent association;
- requires exactly one changed row, then reads back the new value;
- rejects the reserved delimiter.

It does not touch any attempt or snapshot table.

The source trigger advances `mock_content_revision`, as intended. A post-commit rollback must
use a fresh CAS against the rows as they are then, never a replay of an old SQL file.

## Reads needed (not done; to be batched into one approval request)

None of these has been run. Each is read-only, and each needs Andy's typed approval: production
reads need it under the team rules, and staging reads go through his Mac's DB URL.

1. **Production, read-only (4 rows + 4 papers).** For each production paper above:
   - the `{reading,listening}_tests` row (`id`, `test_id`, `status`, `is_public`);
   - the target row (`id`, the parent `passage_id`/`content_id` and its `test_id`, the full `answer`/`payload` JSON, `updated_at`).

   These confirm that the pinned UUIDs in `ROW_IDS` still hold, that the before-images still equal #2311's reviewed values, and that nothing changed since 12/11. Batch A did not touch these four rows, but its production status is unconfirmed.
2. **Production, read-only:** the batch A Q31 explanation object (`mock-995b0273-…-listening-q31`) `payload.item.answer.accepted_forms`. This shows whether V2b was applied, and so whether learners are already told `321000` is accepted.
3. **Staging, read-only (3 rows + 1 reference):** the same fields for `ILR-RDG-CAM-B18-T1`, `ILR-LIS-CAM-B17-T2`, `ILR-RDG-CAM-B16-T4` and the reference `ILR-LIS-CAM-B20-T2`.

   Batch A needed a builder fix after its first real capture (`10bcde32`, "match … captured staging shape"). Expect the same here, and fix the builder before emitting SQL rather than loosening a guard.
4. **Staging and production, read-only:** `has_function_privilege(<runner role>, 'public.fn_lock_mock_paper(text, uuid)', 'EXECUTE')`.

   Batch A attempt 2 stopped with rc=3 on a missing EXECUTE grant for this function (JOB-REGISTRY mạch 2). This batch uses the same lock, so the grant decision for batch A applies here too.

## After the reads (each step needs its own approval)

1. Review the captures, then build the plan and the ROLLBACK SQL offline. Get CR/CM sign-off on the exact SQL bytes.
2. Staging rehearsal in a ROLLBACK transaction, then a readback confirming nothing changed.
3. Production COMMIT only in an approved window, then readback. A learner check needs a new attempt, because old drafts keep their old contract.

## Tests

- `backend/tests/test_cambridge_audit_batch_b_20261123.py` (ported from #2311, Q8 removed):
  - each added form matches and the prior forms still match;
  - wrong magnitude, unit or extra words still fail;
  - drift fails closed, and B20-T4 Q8 is rejected as outside the batch;
  - the matching group scores per slot;
  - identity, policy, timestamp and option-bank drift are rejected;
  - the reserved delimiter is rejected;
  - production makes exactly four updates and the default SQL ends in ROLLBACK;
  - staging makes three rehearsals with exactly one reference.
- `frontend/tests/react/listening-cam20-matching-repair.test.tsx` with fixture `frontend/tests/fixtures/cam20-t2-reviewed-matching.json`: the repaired Cam20 T2 payload renders six labelled rows, each with 9 options. The test checks that all rows stay editable after two picks and that the page makes no API writes. The backend test checks that the transform output equals this fixture.
