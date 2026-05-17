# Sprint 11.0 — Listening Module Discovery

**Date:** 2026-05-17
**Status:** Discovery complete, ready for Andy review.
**Cluster:** DEBT-LISTENING-MODULE (new, opens with this sprint).
**Foundation proposal:** `LISTENING_MODULE_PROPOSAL_2026-05-16.md` (Andy-authored, referenced throughout).

This sprint produces documentation + a deferred prototype (ElevenLabs sample generation gated on key provisioning). NO production code shipped except the ledger update.

---

## TL;DR — what changed during discovery

1. **No backend routes / no schema changes / no frontend code changes** in this PR. Doc-only.
2. **ElevenLabs sample generation deferred** — Andy has not provisioned the Creator plan yet (no `ELEVENLABS_API_KEY` in `backend/.env` or `.env.example`). Section 3 ships the cost projection + voice catalog research; the 3 sample renders are gated behind a one-shot prototype script that fires only after Andy adds the key. Detailed in §3A.
3. **Three big dividends from auditing existing patterns** (Sprint 10.0-style shortcuts):
   - **Chrome nav slot:** adding "Listening" as a 5th `data-tab` is a 2-line diff to `aver-chrome.js` (the component already drives the active-state logic — Sprint 6.17 / 10.x pattern). No new component, no new CSS bucket.
   - **Storage pattern reusable:** `supabase_admin.storage.from_("audio-responses").upload(...)` from `routers/grading.py:230` is the canonical upload site. Listening just needs a new bucket (`listening-audio`) with the same pattern — RLS policy + upload helper + signed-URL fetch all already battle-tested by Speaking captures.
   - **BackgroundTasks pattern proven:** 4 routers already use FastAPI `BackgroundTasks` (Sprint 10.4 pending confirm, Sprint 10.5 D1 generation). ElevenLabs TTS render fits the same shape — admin uploads a script, BackgroundTask renders the MP3 post-response.
4. **Audio player component does NOT exist** (confirmed by `grep -rln "<audio\b" frontend/js/components/` = 0 hits). Sprint 11.2 builds this. Vanilla `<audio>` element + thin JS wrapper, no external lib needed. Detailed in §6A wireframe.
5. **Schema additions match proposal § 2.2 with 5 refinements:** `transcript_segments` JSONB granularity, `accent_tag`, `topic_tags[]`, `audio_play_completed`, `attention_loss_events` (per §5).

---

## 1. Production Architecture Audit

Code inspected the codebase to identify integration points. Findings below.

### 1A. Routing + page registration

**Existing pattern (Sprint 6.17 chrome unification, Sprint 8.2 hash routing):**
- Page files live at `frontend/pages/*.html`. The single canonical chrome is `<aver-chrome active="..."></aver-chrome>` (Web Component) emitted near `<body>` start.
- `frontend/js/components/aver-chrome.js`:
  - Line 55: `VALID_ACTIVE = ['home', 'writing', 'speaking', 'grammar', 'vocabulary']`
  - Lines 312-315: nav `<a>` tags rendered in shadow DOM template.
  - Adding Listening = (a) extend the array to 6 entries, (b) add the `<a href="/pages/listening.html" data-tab="listening">Listening</a>` line, (c) update the canonical-chrome sentinel test that asserts the link roster.

**Sub-mode routing (Sprint 8.1 Speaking):**
- Speaking exposes Part 1 / Part 2 / Part 3 / Full Test via `?part=1` query params on `practice.html`.
- Vocabulary (Sprint 8.2) uses hash routing — `vocabulary.html#my-vocab`, `#flashcards`, `#exercises`, `#needs-review`, `#topic-bank`. Five children land on the same shell page, lazy-imported per tab.

**For Listening, Code recommends:** hash routing (matches Vocabulary pattern, supports 5 children — dictation / gist / true-false / mcq / mini-test). Single shell `listening.html` with `vocab-landing.js`-style TAB_LOADERS registry.

**Integration points for Sprint 11.1:**
| What | File | Change |
|---|---|---|
| Chrome nav tab | `frontend/js/components/aver-chrome.js` | +2 lines (array + template) |
| Page shell | `frontend/pages/listening.html` | NEW |
| Tab loader | `frontend/js/listening-landing.js` | NEW (mirror `vocab-landing.js`) |
| Sentinel test | `frontend/tests/chrome-unification-canonical.test.mjs` | +1 page in roster |

### 1B. Auth + session ownership

**Existing pattern (every user-facing endpoint):**
```python
async def some_route(authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)  # raises 401 if no/bad token
    user_id = user["id"]
    token = _bearer_token(authorization)
    sb = _user_sb(token)  # Supabase client bound to user JWT → RLS enforces ownership
    # ... DB queries via sb.table(...).select(...) ...
```

- RLS policies on every table USING `auth.uid() = user_id` are the canonical user-scope guard (migration 019 `user_vocabulary` is the reference).
- Sprint 10.4 introduced `BackgroundTasks` + service-role admin client for trusted writes (`from database import supabase_admin`) — used for AI-generated rows that the user JWT can't write directly.

**Listening attempts table** (`listening_attempts`) must enable RLS with the same USING + WITH CHECK pattern. Background AI rendering (ElevenLabs) uses `supabase_admin` to upload audio + INSERT the `listening_content` row, same as Sprint 10.5 D1 question generation in `vocabulary_bank.py:_run_d1_generation_for_vocab`.

**No new auth code needed.** Reuse `_require_auth` + `_user_sb` + `supabase_admin` per existing pattern.

### 1C. Design tokens + components

**Available primitives** (Sprint 6.x → 9.x stabilised in `frontend/css/aver-design/components.css`):

| Primitive | Sprint | Usable for Listening |
|---|---|---|
| `.mode-card` | 6.10.1 | YES — landing page mode picker |
| `.subpage-header` + `.subpage-header__back` | 9.1 | YES — per-mode header with back-link |
| `.mode-card__badge` | 9.3 | YES — "NEW" / "BETA" / accent badges |
| `.vocab-action`, `.vocab-action--source` | 9.3 | reuse generic action button family |
| `--av-surface-card`, `--av-surface-sunken`, `--av-border-default`, `--av-text-*` | 4.x | YES — token-bound everything |
| `.flashToast` toast primitive | 10.2.1 | YES — submit feedback |

