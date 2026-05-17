# Sprint 11.1 — Listening Data Model + Admin Upload + ElevenLabs Scaffold

## Context

First implementation sprint of the DEBT-LISTENING-MODULE cluster. Sprint 11.0 discovery delivered: data model V2, license whitelist, ElevenLabs cost projection + voice catalog, UX wireframes for 5 modes, audio player scope.

**Mandatory reading before starting:**
- `docs/sprint-11-0-listening-discovery.md` (the discovery doc — this prompt assumes you've internalised §1 audit findings, §5 data model V2 schema, §3 ElevenLabs integration plan).
- Foundation proposal: `LISTENING_MODULE_PROPOSAL_2026-05-16.md`.

This sprint ships **schema + admin tooling**, no user-facing routes yet. Mirrors Sprint 10.5 Phase 1 pattern: ship the data layer first, verify quality in DB, then flip user surface in 11.2.

## Andy's Decisions (from Sprint 11.0 discovery review — TBD lock these)

| # | Decision | Status |
|---|---|---|
| Q1 | ElevenLabs API key provisioned? | **BLOCKER — verify before sprint start.** If not, ship MP3 upload path only; gate ElevenLabs render endpoint behind a feature flag (`LISTENING_AI_RENDER_ENABLED=false` default). |
| Q2 | Bucket policy: private (signed URLs) | **Discovery recommended** (§2A option L2). Confirm. |
| Q3 | Premium tier flag default | `is_premium BOOLEAN DEFAULT FALSE` — discovery recommended free tier default. Confirm. |
| Q4 | Voice picks for sample render (Sprint 11.0 deferred) | After Andy hears the 3 samples (deferred), lock final voice IDs in `backend/config.py` constants. |

## Scope

### Backend

#### 1. Migration 056 — listening foundation schema

`backend/migrations/056_listening_module_foundation.sql`:

Copy verbatim from discovery doc §5A (4 tables: `listening_content`, `listening_exercises`, `listening_attempts`, `listening_sessions`). Verify:

- Foreign keys reference `users(id)` (project convention per `.claude/skills/db-migrate/SKILL.md`), NOT `auth.users(id)`.
- RLS enabled on attempts + sessions (user-owned tables); listening_content + listening_exercises NOT RLS (content is admin-curated, readable by all authenticated users via the user-scoped client).
- `IF NOT EXISTS` everywhere — idempotent.
- Indexes:
  - `listening_content (status, ielts_section)` — session endpoint filter
  - `listening_content (accent_tag)` — accent-variety queries
  - `listening_content USING GIN (topic_tags)` — topic search
  - `listening_exercises (content_id)` — JOIN to content
  - `listening_exercises (exercise_type, status)` — per-mode list
  - `listening_attempts (user_id, created_at DESC)` — analytics aggregator
  - `listening_attempts (listening_session_id) WHERE listening_session_id IS NOT NULL`
  - `listening_sessions (user_id, created_at DESC)`

#### 2. Storage bucket creation

**Note:** Supabase bucket creation lives in the dashboard, NOT in a migration. Add a migration comment block reminding the operator:

```sql
-- Sprint 11.1 operator step (NOT automated):
-- 1. Supabase dashboard → Storage → New bucket
-- 2. Name: 'listening-audio'
-- 3. Public bucket: NO (private — signed URLs only per Sprint 11.0 §2A.L2)
-- 4. RLS policy: SELECT for authenticated users only
```

If the operator forgets, the upload endpoint logs a clear error (mirror `grading.py:240-250` pattern):
```python
except StorageException as e:
    logger.error(
        "[listening] Supabase Storage bucket 'listening-audio' not found. "
        "Create it in the Supabase dashboard (Storage → New bucket, Private) "
        "and add SELECT policy for authenticated users."
    )
    raise HTTPException(503, "Listening audio storage not configured.")
```

#### 3. Router scaffold — `backend/routers/listening.py`

NEW file. Follows the Sprint 10.x convention.

**Imports + prefix:**
```python
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, UploadFile, File
# ... etc, mirror routers/vocabulary_bank.py boilerplate

user_router = APIRouter(prefix="/api/listening", tags=["listening"])
admin_router = APIRouter(prefix="/admin/listening", tags=["listening-admin"])
```

**User-facing routes (Sprint 11.1 ships 1 read-only route; full attempt routes land in 11.2+):**

```python
@user_router.get("/content/{content_id}")
async def get_listening_content(content_id: str, authorization: str | None = Header(default=None)):
    """Fetch a single listening_content row + signed URL to the audio.
    Used by the audio player (Sprint 11.2) to load both metadata and
    the playable URL in one round-trip."""
    user = await _require_auth(authorization)
    sb = _user_sb(_bearer_token(authorization))
    # SELECT the row (RLS-free table — all authenticated users can read
    # published content). Filter status='published' so drafts stay
    # admin-only.
    res = sb.table("listening_content") \
        .select("*") \
        .eq("id", content_id) \
        .eq("status", "published") \
        .limit(1) \
        .execute()
    if not res.data:
        raise HTTPException(404, "Listening content not found or not published")
    row = res.data[0]
    # Generate a signed URL (3600s TTL, Supabase default).
    signed = supabase_admin.storage.from_("listening-audio") \
        .create_signed_url(row["audio_storage_path"], 3600)
    row["audio_signed_url"] = signed.get("signedURL")
    row["audio_signed_url_expires_at"] = signed.get("expires_at")
    return row
```

**Admin-facing routes — Sprint 11.1 ships TWO:**

##### 3a. POST /admin/listening/upload (MP3 upload path)

```python
@admin_router.post("/upload")
async def admin_upload_listening(
    title: str,
    transcript: str,
    accent_tag: str,
    cefr_level: str,
    ielts_section: int,
    audio_file: UploadFile = File(...),
    external_license: str | None = None,
    external_source_url: str | None = None,
    topic_tags: str | None = None,  # comma-separated
    is_premium: bool = False,
    authorization: str | None = Header(default=None),
):
    """Admin uploads an MP3 + transcript + metadata. Source = upload_mp3
    OR curated_external (decided by whether external_license is set)."""
    await require_admin(authorization)

    # License-required-field validation (Sprint 11.0 §4 + §5C):
    # If external_license is set, external_source_url MUST also be set.
    if external_license and not external_source_url:
        raise HTTPException(422, "external_source_url required when external_license is set")
    source_type = "curated_external" if external_license else "upload_mp3"

    # Premium + NC license collision (Sprint 11.0 §8 row):
    if is_premium and external_license and "NC" in external_license:
        raise HTTPException(
            422,
            "Cannot mark NC-licensed content as premium — non-commercial restriction "
            "incompatible with paid tier.",
        )

    # ... upload to bucket, INSERT row with status='draft' ...
```

##### 3b. POST /admin/listening/render (ElevenLabs render — feature-flag gated)

```python
@admin_router.post("/render")
async def admin_render_listening(
    body: ListeningRenderRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """Schedule a BackgroundTask that calls ElevenLabs API → uploads
    the MP3 → inserts the listening_content row with status='draft'.
    Returns immediately with a job_id; the admin polls /admin/listening/
    content?status=draft to see the result."""
    await require_admin(authorization)

    if not settings.LISTENING_AI_RENDER_ENABLED:
        raise HTTPException(503, "ElevenLabs render endpoint not yet enabled. "
                             "Set LISTENING_AI_RENDER_ENABLED=true after provisioning "
                             "ELEVENLABS_API_KEY.")
    if not settings.ELEVENLABS_API_KEY:
        raise HTTPException(503, "ELEVENLABS_API_KEY not configured.")

    job_id = str(uuid.uuid4())
    background_tasks.add_task(
        _run_elevenlabs_render,
        job_id=job_id,
        script_text=body.script_text,
        voice_id=body.voice_id,
        model=body.model,
        # ... etc
    )
    return {"job_id": job_id, "status": "queued"}
```

The BG task helper `_run_elevenlabs_render` lives in a new `services/listening_renderer.py`:

```python
# services/listening_renderer.py
def render_via_elevenlabs(script_text: str, voice_id: str, model: str) -> bytes:
    """Sync. Calls ElevenLabs HTTP API directly (don't pull in the
    Python SDK — keeps dependency surface minimal). Returns the MP3
    bytes. Raises on API failure."""
    import requests
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": settings.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": script_text,
        "model_id": model,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.5},
    }
    r = requests.post(url, headers=headers, json=payload, timeout=120)
    r.raise_for_status()
    return r.content
```

Wrap the call in `services.d1_question_generator._call_with_retry` pattern (Sprint 10.7) so transient 5xx + 429 → retried with backoff. Reuse the helper — it's general enough.

#### 4. Config

`backend/config.py`:
```python
ELEVENLABS_API_KEY: str = ""
LISTENING_AI_RENDER_ENABLED: bool = False  # flip true after key provisioned
LISTENING_AUDIO_BUCKET: str = "listening-audio"
```

`backend/.env.example`:
```
# Sprint 11.1 — Listening module
ELEVENLABS_API_KEY=
LISTENING_AI_RENDER_ENABLED=false
LISTENING_AUDIO_BUCKET=listening-audio
```

#### 5. Wire to main.py

```python
from routers import listening as listening_router_module
app.include_router(listening_router_module.user_router)
app.include_router(listening_router_module.admin_router)
```

### Frontend

#### 6. Chrome nav slot — `frontend/js/components/aver-chrome.js`

```javascript
// Line 55
const VALID_ACTIVE = ['home', 'writing', 'speaking', 'grammar', 'vocabulary', 'listening'];

// Lines 312-315 (add line)
<a href="/pages/writing-dashboard.html" data-tab="writing">Writing</a>
<a href="/pages/speaking.html" data-tab="speaking">Speaking</a>
<a href="/pages/listening.html" data-tab="listening">Listening</a>  // NEW — order: between speaking and grammar
<a href="/grammar.html" data-tab="grammar">Grammar</a>
<a href="/pages/vocabulary.html" data-tab="vocabulary">Vocabulary</a>
```

#### 7. Page shell — `frontend/pages/listening.html`

Mirror `frontend/pages/vocabulary.html` structure. 5 `.mode-card` tiles for the 5 modes (dictation, gist, true-false, mcq, mini-test). Each card disabled (greyed out + "Coming soon" label) for Sprint 11.1 since the user-facing routes land in 11.2+. ONE exception: a "Browse content" admin-only link if `user.role === 'admin'` (matches existing admin gating).

Sprint 11.1 frontend is intentionally minimal — proof the chrome integration works, not user-facing functionality.

#### 8. No new audio player yet (Sprint 11.2 builds it)

#### 9. Admin upload UI — DEFER to Sprint 11.1.x or 11.2

Admin can hit the API directly via Postman / curl for Sprint 11.1 dogfood. A proper admin UI is a separate sprint chunk.

### Tests

#### 10. Backend

- `tests/test_listening_router.py` (NEW):
  - GET /api/listening/content/{id} happy path (published row returned with signed URL)
  - GET 404 for draft row
  - GET 404 for non-existent ID
  - POST /admin/listening/upload happy path (MP3 upload → bucket → row INSERT with `source_type='upload_mp3'`)
  - POST /admin/listening/upload with `external_license` → row INSERT with `source_type='curated_external'`
  - POST /admin/listening/upload `is_premium=true + NC license` → 422
  - POST /admin/listening/render with `LISTENING_AI_RENDER_ENABLED=false` → 503
  - POST /admin/listening/render with key set + BackgroundTask scheduled
  - Auth: all admin routes 403 for non-admin user

- `tests/test_listening_renderer.py` (NEW):
  - `render_via_elevenlabs` happy path (mocked HTTP 200 with MP3 bytes)
  - Retry on 5xx (reuses Sprint 10.7 `_call_with_retry` test pattern)
  - 4xx propagates (don't retry)

#### 11. Frontend

- `tests/chrome-unification-canonical.test.mjs` — extend the existing roster pin to 6 entries (add 'listening')
- `tests/listening-page-shell.test.mjs` (NEW) — sentinel: 5 mode cards present, "Coming soon" badges visible, page imports + mounts cleanly

## Audit Gates

- **Gate 1 (regression):** Sprint 11.1 adds tables + routes but doesn't change Speaking/Writing/Vocabulary/Grammar. Run `pytest` full suite + `node --test` full frontend.
- **Gate 2 (test parity):** +15-20 new tests (10 backend + 5 frontend).
- **Gate 3 (drift):** Audio bucket name + voice IDs in config constants, not magic strings.
- **Gate 9 (commit msg):** Reference Sprint 11.0 discovery doc + DEBT-LISTENING-MODULE foundation.
- **Gate 9.5 (test alignment):** When extending the chrome-unification sentinel, also update any other test that pins the 5-skill roster — search `'home', 'writing', 'speaking', 'grammar', 'vocabulary'` substring before pushing.
- **Gate 9.6 (mock builder):** Storage SDK mocks — verify the Supabase mock builder pattern (Sprint 10.4) supports `.storage.from_(bucket).upload(...)` + `.create_signed_url(...)`. If not, extend it.
- **Gate 9.7 (RLS):** `listening_attempts` + `listening_sessions` MUST have RLS USING `auth.uid() = user_id`. `listening_content` + `listening_exercises` MUST NOT have RLS (admin-curated, all-authenticated readable). Add an integration test (skipped without test users) confirming cross-user attempt isolation, same pattern as `test_rls_vocab_integration.py`.
- **Gate 10 (changelog):** PHASE_CLOSURE_LEDGER row Sprint 11.1.
- **Gate 11 (debt):** DEBT-LISTENING-MODULE foundation 1/5 complete.

## Spec Falsifications to Watch For

- **Bucket creation cannot be automated via migration.** Operator step required (mirror `audio-responses` from Speaking).
- **ElevenLabs key may not be provisioned at sprint start.** Ship the render endpoint behind the feature flag so the rest of the sprint isn't blocked. The MP3 upload path covers all needed dogfood until the key lands.
- **Don't pull in the ElevenLabs Python SDK.** The HTTP API is 5 lines of `requests.post`; SDK adds dependency surface for ~0 value. Reuse `_call_with_retry` from Sprint 10.7 — it's general.
- **Discovery §5C says no auto-capture from listening transcripts.** Sprint 11.1 doesn't wire transcript click-to-capture either; that's Sprint 11.3+.

## Verification Steps

### Local pre-push

```bash
cd backend && python3 -m pytest tests/test_listening_router.py tests/test_listening_renderer.py -v
cd backend && python3 -m pytest  # full suite
cd frontend && node --test 'tests/**/*.test.mjs' 'tests/**/*.test.js'
```

### Post-deploy smoke

1. Migration 056 applied (verify in Supabase dashboard: 4 new tables exist).
2. Bucket `listening-audio` created manually (Sprint 11.1 operator step).
3. Chrome nav shows Listening tab on `/pages/home.html`.
4. `/pages/listening.html` loads with 5 "Coming soon" mode cards.
5. Admin curl: upload an MP3 via `POST /admin/listening/upload` → row INSERT verified in DB.
6. If `ELEVENLABS_API_KEY` provisioned + flag flipped: admin curl `POST /admin/listening/render` → BG task fires, audio file appears in bucket, row INSERT verified.

## PR Commit Message

```
feat(listening): foundation schema + admin scaffold (Sprint 11.1)

DEBT-LISTENING-MODULE foundation 1/5. First implementation sprint
after Sprint 11.0 discovery.

Ships:
- Migration 056 — 4 tables (listening_content, _exercises, _attempts,
  _sessions) with RLS on user-owned tables, GIN index for topic_tags
- New router routers/listening.py — 1 user read route + 2 admin
  routes (MP3 upload + ElevenLabs render behind feature flag)
- New service services/listening_renderer.py — ElevenLabs HTTP call
  wrapped in Sprint 10.7 _call_with_retry helper
- Chrome nav slot — listening as 6th tab in aver-chrome.js
- frontend/pages/listening.html shell with 5 "Coming soon" cards
- 15+ new tests (10 backend + 5 frontend sentinels)

User-facing exercise routes deferred to Sprint 11.2 (dictation first).

Ref: docs/sprint-11-0-listening-discovery.md
Foundation proposal: LISTENING_MODULE_PROPOSAL_2026-05-16.md
```

## Resumption Checklist Next Session

```
1. Verify PR Sprint 11.1:
   - CI green (backend + frontend + Vercel preview)
   - Migration 056 applied to Supabase production
   - Bucket 'listening-audio' created
   - Smoke checks 1-5 pass
   - If ElevenLabs key ready: check 6 also passes

2. Sprint 11.2 — Dictation + audio player component
   - NEW <audio-player> component (~150 LOC, vanilla audio + controls)
   - POST /api/listening/dictation/attempt route
   - Dictation page shell (replaces "Coming soon" on the dictation card)
   - First user-facing route in the cluster

3. OR if ElevenLabs samples not yet generated (Sprint 11.0 deferred):
   - Andy provisions Creator plan
   - Code writes the one-shot scripts/sample_listening_audio.py
   - 3 samples rendered to /tmp/listening_samples/
   - Andy reviews + picks default voices
   - Voice IDs locked in backend/config.py
```

## Notes for Claude Code

- **Discovery doc is canonical.** When in doubt, re-read `docs/sprint-11-0-listening-discovery.md` §5 (data model) — the schema in §5A is migration-ready. Don't reinvent.
- **Storage bucket: private + signed URLs.** This is intentional (license respect — see §2A.L2 + §4). Don't switch to public to "simplify".
- **Audio player NOT in this sprint.** Just the page shell + chrome nav.
- **ElevenLabs render endpoint: feature-flag gated.** If `ELEVENLABS_API_KEY` is missing, the sprint must still ship — the flag stays `false` and only MP3 upload works.
- **License compliance hardening lives in this sprint** — the `is_premium + NC` collision check is non-negotiable per §4E.
- **Estimate: ~1 session** (4-6h focused work).
