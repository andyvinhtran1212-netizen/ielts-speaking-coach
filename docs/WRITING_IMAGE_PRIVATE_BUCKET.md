# Private `writing-images` bucket (B10)

Task 1 Academic prompt charts live in the Supabase Storage bucket
`writing-images` (`settings.WRITING_IMAGES_BUCKET`). The bucket used to be
public and rows stored public URLs, so anyone with a URL could fetch a chart,
including charts reserved for mock exams (`exam_only`) and charts on inactive
prompts. The bucket is now **private**.

## Contract

- **Write:** `writing_prompts.prompt_image_url` and the
  `writing_essays.prompt_image_url` snapshot store the **object path**
  (`prompts/<uuid>-<ts>.<ext>`). `canonical_image_ref()` turns the upload
  preview URL, a signed URL sent back by an editor, or a legacy public URL into
  that path before it is written. URLs on any other host are stored unchanged.
- **Read:** `attach_signed_image_urls()` replaces the stored ref with a
  short-lived signed URL (`VIEW_TTL` = 1 h) **after** the route has authorized
  the reader:

  | Surface | Who is authorized |
  |---|---|
  | `GET /api/writing/prompt-bank` | signed-in **active** account only; anonymous callers get `has_prompt_image` + `prompt_image_url: null` (the cacheable public list) |
  | `GET /api/writing/my-essays/{id}`, `/my-assignments`, `/my-assignments/{id}` | owning learner (existing ownership filters) |
  | `GET /api/mock-exams/sittings/{id}` | sitting owner |
  | `GET /admin/writing/essays/{id}`, `/instructor/essays/{id}` | admin / owning instructor (`get_essay_with_feedback`) |
  | `/admin/writing/prompts*`, `/admin/writing/assignments/{id}` | admin |
  | `/instructor/prompts*` | instructor (`instructor_db` scope) |

  Legacy public URLs on this project's Storage origin are only used to recover
  the path; they are never returned. If signing fails the field becomes `null`
  and the row carries `prompt_image_lookup_failed: true`. The stored URL is
  never used as a fallback.
- **Server fetch:** the Task 1 grader and the chart analysis call
  `fetchable_image_url()` (a 5-minute signed URL) and never log it.
- Signed URLs are reused per process until half their TTL has passed, so
  polling surfaces (the mock-exam runner polls every 8 s) keep the same
  `<img src>`.

Old rows keep rendering before and after the backfill, because readers resolve
both forms.

## Order of operations (per environment)

1. Deploy the backend and frontend that contain this change. The old code
   renders `prompt_image_url` directly, so it would break if the next two
   steps ran first.
2. Make the bucket private (below).
3. Run the path backfill (dry run first).
4. Verify (below).

Steps 2 and 3 are independent of each other once step 1 is live, and both can
be undone: set `public` back to true, or (for the backfill) note that readers
accept both forms.

### Make the bucket private

There is no SQL migration. Bucket visibility is Storage configuration, and CI
Postgres has no `storage` schema. Use either:

- Dashboard: Storage → `writing-images` → Edit bucket → **Public bucket: off**, or
- Storage API with the service-role key (do not echo the key):

  ```bash
  curl -sS -X PUT "$SUPABASE_URL/storage/v1/bucket/writing-images" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" -H "apikey: $SUPABASE_SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"id":"writing-images","name":"writing-images","public":false}'
  ```

Check: `GET $SUPABASE_URL/storage/v1/bucket/writing-images` with the same
headers returns `"public": false`. A former public URL
(`/storage/v1/object/public/writing-images/<path>`) must no longer return 200.

### Path backfill

```bash
cd backend
python -m scripts.backfill_writing_image_paths                        # dry run, read-only
python -m scripts.backfill_writing_image_paths --execute --project-ref <ref>
python -m scripts.backfill_writing_image_paths                        # re-run: convert=0
```

The script converts only URLs into this project's `writing-images` bucket and
uses compare-and-set on the old value. It reports these states:
- `MISMATCH`: the URL path differs from `prompt_image_public_id`.
- `invalid`: an unparseable ref.
- external hosts: left unchanged; `scripts/migrate_writing_images.py` re-homes them.

`--execute` refuses to run when `--project-ref` does not match `SUPABASE_URL`,
and refuses production without `--allow-production`. Rewriting a row bumps its
`updated_at` through the existing trigger. No Storage object is copied, moved
or deleted.

### Verify

- As a learner with a Task 1 Academic assignment: open the assignment. The
  chart loads from `/storage/v1/object/sign/writing-images/...`.
- Open the Writing dashboard → Kho đề → a 🖼️ prompt. The chart loads.
  Anonymous `curl $API/api/writing/prompt-bank` shows `prompt_image_url: null`
  and `has_prompt_image: true`.
- Admin: `/admin/writing/prompts`. Previews load. Edit a title and save, then
  confirm the reviewed answer key is unchanged.
- Admin grade page of a Task 1 essay: the chart loads. A regrade still sends
  the image: no `[grader] Task1 image fetch failed` in the backend log.

## Staging record

- 2026-10-27 dry run on `zjphffoujxkpltixsbzj`: 12 `writing_prompts` rows to
  convert, 0 essays, 0 external, 0 mismatch, 0 invalid. All 12 objects were
  signable, and a signed GET returned 200 `image/png`.
- `--execute` and the privacy switch run after this change is deployed to
  staging (step 1). Record the results here.

## Production runbook

Production project ref: `huwsmtubwulikhlmcirx`. Run this only after the change
has been promoted `staging` → `main` and the production backend/frontend SHAs
are confirmed live.

1. Confirm that the production backend is serving the new code: an anonymous
   `GET /api/writing/prompt-bank` returns `has_prompt_image`.
2. Dry run against production with the production service key. Review the
   output: expect only `convert` / `path` / `external` rows. Stop and
   investigate any `MISMATCH`/`invalid` row or missing object.
3. Make the bucket private (Dashboard or the Storage API call above), then
   check `"public": false`.
4. `python -m scripts.backfill_writing_image_paths --execute --project-ref huwsmtubwulikhlmcirx --allow-production`
5. Re-run the dry run and expect `convert=0`. Then run the Verify checklist on
   production with an internal learner/admin account.
6. Rollback: set the bucket back to public. Readers keep working with paths
   either way, so no data rollback is needed.