**Audio player — does NOT exist.** Confirmed by `grep -rln "<audio\b" frontend/js/components/` (zero hits). Sprint 11.2 must design this. Recommendation: vanilla `<audio>` element + thin JS wrapper (~150 LOC), no external library. Browser-native `play()` / `pause()` / `currentTime` / `playbackRate` cover the spec; bespoke control bar with Tailwind tokens for design parity.

**Light + dark mode contrast verification** (Sprint 10.4.1 lesson):
- Every new surface must be visually verified in both themes. The CI token-discipline gate only checks "uses tokens, not literals" — it doesn't catch "tokens resolve to readable parent/child pairs in light mode" (the 10.4.1 bug: `.pending-panel` + `.pending-card` both resolving to `#FFFFFF` in light theme).
- Sprint 11.2 audio player must pin `--av-surface-sunken` for the player background and `--av-surface-card` for any control popovers — different greys in light, different navys in dark.

### 1D. Backend conventions

**FastAPI router structure** (post Sprint 10.x):
- Each domain has its own router in `backend/routers/<domain>.py` with `router = APIRouter(prefix="/api/<domain>", tags=["<domain>"])`.
- Admin-scoped routes use a sibling `admin_router = APIRouter(prefix="/admin/<domain>")` with `require_admin` dependency (see `routers/exercises.py`).
- For Listening, create `routers/listening.py` (user-facing) + admin routes can live in the same file (Sprint 8.x precedent) — split only if it grows past ~600 LOC.

**Background tasks** (Sprint 10.4 + 10.5 pattern):
```python
@router.post("/some-route")
async def handler(body, background_tasks: BackgroundTasks, authorization):
    # synchronous primary write
    sb.table("...").insert({...}).execute()
    # fire-and-forget AI work post-response
    background_tasks.add_task(_run_some_ai_job, some_id)
    return {"ok": True}
```
- The runner is synchronous (Sprint 10.7 falsification 44 — sync ElevenLabs SDK is the right fit).
- Errors inside background tasks must be fail-soft: log a WARN, return early. Never raise upward.

**Mock builder for tests** (Sprint 10.4 `_Builder`, Sprint 10.5/10.7 evolutions):
- The mock chain supports `.eq()`, `.neq()`, `.lt()`, `.in_()`, `.update().eq().execute()`, `.upsert(on_conflict=...)`, `.insert()`. Reusable for Listening tests.
- New shapes for Listening: `.range()` (paginated audio list?), `.contains()` (topic_tags array containment?). Add to the mock builder only when a route actually uses them — don't pre-extend.

### 1E. Frontend test patterns

**Established style** (Sprint 7.x → 10.x):
- `node --test 'tests/**/*.test.mjs'`. No JSDOM. Sentinel-string match against module source files.
- Naming: `<feature>.test.mjs` for a single surface, `<surface>-<concern>.test.mjs` for a contract pin (e.g. `vocab-source-link.test.mjs`).
- Each test reads the relevant source file with `readFileSync(...)` then asserts via regex / substring.
- This pattern's strength: catches drift (open-coded duplicate of a shared helper) without needing DOM. Weakness: can't catch runtime errors — Vercel preview smoke covers that.

**Listening sentinels to land in Sprint 11.2-11.5:**
- audio-player component contract (export shape, event API)
- 5-mode roster pin in `listening-landing.js`
- chrome nav 5-skill roster pin (extend existing test)
- per-mode card layout sentinels (matches `pending-vocab.test.mjs` + `vocab-source-link.test.mjs`)

---

## 2. Storage Architecture + Cost Projection

### 2A. Bucket configuration

**Existing audio bucket:** `audio-responses` (created via Supabase dashboard, Public bucket per Sprint 6.x speaking flow). Reads via `get_public_url()`. The bucket is **public** because the response audio replays in the result page need to load without per-request signing (CDN-cacheable).

**For Listening:** new bucket `listening-audio`. Two options:

**Option L1 — Public bucket (mirrors `audio-responses`):**
- Pros: simple, CDN-cacheable, no signing overhead.
- Cons: any URL leak = anyone can fetch the audio. For premium licensed content (TED Talks, BBC) this is the wrong choice — license requires not redistributing freely.

**Option L2 — Private bucket + signed URLs:**
- Pros: license-friendly, audit-trail-friendly.
- Cons: signed URLs have a TTL (Supabase default 3600s = 1h); the player must re-fetch fresh URLs on long sessions. Adds latency on each play.

**Code recommends L2 (private + signed URLs).** Justification: §4 (license audit) shows BBC + TED content is CC-licensed but with attribution and non-commercial restrictions — keeping the bucket private respects the spirit of these licenses. AI-generated audio (ElevenLabs) and uploaded MP3s are 100% ours and can go in the same bucket (license differentiation handled at the row level via `external_license` column — not at bucket level).

Signed-URL TTL recommendation: 1 hour (Supabase default). Sprint 11.2 audio player refreshes the URL if the user opens the page after the TTL expires.

### 2B. Cost projection

Per-file sizes from proposal §4.1, validated against ElevenLabs MP3 output (128 kbps mono, ~1 MB/min):

| Asset type | Duration | Size | Source mix |
|---|---|---|---|
| Skill exercise (dictation) | ~10s | ~150 KB | AI (mostly), curated short clips |
| Skill exercise (gist/MCQ) | ~30-60s | ~500 KB-1 MB | AI + curated |
| Mini test section | ~3-7 min | ~3-7 MB | AI for now, curated later |
| Mini test (4 sections) | ~30 min | ~30 MB | mixed |

**Bandwidth model at 500 active users:**
- Avg user: 10 sessions/month × ~10 MB/session = 100 MB/user/month egress
- Total: 500 × 100 MB = **50 GB egress/month**

**Storage model (cumulative):**
- 500 mini tests over 6 months × 30 MB = 15 GB (one-time cost, audio lives forever)
- 2000 skill exercises × 1 MB = 2 GB
- Total: **~17 GB storage** at year 1

