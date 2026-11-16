# Cambridge audit Batch A — offline data package

Builder only — no DB write; RM executes after separate approval. No migration.
Creating/merging this package grants no staging or production execution rights.
No regrade: previous attempts, snapshots, scores and notifications are untouched.

## Academic scope and identities

| Item | Environment / paper | Rows and fields |
| --- | --- | --- |
| C03b | Prod `MOCK0016-PROD-20261006-ILR-LIS-CAM-B20-T4-REV02`, UUID `aa667c6d-1b95-5079-a38e-5dcd88a39f0d` | Exercise `64a259ec-eb66-5b69-ad4f-08d755d50405`, `payload.answers[q_num=8].alternatives`: `["two thirty","2:30"]` → `["2:30"]`; canonical `2.30` unchanged. |
| C03b explanation | Same paper | Bound `mock-aa667c6d-1b95-5079-a38e-5dcd88a39f0d-listening-q08`; source payload identity `cambridge-20-test-4-listening-q08`. Change only `payload.item.answer.accepted_forms`, `payload.explanation.answer_summary` and `.marking_note`. |
| C03b counterpart | Staging `MOCK0016-20261005-C20L4-REV02`, same paper UUID | Optional key/object pair; current exercise/object row UUIDs come from RM capture. Key accepts the reviewed historical `["two thirty"]`, post-#2311 `["two thirty","2:30"]`, or target `["2:30"]`. Target values are guarded no-ops. |
| V2b | Prod `MOCK0016-PROD-20261006-ILR-LIS-CAM-B17-T2-REV01`, UUID `995b0273-8854-57a6-9065-450c3c13465e` | Bound `mock-995b0273-8854-57a6-9065-450c3c13465e-listening-q31`; payload source `cambridge-17-test-2-listening-q31`. Only four JSON paths listed in the adjacent spec. No exercise/key write. |
| X1 | Staging original `ILR-RDG-CAM-B20-T3`, UUID `72a8a0d2-b3d3-58da-85be-35a56c1097c3` | Q38 `ba6fcedf-c89e-5e63-8d22-fd156d698bee`, Q39 `9ac096f5-0514-55e3-a301-d474c0db7063`, Q40 `8cb3cd32-6e68-54ae-8bde-724544a7c49a`: only `payload.options`. Corresponding source explanation objects: only `payload.item.options`. Keys C/B/C and Q37 key B unchanged. |

The JSON records source provenance, hashes and exact before/after constants.
Q38–40 options are copied verbatim from #2308 at
`629e35fb7ee0737be80904dbfbea567d88f8b5e2`, not re-authored.
Q31 text is copied verbatim from CM's
`CAM17-L2-Q31-EXPLANATION-SPEC-20261116.md`; its SHA-256 is recorded.
If CM text is unavailable, `__CM_TEXT_PENDING__` blocks every SQL emission.

Q8 summary and marking note are restored to the source-authored staging values
(`Đáp án chuẩn: 2.30.` / `null`), removing any production variant list in those
fields. Accepted forms become exactly `["2.30","2:30"]`. The full source warning
beginning `Không viết **two thirty**` remains unchanged in `.explanation.trap`.
Unknown production explanation text in **other** fields is retained. Unknown
canonical/forms/warning values refuse the package; return to CM rather than
inventing text. Q31 requires every targeted old field to equal CM's staging old
constant; different production text must go back to CM.

## Existing tools and schema

The transaction follows #2311 (`638b60b1cf036fda1667192e4a15884d2b6e35ee`)
and #2308's lock, identity/visibility, full-pre-image CAS, row-count and readback
pattern. `scripts/sync_web_explanation_item_text.py` supplies the existing pure
`_options` and `_set_item_text` helpers. Its whole-paper version rollover is not
invoked: that executor is staging-only, copies 40 objects and rejects pinned
papers. This package implements the requested bounded payload deltas using the
existing table; it adds no version/activation/persistence subsystem.

Schema truth: migration 245 defines `web_explanation_objects.payload`,
`reading_test_id`, `listening_test_id`, `content_version`, `created_at`; it has
**no `updated_at` column**. Migration 315 defines bound `mock-<UUID>-<skill>-qNN`
identities. Payloads keep their original Cambridge `object_id`.
Explanation CAS therefore compares the entire captured row, including version,
created timestamp, current flag, binding, source hash, rights/editorial/serving
states and payload. Content row CAS additionally names `updated_at` explicitly.
Only `payload` is assigned; source-provenance hashes, versions and statuses stay
as captured (the existing sync/binding tools also preserve source hashes).
The package hashes separately attest the exact captured before/after rows.

