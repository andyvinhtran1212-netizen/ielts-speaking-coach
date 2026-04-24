-- Migration 018: analytics_events table
-- Purpose: Store named analytics events (e.g. vocab_wiki_viewed).
-- Used by POST /api/analytics/events introduced in Vocabulary Module Phase A.

CREATE TABLE IF NOT EXISTS analytics_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name  TEXT        NOT NULL,
    event_data  JSONB       NOT NULL DEFAULT '{}',
    session_id  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying by event name (e.g. counting vocab_wiki_viewed)
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_name
    ON analytics_events (event_name);

-- Index for time-range queries
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at
    ON analytics_events (created_at);
