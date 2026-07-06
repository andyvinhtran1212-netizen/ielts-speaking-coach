# Writing Task 1 image re-homing (legacy Supabase project)

## Problem

`docs/SUPABASE_REGION_MIGRATION.md` moved the database to the current Singapore
project (`huwsmtubwulikhlmcirx`), but the **writing Task 1 image URLs were never
rewritten**. Every `writing_prompts.prompt_image_url` and
`writing_essays.prompt_image_url` still points at the **old** project's public
storage:

```
https://nqhrtqspznepmveyurzm.supabase.co/storage/v1/object/public/writing-images/prompts/…
```

The old project is still serving most of these images, so the app *looks* fine —
but this is decommissioned debt. **The day the old project is deleted, every
Task 1 chart 404s.** It already bit us once: essay `24aca131` was graded
text-only because its single legacy chart object had been lost from the old
bucket (a prompt-image replace deleted it), and the admin grade page showed no
chart.

Snapshot at time of writing (dry run):

| Scope | Count |
|-------|-------|
| Prompts with an image | 11 (9 legacy: 8 old-project + 1 Cloudinary, 2 already current) |
| Essays with an image (snapshots) | 109 (all legacy) |
| **Distinct legacy image objects** | **9** |
| Broken (unrecoverable) sources | 0 |

Many essays share one prompt chart, so only **9 distinct objects** need copying.

## Related code fixes (already shipped in this branch)

These reduce the blast radius but do **not** remove the debt:

- **Fallback resolver** — `essay_service.current_prompt_image_for_essay()` lets
  the grade page and the grader recover a stale essay snapshot from the source
  prompt's current image (`prompt_image_url_fallback`). Covers essays whose
  prompt link still exists.
- **Queue badge** — `task1_image_missing` flags essays graded without their
  chart so they can be re-graded.

The migration below is the actual fix: it re-homes the images onto the current
project and rewrites the URLs so the old project can be safely deleted.

## How the migration works

`backend/scripts/migrate_writing_images.py`:

1. Enumerates every prompt/essay row carrying an image URL.
2. Collects the **distinct** URLs whose host is not the current project.
3. **Downloads** each via its old-project **public** URL — so **no old-project
   credentials are needed**.
4. **Uploads** the bytes to the current project's `writing-images` bucket via
   `services.writing_prompt_image.upload_prompt_image` (same validation/path
   convention as a normal admin upload).
5. **Rewrites** the DB: `writing_prompts.prompt_image_url` +
   `prompt_image_public_id`, and `writing_essays.prompt_image_url` snapshots.

Properties:

- **Dry run by default.** Prints a plan and probes every source; writes nothing.
- **Idempotent.** URLs already on the current host are skipped — a re-run after
  a partial pass only finishes the remainder.
- **De-duped.** Each distinct chart is copied once, even if 50 essays share it.
- **Broken-safe.** A source that doesn't return a valid image (HTTP != 200 or
  non-image payload) is reported and left untouched — it needs an admin
  re-upload, not a copy.

## Running it

```bash
cd backend

# 1. Dry run — see exactly what would be copied/rewritten (read-only).
python -m scripts.migrate_writing_images

# 2. Execute — copy objects + rewrite DB URLs.
python -m scripts.migrate_writing_images --execute
```

Requires the **current** project's `SUPABASE_URL` + service-role key in the
environment (already in `backend/.env`). The `writing-images` bucket must exist
and be **public** on the current project (a one-time deploy precondition — see
`SUPABASE_REGION_MIGRATION.md` §6.1).

## Verification after `--execute`

```bash
# Re-run dry mode — should report 0 distinct legacy URLs remaining.
python -m scripts.migrate_writing_images
```

Then spot-check a grade page: open a Task 1 Academic essay in
`pages/admin/writing/grade.html` and confirm the chart loads from the current
host. Any essay still flagged `task1_image_missing` in the queue can be
re-graded (the fallback + fresh image now make it multimodal again).

## Post-migration

Once the dry run reports **0 legacy URLs** and buckets are verified, the old
project (`nqhrtqspznepmveyurzm`) can be decommissioned per
`SUPABASE_REGION_MIGRATION.md`. Until then it must stay alive.
