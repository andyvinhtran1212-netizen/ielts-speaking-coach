-- Migration 284: make ai_usage_logs a model-aware, idempotent usage ledger.
-- Provider invoices remain authoritative; cost_usd_est is a reproducible
-- estimate tied to pricing_version.

BEGIN;

ALTER TABLE ai_usage_logs
    ADD COLUMN IF NOT EXISTS feature TEXT,
    ADD COLUMN IF NOT EXISTS operation TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success',
    ADD COLUMN IF NOT EXISTS error_code TEXT,
    ADD COLUMN IF NOT EXISTS latency_ms INTEGER,
    ADD COLUMN IF NOT EXISTS request_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_request_id TEXT,
    ADD COLUMN IF NOT EXISTS resource_type TEXT,
    ADD COLUMN IF NOT EXISTS resource_id TEXT,
    ADD COLUMN IF NOT EXISTS thinking_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS pricing_version TEXT,
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS cost_source TEXT NOT NULL DEFAULT 'catalog_estimate',
    ADD COLUMN IF NOT EXISTS usage_event_id TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- A full unique index is intentional: PostgreSQL still permits multiple NULLs,
-- while PostgREST can infer it for ON CONFLICT (usage_event_id). A partial
-- index cannot be inferred by Supabase's upsert and fails with SQLSTATE 42P10.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_event_id
    ON ai_usage_logs (usage_event_id);

CREATE INDEX IF NOT EXISTS idx_ai_usage_feature_ts
    ON ai_usage_logs (feature, created_at DESC)
    WHERE feature IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_resource
    ON ai_usage_logs (resource_type, resource_id)
    WHERE resource_id IS NOT NULL;

COMMENT ON COLUMN ai_usage_logs.usage_event_id IS
'Caller-supplied idempotency key. Retries/fallback attempts need distinct keys.';
COMMENT ON COLUMN ai_usage_logs.cost_source IS
'catalog_estimate, provider_reported, invoice_reconciled, or unpriced.';
COMMENT ON COLUMN ai_usage_logs.pricing_version IS
'Effective-dated price-catalog row used to reproduce cost_usd_est.';

COMMIT;

-- Rollback intentionally omitted: the added nullable/defaulted columns are
-- backward compatible, and dropping them would destroy observability history.
