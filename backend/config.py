from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    APP_NAME: str = "IELTS Speaking Coach"
    ENVIRONMENT: str = "development"

    # Supabase
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    DATABASE_URL: str = ""

    # reading-access-tracking B — salt for hashing anonymous share-link takers'
    # IPs (reading_test_attempts.anon_src). MUST be set on Railway and kept
    # STABLE (changing it orphans existing hashes). Empty → fail-loud in
    # production (reading_student._hash_anon_src); a dev-only fallback keeps
    # local dev working.
    READING_ANON_SALT: str = ""

    # Feature flags
    # Writing prompt-bank (R1): public-read library browse on the student
    # dashboard. Default off until the prompts are launch-ready; flip to true
    # via env to expose the "Kho đề" tab + the /api/writing/prompt-bank data.
    WRITING_PROMPT_BANK_ENABLED: bool = False

    # AI APIs
    ANTHROPIC_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    # Speaking grader primary model (audit 2026-07-02).
    # The Speaking grader used to be hardcoded to Claude Haiku 4.5 — the weakest
    # tier — while the Writing grader already uses Gemini Pro. This knob lets ops
    # point the *grader* at any model without a code change; the fallback chain
    # (Haiku → Sonnet) and the off-topic judge + grammar-check stay on Haiku.
    #   * "gemini-*"                  → routed to the Gemini provider
    #   * "claude-*" / "anthropic-*"  → routed to the Claude provider
    # Default: Gemini 3.5 Flash (GA) — stronger reasoning than Haiku for IELTS
    # calibration, ~$1.50/$9.00 per 1M. Chosen over the cheaper gemini-3-flash-
    # preview for stability (GA, not a preview that Google may change/deprecate).
    # Empty string → fall back to the legacy Haiku-first chain. Needs GEMINI_API_KEY.
    SPEAKING_GRADING_MODEL: str = "gemini-3.5-flash"

    # LISTENING_AUDIT_MODEL — the LLM used by the listening content-audit pass
    # (answer-in-script / solution-consistency / prompt-clarity). Routes by the
    # same "gemini-*"/"claude-*" prefix convention as SPEAKING_GRADING_MODEL. A
    # cheap flash model is plenty for a per-question sanity check.
    LISTENING_AUDIT_MODEL: str = "gemini-3.5-flash"

    # Speech-to-text model (audit 2026-07-02, finding #5). Default whisper-1 —
    # the only OpenAI STT that returns verbose_json (per-segment avg_logprob +
    # duration), which the transcript-reliability classifier and duration guards
    # depend on. Configurable so ops can trial a newer model (e.g.
    # gpt-4o-transcribe) for accented-English accuracy; whisper.py detects a
    # non-"whisper*" model, requests plain json, and probes duration with ffprobe
    # so the pipeline degrades gracefully (reliability → neutral when no
    # segments). Keep whisper-1 unless a newer model is verified end-to-end.
    WHISPER_STT_MODEL: str = "whisper-1"

    # Google Cloud TTS
    GOOGLE_APPLICATION_CREDENTIALS: str = ""

    # Azure Cognitive Services — Pronunciation Assessment
    AZURE_SPEECH_KEY: str = ""
    AZURE_SPEECH_REGION: str = ""   # e.g. "eastus", "southeastasia"

    # audit #2 — Azure→P band mapping. Empty (default) → the historical linear
    # `1 + score/100·8`. Point at a JSON file of isotonic breakpoints
    # ([[azure_score, band], …], fit from the gold set once A1 lands — see
    # docs/TECH_DEBT_gold_set_A1.md) to swap in the empirical mapping with no
    # code change. Loaded once, cached (services.pron_calibration).
    PRON_CALIBRATION_PATH: str = ""

    # Supabase Storage bucket holding Task 1 Academic writing-prompt
    # images (chart/graph). Mirrors READING_IMAGES_BUCKET /
    # LISTENING_IMAGES_BUCKET — created out-of-band BEFORE the first
    # admin upload works (Supabase dashboard → Storage → New bucket →
    # name `writing-images` → Public ✓). PUBLIC so the persisted
    # prompt_image_url renders directly as <img src> with no signed-URL
    # minting on the read side. (Replaced the Cloudinary integration.)
    WRITING_IMAGES_BUCKET: str = "writing-images"

    # Task 1 verified "answer key" (docs/WRITING_TASK1_ANALYSIS_SPEC.md).
    # WRITING_ANALYSIS_MODEL — the vision model that extracts the chart into
    # static facts once at prompt create/update. Pro for accuracy; the cost is a
    # one-off per prompt, amortized over every grade against it.
    WRITING_ANALYSIS_MODEL: str = "gemini-2.5-pro"
    # WRITING_TASK1_FACTS_ENABLED — master switch for FEEDING the reviewed facts
    # to the grader. OFF → extraction/review UI still work, but grading is
    # unchanged (image-only). Turn ON only after enough prompts are reviewed.
    WRITING_TASK1_FACTS_ENABLED: bool = False

    # App config
    # speaking-daily-limit-24 — global per-account daily speaking-session cap
    # (admins bypass; counted per UTC calendar day, resets at UTC midnight;
    # enforced in routers/sessions.py). Env-overridable: if a
    # MAX_SESSIONS_PER_USER_PER_DAY env var is set (e.g. on Railway) it WINS
    # over this default, so update/remove that var to roll the production value.
    MAX_SESSIONS_PER_USER_PER_DAY: int = 24
    MAX_AUDIO_DURATION_SECONDS: int = 300
    # B5 / Mục 5 — daily cap on the expensive grading pipeline (Whisper + Claude)
    # per user. Generous: a real student rarely exceeds a few dozen gradings/day;
    # this stops abuse (spamming one question 100×). <= 0 disables the cap.
    MAX_GRADINGS_PER_USER_PER_DAY: int = 200

    # Vocab Bank feature flags
    VOCAB_ANALYSIS_ENABLED: bool = False
    VOCAB_ANALYSIS_MODEL: str = "claude-haiku-4-5-20251001"
    VOCAB_MIN_TRANSCRIPT_WORDS: int = 30
    VOCAB_MAX_PER_CATEGORY: int = 3
    VOCAB_BANK_FEATURE_FLAG_ENABLED: bool = False

    # Phase D — vocabulary exercises feature flags (default OFF in production)
    D1_ENABLED: bool = False
    D3_ENABLED: bool = False
    D1_DAILY_LIMIT: int = 100        # generous; D1 cost is ~zero
    D3_DAILY_LIMIT_FREE: int = 3
    D1_GENERATION_MODEL: str = "gemini-2.5-flash"

    # Phase D Wave 2 — Flashcards feature flag (default OFF in production)
    FLASHCARD_ENABLED: bool = False
    FLASHCARD_DAILY_REVIEW_LIMIT: int = 500

    # Sprint 2.6 — Writing grader prompt version selector. v1 stays the
    # default until A/B testing confirms v2 is at least as good. Flip
    # WRITING_PROMPT_VERSION=v2 in the environment to swap without a
    # code change. Per-essay logging through writing_feedback.prompt_version
    # lets Andy diff quality metrics by version.
    WRITING_PROMPT_VERSION: str = "v1"

    # Sprint 2.7a — Writing grading model selectors. Standard tier uses
    # GEMINI_PRO_MODEL by default (Pro, full 12-section analysis);
    # admins can still override per-essay to Flash via the existing
    # `selected_model` field on CreateEssayRequest. Sprint 2.7a.1 removed
    # the Quick tier (orthogonality conflict with Levels L3-L5), so
    # GEMINI_FLASH_MODEL no longer has an automatic call site today —
    # it stays as named config for the per-essay Flash override and so
    # ops can swap the underlying Gemini model name without a code
    # change if Google renames or releases new versions.
    GEMINI_PRO_MODEL: str = "gemini-2.5-pro"
    GEMINI_FLASH_MODEL: str = "gemini-2.5-flash"

    # Multi-model plan P1-A — level-aware default grading model. When ON,
    # student-submitted essays at L1–L3 grade with the cheaper/faster
    # gemini-3.5-flash and L4–L5 stay on gemini-2.5-pro. Backed by the
    # calibration harness: 3.5 Flash hit 100% band agreement (±0.5) vs Pro at
    # ≤L3 but only ~90% at L4. KILL-SWITCH: set env WRITING_LEVEL_AWARE_MODEL=false
    # to revert all levels to Pro — no code change; settings load at process
    # start, so the Railway variable change restarts the service to pick it up.
    # Admin-picked models are NOT overridden — student-path default only.
    # NOTE: default True ⇒ ON the moment this deploys; set the env var false
    # at/before deploy if you want to roll out dark first.
    WRITING_LEVEL_AWARE_MODEL: bool = True
    WRITING_FLASH_MAX_LEVEL: int = 3   # highest level that uses 3.5 Flash

    # Sprint W-MM reaper — grading reliability (stuck-job recovery + model
    # fallback). A grading BG task runs IN-PROCESS (FastAPI BackgroundTask); a
    # Railway restart / OOM / hard timeout mid-grade kills the process with NO
    # exception, so `_mark_failed` never runs and the essay is orphaned in
    # 'grading' forever (observed: essay ac21294e, 2026-06-27). The reaper is a
    # startup async loop that sweeps writing_jobs stuck past a timeout and either
    # requeues (attempts remain) or marks terminal-failed (exhausted) so the
    # admin UI surfaces it instead of a perpetual "đang chấm".
    #
    # RETRY/FALLBACK policy (the grader's in-call MAX_RETRIES=3 are transient API
    # re-rolls INSIDE one attempt; these are JOB-LEVEL attempts that survive a
    # process death). attempt 1..N-1 keep the primary model (most failures are
    # infra, not model-specific); the FINAL attempt switches to
    # WRITING_FALLBACK_MODEL so a model/region-specific failure can still deliver
    # *a* result — continuity over marginal quality. With MAX_ATTEMPTS=3 the
    # fallback fires on the 3rd attempt (primary failed twice at job level).
    # All knobs env-overridable; settings load at process start, so a Railway
    # change restarts the service to apply. Set WRITING_REAPER_ENABLED=false to
    # disable the sweep; WRITING_GRADING_FALLBACK_ENABLED=false to always keep
    # the primary model.
    WRITING_REAPER_ENABLED: bool = True
    WRITING_REAPER_INTERVAL_SECONDS: int = 120
    WRITING_STUCK_JOB_TIMEOUT_SECONDS: int = 360        # standard tier
    WRITING_STUCK_JOB_TIMEOUT_DEEP_SECONDS: int = 600   # deep tier (3 passes)
    WRITING_GRADING_MAX_ATTEMPTS: int = 3
    WRITING_GRADING_FALLBACK_ENABLED: bool = True
    WRITING_FALLBACK_MODEL: str = "gemini-2.5-flash"

    # Sprint 11.1 — Listening module (DEBT-LISTENING-MODULE foundation 1/5).
    # ELEVENLABS_API_KEY: empty by default; render endpoint stays 503 until
    # Andy provisions the Creator plan. LISTENING_AI_RENDER_ENABLED is the
    # feature flag — flip to true in .env once the key is set (defense in
    # depth so a leaked key without intentional enablement still gates
    # safely).
    ELEVENLABS_API_KEY: str = ""
    LISTENING_AI_RENDER_ENABLED: bool = False
    # V-eleven — vocab audio generate. ElevenLabs en-GB voice + model used when
    # the admin picks engine="elevenlabs" (OpenAI stays the default engine).
    VOCAB_TTS_ELEVENLABS_VOICE_ID: str = "aHCytOTnUOgfGPn5n89j"
    VOCAB_TTS_ELEVENLABS_MODEL: str = "eleven_multilingual_v2"
    LISTENING_AUDIO_BUCKET: str = "listening-audio"

    # P0-1 (C-1.1) — async-DB migration kill switch. OFF = every path runs the
    # sync supabase_admin singleton exactly as today (the scaffold is a no-op).
    # ON = routers migrated to the db_async facade await the async client. Stays
    # OFF until a phase is wired + load-validated; flip per-deploy in .env.
    USE_ASYNC_DB: bool = False

    # C-* audit — Server-Timing observability gate. The W3C Server-Timing
    # middleware (main.py) runs on every non-/health request and exposes an
    # internal total/auth/db/app breakdown to all clients. Default OFF: in
    # prod it adds a per-request header (minor overhead + internal-timing
    # exposure) that is only useful while actively debugging. Flip to true in
    # .env (ENABLE_SERVER_TIMING=true) to turn it on for a debugging session.
    ENABLE_SERVER_TIMING: bool = False

    # Sprint 13.5.6 — map image generation for plan-label exercises
    # (S2 Q16-20 IELTS standard format). Admin-initiated only; the
    # student player renders the signed URL inline so the map is part
    # of the test paper rather than a text-only description.
    #   * LISTENING_MAP_IMAGE_MODEL — primary model id; the service
    #     walks ``services.listening_map_image.FALLBACK_CHAIN`` on
    #     failure (Pro → legacy 2.5 Flash).
    #   * LISTENING_IMAGES_BUCKET — Supabase Storage bucket holding the
    #     generated PNGs (created in the dashboard, Private, with admin
    #     write + authenticated read policies).
    # Sprint 13.5.9.2 — Andy 2026-05-21 lock: Nano Banana 2 as the
    # cluster default. 95% of Pro quality at half the cost; ranks #1
    # AI Arena text-to-image. Override per environment via env var.
    LISTENING_MAP_IMAGE_MODEL: str = "gemini-3.1-flash-image-preview"
    LISTENING_IMAGES_BUCKET: str = "listening-images"

    # Sprint 20.14f-α — Supabase Storage bucket holding reading
    # diagram / flow-chart images. Same private + signed-URL pattern
    # as LISTENING_IMAGES_BUCKET. Created out-of-band BEFORE the first
    # admin upload works (Supabase dashboard → Storage → New bucket →
    # `reading-images` → Private). The student fetch mints 2h signed
    # URLs per request; nothing is persisted as a public URL.
    READING_IMAGES_BUCKET: str = "reading-images"

    # Sprint 11.2 — IELTS-friendly default voices locked during the
    # Sprint 11.1 audition (2026-05-18). Render endpoint uses these as
    # fallback when voice_id is omitted + accent_tag is set. AU defers
    # to Phase B voice cloning — stock library only offers Charlie
    # (male) which doesn't fit the IELTS narration norm.
    LISTENING_VOICE_US_FEMALE_DEFAULT: str = "EXAVITQu4vr4xnSDxMaL"  # Sarah
    LISTENING_VOICE_UK_FEMALE_DEFAULT: str = "Xb7hH8MSUJpSbSDYk0k2"  # Alice

    class Config:
        env_file = ".env"

    @property
    def ASYNC_DATABASE_URL(self) -> str:
        url = (self.DATABASE_URL or "").strip()
        if not url:
            return ""
        if url.startswith("postgresql+asyncpg://"):
            return url
        if url.startswith("postgres://"):
            return "postgresql+asyncpg://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            return "postgresql+asyncpg://" + url[len("postgresql://"):]
        return url


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
