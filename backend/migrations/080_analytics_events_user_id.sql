-- Migration: 080_analytics_events_user_id.sql
-- Sprint 17.4 — Foot-traffic tracking (Direction D).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Adds user attribution to analytics_events so the admin foot-traffic dashboard
-- can distinguish unique logged-in visitors from anonymous hits. Existing rows
-- stay NULL (anonymous); going-forward page_view events carry user_id when the
-- visitor is authenticated. No backfill.
--
-- (This is migration 080, the next free number — Sprint 17.3 deferred its
--  planned 080 cohort backfill, so no gap is created.)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- Dashboard query support: filter by event_name within a date window, and count
-- distinct users / attribute events.
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id
  ON analytics_events (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created
  ON analytics_events (event_name, created_at DESC);

-- ── Reverse (run manually if needed) ───────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_analytics_events_name_created;
-- DROP INDEX IF EXISTS idx_analytics_events_user_id;
-- ALTER TABLE analytics_events DROP COLUMN IF EXISTS user_id;
