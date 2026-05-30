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

    # AI APIs
    ANTHROPIC_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    # Google Cloud TTS
    GOOGLE_APPLICATION_CREDENTIALS: str = ""

    # Azure Cognitive Services — Pronunciation Assessment
    AZURE_SPEECH_KEY: str = ""
    AZURE_SPEECH_REGION: str = ""   # e.g. "eastus", "southeastasia"

    # Cloudinary (Phase 2.3c-1) — image hosting for Task 1 Academic
    # writing prompts. cloud_name + api_key are non-secret (they
    # appear in every signed upload URL); api_secret is server-only
    # and must NEVER be sent to the browser. All three default to
    # empty so the rest of the app starts cleanly when the feature
    # is unused — services/cloudinary_service.py raises a clear
    # error on first upload if credentials are missing.
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY:    str = ""
    CLOUDINARY_API_SECRET: str = ""

    # App config
    MAX_SESSIONS_PER_USER_PER_DAY: int = 10
    MAX_AUDIO_DURATION_SECONDS: int = 300

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

    # Sprint 11.1 — Listening module (DEBT-LISTENING-MODULE foundation 1/5).
    # ELEVENLABS_API_KEY: empty by default; render endpoint stays 503 until
    # Andy provisions the Creator plan. LISTENING_AI_RENDER_ENABLED is the
    # feature flag — flip to true in .env once the key is set (defense in
    # depth so a leaked key without intentional enablement still gates
    # safely).
    ELEVENLABS_API_KEY: str = ""
    LISTENING_AI_RENDER_ENABLED: bool = False
    LISTENING_AUDIO_BUCKET: str = "listening-audio"

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
