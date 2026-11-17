# Cambridge audit Batch A — offline data package

Builder only — no DB write; RM executes after separate approval. No migration.
Creating/merging this package grants no staging or production execution rights.
No regrade: previous attempts, snapshots, scores and notifications are untouched.

## Academic scope and identities

| Item | Environment / paper | Rows and fields |
| --- | --- | --- |
| C03b | Prod `MOCK0016-PROD-20261006-ILR-LIS-CAM-B20-T4-REV02`, UUID `aa667c6d-1b95-5079-a38e-5dcd88a39f0d` | Exercise `64a259ec-eb66-5b69-ad4f-08d755d50405`, `payload.answers[q_num=8].alternatives`: `["two thirty","2:30"]` → `["2:30"]`; canonical `2.30` unchanged. Also update `payload.solutions.8.answer`, `.trap`, `.why_correct` to CM review :23–25. |
| C03b explanation | Same paper | Bound `mock-aa667c6d-1b95-5079-a38e-5dcd88a39f0d-listening-q08`; source payload identity `cambridge-20-test-4-listening-q08`. Change only `payload.item.answer.accepted_forms`, `payload.explanation.answer_summary` and `.marking_note`. |
| C03b counterpart | Staging `MOCK0016-20261005-C20L4-REV02`, same paper UUID | Exercise `64a259ec-eb66-5b69-ad4f-08d755d50405`: key-only when no bound Q8 object exists, enforced again inside the transaction. If a bound object exists, capture the key/object pair and validate both before-images. Never create an object. Key accepts the reviewed historical `["two thirty"]`, post-#2311 `["two thirty","2:30"]`, or target `["2:30"]`; The same three `solutions.8` fields use CM review :23–25. Only a complete target key and solution is a guarded no-op. |
| V2b | Prod `MOCK0016-PROD-20261006-ILR-LIS-CAM-B17-T2-REV01`, UUID `995b0273-8854-57a6-9065-450c3c13465e` | Bound `mock-995b0273-8854-57a6-9065-450c3c13465e-listening-q31`; payload source `cambridge-17-test-2-listening-q31`. Only four JSON paths listed in the adjacent spec. No exercise/key write. |
| X1 | Staging original `ILR-RDG-CAM-B20-T3`, UUID `72a8a0d2-b3d3-58da-85be-35a56c1097c3` | Q38 `ba6fcedf-c89e-5e63-8d22-fd156d698bee`, Q39 `9ac096f5-0514-55e3-a301-d474c0db7063`, Q40 `8cb3cd32-6e68-54ae-8bde-724544a7c49a`: only `payload.options`. Corresponding source explanation objects: only `payload.item.options`. Keys C/B/C and Q37 key B unchanged. |
| Q40 micro-drill (optional) | Prod Cam17 paper above; staging original `ILR-LIS-CAM-B17-T2`, UUID `82ecda1d-ea89-5d66-8ae2-3c155836f527` | Only `payload.explanation.why_other_answers_fail` and `payload.audit.distractor_analysis`: replace the exact CM old substring once per field. Staging additionally requires the captured Q31 key to accept `321000`; it is never updated here. |

The JSON records source provenance, hashes and exact before/after constants.
Q38–40 options are copied verbatim from #2308 at
`629e35fb7ee0737be80904dbfbea567d88f8b5e2`, not re-authored.
Q31 text is copied verbatim from CM's
`CAM17-L2-Q31-EXPLANATION-SPEC-20261116.md`; its SHA-256 is recorded.
If CM text is unavailable, `__CM_TEXT_PENDING__` blocks every SQL emission.

Q8 summary and marking note use CM-2322-R1-SIGNOFF-20261116.md lines 41–42
verbatim, including real backticks in the marking note:

- `answer_summary`: `Đáp án chuẩn: 2.30 (chấp nhận cả 2:30).`
- `marking_note`: ``Chấp nhận `2.30` hoặc `2:30`. Không nhận dạng chữ như `two thirty` vì là hai từ, vượt giới hạn ONE WORD AND/OR A NUMBER; không ghi thêm "pm" vì đề đã in sẵn "p.m.".``

The exercise's learner-facing `payload.solutions.8` is repaired in both environments
under the same full-row CAS as its answer alternatives. `answer`, `trap` and
`why_correct` are copied from `CM-2323-Q8Q40-REVIEW-20261116.md` lines 23–25
(provenance hash in the adjacent JSON; Markdown backtick escapes decoded).
The answer is `2.30 / 2:30`; trap and why_correct explain that `two thirty`
exceeds the word limit. All other solution fields and audit history are preserved.
Missing target solution fields refuse before emitting SQL.

Accepted forms become exactly `["2.30","2:30"]`. The full source warning
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

### Required fresh capture changes for RM

The 18:46 staging capture (`pre-stg.json`, SHA-256 prefix `025d206b74a3`)
contains obsolete X1 rows `be687263`, `495a1338`, `54675a23`, all non-current.
It **cannot** be used to emit SQL. Re-capture complete paper and question rows
and select explanation rows by **object_id plus is_current**, never the old IDs:

```sql
WHERE object_id IN ('cambridge-20-test-3-reading-q38',
                    'cambridge-20-test-3-reading-q39',
                    'cambridge-20-test-3-reading-q40')
  AND is_current IS TRUE
```

