# Implementation plan

## Architecture impact

- Database (Storage schema): migration 343 updates six rows of
  `storage.buckets` (`file_size_limit`, `allowed_mime_types`). No table,
  grant, policy or function changes; `public` is not written.
- FastAPI: new `backend/services/storage_limits.py` holds the limit table
  (same values as 343), `check_upload(bucket, size, content_type)` raising the
  413/415 `HTTPException`, `normalise_audio_content_type()` for Speaking, and
  `map_storage_error(bucket, exc)` that turns a Storage 413 / mime refusal into
  the same shapes. Upload sites call it: `routers/grading.py`,
  `routers/listening.py` (audio and manual map), `routers/admin_reading.py` →
  `services/reading_image.py`, `routers/admin_writing_prompts.py` →
  `services/writing_prompt_image.py`, `services/tts_audio.py`,
  `services/listening_renderer.py`, `services/listening_package_import.py`,
  `services/listening_source_package_import.py`; scripts only map the error.
- Frontend: unchanged. `frontend/public/js/api.js:234-238` already shows
  `detail.message` for object details.

## Data and contracts

- Final limit table: `spec.md` § Scope, derived in `research.md` (T001).
- New error bodies (FastAPI `detail`):
  - 413 `{"error_code":"file_too_large","max_bytes":<int>,"message":"…"}`
  - 415 `{"error_code":"unsupported_media_type","allowed":[…],"message":"…"}`
- Routes that return a plain-string 413 today (`grading.py:553`) switch to the
  object detail with the same Vietnamese text in `message`; `api.js` renders
  both. OpenAPI error schemas are documented; success schemas are unchanged.
- Speaking: the stored `content-type` may be normalised (for example
  `text/plain` → `audio/webm`); the extension already follows `_guess_ext`.

## Rollout and rollback

- Order: deploy the J133 backend (pre-checks and normalisation) to staging,
  then the Leader applies 343 under the advisory lock (`rollout.md`).
- Rollback: run the down script from the 343 header (restores `NULL`, `NULL`
  on staging). The backend checks can stay; they match today's code limits.

## Verification strategy

- `backend/tests/test_migration_343_storage_bucket_limits.py`: static
  contract (six ids, values equal to `storage_limits.py`, no `public` write,
  postcondition, down script present) and PostgreSQL against a
  `storage.buckets` fixture: apply, double apply, missing-bucket abort,
  postcondition failure, other buckets untouched.
- `backend/tests/test_storage_limits.py`: each upload path with oversize,
  wrong type and a stubbed Storage 413/mime refusal → 413/415 and no upload
  call; Speaking normalisation and "accepts every type the route accepted";
  largest census object sizes still pass.
- Staging (T003): postcheck query, AC 1–6 with synthetic files, real-browser
  Speaking submit, Staging E2E.
