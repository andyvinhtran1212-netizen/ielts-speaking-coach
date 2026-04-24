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

    # App config
    MAX_SESSIONS_PER_USER_PER_DAY: int = 10
    MAX_AUDIO_DURATION_SECONDS: int = 300

    # Vocab Bank feature flags
    VOCAB_ANALYSIS_ENABLED: bool = False
    VOCAB_ANALYSIS_MODEL: str = "claude-haiku-4-5-20251001"
    VOCAB_MIN_TRANSCRIPT_WORDS: int = 30
    VOCAB_MAX_PER_CATEGORY: int = 3
    VOCAB_BANK_FEATURE_FLAG_ENABLED: bool = False

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