Capture exactly one full `to_jsonb(row)` per object_id as `x1-object-38/39/40`.
The current IDs must start with `7ca65ff4`, `8f42f1c4`, `1656d59a` respectively;
the observed version is `2026-11-05-t008-pcj667-v1`. Unknown prefixes, only
non-current rows, duplicate current rows or drifted options/keys refuse. SQL
rechecks current-row cardinality before any UPDATE, then full-row CAS pins the
captured current flag, complete UUID and version. Never substitute fixture IDs.

For Q8, re-capture the exercise and check **all** bound versions using
`listening_test_id = 'aa667c6d-1b95-5079-a38e-5dcd88a39f0d'`, `skill = 'listening'`,
`question_number = 8`, `binding_status = 'BOUND'` (no current-version filter).
Zero objects permits `c03b-key` alone and emits an in-transaction zero-count
assertion. If any exists, include the current `c03b-object` and key, requiring
the existing before-value checks; absent current or ambiguous objects require
RM reconciliation. An object appearing after a key-only capture causes SQL to
refuse and instruct RM to re-capture the pair. There is no INSERT or automatic
fallback without a captured full object pre-image. The old capture envelope's
`missing: ["c03b-object"]` describes this optional absence; it must not be
misreported as a missing mandatory staging target. The builder consumes only
its inner `snapshot`, not the capture envelope.

Neither supplied capture contains Q40. To evaluate it, add `q40-object` with
its complete row and paper, selecting exactly one `is_current IS TRUE` row:

- Staging: `object_id = 'cambridge-17-test-2-listening-q40'`, bound to original
  paper `82ecda1d-ea89-5d66-8ae2-3c155836f527`. Also add `q40-key`, the complete
  `listening_exercises` row `0a846d47-c5d6-58ec-932e-e041e36622fe` (content
  `eb5b9926-9ace-5e6e-8d6c-d0aae2fc5d12`), with the same complete paper image.
- Prod: `object_id = 'mock-995b0273-8854-57a6-9065-450c3c13465e-listening-q40'`,
  bound to paper `995b0273-8854-57a6-9065-450c3c13465e`; paper image must match V2b.

Preserve both full Q40 text fields, including everything after the micro-drill.
The only replacement is CM Q31 spec lines 40 → 41 (adjacent JSON `q40.before`
→ `q40.after`), exactly once in **each** field; zero/two matches refuse when
eligible. Everything else, including `` `around 321,000` ``, remains unchanged.
Absent Q40 is skipped with a reason in `.changes.json`. Staging Q31 currently
has alternatives `[]`; capturing that key skips Q40 with the reason that the key
does not accept `321000`. Captured skipped rows and the key remain full-row SQL
guards before any UPDATE, without changes or revision bumps. No staging Q31 key
or Q31 explanation is changed by this package.

For staging, required targets are `x1-question-38`, `x1-question-39`,
`x1-question-40`, `x1-object-38`, `x1-object-39`, `x1-object-40`.
Optionally include `c03b-key` alone under the zero-object assertion, or include
**both** `c03b-key` and `c03b-object` for the revision counterpart.
Omitting both means C03b staging was not evaluated; record RM's separate
read-only parity evidence before declaring that item closed. Q8 already at
target is included in guards but does not receive an UPDATE or revision bump.
Only these targets and the optional Q40 targets above are accepted. No-op X1/V2b
post-images refuse: capture and reconcile already-applied packages before considering a retry.

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
Fixtures include the original reduced export and synthetic wrappers, plus:

- `cambridge_batch_a_pre_stg_SYNTHETIC_current_x1.json`: the real 18:46 staging
  capture with **only** the three X1 row UUIDs, `is_current` flags and versions
  substituted to model the observed current shape. UUID suffixes are synthetic;
  payloads, Q37 options, papers, timestamps and all other values are retained.
  This proves 0 offline mismatches / 7 changed rows, not a live staging pre-image.
- `cambridge_batch_a_pre_prod_20261116_2159.json`: byte-for-byte copy of the real
  prod read-only capture, SHA-256 `2c2fafdbd2b2fd3b8a0ddd9539877ac11a93c1c200255bf236335a0400f4bcdb`.
  It proves 0 offline mismatches / 3 changed rows: C03b key/object and V2b object.
- `cambridge_batch_a_f2d62986_prod_golden.json`: output digests generated by
  loading the builder Python and JSON from `git show f2d62986566d422a3b99d43aeb024f21bf87fea9:<path>`
  against that prod capture. Tests compare every full before/after row digest,
  all V2b SQL lines, and the entire SQL after restoring the two Q8 object CM
  fields plus the three exercise solution fields. Thus CAS values and V2b SQL/values stay byte-identical to the base.

No fixture is an executable current capture. RM must re-capture before execution.

After separate execution approval, RM must compare actual before/after row counts,
IDs, hashes, target paths, paper policy/revisions and unchanged neighboring keys;
CM validates the two explanations; QA checks paper options and review objects on
the exact target data. Stop on any ID/count/hash mismatch. No live verification
or academic production acceptance is claimed by these offline tests.

Follow-ups, outside this package:

- Staging Cam17 Q31's key may still reject `321000`. V2b is production-only here
  to avoid teaching a form its staging key rejects; RM must verify staging key
  state and obtain scoped authorization before synchronizing it.
- Fresh full X1 current rows and optional Q40 rows remain RM capture requirements.
  Neither supplied capture evaluates Q40; its offline fixtures are synthetic.
- Source packages on Vinh's Mac and production X1 explanation discovery remain
  separate work. This package changes neither source files nor prod X1 objects.
