"""Typed contracts for the admin AI dashboard (AIOPS-0024)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ValueSource = Literal["db_override", "env", "code_default"]
StoreStatus = Literal["ok", "stale", "unavailable", "not_migrated", "not_loaded"]
WindowKey = Literal["today", "7d", "30d"]


class _StrictOut(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ── Models in use / control ────────────────────────────────────────────────


class AiSourcedValueOut(_StrictOut):
    value: str | None
    source: ValueSource


class AiChainStepOut(_StrictOut):
    provider: str
    # Orchestrator slot for speaking_grading (anthropic_primary, grading_primary,
    # claude_haiku, claude_sonnet); equals ``provider`` for other features.
    slot: str
    model: str | None
    model_source: ValueSource
    available: bool
    note: str = ""


class AiExistingModelOut(_StrictOut):
    model: str
    setting: str
    source: ValueSource
    note: str = ""


class AiOverrideOut(_StrictOut):
    preferred_provider: str | None
    anthropic_model: str | None
    updated_at: str | None
    updated_by: str | None
    updated_by_email: str | None = None
    invalid_fields: list[str] = Field(default_factory=list)


class AiFeatureConfigOut(_StrictOut):
    feature: str
    label: str
    existing_provider: str
    # Empty when the feature currently bypasses ai_router (see routing_note).
    allowed_providers: list[str]
    routing_note: str | None = None
    effective_order: list[AiChainStepOut]
    preferred_provider: AiSourcedValueOut
    anthropic_model: AiSourcedValueOut
    existing_models: list[AiExistingModelOut]
    override: AiOverrideOut | None


class AiOverrideStoreOut(_StrictOut):
    status: StoreStatus
    last_refreshed_at: str | None
    last_error: str | None
    ttl_seconds: float


class AiOverrideAuditOut(_StrictOut):
    id: int
    feature: str
    action: Literal["insert", "update", "delete"]
    old_preferred_provider: str | None
    new_preferred_provider: str | None
    old_anthropic_model: str | None
    new_anthropic_model: str | None
    changed_by: str | None
    changed_by_email: str | None
    changed_at: str


class AdminAiModelsOut(_StrictOut):
    features: list[AiFeatureConfigOut]
    anthropic_models: list[str]
    anthropic_key_configured: bool
    store: AiOverrideStoreOut
    recent_changes: list[AiOverrideAuditOut]
    recent_changes_error: str | None = None
    computed_at: datetime


class AdminAiOverrideIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # null = inherit env/code default. Allowlist is enforced server-side.
    preferred_provider: str | None = Field(default=None, max_length=32)
    anthropic_model: str | None = Field(default=None, max_length=64)


# ── Usage ──────────────────────────────────────────────────────────────────


class AiWindowOut(_StrictOut):
    key: WindowKey
    start: datetime
    end: datetime
    timezone: str


class AiUsageTotalsOut(_StrictOut):
    calls: int = Field(ge=0)
    failed_calls: int = Field(ge=0)
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    thinking_tokens: int = Field(ge=0)
    cache_read_tokens: int = Field(ge=0)
    cache_write_tokens: int = Field(ge=0)
    cost_usd: float = Field(ge=0)
    priced_calls: int = Field(ge=0)
    unpriced_calls: int = Field(ge=0)
    legacy_calls: int = Field(ge=0)


class AiUsageFeatureOut(AiUsageTotalsOut):
    feature: str


class AiUsageProviderOut(AiUsageTotalsOut):
    provider: str


class AiUsageMetaOut(_StrictOut):
    source: Literal["ai_usage_logs"]
    note: str


class AdminAiUsageOut(_StrictOut):
    window: AiWindowOut
    totals: AiUsageTotalsOut
    by_feature: list[AiUsageFeatureOut]
    by_provider: list[AiUsageProviderOut]
    meta: AiUsageMetaOut


# ── Failures ───────────────────────────────────────────────────────────────


class AiFailureTotalsOut(_StrictOut):
    total: int = Field(ge=0)
    retry: int = Field(ge=0)
    fallback: int = Field(ge=0)
    final: int = Field(ge=0)


class AiFailureGroupOut(AiFailureTotalsOut):
    provider: str
    feature: str
    by_error_type: dict[str, int]


class AiFailureRecordOut(_StrictOut):
    id: int
    created_at: str
    feature: str
    provider: str
    model: str | None
    route_slot: str | None
    attempt: int | None
    error_type: str
    error_code: str | None
    outcome: Literal["retry", "fallback", "final"]


class AdminAiFailuresOut(_StrictOut):
    window: AiWindowOut
    store_status: Literal["ok", "not_migrated"]
    totals: AiFailureTotalsOut
    by_provider_feature: list[AiFailureGroupOut]
    recent: list[AiFailureRecordOut]
