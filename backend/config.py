from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    APP_NAME: str = "IELTS Speaking Coach"
    ENVIRONMENT: str = "development"
    # Serve /openapi.json, /docs, /docs/oauth2-redirect and /redoc only when
    # truthy (1/true/yes/on). Default closed: staging and production need no
    # env change. Local development only — see services/api_docs.py.
    ENABLE_API_DOCS: str = ""
    # Add the localhost dev origins to the CORS allowlist on a non-development
    # deployment (1/true/yes/on). Ignored in production, always — see
    # services/cors_policy.py. Development allows localhost without it.
    CORS_ALLOW_LOCALHOST: str = ""

    # Signed backend → Next cache invalidation. The admin vocabulary routes
    # mutate runtime DB content while Next caches public reads. Configure both
    # values per environment; absent values make the notifier a safe no-op.
    NEXT_CACHE_REVALIDATION_URL: str = ""
    AVER_CACHE_REVALIDATION_SECRET: str = ""
    # Vercel "Protection Bypass for Automation" secret. Set only where the
    # frontend sits behind Vercel Authentication (staging); when non-empty it
    # is sent as ``x-vercel-protection-bypass`` on the invalidation call so the
    # signed request reaches the route instead of the SSO wall.
    VERCEL_AUTOMATION_BYPASS_SECRET: str = ""

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
    # TASK B2 — hide E2E/QA test data from normal list views. Honoured only when
    # ENVIRONMENT=staging (services/test_data_visibility.py); never set it in
    # production. Admins can still opt in per browser with X-Show-Test-Data.
    HIDE_TEST_DATA: bool = False
    # ADMINAAL2-0032 — admin powers require a verified second factor (AAL2,
    # services/staff_guard.py). False = report-only: behaviour unchanged plus one
    # `admin_aal2_would_block` warning per blocked request. Enable per
    # environment only after every active admin holds a verified TOTP factor
    # (spec FR-017, rollout.md). Standard boolean parsing: an unparseable
    # value fails startup instead of choosing a mode. Runbook value: `false`.
    ADMIN_AAL2_ENFORCE: bool = False
    # Private outcome-evidence foundation. Requires migration 240 and explicit
    # rollout/coverage verification; never enabled implicitly by a code deploy.
    CORE_ATTEMPT_EVIDENCE_ENABLED: bool = False
    # Separate write-path rollout; verify migration 241/schema cache before use.
    SPEAKING_CREATION_RECEIPT_ENABLED: bool = False
    # Separate durable admission protocol, local foundation only (migration 247).
    # Does not enroll old routes or enable itself with diagnostic evidence.
    CORE_ADMISSION_LEDGER_ENABLED: bool = False
    # Separately retain owned reads/execution/fencing of existing admissions
    # while new preparation is disabled. No new command or baseline clock.
    CORE_ADMISSION_RECOVERY_ENABLED: bool = False
    # New compatible Dictation starts only. Turning this off must still allow
    # every already-frozen lexical-v2 attempt to read, grade and complete.
    DICTATION_LEXICAL_V2_ENABLED: bool = False

    # Writing prompt-bank (R1): public-read library browse on the student
    # dashboard. Default off until the prompts are launch-ready; flip to true
    # via env to expose the "Kho đề" tab + the /api/writing/prompt-bank data.
    WRITING_PROMPT_BANK_ENABLED: bool = False

    # AI APIs
    ANTHROPIC_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    # Anthropic-primary routing (services/ai_router.py). Text/JSON LLM tasks try
    # Claude first and fall back automatically — on error, timeout, rate limit,
    # malformed/invalid output, or a missing ANTHROPIC_API_KEY — to the
    # feature's existing provider with its existing model and behaviour.
    # Comma list of "anthropic", "openai", "gemini"; the feature's existing
    # provider is always kept as the final fallback even if omitted.
    AI_PROVIDER_ORDER: str = "anthropic,openai,gemini"
    # Per-feature overrides ("" → AI_PROVIDER_ORDER). AI-0004 FR-005 (revised
    # 2026-10-26): Speaking grading inherits the global order, so Claude
    # Sonnet 5.5 grades first and SPEAKING_GRADING_MODEL (Gemini 3.8) →
    # Haiku 4.5 → Sonnet 5 follow unchanged. Set "gemini" to restore the
    # Gemini-primary chain.
    AI_PROVIDER_ORDER_SPEAKING_GRADING: str = ""
    AI_PROVIDER_ORDER_WRITING_GRADING: str = ""
    AI_PROVIDER_ORDER_COURSE_WRITING: str = ""
    AI_PROVIDER_ORDER_ADVANCED_VOCAB_REWRITE: str = ""
    AI_PROVIDER_ORDER_QUESTION_GENERATION: str = ""
    AI_PROVIDER_ORDER_LISTENING_AUDIT: str = ""
    # Model per tier: GRADING for band grading, FAST for short structured
    # tasks. A per-feature ANTHROPIC_MODEL_<FEATURE> wins when non-empty.
    ANTHROPIC_MODEL_GRADING: str = "claude-sonnet-5-5"
    ANTHROPIC_MODEL_FAST: str = "claude-haiku-5-5"
    ANTHROPIC_MODEL_SPEAKING_GRADING: str = ""
    ANTHROPIC_MODEL_WRITING_GRADING: str = ""
    ANTHROPIC_MODEL_COURSE_WRITING: str = ""
    ANTHROPIC_MODEL_ADVANCED_VOCAB_REWRITE: str = ""
    ANTHROPIC_MODEL_QUESTION_GENERATION: str = ""
    ANTHROPIC_MODEL_LISTENING_AUDIT: str = ""
    # Bounds one Claude attempt so a slow call still leaves the fallback time.
    ANTHROPIC_TIMEOUT_SECONDS: float = 60.0
    # AIOPS-0024: how often each backend process re-reads the admin overrides
    # in ai_model_overrides (DB override > env > code default). Clamped to
    # 30–60 s; a failed read falls back to the env/code defaults above.
    AI_MODEL_OVERRIDE_TTL_SECONDS: float = 30.0

    # Speaking grader Gemini rung (audit 2026-07-02). Since the AI-0004 FR-005
    # revision it is the first fallback behind the Claude primary
    # (AI_PROVIDER_ORDER_SPEAKING_GRADING), and the primary again when that is
    # set to "gemini".
    # The Speaking grader used to be hardcoded to Claude Haiku 4.5 — the weakest
    # tier — while the Writing grader already uses Gemini Pro. This knob lets ops
    # point the *grader* at any model without a code change; the fallback chain
    # (Haiku → Sonnet) and the off-topic judge + grammar-check stay on Haiku.
    #   * "gemini-*"                  → routed to the Gemini provider
    #   * "claude-*" / "anthropic-*"  → routed to the Claude provider
    # Default: Gemini 3.8 Flash (GA). The rollout is intentionally reversible:
    # set SPEAKING_GRADING_MODEL=gemini-3.5-flash to flip the primary grader
    # back without a code deploy. Gemini 3.8 rejects legacy sampling controls;
    # GeminiProvider applies the shared request-shape compatibility guard.
    # Empty string → fall back to the legacy Haiku-first chain. Needs GEMINI_API_KEY.
    SPEAKING_GRADING_MODEL: str = "gemini-3.8-flash"

    # LISTENING_AUDIT_MODEL — the LLM used by the listening content-audit pass
    # (answer-in-script / solution-consistency / prompt-clarity). Routes by the
    # same "gemini-*"/"claude-*" prefix convention as SPEAKING_GRADING_MODEL. A
    # cheap flash model is plenty for a per-question sanity check.
    # Low-risk structured content audit. Gemini 3.8 Flash is the current stable
    # Flash line; unlike learner scoring, this path can roll back by env var.
    LISTENING_AUDIT_MODEL: str = "gemini-3.8-flash"

    # COURSE_WRITING_MODEL — soát ngữ pháp + chính tả cho phần tự luận của bài
    # tập theo buổi. Việc hẹp (sửa lỗi, KHÔNG nâng cấp câu) nên chọn hạng rẻ
    # nhất còn đủ: không cần suy luận sâu, cần nhất quán — bộ chấm chạy ở
    # nhiệt độ 0.
    # gemini-2.5-flash-lite BỊ NGỪNG CẤP 06/08: gọi nó trả 404 "no longer
    # available to new users", trong khi `list_models()` VẪN liệt kê nó — nhìn
    # danh sách không thấy gì bất thường. Học viên nhận "Bộ chấm tạm thời không
    # dùng được" và mất lượt nộp DUY NHẤT (em Lê Chinh).
    COURSE_WRITING_MODEL: str = "gemini-3.5-flash-lite"

    # Controlled Rewrite in Advanced Vocabulary: all 20 answers are reviewed
    # in one low-cost structured request, once per learner/unit.
    ADVANCED_VOCAB_REWRITE_MODEL: str = "gemini-3.5-flash-lite"

    # Speech-to-text model (audit 2026-07-02, finding #5). Default whisper-1 —
    # the only production-verified option here for per-segment avg_logprob and
    # timestamp behavior, which the transcript-reliability classifier and
    # duration guards depend on. Configurable so ops can trial a newer model (e.g.
    # gpt-transcribe) for accented-English accuracy; whisper.py chooses the
    # richest response format supported by each model and probes duration with
    # ffprobe when metadata is unavailable. Keep whisper-1 until A/B verification.
    WHISPER_STT_MODEL: str = "whisper-1"

    # audit #8 — request Whisper WORD-level timestamps and feed measured pause/
    # articulation-rate into the FC prompt (services.fluency_signals) instead of
    # the coarse total-words/total-duration heuristic. Default OFF: turning it on
    # changes Speaking grading, so it must be A/B'd against the gold set first
    # (docs/TECH_DEBT_gold_set_A1.md). Effective only when the selected model
    # supports verbose_json word timestamps.
    SPEAKING_WORD_TIMESTAMPS_ENABLED: bool = False

    # FE migration plan Phase 0 (B2) — deterministic provider fixture mode.
    # "real" (default) calls Whisper/Claude/Azure exactly as today. "fixture"
    # replaces the SPEAKING pipeline's provider calls (STT, grader,
    # pronunciation) with deterministic production-shaped payloads so staging
    # E2E is fast, free and repeatable — the persistence path still runs for
    # real. Server-side only: clients can NEVER choose the mode. Startup
    # ABORTS (services/provider_fixtures.assert_fixture_mode_safe) if fixture
    # mode is combined with the production environment or production Supabase
    # project — fail-closed by design.
    GRADING_PROVIDER_MODE: str = "real"
    # Optional fault injection, honored ONLY in fixture mode (applies to the
    # speaking-grader seam): "" | "timeout" | "429" | "5xx" | "malformed".
    GRADING_FIXTURE_FAULT: str = ""

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
    # name `writing-images`, Public OFF). PRIVATE: rows persist object
    # paths and readers mint short-lived signed URLs after authorizing
    # the viewer (services/writing_image_access.py).
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
    # F05 — POST /tts (OpenAI tts-1) caps. Daily per-user count of
    # ai_usage_logs feature="question_tts" rows since UTC midnight, plus a
    # per-worker, per-IP sliding minute window. <= 0 disables either cap.
    TTS_DAILY_LIMIT_PER_USER: int = 200
    TTS_IP_MAX_PER_MINUTE: int = 60
    # W-03 — Listening gist grading (POST /api/listening/attempts mode=gist,
    # one Claude Haiku call per attempt). Daily per-user count of
    # ai_usage_logs feature="listening_gist" rows since UTC midnight, plus a
    # per-worker, per-user sliding minute window. <= 0 disables either cap.
    LISTENING_GIST_DAILY_LIMIT_PER_USER: int = 60
    LISTENING_GIST_MAX_PER_MINUTE: int = 6

    # Vocab Bank feature flags
    VOCAB_ANALYSIS_ENABLED: bool = False
    # Short structured tasks: Haiku 5.5, with independent rollback controls.
    # Speaking scoring/judge fallbacks deliberately retain their calibrated models.
    VOCAB_ANALYSIS_MODEL: str = "claude-haiku-5-5"
    D1_QUESTION_MODEL: str = "claude-haiku-5-5"
    LISTENING_GIST_MODEL: str = "claude-haiku-5-5"
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

    # Sprint 2.6 — Writing grader prompt version selector. Default flipped
    # to v2 (2026-07-10, audit finding #1): v1's L1 prompt tells the model to
    # "aim to find 8-15 mistakes / re-read if you find 0 — students always
    # have basic errors" with no anti-fabrication floor, which drove the
    # zero-mistake-Band-5 fabrication incident (essay 0caf5e59). v2 adds the
    # ANTI-FABRICATION RULE + per-band descriptors + few-shot calibration.
    # Override per-env with WRITING_PROMPT_VERSION (hot-read per grade_essay()
    # call — no redeploy needed); per-essay logging through
    # writing_feedback.prompt_version lets Andy diff quality metrics by version.
    WRITING_PROMPT_VERSION: str = "v2"

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
    # student-submitted essays at L1–L3 use WRITING_FLASH_MODEL; L4–L5 stay
    # on gemini-2.5-pro. The owner approved 3.8 on staging on 2026-10-12
    # and will review grading quality. Roll back to 3.5 via WRITING_FLASH_MODEL.
    # KILL-SWITCH: set env WRITING_LEVEL_AWARE_MODEL=false
    # to revert all levels to Pro — no code change; settings load at process
    # start, so the Railway variable change restarts the service to pick it up.
    # Admin-picked models are NOT overridden — student-path default only.
    # NOTE: default True ⇒ ON the moment this deploys; set the env var false
    # at/before deploy if you want to roll out dark first.
    WRITING_LEVEL_AWARE_MODEL: bool = True
    WRITING_FLASH_MODEL: str = "gemini-3.8-flash"
    WRITING_FLASH_MAX_LEVEL: int = 3   # highest level that uses the Flash default

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

    # Retake self-timing backstop (mode='retake'): an in-process loop collects a
    # retaker's section when its per-sitting clock expires even if their browser
    # is gone, and finalises a sitting past its window. GRACE lets a live client
    # auto-submit first. Disable via RETAKE_REAPER_ENABLED=false.
    RETAKE_REAPER_ENABLED: bool = True
    RETAKE_REAPER_INTERVAL_SECONDS: int = 60
    RETAKE_REAPER_GRACE_SECONDS: int = 30
    # Timed Course quiz backstop: closes and grades an expired assessment even
    # when the learner's browser disappears before its countdown callback runs.
    COURSE_TIMER_REAPER_ENABLED: bool = True
    COURSE_TIMER_REAPER_INTERVAL_SECONDS: int = 60
    # Migration 274/275 accepts browser final batches for exactly 15 seconds.
    # Never let the background reaper take ownership before that DB window.
    COURSE_TIMER_REAPER_GRACE_SECONDS: int = Field(default=15, ge=15)
    # INACTIVEWRITE-0035 follow-up: daily row-growth alert. Flags a user who
    # created more than ROW_GROWTH_ALERT_THRESHOLD rows in one Vocabulary/
    # flashcard table in 24h as an error_logs warning (/admin/error-logs).
    # Runs once shortly after startup, then every INTERVAL; one alert per
    # user/table/UTC day. Disable via ROW_GROWTH_ALERT_ENABLED=false.
    ROW_GROWTH_ALERT_ENABLED: bool = True
    ROW_GROWTH_ALERT_INTERVAL_SECONDS: int = Field(default=86400, ge=3600)
    ROW_GROWTH_ALERT_STARTUP_DELAY_SECONDS: int = Field(default=600, ge=0)
    ROW_GROWTH_ALERT_THRESHOLD: int = Field(default=500, ge=1)
    WRITING_STUCK_JOB_TIMEOUT_SECONDS: int = 360        # standard tier
    WRITING_STUCK_JOB_TIMEOUT_DEEP_SECONDS: int = 600   # deep tier (3 passes)
    WRITING_GRADING_MAX_ATTEMPTS: int = 3
    WRITING_GRADING_FALLBACK_ENABLED: bool = True
    WRITING_FALLBACK_MODEL: str = "gemini-2.5-flash"

    # ELEVENLABS_API_KEY: used by the test-audio assembly narrator
    # (services/listening_audio.py) and vocab TTS (services/tts_audio.py).
    # The admin AI-render UI was decommissioned 2026-07-17 (usage audit).
    ELEVENLABS_API_KEY: str = ""
    # V-eleven — vocab audio generate. ElevenLabs en-GB voice + model used when
    # the admin picks engine="elevenlabs" (OpenAI stays the default engine).
    VOCAB_TTS_ELEVENLABS_VOICE_ID: str = "aHCytOTnUOgfGPn5n89j"
    VOCAB_TTS_ELEVENLABS_MODEL: str = "eleven_multilingual_v2"
    LISTENING_AUDIO_BUCKET: str = "listening-audio"

    # P0-1 (C-1.1) — async-DB migration kill switch. OFF = every path runs the
    # sync supabase_admin singleton exactly as today (the scaffold is a no-op).
    # ON = routers migrated to the db_async facade await the async client. Stays
    # OFF until a phase is wired + load-validated; flip per-deploy in .env.
    # Wired today: grading.py (P0-1 Phase 2) and the per-request auth layer
    # (PC-J05 D1a) — learner activation gate, require_admin/require_instructor,
    # /auth/me, /auth/check-active, /api/student/permissions.
    USE_ASYNC_DB: bool = False

    # C-* audit — Server-Timing observability gate. The W3C Server-Timing
    # middleware (main.py) runs on every non-/health request and exposes an
    # internal total/auth/db/app breakdown to all clients. Default OFF: in
    # prod it adds a per-request header (minor overhead + internal-timing
    # exposure) that is only useful while actively debugging. Flip to true in
    # .env (ENABLE_SERVER_TIMING=true) to turn it on for a debugging session.
    ENABLE_SERVER_TIMING: bool = False

    # LISTENING_IMAGES_BUCKET — Supabase Storage bucket holding map
    # images for plan-label exercises (Private; admin write +
    # authenticated read). Images are uploaded manually via the admin
    # exercise UI; the AI-generation path was decommissioned 2026-07-17.
    LISTENING_IMAGES_BUCKET: str = "listening-images"

    # Sprint 20.14f-α — Supabase Storage bucket holding reading
    # diagram / flow-chart images. Same private + signed-URL pattern
    # as LISTENING_IMAGES_BUCKET. Created out-of-band BEFORE the first
    # admin upload works (Supabase dashboard → Storage → New bucket →
    # `reading-images` → Private). The student fetch mints 2h signed
    # URLs per request; nothing is persisted as a public URL.
    READING_IMAGES_BUCKET: str = "reading-images"

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