**Supabase Pro plan (2026 pricing):**
- $25/month base, includes 100 GB storage + 250 GB egress.
- 50 GB egress + 17 GB storage well within the free tier of the paid plan.
- **Net storage cost: $0 incremental** (Pro plan already paid for; Listening fits inside the existing allocation).

### 2C. CDN consideration

Supabase Storage has built-in Cloudflare CDN for public buckets only. Private buckets (Code's L2 recommendation) bypass the CDN and fetch from the origin directly. For Sprint 11.x this is fine (latency: ~200-300ms first byte from us-east). If Andy adds large international traffic in Phase B, reconsider — Sprint 11.6+ polish item.

**Defer:** dedicated Cloudflare R2 + Worker layer ($5/month for 10M requests). Trigger to revisit: monthly egress > 100 GB OR P50 audio load latency > 500ms in production telemetry.

---

## 3. ElevenLabs Integration Audit (RESEARCH-ONLY — sample generation DEFERRED)

### 3A. Account setup — BLOCKER

**Status as of 2026-05-17:** Andy has NOT provisioned an ElevenLabs Creator plan. Verified by:

```
$ grep -c "ELEVENLABS\|ELEVEN_LABS\|eleven" backend/.env backend/.env.example
backend/.env: 0
backend/.env.example: 0
```

**Action required from Andy:** Sign up at https://elevenlabs.io/, subscribe to the Creator plan ($22/month — 100K credits/month, ~250K chars at standard quality, ~50K chars at Multilingual v2), then add `ELEVENLABS_API_KEY=sk_...` to `backend/.env` AND `backend/.env.example` (placeholder).

**Sample generation prototype:** a one-shot script `backend/scripts/sample_listening_audio.py` is **NOT** committed in this PR. Once Andy provisions the key, Code will write the script in a follow-up step (or as part of Sprint 11.1) to generate the 3 samples described below.

### 3B. Sample generation plan (DEFERRED until §3A unblocks)

3 samples planned:

| # | Voice (target) | Model | Script kind | Length | Estimated credits |
|---|---|---|---|---|---|
| 1 | General American female | `eleven_multilingual_v2` | IELTS Section 1 booking | ~10s, ~180 chars | ~360 (HD) |
| 2 | British male | `eleven_multilingual_v2` | Section 2 personal monologue | ~30s, ~600 chars | ~1200 (HD) |
| 3 | Australian female | `eleven_flash_v2_5` | Section 4 academic lecture | ~2 min, ~2200 chars | ~2200 (Flash, half cost) |

**Total: ~3760 credits ≈ 3.8% of Creator monthly quota for the 3-sample render.** Comfortably within budget for ongoing exploration.

Samples will be saved to `/tmp/listening_samples/` (gitignored, NOT committed). The discovery doc gets a follow-up addendum after Andy reviews the samples.

### 3C. Cost extrapolation (from ElevenLabs published pricing 2025-26)

ElevenLabs credit cost model (Multilingual v2 / standard quality):
- 1 character ≈ 2 credits
- 1 minute of generated speech ≈ 1500 characters ≈ 3000 credits

Creator plan: 100K credits/month → ~33 minutes of HD audio.

**Per-session math:**
- 1 dictation set (5 exercises × 10s) = 50s × 1500 chars/min = 1250 chars × 2 = 2500 credits ≈ 2.5% of monthly
- 1 mini test (30 min) = 30 × 3000 = 90,000 credits ≈ 90% of monthly (!!!)

**Implication:** 1 mini test ≈ entire Creator plan budget. The realistic Sprint 11.x cadence is:
- 1 mini test/month rendered fresh on Creator plan
- Backlog of curated/uploaded MP3s for the rest
- Upgrade to Pro ($99/month, ~330K credits) when reaching ~3 mini tests/month sustained — projected Sprint 11.7+.

Andy Q5 lock ("start at Creator, upgrade if backlog needs") aligns with this.

**Flash model option:** `eleven_flash_v2_5` costs half the credits but slightly degraded quality on numbers + proper nouns (per ElevenLabs docs). For Section 4 academic content with lots of named entities, Multilingual v2 is the right pick. Flash is fine for Section 1-2 daily conversation.

### 3D. Voice catalog (from ElevenLabs public stock library, as of knowledge cutoff Jan 2026)

**Targeted IELTS accents:**

| Accent | Voice (representative) | voice_id (verify on render) | Age | Best for |
|---|---|---|---|---|
| General American female | "Rachel" | `21m00Tcm4TlvDq8ikWAM` | adult | Section 1 conversational |
| General American male | "Adam" | `pNInz6obpgDQGcFmaJgB` | adult | Section 2 monologue |
| British female (RP) | "Bella" | `EXAVITQu4vr4xnSDxMaL` | young adult | Section 1 / 3 academic |
| British male (RP) | "Antoni" | `ErXwobaYiN019PkySvjV` | adult | Section 4 lecture |
| Australian female | "Charlotte" (if available) | TBD on render | adult | accent variety Section 2 |
| Australian male | "Sam" | `yoZ06aMxZJJ28mfd3POQ` | adult | accent variety |

**Canadian English:** ElevenLabs does NOT publish a stock Canadian English voice as of Jan 2026. If Andy wants Canadian variety, options are (a) skip — IELTS exam itself doesn't always test Canadian, or (b) commission a voice clone in Sprint 11.7+ ($5/voice on Creator plan, takes ~5 min of source audio).

Final voice picks belong to Andy after he hears the 3 samples (deferred per §3A).

---

## 4. Curation Source Whitelist (license audit)

### 4A. BBC Learning English — ✅ ALLOWED (with attribution)

**"6 Minute English"** podcasts (2021-2026 archive):
- License: **Creative Commons Attribution-NonCommercial-NoDerivs 4.0** (CC BY-NC-ND).
- Verified at: https://www.bbc.co.uk/learningenglish/english/features/6-minute-english (page footer carries the CC notice).
- Allows: redistribution + use in non-commercial contexts.
- Attribution: must credit "BBC Learning English" + link back to the source episode page.
- Transcripts: same license — fully usable for the `transcript_segments` JSONB field.

**"The English We Speak"** — same license.

**For averlearning.com:** as long as the platform stays free OR clearly delineates the BBC content as "free / non-commercial" (e.g. only on the free tier and labeled), this is usable. If Andy ever paywalls a Listening track containing BBC content, that breaks ND/NC. Sprint 11.x should add a `is_premium` flag on `listening_content` — BBC tracks force `is_premium=false`.

### 4B. TED-Ed / TED Talks — ✅ ALLOWED (with caveats)

**TED Talks audio + transcripts:**
- License: **CC BY-NC-ND 4.0** (verified at https://www.ted.com/about/our-organization/our-policies-terms/ted-talks-usage-policy).
- Same constraints as BBC: non-commercial, no derivatives, attribution.
- TED-Ed lessons: same license.
- Audio redistribution: TED's TOS explicitly allows embedding via the TED player AND re-hosting the audio for educational, non-commercial purposes with attribution.

### 4C. Project Gutenberg / LibriVox — ✅ ALLOWED (public domain)

**LibriVox** (volunteer audiobook readings of public-domain texts):
- All recordings are public domain (CC0 equivalent).
- Verified at https://librivox.org/pages/public-domain/.
- Excellent for advanced listening (long-form classics, varied accents from international volunteer readers).
- Quality varies — some recordings have audible artifacts. Curation effort required.

**Use case:** Section 4 academic-style content. A 5-minute LibriVox excerpt from a 19th-century essay = free authentic English at advanced level. Lower priority for Sprint 11.x (Section 4 is hardest to source).

### 4D. NOT ALLOWED — denylist

Andy must verify these are NEVER uploaded as `curated_external` source:

| Source | Why blocked |
|---|---|
| **Cambridge IELTS official audio** (books 1-19) | © Cambridge University Press, all rights reserved, no CC license. Re-hosting = piracy. |
| **British Council IELTS resources** | © British Council, restricted to their own platforms. |
| **IDP IELTS official materials** | Same as British Council. |
| **YouTube audio** (default) | Default license = standard YouTube license, no redistribution rights. Even with CC YouTube videos, re-hosting requires checking each video's specific license. Default to BLOCK unless individually verified. |
| **Podcasts without explicit CC license** | Default copyright. Block unless creator grants written permission. |
| **Spotify / Apple Podcasts audio** | Streaming licenses do NOT allow redistribution. |

**Implementation:** Sprint 11.1 admin upload UI must ask the operator to (a) tick "I have license to redistribute this audio" AND (b) select a license value from a hardcoded dropdown (`CC BY-NC-ND 4.0`, `CC BY 4.0`, `Public Domain`, `Original (Aver Learning)`, `Other (specify)`). If "Other" selected, require a free-text license field with min length.

### 4E. License compliance hygiene

- Each `listening_content` row has `external_license` TEXT NOT NULL (default empty for AI-generated).
- Each row has `external_source_url` TEXT (the canonical attribution URL; required if `source_type='curated_external'`).
- Frontend audio player shows the attribution footer when these fields are set: `"Nguồn: BBC Learning English — bbc.co.uk/learningenglish/..."` with link.
- Admin dashboard has a "license audit" view filtering by `source_type='curated_external' AND (external_license IS NULL OR external_source_url IS NULL)` — surfaces non-compliant rows. Sprint 11.6 polish.

---

## 5. Data Model V2

### 5A. Schema (full DDL, ready for Sprint 11.1 migration)

```sql
-- Migration 056 (will land in Sprint 11.1, not this discovery PR):
-- backend/migrations/056_listening_module_foundation.sql

-- ── listening_content ───────────────────────────────────────────────
-- One row per audio asset. The source-of-truth for the audio file +
-- its transcript + metadata. Same row drives both mini-test sections
-- AND skill exercises (the exercise table references it by FK).
CREATE TABLE IF NOT EXISTS listening_content (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Audio source (Andy Q1 lock — 3 sources)
    source_type              TEXT NOT NULL CHECK (source_type IN (
                                'ai_elevenlabs',
                                'upload_mp3',
                                'curated_external'
                             )),
    -- ElevenLabs metadata (NULL unless source_type='ai_elevenlabs')
    elevenlabs_voice_id      TEXT,
    elevenlabs_model         TEXT CHECK (elevenlabs_model IN (
                                'eleven_multilingual_v2',
                                'eleven_flash_v2_5'
                             )),
    generation_cost_credits  INT,
    -- Curated metadata (NULL unless source_type='curated_external')
    external_license         TEXT,          -- e.g. 'CC BY-NC-ND 4.0'
    external_source_url      TEXT,          -- canonical attribution URL
    -- Storage
    audio_storage_path       TEXT NOT NULL, -- bucket-relative path in listening-audio
    audio_duration_seconds   INT  NOT NULL CHECK (audio_duration_seconds > 0),
    audio_size_bytes         INT  NOT NULL CHECK (audio_size_bytes > 0),
    -- Linguistic metadata
    accent_tag               TEXT NOT NULL CHECK (accent_tag IN (
                                'us_general', 'uk_rp', 'au', 'ca', 'other'
                             )),
    topic_tags               TEXT[] NOT NULL DEFAULT '{}',  -- e.g. {'travel','business'}
    cefr_level               TEXT CHECK (cefr_level IN ('A2','B1','B2','C1','C2')),
    ielts_section            INT  CHECK (ielts_section BETWEEN 1 AND 4),
    -- Transcript
    transcript               TEXT NOT NULL,
    -- Sprint 11.0 §5B refinement: segment-level granularity for
    -- replay-by-segment + per-segment highlighting in the player.
    transcript_segments      JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Example shape: [{"start": 0, "end": 3.5, "text": "..."}, ...]
    -- Publishing
    status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                                'draft', 'published', 'archived'
                             )),
    is_premium               BOOLEAN NOT NULL DEFAULT FALSE,
    -- License-friendly default: free tier shows all content.
    -- Premium tier (Phase B+): admin can flag content as premium-only.
    title                    TEXT NOT NULL,
    description              TEXT,
    -- Admin
    created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listening_content_status_section
    ON listening_content (status, ielts_section);
CREATE INDEX IF NOT EXISTS idx_listening_content_accent
    ON listening_content (accent_tag);
CREATE INDEX IF NOT EXISTS idx_listening_content_topic_tags
    ON listening_content USING GIN (topic_tags);

-- ── listening_exercises ─────────────────────────────────────────────
-- One row per exercise. Multiple exercises can reference the same
-- listening_content row (e.g. one audio clip serves a dictation
-- question + a gist question + 3 MCQ questions).
CREATE TABLE IF NOT EXISTS listening_exercises (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id          UUID NOT NULL REFERENCES listening_content(id) ON DELETE CASCADE,
    exercise_type       TEXT NOT NULL CHECK (exercise_type IN (
                            'dictation', 'gist', 'true_false', 'mcq', 'mini_test'
                        )),
    -- Per-type payload — schema differs per exercise_type.
    -- See §5B for the per-type shape.
    payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Order within a set (mini test has 40 questions Q1-Q40 ordered)
    order_num           INT  NOT NULL DEFAULT 1,
    -- Difficulty grading (B2-C2 typical for IELTS)
    cefr_level          TEXT CHECK (cefr_level IN ('A2','B1','B2','C1','C2')),
    -- Publishing
    status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                            'draft', 'published', 'archived'
                        )),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listening_exercises_content
    ON listening_exercises (content_id);
CREATE INDEX IF NOT EXISTS idx_listening_exercises_type_status
    ON listening_exercises (exercise_type, status);

-- ── listening_attempts ──────────────────────────────────────────────
-- One row per user attempt. Append-only; analytics derive from this.
CREATE TABLE IF NOT EXISTS listening_attempts (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exercise_id              UUID NOT NULL REFERENCES listening_exercises(id) ON DELETE CASCADE,
    -- User answer (shape depends on exercise_type — JSONB lets us
    -- not invent 5 different attempt tables)
    user_answer              JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_correct               BOOLEAN,           -- NULL for partial-credit (dictation)
    score                    NUMERIC(4,2),      -- e.g. 4.50 for dictation word-level
    -- Sprint 11.0 §5B refinement: pattern-analytics signals
    replay_count             INT  NOT NULL DEFAULT 0,
    audio_play_completed     BOOLEAN NOT NULL DEFAULT FALSE,
    -- Session-of-session linkage (NULL for one-off skill exercises)
    listening_session_id     UUID,  -- groups exercises in a mini test
    time_to_answer_seconds   INT,
    -- Sprint 11.0 §5B refinement: light AI-insight signal (Andy Q3)
    -- Filled by background job after attempt for mini-test scope only
    -- (skill exercises are too small to warrant AI per-attempt analysis).
    ai_insights              JSONB,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE listening_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY listening_attempts_owner ON listening_attempts
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_listening_attempts_user_created
    ON listening_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listening_attempts_session
    ON listening_attempts (listening_session_id)
    WHERE listening_session_id IS NOT NULL;

-- ── listening_sessions (mini test grouping) ─────────────────────────
-- A mini test attempt creates one parent row + 40 child listening_
-- attempts. Skill exercises don't create a session row.
CREATE TABLE IF NOT EXISTS listening_sessions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section_content_ids     UUID[] NOT NULL,  -- 4 listening_content IDs for the 4 sections
    started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ,
    total_questions         INT  NOT NULL DEFAULT 40,
    correct_count           INT,
    band_estimate           NUMERIC(2,1),  -- e.g. 6.5
    -- Sprint 11.0 §5B refinement: per-section breakdown
    section_scores          JSONB,
    -- Example shape: {"section_1": {"correct":8, "total":10}, ...}
    ai_insights             JSONB,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE listening_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY listening_sessions_owner ON listening_sessions
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_listening_sessions_user_created
    ON listening_sessions (user_id, created_at DESC);
```

### 5B. Per-exercise-type `payload` shape (JSONB)

**dictation:**
```json
{
  "expected_text": "The exhibition opens on Saturday.",
  "expected_text_normalized": "the exhibition opens on saturday",
  "case_sensitive": false,
  "punctuation_counts": false,
  "scoring_mode": "word_level"
}
```

**gist:**
```json
{
  "prompt": "What is the speaker mainly discussing?",
  "options": [
    "The history of the museum",
    "Plans for the upcoming exhibition",
    "Visitor feedback policies",
    "Staff training procedures"
  ],
  "correct_option_index": 1,
  "explanation": "The speaker references 'opening next Saturday' and 'three new galleries'."
}
```

**true_false:**
```json
{
  "statements": [
    {"text": "The museum opens at 9 AM weekdays.", "correct": true},
    {"text": "Parking is free for visitors.", "correct": false},
    {"text": "Children under 12 enter free.", "correct": true}
  ]
}
```

**mcq:**
```json
{
  "questions": [
    {
      "id": "q1",
      "stem": "The speaker mentions:",
      "options": [
        "industrial revolution",
        "climate change",
        "urbanization",
        "globalization"
      ],
      "correct_index": 2,
      "audio_anchor_seconds": 45.2
    },
    ...
  ]
}
```

**mini_test:**
```json
{
  "section": 1,
  "questions": [
    /* references to mcq + true_false + gist payloads */
  ],
  "total_time_seconds": 600,
  "audio_replay_allowed": false
}
```

### 5C. Cross-skill integration — vocab capture

**Andy Q (implicit):** should listening exercises auto-capture vocab into the user's vocab bank like Speaking does?

**Recommendation: NO auto-capture, explicit user action only.**

Reasoning:
- Speaking transcripts have ~30-100 words per response. AI extraction yields 3-9 vocab items (used_well + needs_review + upgrade_suggested categories). Signal-to-noise high.
- Listening transcripts have ~500-2500 words per session. AI extraction would yield 50-300 items per session. Signal-to-noise terrible.
- Better UX: user clicks "+ vocab" next to an unfamiliar word in the transcript after the audio finishes. Single explicit click, low cognitive load.

**Sprint 11.3+ implementation hint:** transcript renderer with click-to-capture. Each transcript word is a clickable `<span data-word="ephemeral">ephemeral</span>`. Click handler:
1. Asks Claude Haiku for definition + example (existing `vocab_extractor.py` reusable shape).
2. POST `/api/vocabulary/bank/` with `headword=ephemeral, source_type='manual', context_sentence=<the sentence the word appeared in>`.
3. Toast: "✓ Added 'ephemeral' to your vocab bank".

No new backend endpoints needed — reuse manual-add path from Sprint 6.x.

### 5D. Schema validation against Andy's locks

| Q | Lock | Schema support |
|---|---|---|
| Q1 | All 3 sources | `source_type` CHECK constraint with 3 values ✓ |
| Q2 | Mini test + skill exercises | `exercise_type` CHECK with 5 values (4 skills + 'mini_test' grouping) ✓ |
| Q3 | Pattern analytics + light AI insights | `ai_insights JSONB` on attempt + session ✓ |
| Q4 | Solo learner + AI teacher | RLS policies `auth.uid() = user_id` — no admin/instructor scope ✓ |
| Q5 | ElevenLabs Creator | `elevenlabs_voice_id` + `generation_cost_credits` track spend ✓ |
| Q6 | Dictation first | Schema is general enough — dictation goes first via `exercise_type='dictation'` and the `payload.scoring_mode='word_level'` Sprint 11.2 implements ✓ |

---

## 6. UX Wireframes (text sketches)

### 6A. Dictation (Sprint 11.2 — first to build)

```
┌──────────────────────────────────────────┐
│ ← Listening | Chép chính tả              │  ← .subpage-header + .back
├──────────────────────────────────────────┤
│ Bài 1/10 — Section 1 booking · US accent │  ← progress + accent badge
│                                          │
│ ┌──────────────────────────────────────┐ │  ← AUDIO PLAYER (NEW component)
│ │  [▶]   ━━━━━━━━━━━○━━━━━  0:08 / 0:15│ │
│ │  ⏪ -5s   ⏸ Pause   ⏩ +5s            │ │
│ │  Replays: 2/∞     Speed: [1.0x ▾]    │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ Hãy gõ chính xác câu bạn vừa nghe:       │
│ ┌──────────────────────────────────────┐ │
│ │                                      │ │  ← <textarea>
│ │ (textarea)                           │ │     min-height 5rem
│ │                                      │ │     autofocus
│ └──────────────────────────────────────┘ │
│                                          │
│  [Kiểm tra]    [Bỏ qua]                  │  ← .vocab-action--primary + neutral
│                                          │
│ 💡 Mẹo: Space = play/pause, ←→ = ±5s    │  ← .mv-context (muted)
└──────────────────────────────────────────┘
```

**Post-submit state:**
```
┌──────────────────────────────────────────┐
│ Kết quả                                  │
│                                          │
│ Bạn gõ:                                  │
│ "The exhibition opens on Saturday"       │
│                                          │
│ Đáp án:                                  │
│ "The exhibition opens on Saturday."      │
│  ──────────────────────────────────  ^   │
│  ✓ tất cả từ đúng                        │
│                                ↑         │
│                       thiếu dấu chấm     │  ← muted note
│                                          │
│ Điểm: 5/5 từ ✓                           │
│ (Dấu câu không tính vào điểm)            │
│                                          │
│  [Bài tiếp →]    [Xem transcript đầy đủ] │
└──────────────────────────────────────────┘
```

**States:**
- `pre-listen` — audio loaded, play button enabled, textarea disabled (or enabled with placeholder "Nghe rồi gõ nhé")
- `listening` — pause/replay enabled, replay counter incrementing
- `paused` — same UI, play icon swap
- `submitted` — feedback panel above textarea, "Bài tiếp" button
- `error` — toast "Không tải được audio. Thử lại?" + retry button

**Scoring (word-level, ignore punctuation):**
- Normalize both strings: lowercase, strip punctuation, collapse whitespace.
- Tokenize, compute correct words via order-aware diff (Levenshtein-aligned).
- 4/5 words correct = 80% = pass; below = retry encouraged.

### 6B. Gist (Sprint 11.3)

```
┌──────────────────────────────────────────┐
│ ← Listening | Nghe ý chính               │
├──────────────────────────────────────────┤
│ Bài 1/5 — Section 2 monologue · UK       │
│                                          │
│ [Audio player — same component]          │
│                                          │
│ Ý chính của đoạn này là gì?              │
│                                          │
│  ( ) A. Quá khứ ngành du lịch            │
│  ( ) B. Kế hoạch triển lãm sắp tới       │
│  ( ) C. Phản hồi khách thăm quan         │
│  ( ) D. Quy trình đào tạo nhân viên      │
│                                          │
│  [Kiểm tra]                              │
└──────────────────────────────────────────┘
```

**Post-submit:** highlight selected (green if correct, red if not) + show correct + 1-line explanation.

### 6C. True/False (Sprint 11.3)

```
┌──────────────────────────────────────────┐
│ ← Listening | Đúng / Sai                 │
├──────────────────────────────────────────┤
│ [Audio player]                           │
│                                          │
│ Đánh dấu Đúng (T) / Sai (F) cho mỗi câu: │
│                                          │
│ 1. Bảo tàng mở cửa 9 AM ngày thường      │
│    ( T )  ( F )                          │
│                                          │
│ 2. Đậu xe miễn phí                       │
│    ( T )  ( F )                          │
│                                          │
│ 3. Trẻ em dưới 12 vào cửa miễn phí       │
│    ( T )  ( F )                          │
│                                          │
│  [Kiểm tra]                              │
└──────────────────────────────────────────┘
```

### 6D. Multiple Choice (Sprint 11.4)

```
┌──────────────────────────────────────────┐
│ ← Listening | Trắc nghiệm                │
├──────────────────────────────────────────┤
│ Section 3 academic discussion · UK       │
│                                          │
│ [Audio player]                           │
│                                          │
│ Q1/5. Speaker chính đang nói về:         │
│  ○ A. Industrial revolution              │
│  ○ B. Climate change                     │
│  ○ C. Urbanization                       │
│  ○ D. Globalization                      │
│                                          │
│ Q2/5. Theo speaker, nguyên nhân chính:   │
│  ○ A. ...                                │
│  ○ B. ...                                │
│  ○ C. ...                                │
│  ○ D. ...                                │
│                                          │
│  [Kiểm tra tất cả]                       │
└──────────────────────────────────────────┘
```

### 6E. Mini Test (Sprint 11.4)

```
┌──────────────────────────────────────────┐
│ MINI TEST — 4 sections, ~30 min          │
├──────────────────────────────────────────┤
│ ⏱ 24:18 còn lại                          │
│                                          │
│ Section 1: Q1-Q10  ████░░░░░░ 4/10       │
│ Section 2: Q11-Q20 ░░░░░░░░░░ 0/10       │
│ Section 3: Q21-Q30 ░░░░░░░░░░ 0/10       │
│ Section 4: Q31-Q40 ░░░░░░░░░░ 0/10  ←    │
│                                          │
│ Audio: phát liên tục trong từng section, │
│ chỉ pause được giữa các sections         │
│                                          │
│ ┌────────────────────────────────┐       │
│ │ Q35. Speaker mentions:          │       │
│ │  ○ A. industrial revolution     │       │
│ │  ○ B. climate change            │       │
│ │  ○ C. urbanization             │       │
│ │  ○ D. globalization            │       │
│ └────────────────────────────────┘       │
│                                          │
│  [← Q34]  [Q36 →]   [Nộp bài]            │
└──────────────────────────────────────────┘
```

**Results page (post-submit):**
```
┌──────────────────────────────────────────┐
│ Điểm: Band 6.0 (32/40)                   │
│                                          │
│ Theo section:                            │
│   Section 1: 9/10  (Band 7.5)            │
│   Section 2: 8/10  (Band 6.5)            │
│   Section 3: 7/10  (Band 6.0)            │
│   Section 4: 8/10  (Band 6.5)            │
│                                          │
│ Thời gian: 28:42 / 30:00                 │
│                                          │
│ 💡 Câu sai nhiều ở phần điền số          │  ← AI insight
│ (5/8 lần điền số gần nhất sai).          │
│ Thử exercise "Numbers in context".       │
│                                          │
│  [Xem từng câu]   [Làm bài khác]         │
└──────────────────────────────────────────┘
```

### 6F. Analytics Dashboard (Sprint 11.5)

```
┌──────────────────────────────────────────┐
│ LISTENING ANALYTICS                      │
├──────────────────────────────────────────┤
│ 30 ngày qua                              │
│                                          │
│ Tổng accuracy:        72% (32/45)        │
│                                          │
│ Theo kỹ năng:                            │
│   Chép chính tả:      65%  ← yếu nhất   │
│   Nghe ý chính:       85%                │
│   Đúng/Sai:           70%                │
│   Trắc nghiệm:        78%                │
│                                          │
│ Mini test (3 lần gần nhất):              │
│   Lần 1 (2 tuần trước):  Band 5.5        │
│   Lần 2 (1 tuần trước):  Band 6.0        │
│   Lần 3 (3 ngày trước):  Band 6.5  ↑     │
│                                          │
│ 💡 Bạn hay sai khi nghe số. 5/8 lần      │  ← AI insight #1
│ điền số gần nhất sai. Thử exercise       │
│ "Numbers in context".                    │
│                                          │
│ 💡 Section 3 (academic) là điểm yếu.     │  ← AI insight #2
│ Recommend: TED-Ed 5-10 phút/ngày.        │
└──────────────────────────────────────────┘
```

---

## 7. Sprint Plan (Phase A)

| Sprint | Scope | Effort | Output |
|---|---|---|---|
| **11.0** (this) | Discovery | 3-4h | This doc + Sprint 11.1 prompt + ledger row |
| **11.1** | Data model + admin upload + ElevenLabs scaffold | ~1 session | Migration 056 + `routers/listening.py` user routes + admin upload tool + ElevenLabs render endpoint (admin-only) + chrome nav slot |
| **11.2** | Dictation + audio player component | ~1 session | NEW `<audio-player>` component (~150 LOC) + dictation submit/grade route + dictation page shell |
| **11.3** | Gist + True/False (reuse player) | ~0.5 session | 2 more exercise types + 2 page shells (lean on dictation template) |
| **11.4** | MCQ + Mini Test | ~1 session | MCQ rendering + 30-min timer + 4-section state machine + results page + band-estimate compute |
| **11.5** | Analytics dashboard + light AI insights | ~0.5 session | Aggregator service + 2 AI insight slots per dashboard |
| **Total Phase A** | **5 sprints** | **~4-5 sessions** | Listening MVP live |

**Phase B (deferred):**
- 11.6: Cloudflare CDN layer (trigger if egress >100 GB/mo OR latency >500ms)
- 11.7: Voice cloning (Andy custom voice) + multi-instructor visibility
- 11.8: SRS-style review queue for previously-missed listening items
- 11.9: Speaking + Listening cross-train (record yourself reading the transcript, get pronunciation feedback)

### Per-sprint critical-path notes

**Sprint 11.1:**
- Migration 056 lands the 4 tables (`listening_content` + `listening_exercises` + `listening_attempts` + `listening_sessions`).
- Backend admin tool: `POST /admin/listening/render` accepts `{script_text, voice_id, model, accent, section}`, schedules `BackgroundTasks` job that calls ElevenLabs API → uploads MP3 to bucket → inserts `listening_content` row with `status='draft'`.
- Backend admin tool: `POST /admin/listening/upload` accepts multipart MP3 upload + metadata.
- Chrome nav: extend `aver-chrome.js` 2-line diff + sentinel test update.
- Sprint 11.1 ships zero user-facing routes (deliberately, like Sprint 10.5 Phase 1).

**Sprint 11.2:**
- Audio player component: vanilla `<audio>` + JS wrapper. Public API: `mount(container, {audioUrl, segments, onPlayCompleted, onReplay})`. Emits events; parent decides what to do.
- Dictation route: `POST /api/listening/dictation/attempt` with `{exercise_id, user_answer_text, replay_count}`. Returns `{score, correct_words, missed_words, expected_text}`.
- Dictation page: minimal — header + audio player + textarea + submit.

**Sprint 11.3:**
- Reuse 11.2 audio player as-is. The 2 page shells are ~50 LOC each.
- Routes mirror 11.2 with payload deserialization differences.

**Sprint 11.4:**
- Mini test timer is the trickiest part. State machine: `loading → section_1 → section_2 → ... → results`. Audio plays continuously within a section; the timer paces transitions.
- Band estimate: simple lookup table (40 questions → IELTS official band conversion table, public).

**Sprint 11.5:**
- Reuse `services/student_home_aggregator.py` pattern for the analytics view.
- AI insights = 1-2 Claude Haiku calls per dashboard load, cached for 24h via a `listening_insight_cache` table OR ephemeral in-memory dict (Andy preference: skip cache table for MVP, accept the per-load cost).

---

## 8. Discovery Findings + Spec Falsifications

### Findings that validated the proposal

1. **Listening fits the existing module architecture cleanly.** No new chrome variant, no new design tokens, no new auth pattern. Sprint 11.x cluster is purely additive.
2. **ElevenLabs Creator plan ($22/mo) is the right starting point** — math in §3C shows ~1 mini test/month + abundant skill exercises within budget. Upgrade trigger to Pro is well-defined.
3. **License audit confirms BBC + TED + LibriVox usable for curated tier.** Denylist (Cambridge, British Council, YouTube default) is the operational guard for the admin upload UI.

### Spec falsifications (cumulative 50-53)

**(50) Storage cost projection is much lower than the proposal estimated.** The proposal assumed Supabase free-tier storage limits + dedicated CDN cost. Actual reality: averlearning.com is already on Supabase Pro ($25/mo), and the 100 GB storage + 250 GB egress allotment more than covers Listening at 500 users. Net incremental cost: $0 for storage. ElevenLabs becomes the dominant variable cost ($22-99/mo depending on render cadence).

**(51) Audio player does NOT exist anywhere in the codebase.** The proposal implicitly assumed there might be one (the practice flow plays recorded user audio). Verification: `<audio>` element appears in `result.html` for user-recording replay but with NO bespoke control wrapper. Sprint 11.2 must build the component from scratch. NOT a blocker — well-scoped (~150 LOC).

**(52) Vocab auto-capture from listening transcripts would generate too much noise.** The proposal hinted at "listening transcripts auto-feed vocab bank." Discovery's math: ~500-2500 words per session × ~5-10% unknown rate = 25-250 candidate items/session, vs Speaking's 3-9. Recommendation: explicit click-to-capture, not auto-extraction. Saves AI cost + UX is cleaner. Sprint 11.3+ implements the transcript renderer with click handlers.

**(53) ElevenLabs Canadian English voice does NOT exist in the stock library** (as of Jan 2026 knowledge cutoff). The proposal listed 4 accents (US/UK/AU/CA). If Andy wants Canadian, the path is voice cloning in Sprint 11.7+, not stock. Sprint 11.x ships with US/UK/AU only; documented as a Phase B follow-up.

### Risks flagged (carry into Sprint 11.x cluster)

| Risk | Trigger | Mitigation |
|---|---|---|
| ElevenLabs API key never provisioned | Andy delays Creator plan signup | Sprint 11.1 can land schema + admin upload (MP3 path only) without the AI render. Render endpoint stays behind a feature flag. |
| ElevenLabs voice quality fails Andy's bar after samples | Andy hears samples + rejects | Fallback to alternative TTS: OpenAI TTS ($15/1M chars, similar quality, no voice cloning) OR Azure Cognitive Speech. Both well-documented; integration shape similar. |
| Audio player browser compat issues | Safari iOS autoplay restrictions | Audio player must require user-gesture-to-play (no autoplay). Tested across Chrome/Safari/Firefox in 11.2. |
| Mini-test 30-min timer abandonment | User loses focus mid-test, browser tab backgrounded | Timer pauses on `visibilitychange` event (user backgrounds tab) but logs to telemetry. Andy decides if this is too lenient post-Sprint 11.4 dogfood. |
| License compliance drift | Admin uploads BBC content under wrong license tag | License-required-field validation + admin "license audit" view in Sprint 11.6. Manual SQL review monthly until then. |
| Premium tier conflict with BBC license | Andy paywalls a track containing BBC content | `is_premium=true` validation: trigger error if `source_type='curated_external' AND external_license CONTAINS 'NC'`. Sprint 11.1 migration enforces via CHECK constraint or trigger. |

---

## 9. Sprint 11.1 prompt — drafted

See companion file: `docs/sprint-11-1-listening-data-model-prompt.md`.

---

## Appendix A — files referenced

- `frontend/js/components/aver-chrome.js` (chrome nav integration point)
- `frontend/js/vocab-landing.js` (hash-routing reference pattern)
- `frontend/css/aver-design/components.css` (canonical design primitives)
- `backend/routers/grading.py:230` (`audio-responses` bucket upload reference)
- `backend/routers/vocabulary_bank.py:_run_d1_generation_for_vocab` (BackgroundTasks AI generation reference)
- `backend/migrations/019_user_vocabulary.sql` (RLS policy reference)
- `backend/migrations/052_personalized_d1_questions.sql` (per-user content table reference)

## Appendix B — Sprint cluster genealogy

Discovery sprints in this codebase that delivered measurable effort savings:

| Sprint | Discovery insight | Effort saved |
|---|---|---|
| 7.1 | iframe → module migration scope (DEBT-2026-05-09-B Phase 1) | ~10h |
| 7.9 | Vocabulary redesign roster pre-flight | ~6h |
| 9.0 | Chrome unification audit | ~15h |
| 10.0 | Vocab workflow 14-issue catalog + 3-roadmap option | ~30h (vs blind implementation) |
| 10.8 | `ON DELETE SET NULL` dividend (skip new backend column) | ~3h |
| **11.0 (this)** | ElevenLabs cost calibration + license whitelist + audio-player scope | **~5-8h projected** (avoids over-engineering bucket policy + chasing Canadian voice + auto-capture noise) |

The pattern works. Discovery-first stays the project methodology going into Phase 11 cluster.
