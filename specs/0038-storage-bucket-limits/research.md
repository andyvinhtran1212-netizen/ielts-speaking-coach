# T001 research — staging Storage census (read-only)

- Environment: Supabase **staging** only, project ref `zjphffoujxkpltixsbzj`.
  Production was not read (T004, at promotion, needs Vinh's permission).
- Date: 2026-10-29 11:24:57Z and 11:26:23Z (18:24–18:26 UTC+7), job PC-J132 (`q-18g`).
- Method: one Management API `database/query` call with `"read_only": true`
  (aggregate SQL below) and one `GET /v1/projects/{ref}/config/storage`.
  Nothing was written and no object was downloaded. The query selects no
  object name or path (paths contain user ids). Request and raw result files:
  `/workspace/cc-jobs/job-q-18g-pc-j132-a-st-spec-0038.log.d/t001-census.json{,.result}`
  and `t001-storage-config.req{,.result}`.

```sql
WITH b AS (SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets),
o AS (SELECT bucket_id, count(*) AS n, max((metadata->>'size')::bigint) AS max_size,
             count(*) FILTER (WHERE metadata->>'size' IS NULL) AS n_no_size
      FROM storage.objects GROUP BY bucket_id),
m AS (SELECT bucket_id, jsonb_object_agg(coalesce(mt,'<null>'), n ORDER BY mt) AS mimes
      FROM (SELECT bucket_id, metadata->>'mimetype' AS mt, count(*) AS n
            FROM storage.objects GROUP BY 1,2) x GROUP BY bucket_id)
SELECT b.id, b.public, b.file_size_limit, b.allowed_mime_types,
       coalesce(o.n,0) AS n, o.max_size, o.n_no_size, m.mimes
FROM b LEFT JOIN o ON o.bucket_id=b.id LEFT JOIN m ON m.bucket_id=b.id
UNION ALL  -- objects whose bucket row is missing (none found)
SELECT '<orphan:'||o.bucket_id||'>', NULL, NULL, NULL, o.n, o.max_size, o.n_no_size, NULL
FROM o WHERE o.bucket_id NOT IN (SELECT id FROM b)
ORDER BY 1;
```

## Census result (staging, 2026-10-29)

| Bucket | `public` | `file_size_limit` now | `allowed_mime_types` now | Objects | Largest object (bytes) | Objects without `size` | Mimetypes (count) |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| `audio-responses` | false | NULL | NULL | 84 | 2 944 342 (2.8 MiB) | 0 | `audio/webm` 80, `audio/mp4` 4 |
| `listening-audio` | false | NULL | NULL | 4 676 | 31 138 002 (29.7 MiB) | 0 | `audio/mpeg` 3 726, `image/png` 555, `audio/wav` 319, `application/json` 70, `image/svg+xml` 6 |
| `listening-images` | false | NULL | NULL | 27 | 332 088 (0.32 MiB) | 0 | `image/png` 27 |
| `reading-images` | false | NULL | NULL | 7 | 739 379 (0.71 MiB) | 0 | `image/png` 7 |
| `vocab-audio` | **true** | NULL | NULL | 3 524 | 51 404 (50 KiB) | 0 | `audio/mpeg` 3 524 |
| `writing-images` | false | NULL | NULL | 19 | 98 403 (96 KiB) | 0 | `image/png` 19 |

- `storage.buckets` holds exactly these six buckets. **No other bucket exists
  on staging**, and no object references a missing bucket. Nothing to report
  to Leader under the "other bucket" rule.
- No object has a null `size`; no object has a null `mimetype`.
- No non-audio mimetype exists in `audio-responses` (no `video/webm`,
  `application/octet-stream`).
- Staging project-wide Storage limit (`config/storage` → `fileSizeLimit`):
  **52 428 800 bytes (50 MiB)**. Supabase enforces the smaller of the bucket
  limit and this global limit, so on staging any bucket limit above 50 MiB is
  effectively 50 MiB. See "Finding: global 50 MiB cap" below.

## Previous values for the 343 down script

On staging all six buckets have `file_size_limit = NULL` and
`allowed_mime_types = NULL` before 343. The down script therefore restores
`NULL, NULL` for each of the six ids and must not touch `public`.
Production values are unknown: T004 reads them at promotion before 343 is
applied there. If any production value is not NULL, T004 stops and the down
script is amended before the production apply.

## Code limits and types (origin/staging `756016558`)

| Bucket | Writers | Largest size the code allows | Types the code sends |
| --- | --- | --- | --- |
| `audio-responses` | `routers/grading.py:622` (learner Speaking submit); `scripts/migrate_legacy_audio_urls.py` (one-off legacy copy) | 50 MiB (`grading.py:95` `_MAX_BYTES = 50 * 1024 * 1024`, 413 at `:552`) | `audio_file.content_type or "audio/webm"` (`:626`). The route accepts **any** client content type, including parameters such as `audio/webm;codecs=opus`; `_guess_ext` (`:1434`) maps the known audio types to an extension and defaults to `.webm`. Legacy script: extension map `audio/webm, audio/mpeg, audio/mp4, audio/wav, audio/ogg, audio/flac`, else the source header or `application/octet-stream` (`migrate_legacy_audio_urls.py:104-111,162`) |
| `listening-audio` | `routers/listening.py:4289` (`audio/mpeg`); `services/listening_renderer.py:291` (`audio/mpeg`); `services/listening_package_import.py:1267` (`audio/wav` forms, `image/svg+xml` visuals ≤ 5 MiB, artifacts ≤ 32 MiB); `services/listening_source_package_import.py:649` (audio `.mp3/.wav/.m4a` ≤ 128 MiB, images `.png/.jpg/.jpeg/.webp` ≤ 10 MiB, transcript `.json` ≤ 20 MiB, type from `mimetypes.guess_type`); scripts `import_listening_lessons.py`, `import_skill_drills.py`, `import_course_exercise_bank.py`, `import_cambridge_canonical_qa.py:738` (`audio/mpeg`, no size cap) | 128 MiB (`listening_source_package_import.py:344`, `134_217_728`); full test 100 MiB (`listening_audio.py:55`); full-test pack 60 MiB (`listening.py:3004`) | `audio/mpeg`, `audio/wav`; from `guess_type` on Python 3.11/3.13: `audio/x-wav` (`.wav`), `audio/mp4` (`.m4a`), `image/png`, `image/jpeg`, `image/webp`, `application/json`; `image/svg+xml`. The host's `/etc/mime.types` can change the `guess_type` answer (for example `audio/wav` instead of `audio/x-wav`) |
| `listening-images` | `routers/listening.py:4848` (manual map, 5 MiB cap at `:4738`, magic-byte sniff); `scripts/repair_cam16_cam18_screening.py:394` (`image/png`, no cap) | 5 MiB (route); scripts uncapped | `image/png`, `image/jpeg`, `image/webp` |
| `reading-images` | `services/reading_image.py:184` (via `admin_reading.py`, 5 MiB at `:61`, magic-byte sniff); `scripts/import_cambridge_canonical_qa.py:752` (`image/png`, no cap) | 5 MiB (route); script uncapped | `image/png`, `image/jpeg`, `image/webp` |
| `writing-images` | `services/writing_prompt_image.py:115` (via `admin_writing_prompts.py`, 5 MiB at `:53`, magic-byte sniff) | 5 MiB | `image/png`, `image/jpeg`, `image/webp` |
| `vocab-audio` | `services/tts_audio.py:113` (TTS mp3); `scripts/migrate_legacy_audio_urls.py` (one-off; vocab paths are `.mp3`) | none | `audio/mpeg` |

## Final limit table (J133 / migration 343 uses exactly this)

Rule: limit = max(code limit, census max), at least the code limit; MIME =
code types ∪ census types. `public` is never changed.

| Bucket | `file_size_limit` (bytes) | `allowed_mime_types` | Basis |
| --- | ---: | --- | --- |
| `audio-responses` | 52 428 800 (50 MiB) | `audio/*`, `video/webm`, `video/mp4`, `application/octet-stream` | Code 50 MiB > census 2.8 MiB. `audio/*` covers every audio type and any parameter (`;codecs=opus`). The census found no non-audio type, but the route accepts any client type today, so the three known recorder/upload fallbacks stay allowed (protects the window between applying 343 and deploying normalisation) and J133 normalises every other non-audio type before upload (FR-005). |
| `listening-audio` | 134 217 728 (128 MiB) | `audio/*`, `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`, `application/json` | Code 128 MiB > census 29.7 MiB. `audio/*` instead of a list because `guess_type` returns host-dependent names (`audio/wav`/`audio/x-wav`, `audio/mp4`/`audio/x-m4a`). `application/octet-stream` (the source importer's `guess_type` fallback) is not allowed: every suffix the importer accepts has a built-in `guess_type` answer, so the fallback is unreachable today; J133 makes the importer fail clearly if it ever happens. |
| `listening-images` | 10 485 760 (10 MiB) | `image/png`, `image/jpeg`, `image/webp` | Route 5 MiB, census 0.32 MiB; 10 MiB headroom for the uncapped repair script, as approved. |
| `reading-images` | 5 242 880 (5 MiB) | `image/png`, `image/jpeg`, `image/webp` | Route 5 MiB > census 0.71 MiB. |
| `writing-images` | 5 242 880 (5 MiB) | `image/png`, `image/jpeg`, `image/webp` | Route 5 MiB > census 96 KiB. Stays `public = false` (#1760). |
| `vocab-audio` | 5 242 880 (5 MiB) | `audio/mpeg` | No code cap; census 50 KiB × 2 = 100 KiB, raised to the 5 MiB floor. Stays `public = true`. |

## Finding: global 50 MiB cap (report to Leader)

Staging's project-wide limit is 50 MiB. The code already allows larger
Listening objects (128 MiB source audio, 100 MiB full test, 60 MiB pack), and
those uploads are already refused by Storage on staging today; 343 does not
change that (the bucket limit is higher, the effective limit stays 50 MiB).
The largest staging object is 29.7 MiB, so nothing current is near the cap.
Raising the project-wide limit is out of scope for 0038 (plan-level setting,
owner decision). Production's project-wide limit was not read (prod is out of
scope for this job); T004 reads it at promotion.

## Notes for J133

- Supabase matches `allowed_mime_types` on `type/subtype`; whether it strips
  parameters (`audio/webm;codecs=opus`) before an exact match is not verified
  here. `audio/*` makes the Speaking case safe either way; AC 6 (real browser
  recording on staging) confirms it.
- Image routes keep their magic-byte sniff: `allowed_mime_types` is the
  client-declared header, not proof of content.