## RM current pre-image contract

Capture **read-only** immediately before building. This job neither captures nor
connects to either database. Do not use test fixtures as executable captures.
Input JSON shape:

```json
{
  "environment": "prod",
  "entries": [
    {"target": "c03b-key", "paper": {"...": "complete listening_tests row"}, "row": {"...": "complete listening_exercises row"}},
    {"target": "c03b-object", "paper": {"...": "same complete paper row"}, "row": {"...": "complete bound Q8 explanation row"}},
    {"target": "v2b-object", "paper": {"...": "complete Cam17 listening_tests row"}, "row": {"...": "complete bound Q31 explanation row"}}
  ]
}
```

Every `paper` and `row` must be the complete PostgreSQL `to_jsonb(t)` image,
including null columns. Partial objects cannot match the generated SQL's full-row
CAS. Repeated paper images must agree exactly. Required paper fields include
`id`, `test_id`, `status`, `is_public`, `updated_at`, `mock_content_revision`,
`policy_revision`. Paper status is prod `published` / staging `draft`, always
`is_public=false`. Full-row guards also pin all other policy fields.

For staging, required targets are `x1-question-38`, `x1-question-39`,
`x1-question-40`, `x1-object-38`, `x1-object-39`, `x1-object-40`.
Optionally include **both** `c03b-key` and `c03b-object` for the revision counterpart.
Omitting that pair means C03b staging was not evaluated; record RM's separate
read-only parity evidence before declaring that item closed. Q8 already at
target is included in guards but does not receive an UPDATE or revision bump.
No other rows/papers are accepted. No-op X1/V2b post-images refuse: capture and
reconcile already-applied packages before considering a retry.

Generate locally from the repository's backend directory:

```bash
python -m content_mock_correction.cambridge_audit_20261116 \
  /path/to/current-pre-image.json --out-prefix /path/to/batch-a-prod
```

Outputs: `.changes.json` (before/after, changed flags and per-row hashes),
`.rollback.sql` (default dry-run transaction ending **ROLLBACK**), `.commit.sql`
(the same guarded transaction ending COMMIT), `.sha256.json` (artifact hashes).
All artifacts render/validate before the first output file is written.
This command only writes files. It has no connection or SQL execution option.

Locks for every paper are taken in deterministic order before row checks.
All row pre-images, including no-ops, are locked and checked before the first
UPDATE. Each UPDATE rechecks the entire old row plus paper membership, requires
ROW_COUNT=1, then verifies the entire post-image except trigger-owned updated_at.
Paper post-images must equal the captured policy with exactly one content
revision increment per changed row, as migration 306's existing triggers specify.
Any mismatch raises, rolling back the whole transaction.

`.rollback.sql` is a rehearsal, **not an inverse restoration**. The changes file
retains exact before values for a rollback package. After a commit, RM must take
a fresh read-only post-image and separately approve a guarded inverse against
that image, including its current timestamps/revisions. Never replay old forward
SQL to recover or blindly resend an unclear write.

## Verification and remaining operational work

Offline tests cover exact changed-field scope; preserved unknown production
fields; Q8 matcher accept/reject behavior; X1 source options and keys; no-op
staging behavior; incomplete/duplicate/drifted snapshots; placeholder refusal;
SQL locks/CAS/membership/row-count/readback/ROLLBACK and allowed UPDATE tables;
and CLI artifact hashes with no files emitted on validation failure.
Fixtures are reduced staging exports with explicit synthetic production wrappers,
not current production rows. The JSON records the original export hashes.

After separate execution approval, RM must compare actual before/after row counts,
IDs, hashes, target paths, paper policy/revisions and unchanged neighboring keys;
CM validates the two explanations; QA checks paper options and review objects on
the exact target data. Stop on any ID/count/hash mismatch. No live verification
or academic production acceptance is claimed by these offline tests.

Follow-ups, outside this package:

- CM's Q40 micro-drill repeats the Cam17 Q31 comma teaching in two fields. The
  job names Q31 only; Q40 needs a separately scoped content change.
- Staging Cam17 Q31's key may still reject `321000`. V2b is production-only here
  to avoid teaching a form its staging key rejects; RM must verify staging key
  state and obtain scoped authorization before synchronizing it.
- Production explanation payloads/UUIDs and staging Q8 counterpart remain runtime
  capture requirements; this job does not claim their current state.
- Source packages on Vinh's Mac and production X1 explanation discovery remain
  separate work. This package changes neither source files nor prod X1 objects.
