"""Response contracts for the authenticated identity/profile spine."""

from pydantic import BaseModel


class AuthMeResponse(BaseModel):
    id: str
    email: str | None
    display_name: str | None
    avatar_url: str | None
    role: str
    is_active: bool
    permissions: list[str]
    onboarding_completed: bool
    target_band: float | None
    exam_date: str | None
    self_level: str | None
    preferred_topics: list[str]
    vocab_bank_enabled: bool
    d1_enabled: bool
    d3_enabled: bool
    flashcard_enabled: bool
    vocab_curated_enabled: bool


class AuthActiveStatusResponse(BaseModel):
    is_active: bool


class AuthProfileBase(BaseModel):
    id: str
    email: str | None
    display_name: str | None
    avatar_url: str | None
    role: str
    is_active: bool
    onboarding_completed: bool
    target_band: float | None
    exam_date: str | None
    self_level: str | None
    preferred_topics: list[str]
    timezone: str
    weekly_goal: int
    notification_email: bool


class AuthProfileStats(BaseModel):
    total_sessions: int
    avg_band: float | None
    joined_at: str | None


class AuthProfileResponse(AuthProfileBase):
    joined_at: str | None
    stats: AuthProfileStats


class AuthProfileUpdateResponse(AuthProfileBase):
    pass


class AuthActivateResponse(BaseModel):
    success: bool
    message: str
