-- Migration 322 — AIOPS-0024: admin AI model control, audit and failure log.
--
-- Additive only. With no ai_model_overrides row every feature keeps its
-- env/code-default provider order and model (services/ai_router.py); the
-- router reads this table through a 30–60 s in-process snapshot and falls back
-- to env/code defaults when it cannot.
--
--   ai_model_overrides       one row per routed feature: preferred provider and
--                            Claude model (NULL = inherit env/code default).
--   ai_model_override_audit  append-only, written ONLY by trigger: who changed
--                            what and when.
--   ai_provider_failures     routing-layer failed attempts and fallbacks. No
--                            prompt, output, message text, user or session id.
--   fn_admin_ai_usage_rollup / fn_admin_ai_failure_rollup
--                            grouped window aggregates for the admin dashboard,
--                            so no row cap can truncate totals.
--
-- Permissions: RLS on, no policies, nothing for anon/authenticated. The FastAPI
-- backend writes with the service role behind require_admin. The allowlist of
-- providers/models is enforced by the backend; the CHECKs below only bound the
-- shape so a hand edit cannot store arbitrary text.
--
-- Idempotent: safe to re-apply. Rollback (destroys audit/failure history; run
-- only after reverting dependent code) is documented in
-- specs/0024-admin-ai-model-control/rollout.md.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_model_overrides (
    feature            text        PRIMARY KEY
                                   CHECK (feature ~ '^[a-z][a-z0-9_]{1,63}$'),
    preferred_provider text        CHECK (preferred_provider IN ('anthropic', 'gemini', 'openai')),
    anthropic_model    text        CHECK (anthropic_model ~ '^claude-[a-z0-9.-]{1,60}$'),
    updated_by         uuid,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_model_override_audit (
    id                     bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    feature                text        NOT NULL,
    action                 text        NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
    old_preferred_provider text,
    new_preferred_provider text,
    old_anthropic_model    text,
    new_anthropic_model    text,
    -- No FK: the audit must survive the actor's account being deleted.
    changed_by             uuid,
    changed_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_model_override_audit_changed_at
    ON public.ai_model_override_audit (changed_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_provider_failures (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at  timestamptz NOT NULL DEFAULT now(),
    feature     text        NOT NULL CHECK (char_length(feature) BETWEEN 1 AND 64),
    provider    text        NOT NULL CHECK (provider IN ('anthropic', 'gemini', 'openai', 'unknown')),
    model       text        CHECK (char_length(model) <= 100),
    route_slot  text        CHECK (char_length(route_slot) <= 64),
    attempt     smallint    CHECK (attempt >= 0),
    error_type  text        NOT NULL CHECK (error_type IN (
                    'timeout', 'rate_limit', 'overloaded', 'server_error',
                    'api_error', 'network', 'invalid_json', 'empty_response',
                    'missing_key', 'not_configured', 'unknown')),
    error_code  text        CHECK (char_length(error_code) <= 64),
    outcome     text        NOT NULL CHECK (outcome IN ('retry', 'fallback', 'final'))
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_failures_created_at
    ON public.ai_provider_failures (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_provider_failures_feature_ts
    ON public.ai_provider_failures (feature, created_at DESC);

COMMENT ON TABLE public.ai_model_overrides IS
'AIOPS-0024 per-feature preferred provider / Claude model. NULL inherits env/code default. Written via PATCH /admin/ai/models/{feature}; read by services/ai_model_overrides.py.';
COMMENT ON TABLE public.ai_model_override_audit IS
'AIOPS-0024 append-only audit of ai_model_overrides, written only by trigger.';
COMMENT ON TABLE public.ai_provider_failures IS
'AIOPS-0024 routing-layer failed provider attempts/fallbacks. Operational metadata only: no prompt, output, message text, user or session id.';

-- ── Audit trigger ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_ai_model_override_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.ai_model_override_audit (
            feature, action, new_preferred_provider, new_anthropic_model, changed_by)
        VALUES (NEW.feature, 'insert', NEW.preferred_provider, NEW.anthropic_model, NEW.updated_by);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.preferred_provider IS NOT DISTINCT FROM NEW.preferred_provider
           AND OLD.anthropic_model IS NOT DISTINCT FROM NEW.anthropic_model
           AND OLD.feature = NEW.feature THEN
            RETURN NEW;
        END IF;
        INSERT INTO public.ai_model_override_audit (
            feature, action, old_preferred_provider, new_preferred_provider,
            old_anthropic_model, new_anthropic_model, changed_by)
        VALUES (NEW.feature, 'update', OLD.preferred_provider, NEW.preferred_provider,
                OLD.anthropic_model, NEW.anthropic_model, NEW.updated_by);
        RETURN NEW;
    END IF;
    -- DELETE: the deleting actor is unknown to the row; record NULL rather
    -- than attributing the change to the previous editor.
    INSERT INTO public.ai_model_override_audit (
        feature, action, old_preferred_provider, old_anthropic_model, changed_by)
    VALUES (OLD.feature, 'delete', OLD.preferred_provider, OLD.anthropic_model, NULL);
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_model_override_audit ON public.ai_model_overrides;
CREATE TRIGGER trg_ai_model_override_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.ai_model_overrides
    FOR EACH ROW EXECUTE FUNCTION public.fn_ai_model_override_audit();

CREATE OR REPLACE FUNCTION public.fn_ai_model_override_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'ai_model_override_audit is append-only'
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_model_override_audit_append_only ON public.ai_model_override_audit;
CREATE TRIGGER trg_ai_model_override_audit_append_only
    BEFORE UPDATE OR DELETE ON public.ai_model_override_audit
    FOR EACH ROW EXECUTE FUNCTION public.fn_ai_model_override_audit_append_only();

-- ── Dashboard rollups ──────────────────────────────────────────────────────

-- Grouped ledger sums for [p_start, p_end). pricing_version stays in the
-- group key so stored estimates are summed per price period and legacy rows
-- (no pricing_version) can be re-priced by services/ai_pricing.py.
CREATE OR REPLACE FUNCTION public.fn_admin_ai_usage_rollup(p_start timestamptz, p_end timestamptz)
RETURNS TABLE (
    feature            text,
    service            text,
    model              text,
    status             text,
    cost_source        text,
    pricing_version    text,
    calls              bigint,
    input_tokens       bigint,
    output_tokens      bigint,
    thinking_tokens    bigint,
    cache_read_tokens  bigint,
    cache_write_tokens bigint,
    audio_seconds      double precision,
    text_chars         bigint,
    cost_usd           double precision,
    priced_calls       bigint,
    last_at            timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT l.feature, l.service, l.model, l.status, l.cost_source, l.pricing_version,
           count(*),
           coalesce(sum(l.input_tokens), 0)::bigint,
           coalesce(sum(l.output_tokens), 0)::bigint,
           coalesce(sum(l.thinking_tokens), 0)::bigint,
           coalesce(sum(l.cache_read_tokens), 0)::bigint,
           coalesce(sum(l.cache_write_tokens), 0)::bigint,
           coalesce(sum(l.audio_seconds), 0)::double precision,
           coalesce(sum(l.text_chars), 0)::bigint,
           sum(l.cost_usd_est)::double precision,
           count(l.cost_usd_est),
           max(l.created_at)
      FROM public.ai_usage_logs l
     WHERE l.created_at >= p_start AND l.created_at < p_end
     GROUP BY l.feature, l.service, l.model, l.status, l.cost_source, l.pricing_version
$$;

CREATE OR REPLACE FUNCTION public.fn_admin_ai_failure_rollup(p_start timestamptz, p_end timestamptz)
RETURNS TABLE (
    feature    text,
    provider   text,
    error_type text,
    outcome    text,
    failures   bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT f.feature, f.provider, f.error_type, f.outcome, count(*)
      FROM public.ai_provider_failures f
     WHERE f.created_at >= p_start AND f.created_at < p_end
     GROUP BY f.feature, f.provider, f.error_type, f.outcome
$$;

-- ── Permissions ────────────────────────────────────────────────────────────

ALTER TABLE public.ai_model_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_model_override_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_provider_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_model_overrides, public.ai_model_override_audit,
                    public.ai_provider_failures
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ai_model_overrides, public.ai_model_override_audit,
                    public.ai_provider_failures
    FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_model_overrides TO service_role;
GRANT SELECT, INSERT ON TABLE public.ai_model_override_audit TO service_role;
GRANT SELECT, INSERT ON TABLE public.ai_provider_failures TO service_role;

REVOKE ALL ON FUNCTION public.fn_ai_model_override_audit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ai_model_override_audit_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_admin_ai_usage_rollup(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_admin_ai_failure_rollup(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_ai_usage_rollup(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_ai_failure_rollup(timestamptz, timestamptz) TO service_role;

COMMIT;
