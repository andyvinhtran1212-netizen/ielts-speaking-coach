# Writing prompt batches

Reviewed Writing prompts that live in the `writing_prompts` table. The JSON
manifest is the source of truth; `backend/scripts/import_writing_prompts.py`
reconciles **staging** with it (dry run by default, `--execute` to apply,
then a read-back that must report no difference). It refuses any project
other than staging.

## `2026-10-batch.json` (team content plan 2026-10-27, B3)

| Keys | Count | Task type | Source draft |
|---|---|---|---|
| `T2-01` … `T2-19` | 10 | `task2` | `content-audit/task2-replacements` (replaces ten 035 seed prompts) |
| `A01` … `A12` | 12 | `task1_academic` | `content-audit/writing-prompts-task1/PLAN.md` §2 and §5 |
| `G01` … `G06` | 6 | `task1_general` | `PLAN.md` §3 and §5 |

All places, organisations and data are fictional. Each Academic item carries
the data table its chart was drawn from (`source_data`), the image's sha256
and the answer-key draft used when the admin approves the extracted key.

`review.status` records what the Content Manager has signed off:
`approved` means the text passed review; `needs_review` lists in
`review.needs` what is still waiting (`prompt_text`, `image`).

### Import rules

- Matching is by `task_type` + `title` (then `legacy_titles`) among active
  rows. Two active matches abort the run before any write.
- New rows are held from the learner bank (`exam_only = true`) unless
  `--visible` is passed. Existing rows keep their `is_active` / `exam_only`.
- A differing image is uploaded as a new object and the answer key is
  cleared, as the admin PATCH does; it must be re-analysed and approved.
  Published objects are never deleted.
- Live images are read from the private `writing-images` bucket by object
  path with the service role, and rows store the object path, as the admin
  routes do. A stored image that cannot be read aborts the run before any
  write; it is never treated as "differs".
- A Task 2 item retires any active row whose text equals its 035 seed text.
  The seed shares the replacement's title but is never matched as the
  replacement: the replacement is created first, then the seed is retired.
  Staging never had the 035 seed, so there this is a no-op.

```bash
cd backend
python -m scripts.import_writing_prompts             # dry run
python -m scripts.import_writing_prompts --execute   # apply on staging
```
